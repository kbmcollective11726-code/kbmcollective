// Send push notification when a schedule session is starting in ~5 minutes.
// Invoke via cron every 1–2 minutes (e.g. Supabase cron or external). Use x-cron-secret if set.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Must match NOTIFICATION_CHANNEL_ID in app/_layout.tsx for sound + vibration on Android.
const ANDROID_CHANNEL_ID = "collectivelive_notifications_v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, x-cron-secret",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Sessions starting in ~4–6 minutes (so a cron every 1–2 min catches "5 mins" once)
  const { data: sessions, error: sessionsError } = await supabase
    .from("schedule_sessions")
    .select("id, event_id, title, start_time")
    .eq("is_active", true)
    .gte("start_time", new Date(Date.now() + 4 * 60 * 1000).toISOString())
    .lte("start_time", new Date(Date.now() + 6 * 60 * 1000).toISOString());

  if (sessionsError) {
    console.error("Fetch sessions error:", sessionsError);
    return json({ error: sessionsError.message }, 500);
  }

  const list = (sessions ?? []) as { id: string; event_id: string; title: string; start_time: string }[];
  if (list.length === 0) {
    return json({ sent: 0, message: "No sessions starting in 5 mins" }, 200);
  }

  // Already sent reminder for these?
  const { data: alreadySent } = await supabase
    .from("session_reminder_sent")
    .select("session_id")
    .in("session_id", list.map((s) => s.id));

  const sentSet = new Set((alreadySent ?? []).map((r: { session_id: string }) => r.session_id));
  const toProcess = list.filter((s) => !sentSet.has(s.id));
  if (toProcess.length === 0) {
    return json({ sent: 0, message: "Reminders already sent for these sessions" }, 200);
  }

  let totalSent = 0;
  for (const session of toProcess) {
    const { data: members } = await supabase
      .from("event_members")
      .select("user_id")
      .eq("event_id", session.event_id);

    const userIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
    if (userIds.length === 0) {
      await supabase.from("session_reminder_sent").insert({ session_id: session.id });
      continue;
    }

    const { data: users } = await supabase
      .from("users")
      .select("id, push_token")
      .in("id", userIds)
      .not("push_token", "is", null);

    const tokens = (users ?? []).map((u: { push_token: string }) => u.push_token).filter(Boolean);
    if (tokens.length > 0) {
      const title = "Event starting in 5 minutes";
      const body = `${session.title ?? "A session"} is starting soon. Check the Agenda.`;
      const messages = tokens.map((to: string) => ({
        to,
        title,
        body,
        data: { event_id: session.event_id, session_id: session.id, url: "collectivelive://schedule" },
        sound: "default",
        priority: "high",
        channelId: ANDROID_CHANNEL_ID,
        badge: 1,
      }));
      try {
        const pushRes = await fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(messages),
        });
        if (pushRes.ok) totalSent += tokens.length;
        else console.warn("Expo push error:", await pushRes.text());
      } catch (e) {
        console.error("Push request failed:", e);
      }
    }

    await supabase.from("session_reminder_sent").insert({ session_id: session.id });
  }

  return json({ sent: totalSent, sessions: toProcess.length }, 200);
});

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
