// Stream a single post image to the browser (attachment). Server-side fetch avoids R2/CDN CORS blocking admin "Download".
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
};

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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

async function canManageEventPosts(
  admin: ReturnType<typeof createClient>,
  callerId: string,
  eventId: string,
): Promise<boolean> {
  const { data: u } = await admin.from("users").select("is_platform_admin").eq("id", callerId).maybeSingle();
  if ((u as { is_platform_admin?: boolean } | null)?.is_platform_admin === true) return true;
  const { data: em } = await admin
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", callerId)
    .maybeSingle();
  const r = (em as { role?: string } | null)?.role;
  return r === "admin" || r === "super_admin";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Server configuration error" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Authorization required" }, 401);
  }

  const userJwt = authHeader.slice(7);
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller } } = await callerClient.auth.getUser(userJwt);
  if (!caller?.id) {
    return json({ error: "Invalid token" }, 401);
  }

  let body: { post_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const postId = typeof body?.post_id === "string" ? body.post_id.trim() : "";
  if (!postId) {
    return json({ error: "post_id required" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: post, error: pErr } = await admin
    .from("posts")
    .select("id, event_id, image_url")
    .eq("id", postId)
    .maybeSingle();

  if (pErr || !post) {
    return json({ error: "Post not found" }, 404);
  }

  const row = post as { id: string; event_id: string; image_url: string };
  if (!row.image_url) {
    return json({ error: "No image" }, 400);
  }

  const allowed = await canManageEventPosts(admin, caller.id, row.event_id);
  if (!allowed) {
    return json({ error: "Forbidden" }, 403);
  }

  let imgRes: Response;
  try {
    imgRes = await fetch(row.image_url, { redirect: "follow" });
  } catch (e) {
    console.error("Image fetch error:", e);
    return json({ error: "Failed to fetch image from storage" }, 502);
  }
  if (!imgRes.ok) {
    return json({ error: `Image returned ${imgRes.status}` }, 502);
  }

  const buf = await imgRes.arrayBuffer();
  const ct = imgRes.headers.get("content-type") || "application/octet-stream";
  const ext = extFromUrl(row.image_url);

  return new Response(buf, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": ct,
      "Content-Disposition": `attachment; filename="photo-${row.id.slice(0, 8)}${ext}"`,
    },
  });
});
