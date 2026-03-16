// Create user accounts in bulk from a list of emails (default password; must change on first sign-in).
// Callable by platform admin, or by event admin when event_id is provided (users are added to that event).
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

type Body = {
  emails?: string[];
  default_password?: string;
  event_id?: string;
  role?: string;
};

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

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const emails = Array.isArray(body.emails) ? body.emails : [];
  const defaultPassword = typeof body.default_password === "string" ? body.default_password.trim() : "";
  const eventId = typeof body.event_id === "string" ? body.event_id : null;
  const role = typeof body.role === "string" && body.role.trim() ? body.role.trim() : "attendee";
  const validRoles = ["attendee", "speaker", "vendor", "admin"];
  const eventRole = validRoles.includes(role) ? role : "attendee";

  if (emails.length === 0) {
    return json({ error: "emails array is required and must not be empty" }, 400);
  }
  if (defaultPassword.length < 8) {
    return json({ error: "default_password must be at least 8 characters" }, 400);
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
  const { data: profile } = await admin.from("users").select("is_platform_admin").eq("id", caller.id).single();
  const isPlatformAdmin = (profile as { is_platform_admin?: boolean } | null)?.is_platform_admin === true;

  if (eventId && !isPlatformAdmin) {
    const { data: em } = await admin
      .from("event_members")
      .select("role")
      .eq("event_id", eventId)
      .eq("user_id", caller.id)
      .maybeSingle();
    const member = em as { role?: string } | null;
    const isEventAdmin = member?.role === "admin" || member?.role === "super_admin";
    if (!isEventAdmin) {
      return json({ error: "Only platform admins or event admins can bulk-create users" }, 403);
    }
  } else if (!isPlatformAdmin) {
    return json({ error: "Platform admin or event admin required" }, 403);
  }

  const errors: string[] = [];
  let created = 0;
  const createdIds: string[] = [];

  for (const raw of emails) {
    const email = String(raw).trim().toLowerCase();
    if (!email || !email.includes("@")) {
      errors.push(`Invalid email: ${raw}`);
      continue;
    }
    const fullName = email.split("@")[0].replace(/[._]/g, " ") || "User";
    try {
      const { data: newUser, error } = await admin.auth.admin.createUser({
        email,
        password: defaultPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName, must_change_password: true },
      });
      if (error) {
        errors.push(`${email}: ${error.message}`);
        continue;
      }
      if (newUser?.user?.id) {
        created++;
        createdIds.push(newUser.user.id);
      }
    } catch (e) {
      errors.push(`${email}: ${e instanceof Error ? e.message : "Failed"}`);
    }
  }

  if (eventId && createdIds.length > 0) {
    for (const userId of createdIds) {
      await admin.from("event_members").upsert(
        { event_id: eventId, user_id: userId, role: eventRole },
        { onConflict: "event_id,user_id" }
      );
    }
  }

  return json({
    created,
    failed: errors.length,
    errors: errors.slice(0, 50),
  }, 200);
});
