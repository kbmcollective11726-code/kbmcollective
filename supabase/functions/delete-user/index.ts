// Platform admin only: delete a user account and all associated data.
// Clears FKs that use NO ACTION, then calls auth.admin.deleteUser (cascade removes public.users and related rows).
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

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile } = await admin
    .from("users")
    .select("is_platform_admin")
    .eq("id", caller.id)
    .single();
  if (!(profile as { is_platform_admin?: boolean } | null)?.is_platform_admin) {
    return json({ error: "Platform admin only" }, 403);
  }

  let body: { user_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const targetUserId = typeof body?.user_id === "string" ? body.user_id.trim() : null;
  if (!targetUserId) {
    return json({ error: "user_id required" }, 400);
  }
  if (targetUserId === caller.id) {
    return json({ error: "Cannot delete your own account" }, 400);
  }

  await admin.from("announcements").update({ sent_by: null }).eq("sent_by", targetUserId);
  await admin.from("events").update({ created_by: null }).eq("created_by", targetUserId);
  await admin.from("vendor_booths").update({ contact_user_id: null }).eq("contact_user_id", targetUserId);

  const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId);
  if (deleteError) {
    console.error("auth.admin.deleteUser error:", deleteError);
    return json({ error: deleteError.message }, 400);
  }
  return json({ success: true }, 200);
});
