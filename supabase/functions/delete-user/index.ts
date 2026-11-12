// Delete a user account and all associated data.
// Caller can delete their own account (self-deletion) or, if platform admin, delete another user.
// Clears FKs that use NO ACTION, purges R2 objects when possible, then auth.admin.deleteUser.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { S3Client, DeleteObjectsCommand, ListObjectsV2Command } from "npm:@aws-sdk/client-s3@3.700.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

function json(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

const R2_PURGE_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function keyFromPublicUrl(publicUrl: string, publicBaseUrl: string): string | null {
  const base = publicBaseUrl.replace(/\/$/, "");
  if (!publicUrl.startsWith(base + "/")) return null;
  return publicUrl.slice(base.length + 1);
}

async function purgeUserR2Objects(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<void> {
  const accountId = Deno.env.get("R2_ACCOUNT_ID");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("R2_BUCKET_NAME");
  const publicBaseUrl = Deno.env.get("R2_PUBLIC_URL");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    console.warn("delete-user: R2 not configured; skipping object purge");
    return;
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const keys = new Set<string>();

  // Avatar prefix
  const avatarPrefix = `avatars/${userId}/`;
  let token: string | undefined;
  do {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: avatarPrefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of listed.Contents ?? []) {
      if (obj.Key) keys.add(obj.Key);
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);

  // Post / profile images stored as public URLs
  const { data: posts } = await admin.from("posts").select("image_url").eq("user_id", userId);
  for (const row of posts ?? []) {
    const url = (row as { image_url?: string | null }).image_url;
    if (!url) continue;
    const key = keyFromPublicUrl(url, publicBaseUrl);
    if (key) keys.add(key);
  }

  const { data: profile } = await admin.from("users").select("avatar_url").eq("id", userId).maybeSingle();
  const avatarUrl = (profile as { avatar_url?: string | null } | null)?.avatar_url;
  if (avatarUrl) {
    const key = keyFromPublicUrl(avatarUrl, publicBaseUrl);
    if (key) keys.add(key);
  }

  const keyList = [...keys];
  for (let i = 0; i < keyList.length; i += 1000) {
    const chunk = keyList.slice(i, i + 1000).map((Key) => ({ Key }));
    if (chunk.length === 0) continue;
    try {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: chunk, Quiet: true },
        }),
      );
    } catch (err) {
      console.error("delete-user: R2 DeleteObjects failed:", err);
    }
  }
}

Deno.serve(async (req: Request) => {
  const ch = corsHeaders(req, "Authorization, Content-Type, apikey");
  if (req.method === "OPTIONS") {
    return corsPreflightResponse(req, "Authorization, Content-Type, apikey");
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, ch);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Server configuration error" }, 500, ch);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Authorization required" }, 401, ch);
  }

  const userJwt = authHeader.slice(7);
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller } } = await callerClient.auth.getUser(userJwt);
  if (!caller?.id) {
    return json({ error: "Invalid token" }, 401, ch);
  }

  let body: { user_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, ch);
  }
  const targetUserId = typeof body?.user_id === "string" ? body.user_id.trim() : null;
  if (!targetUserId) {
    return json({ error: "user_id required" }, 400, ch);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const isSelfDelete = targetUserId === caller.id;
  if (!isSelfDelete) {
    const { data: platformAdmin } = await callerClient.rpc("is_platform_admin");
    if (platformAdmin !== true) {
      return json({ error: "Verified platform admin required" }, 403, ch);
    }
  }

  const { data: targetProfile } = await admin
    .from("users")
    .select("email, full_name")
    .eq("id", targetUserId)
    .maybeSingle();
  const targetEmail = (targetProfile as { email?: string } | null)?.email ?? null;
  const targetName = (targetProfile as { full_name?: string } | null)?.full_name ?? null;

  // Purge R2 before Auth delete so we still have profile/post URLs.
  // Cap wait time so Cloudflare/R2 slowness cannot block deletion for 150s.
  try {
    await withTimeout(purgeUserR2Objects(admin, targetUserId), R2_PURGE_TIMEOUT_MS, "R2 purge");
  } catch (err) {
    console.warn("delete-user: R2 purge skipped or timed out:", err);
  }

  await admin.from("announcements").update({ sent_by: null }).eq("sent_by", targetUserId);
  await admin.from("events").update({ created_by: null }).eq("created_by", targetUserId);
  await admin.from("vendor_booths").update({ contact_user_id: null }).eq("contact_user_id", targetUserId);
  await admin.from("vendor_booth_reps").delete().eq("user_id", targetUserId);

  await admin.rpc("insert_platform_audit_log", {
    p_category: "admin",
    p_action: isSelfDelete ? "account_self_delete" : "user_delete",
    p_actor_user_id: caller.id,
    p_target_user_id: targetUserId,
    p_target_email: targetEmail,
    p_target_name: targetName,
    p_event_id: null,
    p_ip_address: null,
    p_details: { source: "delete-user" },
  });

  const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId);
  if (deleteError) {
    console.error("auth.admin.deleteUser error:", deleteError);
    return json({ error: "Delete failed" }, 400, ch);
  }
  return json({ success: true }, 200, ch);
});
