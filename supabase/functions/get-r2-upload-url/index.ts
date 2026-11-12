// Returns a presigned PUT URL for uploading an image to Cloudflare R2.
// App uploads the image directly to that URL, then uses publicUrl in the DB.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3@3.700.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.700.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeR2Upload } from "./authorize-r2-upload.ts";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
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
  const accountId = Deno.env.get("R2_ACCOUNT_ID");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("R2_BUCKET_NAME");
  const publicBaseUrl = Deno.env.get("R2_PUBLIC_URL");

  if (!supabaseUrl || !anonKey) {
    return json({ error: "Server configuration error" }, 500, ch);
  }
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return json({ error: "R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL in Supabase Edge Function secrets." }, 503, ch);
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

  let body: { key: string; contentType?: string; contentLength?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, ch);
  }
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const contentType = (typeof body.contentType === "string" ? body.contentType.trim() : "") || "image/jpeg";
  const authorization = await authorizeR2Upload(client, user.id, key, contentType);
  if (!authorization.allowed) {
    return json({ error: authorization.reason ?? "Upload is not allowed." }, 403, ch);
  }

  // Cap object size on the signed PUT when the client sends contentLength.
  // Legacy store builds (e.g. iOS build 41) omit contentLength and got 400,
  // which forced Supabase backup + the "backup storage" alert. Allow those
  // clients by signing without a ContentLength binding.
  const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
  const contentLengthRaw = (body as { contentLength?: unknown }).contentLength;
  let contentLength: number | undefined;
  if (typeof contentLengthRaw === "number" && Number.isFinite(contentLengthRaw)) {
    contentLength = Math.floor(contentLengthRaw);
    if (contentLength < 1 || contentLength > MAX_UPLOAD_BYTES) {
      return json({ error: "contentLength must be between 1 and 6MB" }, 400, ch);
    }
  } else if (contentLengthRaw != null && contentLengthRaw !== "") {
    return json({ error: "contentLength must be a number (bytes of the image body)" }, 400, ch);
  }
  if (!["image/jpeg", "image/png"].includes(contentType)) {
    return json({ error: "Only image/jpeg and image/png uploads are allowed" }, 400, ch);
  }

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const s3 = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    const putInput: {
      Bucket: string;
      Key: string;
      ContentType: string;
      ContentLength?: number;
    } = {
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    };
    if (contentLength != null) {
      putInput.ContentLength = contentLength;
    }
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand(putInput),
      { expiresIn: 300 }
    );
    const publicUrl = `${publicBaseUrl.replace(/\/$/, "")}/${key}`;
    return json({ uploadUrl, publicUrl });
  } catch (err) {
    console.error("R2 presign error:", err);
    return json({ error: "Failed to generate upload URL" }, 500, ch);
  }
});
