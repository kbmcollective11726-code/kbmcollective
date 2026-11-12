// Stream a single post image to the browser (attachment). Server-side fetch avoids R2/CDN CORS blocking admin "Download".
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

function json(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function extFromUrl(url: string): string {
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\.(jpe?g|png|gif|webp)$/i);
    return m ? m[0].toLowerCase() : ".jpg";
  } catch {
    return ".jpg";
  }
}

/** Only allow fetching images from our configured R2 public host (SSRF guard). */
function assertAllowedImageUrl(imageUrl: string): { ok: true; url: URL } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return { ok: false, error: "Invalid image URL" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "Image URL must be https" };
  }
  const publicBase = Deno.env.get("R2_PUBLIC_URL")?.replace(/\/$/, "") ?? "";
  if (!publicBase) {
    return { ok: false, error: "R2_PUBLIC_URL not configured" };
  }
  let allowed: URL;
  try {
    allowed = new URL(publicBase);
  } catch {
    return { ok: false, error: "R2_PUBLIC_URL invalid" };
  }
  if (parsed.hostname.toLowerCase() !== allowed.hostname.toLowerCase()) {
    return { ok: false, error: "Image host not allowed" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "Image URL credentials not allowed" };
  }
  return { ok: true, url: parsed };
}

async function canManageEventPosts(
  callerClient: ReturnType<typeof createClient>,
  eventId: string,
): Promise<boolean> {
  const { data: platformAdmin } = await callerClient.rpc("is_platform_admin");
  if (platformAdmin === true) return true;
  const { data: eventAdmin } = await callerClient.rpc("is_event_admin", {
    p_event_id: eventId,
  });
  return eventAdmin === true;
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

  let body: { post_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, ch);
  }
  const postId = typeof body?.post_id === "string" ? body.post_id.trim() : "";
  if (!postId) {
    return json({ error: "post_id required" }, 400, ch);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: post, error: pErr } = await admin
    .from("posts")
    .select("id, event_id, image_url")
    .eq("id", postId)
    .maybeSingle();

  if (pErr || !post) {
    return json({ error: "Post not found" }, 404, ch);
  }

  const row = post as { id: string; event_id: string; image_url: string };
  if (!row.image_url) {
    return json({ error: "No image" }, 400, ch);
  }

  const allowed = await canManageEventPosts(callerClient, row.event_id);
  if (!allowed) {
    return json({ error: "Forbidden" }, 403, ch);
  }

  const urlCheck = assertAllowedImageUrl(row.image_url);
  if (!urlCheck.ok) {
    return json({ error: urlCheck.error }, 400, ch);
  }

  let imgRes: Response;
  try {
    // redirect: manual — re-validate final URL host if redirected
    imgRes = await fetch(urlCheck.url.toString(), { redirect: "manual" });
    if (imgRes.status >= 300 && imgRes.status < 400) {
      const loc = imgRes.headers.get("location");
      if (!loc) return json({ error: "Invalid redirect" }, 502, ch);
      const next = assertAllowedImageUrl(new URL(loc, urlCheck.url).toString());
      if (!next.ok) return json({ error: next.error }, 400, ch);
      imgRes = await fetch(next.url.toString(), { redirect: "error" });
    }
  } catch (e) {
    console.error("Image fetch error:", e);
    return json({ error: "Failed to fetch image from storage" }, 502, ch);
  }
  if (!imgRes.ok) {
    return json({ error: "Image fetch failed" }, 502, ch);
  }

  const buf = await imgRes.arrayBuffer();
  const ct = imgRes.headers.get("content-type") || "application/octet-stream";
  const ext = extFromUrl(row.image_url);

  return new Response(buf, {
    status: 200,
    headers: {
      ...ch,
      "Content-Type": ct,
      "Content-Disposition": `attachment; filename="photo-${row.id.slice(0, 8)}${ext}"`,
    },
  });
});
