// Device push for user-report admins. In-app notifications are created by DB trigger notify_admins_on_user_report.
// Caller must be the report's reporter. Uses service role to resolve admin recipients (not exposed to client).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const ANDROID_CHANNEL_ID = "collectivelive_notifications_v2";

const EXPO_BANNER_FIELDS = {
  sound: "default",
  priority: "high",
  channelId: ANDROID_CHANNEL_ID,
  badge: 1,
  vibrate: true,
} as const;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
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

  const userJwt = authHeader.slice(7);
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller } } = await callerClient.auth.getUser(userJwt);
  if (!caller?.id) {
    return json({ error: "Invalid token" }, 401);
  }

  let body: { report_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const reportId = body.report_id?.trim();
  if (!reportId) {
    return json({ error: "Missing report_id" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: report, error: reportErr } = await admin
    .from("user_reports")
    .select("id, reporter_id, reported_user_id, reason, event_id")
    .eq("id", reportId)
    .maybeSingle();

  if (reportErr) {
    console.error("user_reports select:", reportErr);
    return json({ error: "Lookup failed" }, 500);
  }
  if (!report) {
    return json({ error: "Report not found" }, 404);
  }
  if (report.reporter_id !== caller.id) {
    return json({ error: "Forbidden" }, 403);
  }
  if (!report.event_id) {
    return json({ sent: 0, message: "No event on report; push skipped" }, 200);
  }

  const { data: eventRows, error: emErr } = await admin
    .from("event_members")
    .select("user_id, role, roles")
    .eq("event_id", report.event_id);

  if (emErr) {
    console.error("event_members select:", emErr);
    return json({ error: "Recipient lookup failed" }, 500);
  }

  const eventAdminIds: string[] = [];
  for (const row of eventRows ?? []) {
    const uid = row.user_id as string;
    const role = row.role as string;
    const roles = row.roles as string[] | null;
    const inPrimary = role === "admin" || role === "super_admin";
    const inRoles = Array.isArray(roles) &&
      (roles.includes("admin") || roles.includes("super_admin"));
    if (inPrimary || inRoles) eventAdminIds.push(uid);
  }

  const { data: platRows, error: platErr } = await admin
    .from("users")
    .select("id")
    .eq("is_platform_admin", true);

  if (platErr) {
    console.error("platform admins select:", platErr);
    return json({ error: "Recipient lookup failed" }, 500);
  }

  const platIds = (platRows ?? []).map((r: { id: string }) => r.id);
  const recipientSet = new Set<string>([...eventAdminIds, ...platIds]);
  recipientSet.delete(report.reporter_id as string);
  const uniqueIds = [...recipientSet];

  if (uniqueIds.length === 0) {
    return json({ sent: 0, message: "No admin recipients" }, 200);
  }

  const { data: users } = await admin
    .from("users")
    .select("id, push_token")
    .in("id", uniqueIds)
    .not("push_token", "is", null);

  const tokens = Array.from(
    new Set((users ?? []).map((u: { push_token: string }) => u.push_token).filter(Boolean)),
  );
  if (tokens.length === 0) {
    return json({ sent: 0, message: "No push tokens for recipients" }, 200);
  }

  const title = "User report";
  const bodyText = `A member submitted a report (${report.reason}). Review in Event safety.`;
  const pushData: Record<string, string> = { event_id: report.event_id as string };

  const messages = tokens.map((to: string) => ({
    to,
    title,
    body: bodyText.slice(0, 200),
    data: pushData,
    ...EXPO_BANNER_FIELDS,
  }));

  try {
    const pushRes = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    });
    const rawText = await pushRes.text();
    if (!pushRes.ok) {
      console.warn("Expo push HTTP error:", pushRes.status, rawText);
      return json({ sent: 0, error: rawText || pushRes.statusText }, 500);
    }
    let parsed: { data?: Array<{ status?: string }> } = {};
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return json({ sent: tokens.length }, 200);
    }
    const items = Array.isArray(parsed?.data) ? parsed.data : [];
    let okCount = 0;
    for (const item of items) {
      if (item?.status === "ok") okCount++;
    }
    return json({ sent: okCount }, 200);
  } catch (err) {
    console.error("Expo push request failed:", err);
    return json({ sent: 0, error: String(err) }, 500);
  }
});

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
