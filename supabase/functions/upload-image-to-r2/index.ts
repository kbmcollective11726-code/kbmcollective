// Proxy upload: app sends image as base64, function uploads to R2 and returns public URL.
// transform "event-banner" letterboxes to 1200×750 (same as cadmin).
// processOnly returns letterboxed base64 without uploading (for storage fallbacks).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3@3.700.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Image } from "npm:imagescript@1.3.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
};

const MAX_BODY_BYTES = 6 * 1024 * 1024; // 6MB
const BANNER_W = 1200;
const BANNER_H = 750;
const BANNER_JPEG_QUALITY = 82;
/** Matches lib/eventBanner.ts EVENT_BANNER_LETTERBOX_BG */
const BANNER_FILL = 0x0c1f3dff;

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

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function sampleEdgeColor(img: Image): number {
  const w = img.width;
  const h = img.height;
  const points: [number, number][] = [
    [1, 1],
    [w, 1],
    [1, h],
    [w, h],
    [Math.max(1, Math.floor(w / 2)), 1],
    [Math.max(1, Math.floor(w / 2)), h],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [x, y] of points) {
    const p = img.getPixelAt(x, y);
    r += (p >> 24) & 0xff;
    g += (p >> 16) & 0xff;
    b += (p >> 8) & 0xff;
  }
  const n = points.length;
  return (((Math.round(r / n) << 24) | (Math.round(g / n) << 16) | (Math.round(b / n) << 8) | 0xff) >>> 0);
}

async function letterboxEventBanner(bytes: Uint8Array): Promise<Uint8Array> {
  const img = await Image.decode(bytes);
  const scale = Math.min(BANNER_W / img.width, BANNER_H / img.height);
  const drawW = Math.round(img.width * scale);
  const drawH = Math.round(img.height * scale);
  const dx = Math.round((BANNER_W - drawW) / 2);
  const dy = Math.round((BANNER_H - drawH) / 2);
  const fill =
    Math.abs(drawW - BANNER_W) < 2 && Math.abs(drawH - BANNER_H) < 2 ? BANNER_FILL : sampleEdgeColor(img);
  const canvas = new Image(BANNER_W, BANNER_H);
  canvas.fill(fill);
  const resized = img.resize(drawW, drawH);
  canvas.composite(resized, dx, dy);
  return await canvas.encodeJPEG(BANNER_JPEG_QUALITY);
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
  if (!supabaseUrl || !anonKey) {
    return json({ error: "Server configuration error" }, 500);
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await client.auth.getUser(authHeader.slice(7));
  if (!user?.id) {
    return json({ error: "Invalid token" }, 401);
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
    return json({ error: "Invalid JSON body" }, 400);
  }

  const processOnly = body.processOnly === true;
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const contentType = (typeof body.contentType === "string" ? body.contentType.trim() : "") || "image/jpeg";
  const base64 = typeof body.base64 === "string" ? body.base64 : "";
  const transform = typeof body.transform === "string" ? body.transform.trim() : "";

  if (!base64) {
    return json({ error: "Missing base64 image" }, 400);
  }
  if (processOnly && transform !== "event-banner") {
    return json({ error: "processOnly requires event-banner transform" }, 400);
  }
  if (!processOnly && (!key || key.includes("..") || key.startsWith("/"))) {
    return json({ error: "Invalid key" }, 400);
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

  if (transform === "event-banner") {
    try {
      bytes = await letterboxEventBanner(bytes);
    } catch (err) {
      console.error("Banner letterbox error:", err);
      return json({ error: "Could not process banner image" }, 400);
    }
  }

  if (processOnly) {
    return json({ base64: uint8ArrayToBase64(bytes) });
  }

  const accountId = Deno.env.get("R2_ACCOUNT_ID");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("R2_BUCKET_NAME");
  const publicBaseUrl = Deno.env.get("R2_PUBLIC_URL");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return json({ error: "R2 not configured" }, 503);
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
