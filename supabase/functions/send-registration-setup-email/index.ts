// Delegate registration: email a set-password link via Supabase Auth SMTP.
// New email → Invite template. Existing auth account → Magic Link template (not Reset password).
// Optional: RESEND_API_KEY for fully custom HTML.
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

function registrationEmailContent(eventName: string, fullName: string, actionLink: string) {
  const subject = `Complete your registration — ${eventName}`;
  const greeting = fullName ? `Hi ${fullName},` : "Hi,";
  const html = `<p>${greeting}</p>
<p>Thank you for registering for <strong>${eventName}</strong>.</p>
<p>Click the button below to choose your password and sign in to your delegate portal.</p>
<p style="margin:24px 0"><a href="${actionLink}" style="display:inline-block;background:#1e4f8a;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px;font-weight:600">Complete registration</a></p>
<p style="color:#555;font-size:14px">If the button does not work, copy this link into your browser:<br/><a href="${actionLink}">${actionLink}</a></p>
<p style="color:#555;font-size:14px">This link expires after a short time. If it stops working, submit the registration form again to receive a new link.</p>`;
  const text =
    `${greeting}\n\nThank you for registering for ${eventName}.\n\nComplete your registration and choose your password using this link (expires after a short time):\n${actionLink}\n\nIf the link expires, submit the registration form again for a new link.`;
  return { subject, html, text };
}

async function sendViaResend(
  resendKey: string,
  fromEmail: string,
  email: string,
  content: { subject: string; html: string; text: string },
): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [email],
      subject: content.subject,
      html: content.html,
      text: content.text,
    }),
  });

  if (!res.ok) {
    console.error("Resend error", await res.text());
    return false;
  }

  return true;
}

async function findUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
) {
  const { data: listed, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1, filter: email });
  if (error) {
    console.error("listUsers", error);
    return null;
  }
  return listed?.users?.find((u) => (u.email ?? "").toLowerCase() === email) ?? null;
}

/** Magic Link email (customize in Supabase → Magic Link template). Not the Reset password template. */
async function sendViaSupabaseMagicLink(
  supabaseUrl: string,
  anonKey: string,
  email: string,
  redirectTo: string,
): Promise<{ ok: true } | { error: string; status: number }> {
  const res = await fetch(`${supabaseUrl}/auth/v1/otp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({
      email,
      options: {
        email_redirect_to: redirectTo,
        should_create_user: false,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("Supabase magic link email", res.status, detail);
    return { error: "Could not send registration email via Supabase Auth.", status: res.status >= 500 ? 502 : 400 };
  }

  return { ok: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail =
    Deno.env.get("REGISTRATION_FROM_EMAIL") ??
    Deno.env.get("SECURITY_ALERT_FROM_EMAIL") ??
    "KBM Connect <noreply@kbmcollective.org>";
  const cadminBase = (Deno.env.get("CADMIN_BASE_URL") ?? "https://cadmin.kbmcollective.org").replace(/\/+$/, "");

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ error: "Server configuration error" }, 500);
  }

  let body: { event_id?: string; email?: string; full_name?: string; attendee_type?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const eventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  const attendeeType = typeof body.attendee_type === "string" ? body.attendee_type.trim() : "attendee";

  if (!eventId || !email || !email.includes("@")) {
    return json({ error: "event_id and valid email are required" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: settingsRow, error: settingsErr } = await admin
    .from("event_matchmaking_settings")
    .select("registration_open")
    .eq("event_id", eventId)
    .maybeSingle();
  if (settingsErr) {
    return json({ error: settingsErr.message }, 500);
  }
  if (!settingsRow?.registration_open) {
    return json({ error: "Registration is not open for this event" }, 403);
  }

  const { data: eventRow } = await admin.from("events").select("name").eq("id", eventId).maybeSingle();
  const eventName = (eventRow as { name?: string } | null)?.name ?? "your event";

  const redirectTo = `${cadminBase}/portal/${eventId}/delegate/set-password`;
  const userMetadata = {
    full_name: fullName || null,
    event_id: eventId,
    attendee_type: attendeeType,
  };

  const existingUser = await findUserByEmail(admin, email);

  if (existingUser) {
    await admin.auth.admin.updateUserById(existingUser.id, {
      user_metadata: { ...(existingUser.user_metadata ?? {}), ...userMetadata },
    });
  }

  if (resendKey) {
    if (!existingUser) {
      const tempPassword = crypto.randomUUID().replace(/-/g, "") + "Aa1!";
      const { error: createErr } = await admin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: userMetadata,
      });
      if (createErr) {
        console.error("createUser", createErr);
        return json({ error: createErr.message || "Could not create account" }, 400);
      }
    }

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });

    if (!linkErr && linkData?.properties?.action_link) {
      const sent = await sendViaResend(
        resendKey,
        fromEmail,
        email,
        registrationEmailContent(eventName, fullName, linkData.properties.action_link),
      );
      if (sent) {
        return json({ ok: true, emailed: true, via: "resend" }, 200);
      }
    }
  }

  if (!existingUser) {
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: userMetadata,
    });
    if (!inviteErr) {
      return json({ ok: true, emailed: true, via: "supabase_invite" }, 200);
    }
    const alreadyExists =
      inviteErr.message?.toLowerCase().includes("already") ||
      inviteErr.message?.toLowerCase().includes("exists") ||
      (inviteErr as { code?: string }).code === "email_exists";
    if (!alreadyExists) {
      console.error("inviteUserByEmail", inviteErr);
      return json({ error: inviteErr.message || "Could not send registration email" }, 400);
    }
    console.warn("inviteUserByEmail: account exists, sending magic link instead", email);
  }

  const magicResult = await sendViaSupabaseMagicLink(supabaseUrl, anonKey, email, redirectTo);
  if ("error" in magicResult) {
    return json({ error: magicResult.error }, magicResult.status);
  }

  return json({ ok: true, emailed: true, via: "supabase_magiclink" }, 200);
});
