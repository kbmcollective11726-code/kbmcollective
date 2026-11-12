import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

function json(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const ch = corsHeaders(req, "Authorization, Content-Type, apikey");
  if (req.method === "OPTIONS") return corsPreflightResponse(req, "Authorization, Content-Type, apikey");
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, ch);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Server configuration error" }, 500, ch);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401, ch);

  let body: { user_id?: unknown; is_active?: unknown; event_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, ch);
  }

  const targetUserId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  const eventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
  if (!targetUserId || typeof body.is_active !== "boolean") {
    return json({ error: "user_id and boolean is_active are required" }, 400, ch);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user: caller },
    error: callerError,
  } = await callerClient.auth.getUser(authHeader.slice(7));
  if (callerError || !caller?.id) return json({ error: "Unauthorized" }, 401, ch);
  if (caller.id === targetUserId) {
    return json({ error: "You cannot change your own account status." }, 403, ch);
  }

  const { data: platformAdmin } = await callerClient.rpc("is_platform_admin", {
    p_user_id: caller.id,
  });
  const isPlatformAdmin = platformAdmin === true;
  const makeActive = body.is_active === true;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Event-scoped path: membership flag only — never Auth ban / global is_active.
  // Members UI always passes event_id; Platform Users omits it for global deactivate.
  if (eventId) {
    const { data: eventAdmin } = await callerClient.rpc("is_event_admin", {
      p_event_id: eventId,
    });
    if (!isPlatformAdmin && eventAdmin !== true) {
      return json(
        { error: "A verified platform admin or an event admin for this event is required." },
        403,
      );
    }

    const { data: targetMembership, error: membershipError } = await admin
      .from("event_members")
      .select("user_id")
      .eq("event_id", eventId)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (membershipError) {
      console.error("target event membership check", membershipError);
      return json({ error: "Could not verify target event membership." }, 500, ch);
    }
    if (!targetMembership) {
      return json({ error: "User is not a member of this event." }, 403, ch);
    }

    const { data: target, error: targetError } = await admin
      .from("users")
      .select("id, is_platform_admin, email, full_name")
      .eq("id", targetUserId)
      .maybeSingle();
    if (targetError || !target) return json({ error: "User not found" }, 404, ch);

    if (
      (target as { is_platform_admin?: boolean }).is_platform_admin === true &&
      !isPlatformAdmin
    ) {
      return json({ error: "Only a verified platform admin can change a platform admin." }, 403, ch);
    }

    const { error: memUpdateError } = await admin
      .from("event_members")
      .update({ is_active: makeActive })
      .eq("event_id", eventId)
      .eq("user_id", targetUserId);
    if (memUpdateError) {
      console.error("event membership status update", memUpdateError);
      return json({ error: "Could not update event membership status." }, 500, ch);
    }

    const targetRow = target as {
      email?: string | null;
      full_name?: string | null;
    };
    const { error: auditError } = await admin.rpc("insert_platform_audit_log", {
      p_category: "admin",
      p_action: makeActive ? "event_membership_activate" : "event_membership_deactivate",
      p_actor_user_id: caller.id,
      p_target_user_id: targetUserId,
      p_target_email: targetRow.email ?? null,
      p_target_name: targetRow.full_name ?? null,
      p_event_id: eventId,
      p_ip_address: null,
      p_details: { source: "set-account-active", scope: "event_membership" },
    });
    if (auditError) console.error("membership status audit", auditError);

    return json({ ok: true, is_active: makeActive, scope: "event_membership" }, 200, ch);
  }

  // Global path: platform admin only — users.is_active + Auth ban/unban.
  if (!isPlatformAdmin) {
    return json(
      { error: "Platform admin required for global account status changes. Pass event_id for event-scoped suspension." },
      403,
    );
  }

  const { data: target, error: targetError } = await admin
    .from("users")
    .select("id, is_platform_admin, email, full_name")
    .eq("id", targetUserId)
    .maybeSingle();
  if (targetError || !target) return json({ error: "User not found" }, 404, ch);

  if (makeActive) {
    const { error: authError } = await admin.auth.admin.updateUserById(targetUserId, {
      ban_duration: "none",
    });
    if (authError) {
      console.error("account unban", authError);
      return json({ error: "Could not restore authentication access." }, 500, ch);
    }
  }

  const { error: profileError } = await admin
    .from("users")
    .update({ is_active: makeActive })
    .eq("id", targetUserId);
  if (profileError) {
    console.error("profile status update", profileError);
    return json({ error: "Could not update account status." }, 500, ch);
  }

  if (!makeActive) {
    const { error: authError } = await admin.auth.admin.updateUserById(targetUserId, {
      // RLS blocks the current access token immediately; the ban prevents new
      // sign-ins and refresh-token renewal until an admin reactivates the user.
      ban_duration: "876000h",
    });
    if (authError) {
      console.error("account ban", authError);
      return json({
        ok: true,
        is_active: false,
        scope: "global",
        warning: "Database access was blocked, but the Auth ban could not be applied.",
      }, 200, ch);
    }
  }

  await admin
    .from("platform_admin_step_up_sessions")
    .delete()
    .eq("user_id", targetUserId);

  const targetRow = target as {
    email?: string | null;
    full_name?: string | null;
  };
  const { error: auditError } = await admin.rpc("insert_platform_audit_log", {
    p_category: "admin",
    p_action: makeActive ? "account_activate" : "account_deactivate",
    p_actor_user_id: caller.id,
    p_target_user_id: targetUserId,
    p_target_email: targetRow.email ?? null,
    p_target_name: targetRow.full_name ?? null,
    p_event_id: null,
    p_ip_address: null,
    p_details: { source: "set-account-active", scope: "global" },
  });
  if (auditError) console.error("account status audit", auditError);

  return json({ ok: true, is_active: makeActive, scope: "global" }, 200, ch);
});
