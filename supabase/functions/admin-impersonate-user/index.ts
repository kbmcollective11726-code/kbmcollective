// Issue a one-time magic link so an event/platform admin can open the member portal
// as that user (connect.* origin — does not replace the cadmin session).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

function json(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

type PortalRole = "delegate" | "vendor";

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

  let body: {
    user_id?: string;
    event_id?: string;
    role?: string;
    redirect_path?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, ch);
  }

  const targetUserId = typeof body?.user_id === "string" ? body.user_id.trim() : "";
  const eventId = typeof body?.event_id === "string" ? body.event_id.trim() : "";
  const roleRaw = typeof body?.role === "string" ? body.role.trim().toLowerCase() : "";
  const role: PortalRole | null =
    roleRaw === "vendor" || roleRaw === "sponsor"
      ? "vendor"
      : roleRaw === "delegate" || roleRaw === "attendee"
        ? "delegate"
        : null;
  const redirectPath =
    typeof body?.redirect_path === "string" && body.redirect_path.startsWith("/")
      ? body.redirect_path.trim()
      : "";

  if (!targetUserId) {
    return json({ error: "user_id required" }, 400, ch);
  }
  if (!eventId) {
    return json({ error: "event_id required" }, 400, ch);
  }
  if (!role) {
    return json({ error: "role must be delegate or vendor" }, 400, ch);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const userJwt = authHeader.slice(7);
  const {
    data: { user: caller },
  } = await callerClient.auth.getUser(userJwt);
  if (!caller?.id) {
    return json({ error: "Invalid token" }, 401, ch);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: isPlatformAdmin } = await callerClient.rpc("is_platform_admin");
  let allowed = isPlatformAdmin === true;
  if (!allowed) {
    const { data: isEventAdmin } = await callerClient.rpc("is_event_admin", {
      p_event_id: eventId,
    });
    allowed = isEventAdmin === true;
  }
  if (!allowed) {
    return json({ error: "Only platform or event admins can view as a member" }, 403, ch);
  }

  const { data: membership } = await admin
    .from("event_members")
    .select("user_id")
    .eq("event_id", eventId)
    .eq("user_id", targetUserId)
    .maybeSingle();

  const { data: submission } = await admin
    .from("event_registration_submissions")
    .select("id, attendee_type, user_id, email")
    .eq("event_id", eventId)
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (!membership && !submission) {
    return json({ error: "That user is not a member or registrant for this event" }, 403, ch);
  }

  const { data: authUser, error: getErr } = await admin.auth.admin.getUserById(targetUserId);
  if (getErr || !authUser?.user?.email) {
    return json({ error: getErr?.message ?? "Auth user or email not found" }, 400, ch);
  }

  const portalBase =
    Deno.env.get("PUBLIC_PORTAL_URL")?.trim().replace(/\/+$/, "") ||
    "https://connect.kbmcollective.org";
  const defaultPath = `/portal/${eventId}/${role}/welcome`;
  const path = redirectPath || defaultPath;
  const redirectTo = `${portalBase}${path}${path.includes("?") ? "&" : "?"}admin_view=1`;

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: authUser.user.email,
    options: { redirectTo },
  });
  if (linkErr || !linkData?.properties?.action_link) {
    console.error("generateLink error:", linkErr);
    return json({ error: linkErr?.message ?? "Could not create sign-in link" }, 400, ch);
  }

  const { data: targetPublic } = await admin
    .from("users")
    .select("email, full_name")
    .eq("id", targetUserId)
    .maybeSingle();

  await admin.rpc("insert_platform_audit_log", {
    p_category: "admin",
    p_action: "impersonate_user",
    p_actor_user_id: caller.id,
    p_target_user_id: targetUserId,
    p_target_email: (targetPublic as { email?: string } | null)?.email ?? authUser.user.email,
    p_target_name: (targetPublic as { full_name?: string } | null)?.full_name ?? null,
    p_event_id: eventId,
    p_ip_address: null,
    p_details: {
      source: "admin-impersonate-user",
      role,
      redirect_to: redirectTo,
    },
  });

  return json(
    {
      action_link: linkData.properties.action_link,
      email: authUser.user.email,
      role,
      redirect_to: redirectTo,
    },
    200,
    ch,
  );
});
