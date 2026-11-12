// Approve/reject a registration submission and sync event_members for the mobile app Members roster.
// Approve → create/link Auth user, upsert event_members (active), link submission.user_id.
// Reject → mark rejected, deactivate event membership for this event (account kept).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

function json(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

type AttendeeType = "attendee" | "vendor" | "user" | string;

function rolesForAttendeeType(attendeeType: AttendeeType): { role: string; roles: string[] } {
  if (attendeeType === "vendor") return { role: "vendor", roles: ["vendor"] };
  if (attendeeType === "user") return { role: "speaker", roles: ["speaker"] };
  return { role: "attendee", roles: ["attendee"] };
}

async function findAuthUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<{ id: string; user_metadata?: Record<string, unknown> } | null> {
  const { data: listed, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1,
    filter: email,
  });
  if (error) {
    console.error("listUsers", error);
    return null;
  }
  const hit = listed?.users?.find((u) => (u.email ?? "").toLowerCase() === email) ?? null;
  return hit ? { id: hit.id, user_metadata: (hit.user_metadata ?? {}) as Record<string, unknown> } : null;
}

async function findPublicUserIdByEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<string | null> {
  const { data } = await admin.from("users").select("id").ilike("email", email).maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
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

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Authorization required" }, 401, ch);
  }

  // Database trigger for events with auto-approve on; approve only, never reject.
  const cronSecret = Deno.env.get("CRON_SECRET");
  const autoApprove = Boolean(cronSecret) && req.headers.get("x-cron-secret") === cronSecret;

  let body: { submission_id?: string; status?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON body" }, 400, ch);
  }

  const submissionId = typeof body.submission_id === "string" ? body.submission_id.trim() : "";
  const status = typeof body.status === "string" ? body.status.trim() : "";
  if (!submissionId || (status !== "approved" && status !== "rejected")) {
    return json({ error: "submission_id and status (approved|rejected) are required" }, 400, ch);
  }

  if (autoApprove && status !== "approved") {
    return json({ error: "Automatic approval can only approve" }, 400, ch);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  let callerId: string | null = null;
  if (!autoApprove) {
    const {
      data: { user: caller },
    } = await callerClient.auth.getUser(authHeader.slice(7));
    if (!caller?.id) {
      return json({ error: "Invalid token" }, 401, ch);
    }
    callerId = caller.id;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: submission, error: subErr } = await admin
    .from("event_registration_submissions")
    .select(
      "id, event_id, form_id, email, first_name, last_name, company_name, job_title, attendee_type, user_id, registration_status, meetings_enabled, matching_opt_in",
    )
    .eq("id", submissionId)
    .maybeSingle();
  if (subErr) {
    return json({ error: subErr.message }, 500, ch);
  }
  if (!submission) {
    return json({ error: "Registration not found" }, 404, ch);
  }

  const eventId = (submission as { event_id: string }).event_id;
  if (autoApprove) {
    const formId = (submission as { form_id?: string | null }).form_id ?? "";
    const { data: form } = await admin
      .from("event_registration_forms")
      .select("is_standard")
      .eq("id", formId)
      .maybeSingle();
    const { data: site } = await admin
      .from("event_public_sites")
      .select("auto_approve")
      .eq("form_id", formId)
      .maybeSingle();
    if (
      (form as { is_standard?: boolean } | null)?.is_standard !== true ||
      (site as { auto_approve?: boolean } | null)?.auto_approve !== true
    ) {
      return json({ error: "Automatic approval is not on for this registration form" }, 403, ch);
    }
    const currentStatus = (submission as { registration_status?: string | null }).registration_status;
    if (currentStatus && currentStatus !== "pending_review") {
      return json({ ok: true, skipped: `already_${currentStatus}` }, 200, ch);
    }
  } else {
    const { data: platformAdmin } = await callerClient.rpc("is_platform_admin");
    const isPlatformAdmin = platformAdmin === true;
    if (!isPlatformAdmin) {
      const { data: eventAdmin } = await callerClient.rpc("is_event_admin", {
        p_event_id: eventId,
      });
      if (eventAdmin !== true) {
        return json({ error: "Only platform admins or event admins can approve registrations" }, 403, ch);
      }
    }
  }

  const email = String((submission as { email?: string | null }).email ?? "")
    .trim()
    .toLowerCase();
  const firstName = String((submission as { first_name?: string | null }).first_name ?? "").trim();
  const lastName = String((submission as { last_name?: string | null }).last_name ?? "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const company = String((submission as { company_name?: string | null }).company_name ?? "").trim();
  const title = String((submission as { job_title?: string | null }).job_title ?? "").trim();
  const attendeeType = String((submission as { attendee_type?: string | null }).attendee_type ?? "attendee");
  const { role, roles } = rolesForAttendeeType(attendeeType);

  if (status === "rejected") {
    const { error: updErr } = await admin
      .from("event_registration_submissions")
      .update({
        registration_status: "rejected",
        rejected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", submissionId);
    if (updErr) return json({ error: updErr.message }, 400, ch);

    let userId =
      (submission as { user_id?: string | null }).user_id ??
      (email ? await findPublicUserIdByEmail(admin, email) : null);

    if (userId) {
      await admin
        .from("event_members")
        .update({ is_active: false })
        .eq("event_id", eventId)
        .eq("user_id", userId);
    }

    await admin.rpc("insert_platform_audit_log", {
      p_category: "admin",
      p_action: "registration_rejected",
      p_actor_user_id: callerId,
      p_target_user_id: userId,
      p_target_email: email || null,
      p_target_name: fullName || null,
      p_event_id: eventId,
      p_ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      p_details: { submission_id: submissionId, source: "sync-registration-membership" },
    });

    return json(
      {
        ok: true,
        status: "rejected",
        user_id: userId,
        membership_deactivated: Boolean(userId),
        message:
          "Registration rejected. Portal access is blocked and app membership for this event is turned off (account kept).",
      },
      200,
      ch,
    );
  }

  // --- approve ---
  if (!email.includes("@")) {
    return json({ error: "Cannot approve: registration has no valid email." }, 400, ch);
  }

  let userId = (submission as { user_id?: string | null }).user_id ?? null;
  let createdAccount = false;

  if (!userId) {
    userId = await findPublicUserIdByEmail(admin, email);
  }
  if (!userId) {
    const authUser = await findAuthUserByEmail(admin, email);
    if (authUser) userId = authUser.id;
  }

  if (!userId) {
    const tempPassword = crypto.randomUUID().replace(/-/g, "") + "Aa1!";
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: fullName || null,
        event_id: eventId,
        attendee_type: attendeeType,
      },
    });
    if (createErr || !created.user?.id) {
      return json({ error: createErr?.message || "Could not create app account" }, 400, ch);
    }
    userId = created.user.id;
    createdAccount = true;
  }

  // Ensure public.users row exists (trigger usually creates it; upsert profile fields).
  const profilePatch: Record<string, string | null> = {
    email,
    full_name: fullName || null,
  };
  if (title) profilePatch.title = title;
  if (company) profilePatch.company = company;

  const { data: existingProfile } = await admin.from("users").select("id").eq("id", userId).maybeSingle();
  if (existingProfile) {
    await admin.from("users").update(profilePatch).eq("id", userId);
  } else {
    await admin.from("users").upsert({ id: userId, ...profilePatch }, { onConflict: "id" });
  }

  const { error: linkErr } = await admin
    .from("event_registration_submissions")
    .update({
      user_id: userId,
      registration_status: "approved",
      rejected_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", submissionId);
  if (linkErr) return json({ error: linkErr.message }, 400, ch);

  const { error: memErr } = await admin.from("event_members").upsert(
    {
      event_id: eventId,
      user_id: userId,
      role,
      roles,
      is_active: true,
    },
    { onConflict: "event_id,user_id" },
  );
  if (memErr) return json({ error: memErr.message }, 400, ch);

  // Prefer registration Headshot/Photo as the app profile picture (real HTTPS only).
  const isUsableProfilePhotoUrl = (url: string): boolean => {
    const trimmed = url.trim();
    if (!/^https:\/\//i.test(trimmed)) return false;
    try {
      const host = new URL(trimmed).hostname.toLowerCase();
      if (host === "example.com" || host.endsWith(".example.com") || host === "localhost") {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  };
  const { data: headshotQuestions } = await admin
    .from("event_registration_questions")
    .select("id, prompt")
    .eq("form_id", (submission as { form_id?: string }).form_id ?? "");
  const headshotQuestionIds = ((headshotQuestions ?? []) as Array<{ id: string; prompt: string }>)
    .filter((q) => {
      const norm = (q.prompt ?? "").trim().toLowerCase();
      return norm === "headshot/photo" || norm === "speaker headshot";
    })
    .map((q) => q.id);
  if (headshotQuestionIds.length > 0) {
    const { data: headshotAnswers } = await admin
      .from("event_registration_answers")
      .select("answer_text")
      .eq("submission_id", submissionId)
      .in("question_id", headshotQuestionIds);
    const headshotUrl = ((headshotAnswers ?? []) as Array<{ answer_text?: string | null }>)
      .map((a) => (a.answer_text ?? "").trim())
      .find((url) => isUsableProfilePhotoUrl(url));
    if (headshotUrl) {
      await admin.from("users").update({ avatar_url: headshotUrl }).eq("id", userId);
    }
  }

  if (
    attendeeType === "vendor" &&
    (submission as { meetings_enabled?: boolean | null }).meetings_enabled !== false &&
    (submission as { matching_opt_in?: boolean | null }).matching_opt_in !== false
  ) {
    await admin.rpc("ensure_matchmaking_vendor_booth", { p_submission_id: submissionId });
  }

  await admin.rpc("insert_platform_audit_log", {
    p_category: "admin",
    p_action: "registration_approved",
    p_actor_user_id: callerId,
    p_target_user_id: userId,
    p_target_email: email,
    p_target_name: fullName || null,
    p_event_id: eventId,
    p_ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    p_details: {
      submission_id: submissionId,
      created_account: createdAccount,
      role,
      source: autoApprove ? "auto_approve" : "sync-registration-membership",
    },
  });

  return json(
    {
      ok: true,
      status: "approved",
      user_id: userId,
      created_account: createdAccount,
      role,
      message: createdAccount
        ? "Approved. App account created and added to Members. Use Resend email if they still need a password link."
        : "Approved. Added to Members so they can appear in the app.",
    },
    200,
    ch,
  );
});
