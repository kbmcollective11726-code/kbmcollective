// Set password and/or Auth email (no magic link). Platform admins: any user. Event admins: only members of that event.
// Syncing Auth email matters: the app signs in with auth.users.email, not only public.users.email.
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

  let body: {
    user_id?: string;
    new_password?: string;
    new_email?: string;
    event_id?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const targetUserId = typeof body?.user_id === "string" ? body.user_id.trim() : "";
  const newPasswordRaw = typeof body?.new_password === "string" ? body.new_password : "";
  const newPassword = newPasswordRaw.trim();
  const newEmailRaw = typeof body?.new_email === "string" ? body.new_email.trim() : "";
  const newEmail = newEmailRaw.toLowerCase();
  const eventId =
    typeof body?.event_id === "string" && body.event_id.trim().length > 0
      ? body.event_id.trim()
      : null;

  if (!targetUserId) {
    return json({ error: "user_id required" }, 400);
  }

  const wantsPassword = newPassword.length > 0;
  const wantsEmail = newEmail.length > 0;
  if (!wantsPassword && !wantsEmail) {
    return json({ error: "Provide new_password and/or new_email" }, 400);
  }
  if (wantsPassword && newPassword.length < 8) {
    return json({ error: "new_password must be at least 8 characters" }, 400);
  }
  if (wantsEmail && (!newEmail.includes("@") || newEmail.length < 5)) {
    return json({ error: "new_email must be a valid email" }, 400);
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

  const { data: callerProfile } = await admin
    .from("users")
    .select("is_platform_admin")
    .eq("id", caller.id)
    .single();
  const isPlatformAdmin =
    (callerProfile as { is_platform_admin?: boolean } | null)?.is_platform_admin === true;

  const { data: targetProfile } = await admin
    .from("users")
    .select("is_platform_admin")
    .eq("id", targetUserId)
    .maybeSingle();
  if (!targetProfile) {
    return json({ error: "User not found" }, 404);
  }
  const targetIsPlatformAdmin =
    (targetProfile as { is_platform_admin?: boolean }).is_platform_admin === true;

  if (targetIsPlatformAdmin && !isPlatformAdmin) {
    return json({ error: "Only a platform admin can reset this user's password" }, 403);
  }

  if (isPlatformAdmin) {
    // ok — no event check
  } else {
    if (!eventId) {
      return json({ error: "event_id required for event admins" }, 400);
    }
    const { data: emCaller } = await admin
      .from("event_members")
      .select("role")
      .eq("event_id", eventId)
      .eq("user_id", caller.id)
      .maybeSingle();
    const callerRole = (emCaller as { role?: string } | null)?.role;
    const isEventAdmin = callerRole === "admin" || callerRole === "super_admin";
    if (!isEventAdmin) {
      return json({ error: "Only platform admins or event admins can reset passwords" }, 403);
    }
    const { data: emTarget } = await admin
      .from("event_members")
      .select("user_id")
      .eq("event_id", eventId)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (!emTarget) {
      return json({ error: "That user is not a member of this event" }, 403);
    }
  }

  const { data: authUser, error: getErr } = await admin.auth.admin.getUserById(targetUserId);
  if (getErr || !authUser?.user) {
    return json({ error: getErr?.message ?? "Auth user not found" }, 400);
  }

  const prevMeta = (authUser.user.user_metadata ?? {}) as Record<string, unknown>;

  const attrs: Record<string, unknown> = {};
  if (wantsPassword) {
    attrs.password = newPassword;
    attrs.user_metadata = { ...prevMeta, must_change_password: true };
  }
  if (wantsEmail) {
    attrs.email = newEmail;
    // So the user can sign in immediately without confirming via inbox (admin-set email).
    attrs.email_confirm = true;
  }

  const { error: upErr } = await admin.auth.admin.updateUserById(targetUserId, attrs);
  if (upErr) {
    console.error("auth.admin.updateUserById error:", upErr);
    return json({ error: upErr.message }, 400);
  }

  const { data: targetPublic } = await admin
    .from("users")
    .select("email, full_name")
    .eq("id", targetUserId)
    .maybeSingle();
  const auditActions: string[] = [];
  if (wantsPassword) auditActions.push("password_reset");
  if (wantsEmail) auditActions.push("email_change");
  for (const auditAction of auditActions) {
    await admin.rpc("insert_platform_audit_log", {
      p_category: "admin",
      p_action: auditAction,
      p_actor_user_id: caller.id,
      p_target_user_id: targetUserId,
      p_target_email: (targetPublic as { email?: string } | null)?.email ?? authUser.user.email ?? null,
      p_target_name: (targetPublic as { full_name?: string } | null)?.full_name ?? null,
      p_event_id: eventId,
      p_ip_address: null,
      p_details: {
        source: "admin-reset-user-password",
        ...(wantsEmail ? { new_email: newEmail } : {}),
      },
    });
  }

  return json({ success: true }, 200);
});
