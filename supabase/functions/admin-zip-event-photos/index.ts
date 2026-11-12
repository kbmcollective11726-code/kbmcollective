// Build a ZIP of post images for an event (platform / event admin only). Server-side fetch avoids CORS.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import JSZip from "https://esm.sh/jszip@3.10.1";

const MAX_FILES = 50;

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

  let body: { event_id?: string; post_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, ch);
  }

  const eventId = typeof body?.event_id === "string" ? body.event_id.trim() : "";
  const postIds = Array.isArray(body?.post_ids)
    ? body.post_ids.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];

  if (!eventId) {
    return json({ error: "event_id required" }, 400, ch);
  }
  if (postIds.length === 0) {
    return json({ error: "post_ids required" }, 400, ch);
  }
  if (postIds.length > MAX_FILES) {
    return json({ error: `At most ${MAX_FILES} photos per ZIP` }, 400, ch);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const allowed = await canManageEventPosts(callerClient, eventId);
  if (!allowed) {
    return json({ error: "Forbidden" }, 403, ch);
  }

  const { data: posts, error: qErr } = await admin
    .from("posts")
    .select("id, image_url, event_id")
    .eq("event_id", eventId)
    .in("id", postIds);

  if (qErr) {
    return json({ error: qErr.message }, 500, ch);
  }
  const list = (posts ?? []) as { id: string; image_url: string; event_id: string }[];
  if (list.length === 0) {
    return json({ error: "No matching posts" }, 404, ch);
  }
  if (list.length !== postIds.length) {
    return json({ error: "Some post IDs are invalid or not in this event" }, 400, ch);
  }

  const zip = new JSZip();
  let index = 0;
  for (const row of list) {
    if (!row.image_url) continue;
    let imgRes: Response;
    try {
      imgRes = await fetch(row.image_url, { redirect: "follow" });
    } catch (e) {
      console.error("zip image fetch:", row.id, e);
      return json({ error: `Failed to fetch image for post ${row.id.slice(0, 8)}` }, 502, ch);
    }
    if (!imgRes.ok) {
      return json({ error: `Image ${row.id.slice(0, 8)} returned ${imgRes.status}` }, 502, ch);
    }
    const buf = await imgRes.arrayBuffer();
    const ext = extFromUrl(row.image_url);
    index += 1;
    zip.file(`${String(index).padStart(3, "0")}-photo-${row.id.slice(0, 8)}${ext}`, buf);
  }

  const out = await zip.generateAsync({ type: "uint8array" });
  const filename = `event-photos-${eventId.slice(0, 8)}-${index}-files.zip`;

  return new Response(out, {
    status: 200,
    headers: {
      ...ch,
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
