// After creating an event, call this to set the creator as event admin (bypasses RLS).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

  let body: { event_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const eventId = typeof body?.event_id === "string" ? body.event_id.trim() : null;
  if (!eventId) {
    return json({ error: "event_id required" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: event, error: eventError } = await admin
    .from("events")
    .select("id, created_by")
    .eq("id", eventId)
    .single();
  if (eventError || !event) {
    return json({ error: "Event not found" }, 404);
  }
  if ((event as { created_by: string | null }).created_by !== caller.id) {
    return json({ error: "Only the event creator can set themselves as admin" }, 403);
  }

  const { error: upsertError } = await admin
    .from("event_members")
    .upsert(
      {
        event_id: eventId,
        user_id: caller.id,
        role: "admin",
        roles: ["admin"],
      },
      { onConflict: "event_id,user_id" }
    );
  if (upsertError) {
    console.error("event_members upsert error:", upsertError);
    return json({ error: upsertError.message }, 500);
  }
  return json({ success: true }, 200);
});
