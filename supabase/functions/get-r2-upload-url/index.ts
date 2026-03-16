// Returns a presigned PUT URL for uploading an image to Cloudflare R2.
// App uploads the image directly to that URL, then uses publicUrl in the DB.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3@3.700.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.700.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
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
    return json({ error: "R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL in Supabase Edge Function secrets." }, 503);
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await client.auth.getUser(authHeader.slice(7));
  if (!user?.id) {
    return json({ error: "Invalid token" }, 401);
  }

  let body: { key: string; contentType?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const contentType = (typeof body.contentType === "string" ? body.contentType.trim() : "") || "image/jpeg";
  if (!key || key.includes("..") || key.startsWith("/")) {
    return json({ error: "Invalid key" }, 400);
  }

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const s3 = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: 300 }
    );
    const publicUrl = `${publicBaseUrl.replace(/\/$/, "")}/${key}`;
    return json({ uploadUrl, publicUrl });
  } catch (err) {
    console.error("R2 presign error:", err);
    return json({ error: "Failed to generate upload URL" }, 500);
  }
});
