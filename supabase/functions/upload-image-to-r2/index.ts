// Proxy upload: app sends image as base64, function uploads to R2 and returns public URL.
// processOnly returns validated base64 without uploading (for storage fallbacks).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3@3.700.0";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const MAX_BODY_BYTES = 6 * 1024 * 1024; // 6MB

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const EVENT_KEY_PATTERN = new RegExp(`^event-photos/(${UUID_SOURCE})/(.+)$`, "i");
const AVATAR_KEY_PATTERN = new RegExp(`^avatars/(${UUID_SOURCE})/avatar_\\d+\\.(?:jpe?g|png)$`, "i");
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png"]);

async function authorizeR2Upload(
  client: SupabaseClient,
  userId: string,
  key: string,
  contentType: string,
): Promise<{ allowed: boolean; reason?: string }> {
  if (
    !key || key.length > 500 || key.includes("..") || key.startsWith("/") ||
    key.includes("\\") || !ALLOWED_CONTENT_TYPES.has(contentType)
  ) {
    return { allowed: false, reason: "Invalid image path or content type." };
  }
  const avatarMatch = key.match(AVATAR_KEY_PATTERN);
  if (avatarMatch) {
    return avatarMatch[1]?.toLowerCase() === userId.toLowerCase()
      ? { allowed: true }
      : { allowed: false, reason: "Avatar path must belong to the signed-in user." };
  }
  const eventMatch = key.match(EVENT_KEY_PATTERN);
  if (!eventMatch) return { allowed: false, reason: "Unsupported image path." };

  const eventId = eventMatch[1]!;
  const relativePath = eventMatch[2]!;
  const escapedUserId = userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ownedFile = `${escapedUserId}_\\d+\\.(?:jpe?g|png)`;
  const memberPath = new RegExp(
    `^(?:${ownedFile}|(?:chat|group-chat|vendor-logos|registration-headshots)/${ownedFile})$`,
    "i",
  );
  const registrantPath = new RegExp(`^(?:vendor-logos|registration-headshots)/${ownedFile}$`, "i");
  const adminPath = new RegExp(
    `^(?:banner_\\d+\\.jpe?g|badge_banner_\\d+\\.jpe?g|portal_banner_\\d+\\.jpe?g|${ownedFile}|(?:chat|group-chat|vendor-logos|registration-headshots|sponsor-logos)/${ownedFile})$`,
    "i",
  );
  const [
    { data: platformAdmin },
    { data: eventAdmin },
    { data: membership },
    { data: registration },
    { data: matchmakingSettings },
  ] = await Promise.all([
    client.rpc("is_platform_admin", { p_user_id: userId }),
    client.rpc("is_event_admin", { p_event_id: eventId }),
    client.from("event_members").select("user_id").eq("event_id", eventId).eq("user_id", userId).maybeSingle(),
    client.from("event_registration_submissions").select("id").eq("event_id", eventId).eq("user_id", userId).limit(1).maybeSingle(),
    client
      .from("event_matchmaking_settings")
      .select("registration_open")
      .eq("event_id", eventId)
      .maybeSingle(),
  ]);
  if (platformAdmin === true || eventAdmin === true) {
    return adminPath.test(relativePath) ? { allowed: true } : { allowed: false, reason: "Image path is not allowed for this event." };
  }
  if (membership) {
    return memberPath.test(relativePath) ? { allowed: true } : { allowed: false, reason: "Image path is not allowed for event members." };
  }
  if (registration || (matchmakingSettings as { registration_open?: boolean } | null)?.registration_open) {
    return registrantPath.test(relativePath)
      ? { allowed: true }
      : { allowed: false, reason: "Registration uploads must use the assigned event folder." };
  }
  return { allowed: false, reason: "You do not have access to upload images for this event." };
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Reject non-image payloads even if Content-Type claims jpeg/png. */
function detectImageMime(bytes: Uint8Array): "image/jpeg" | "image/png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}

Deno.serve(async (req: Request) => {
  const ch = corsHeaders(req, "Authorization, Content-Type, apikey");
  if (req.method === "OPTIONS") {
    return corsPreflightResponse(req, "Authorization, Content-Type, apikey");
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, ch);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Authorization required" }, 401, ch);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return json({ error: "Server configuration error" }, 500, ch);
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await client.auth.getUser(authHeader.slice(7));
  if (!user?.id) {
    return json({ error: "Invalid token" }, 401, ch);
  }
  const { data: accountActive } = await client.rpc("is_account_active", {
    p_user_id: user.id,
  });
  if (accountActive !== true) {
    return json({ error: "Account is deactivated" }, 403, ch);
  }

  let body: {
    key?: string;
    contentType?: string;
    base64: string;
    transform?: string;
    processOnly?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, ch);
  }

  const processOnly = body.processOnly === true;
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const contentType = (typeof body.contentType === "string" ? body.contentType.trim() : "") || "image/jpeg";
  const base64 = typeof body.base64 === "string" ? body.base64 : "";
  const transform = typeof body.transform === "string" ? body.transform.trim() : "";

  if (!base64) {
    return json({ error: "Missing base64 image" }, 400, ch);
  }
  if (processOnly && transform !== "event-banner") {
    return json({ error: "processOnly requires event-banner transform" }, 400, ch);
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToUint8Array(base64);
  } catch {
    return json({ error: "Invalid base64" }, 400, ch);
  }
  if (bytes.length > MAX_BODY_BYTES) {
    return json({ error: "Image too large" }, 413, ch);
  }

  const detected = detectImageMime(bytes);
  if (!detected) {
    return json({ error: "File must be a JPEG or PNG image" }, 400, ch);
  }
  const resolvedType = detected;

  if (processOnly) {
    return json({ base64: uint8ArrayToBase64(bytes), contentType: resolvedType });
  }

  const authorization = await authorizeR2Upload(client, user.id, key, resolvedType);
  if (!authorization.allowed) {
    return json({ error: authorization.reason ?? "Upload is not allowed" }, 403, ch);
  }

  const accountId = Deno.env.get("R2_ACCOUNT_ID");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("R2_BUCKET_NAME");
  const publicBaseUrl = Deno.env.get("R2_PUBLIC_URL");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return json({ error: "R2 not configured" }, 503, ch);
  }

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const s3 = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: resolvedType,
        ContentLength: bytes.length,
      })
    );
    const publicUrl = `${publicBaseUrl.replace(/\/$/, "")}/${key}`;
    return json({ publicUrl });
  } catch (err) {
    console.error("R2 upload error:", err);
    return json({ error: "Failed to upload to R2" }, 500, ch);
  }
});
