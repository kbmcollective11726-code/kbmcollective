// Letterbox an event's current banner to 1200×750 and update events.banner_url.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Image } from "npm:imagescript@1.3.0";

const BANNER_W = 1200;
const BANNER_H = 750;
const BANNER_JPEG_QUALITY = 82;
const BANNER_FILL = 0x0c1f3dff;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
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
  canvas.composite(img.resize(drawW, drawH), dx, dy);
  return await canvas.encodeJPEG(BANNER_JPEG_QUALITY);
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

  const bearer = authHeader.slice(7);
  const isServiceRole = bearer === serviceRoleKey;

  let callerId: string | null = null;
  let callerClient: ReturnType<typeof createClient> | null = null;
  if (!isServiceRole) {
    callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser(bearer);
    if (!caller?.id) {
      return json({ error: "Invalid token" }, 401, ch);
    }
    callerId = caller.id;
  }

  let body: { event_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, ch);
  }
  const eventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
  if (!eventId) {
    return json({ error: "event_id required" }, 400, ch);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  if (!isServiceRole && callerId && callerClient) {
    const { data: isPlatformAdmin } = await callerClient.rpc("is_platform_admin");

    if (isPlatformAdmin !== true) {
      const { data: isEventAdmin } = await callerClient.rpc("is_event_admin", {
        p_event_id: eventId,
      });
      if (isEventAdmin !== true) {
        return json({ error: "Event admin required" }, 403, ch);
      }
    }
  }

  const { data: event, error: eventError } = await admin
    .from("events")
    .select("id, banner_url")
    .eq("id", eventId)
    .single();
  if (eventError || !event) {
    return json({ error: "Event not found" }, 404, ch);
  }

  const bannerUrl = (event as { banner_url: string | null }).banner_url?.trim();
  if (!bannerUrl) {
    return json({ error: "No banner on this event" }, 400, ch);
  }

  let sourceBytes: Uint8Array;
  try {
    const imgRes = await fetch(bannerUrl);
    if (!imgRes.ok) {
      return json({ error: "Could not download banner" }, 400, ch);
    }
    sourceBytes = new Uint8Array(await imgRes.arrayBuffer());
  } catch {
    return json({ error: "Could not download banner" }, 400, ch);
  }

  let jpegBytes: Uint8Array;
  try {
    jpegBytes = await letterboxEventBanner(sourceBytes);
  } catch (err) {
    console.error("letterbox failed:", err);
    return json({ error: "Could not process banner image" }, 400, ch);
  }

  if (jpegBytes.length < 100) {
    return json({ error: "Banner processing failed" }, 500, ch);
  }

  try {
    const verify = await Image.decode(jpegBytes);
    if (verify.width !== BANNER_W || verify.height !== BANNER_H) {
      return json({ error: `Letterbox size mismatch: ${verify.width}×${verify.height}` }, 500, ch);
    }
  } catch {
    return json({ error: "Could not verify banner output" }, 500, ch);
  }

  const storagePath = `${eventId}/banner_${Date.now()}.jpg`;
  const { error: uploadError } = await admin.storage.from("event-photos").upload(storagePath, jpegBytes, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (uploadError) {
    console.error("storage upload:", uploadError);
    return json({ error: uploadError.message || "Upload failed" }, 500, ch);
  }

  const { data: pub } = admin.storage.from("event-photos").getPublicUrl(storagePath);
  const publicUrl = pub?.publicUrl;
  if (!publicUrl) {
    return json({ error: "No public URL" }, 500, ch);
  }

  const { error: updateError } = await admin
    .from("events")
    .update({ banner_url: publicUrl, updated_at: new Date().toISOString() })
    .eq("id", eventId);
  if (updateError) {
    return json({ error: updateError.message || "Failed to update event" }, 500, ch);
  }

  return json({ banner_url: publicUrl, width: BANNER_W, height: BANNER_H });
});
