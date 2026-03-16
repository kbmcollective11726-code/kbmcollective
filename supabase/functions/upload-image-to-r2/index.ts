// Proxy upload: app sends image as base64, function uploads to R2 and returns public URL.
// Use this when the app cannot reach R2 directly (e.g. Android). Images still end up on R2.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3@3.700.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const MAX_BODY_BYTES = 6 * 1024 * 1024; // 6MB

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Authorization required" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const accountId = Deno.env.get("R2_ACCOUNT_ID");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("R2_BUCKET_NAME");
  const publicBaseUrl = Deno.env.get("R2_PUBLIC_URL");

  if (!supabaseUrl || !anonKey) {
    return json({ error: "Server configuration error" }, 500);
  }
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return json({ error: "R2 not configured" }, 503);
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await client.auth.getUser(authHeader.slice(7));
  if (!user?.id) {
    return json({ error: "Invalid token" }, 401);
  }

  let body: { key: string; contentType?: string; base64: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const contentType = (typeof body.contentType === "string" ? body.contentType.trim() : "") || "image/jpeg";
  const base64 = typeof body.base64 === "string" ? body.base64 : "";
  if (!key || key.includes("..") || key.startsWith("/")) {
    return json({ error: "Invalid key" }, 400);
  }
  if (!base64) {
    return json({ error: "Missing base64 image" }, 400);
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToUint8Array(base64);
  } catch {
    return json({ error: "Invalid base64" }, 400);
  }
  if (bytes.length > MAX_BODY_BYTES) {
    return json({ error: "Image too large" }, 413);
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
        ContentType: contentType,
      })
    );
    const publicUrl = `${publicBaseUrl.replace(/\/$/, "")}/${key}`;
    return json({ publicUrl });
  } catch (err) {
    console.error("R2 upload error:", err);
    return json({ error: "Failed to upload to R2" }, 500);
  }
});
