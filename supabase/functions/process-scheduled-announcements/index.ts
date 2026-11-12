// Process scheduled announcements: send due announcements (notifications + push) and set sent_at.
// Invoke via cron (e.g. every minute) or manually with x-cron-secret header.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Must match app lib/notificationChannel.ts
const ANDROID_CHANNEL_ID = "collectivelive_notifications_v2";

const EXPO_BANNER_FIELDS = {
  sound: "default",
  priority: "high",
  channelId: ANDROID_CHANNEL_ID,
  badge: 1,
  vibrate: true,
} as const;

const NOTIF_INSERT_BATCH = 100;
const EXPO_PUSH_BATCH = 100;

const CORS_ALLOW_HEADERS = "Authorization, Content-Type, apikey, x-cron-secret";

interface AnnouncementRow {
  id: string;
  event_id: string;
  title: string;
  content: string | null;
  target_type: string | null;
  target_audience: string[] | null;
  target_user_ids: string[] | null;
}

function json(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const ch = corsHeaders(req, CORS_ALLOW_HEADERS);
  if (req.method === "OPTIONS") {
    return corsPreflightResponse(req, CORS_ALLOW_HEADERS);
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, ch);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500, ch);
  }
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return json({ error: "Unauthorized" }, 401, ch);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const pausedEventIds = new Set<string>();
  const pausedCheck = async (eventId: string): Promise<boolean> => {
    if (pausedEventIds.has(eventId)) return true;
    const { data, error } = await supabase
      .from("events")
      .select("notifications_paused, notifications_paused_until")
      .eq("id", eventId)
      .maybeSingle();
    if (error) throw error;
    const row = data as { notifications_paused?: boolean; notifications_paused_until?: string | null } | null;
    const untilMs = row?.notifications_paused_until ? Date.parse(row.notifications_paused_until) : NaN;
    const paused =
      row?.notifications_paused === true &&
      (!Number.isFinite(untilMs) || untilMs > Date.now());
    if (paused) pausedEventIds.add(eventId);
    return paused;
  };

  const now = new Date().toISOString();
  const { data: rows, error: fetchError } = await supabase
    .from("announcements")
    .select("id, event_id, title, content, target_type, target_audience, target_user_ids")
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", now)
    .is("sent_at", null);

  if (fetchError) {
    console.error("Fetch scheduled announcements error:", fetchError);
    return json({ error: fetchError.message }, 500, ch);
  }

  const announcements = (rows ?? []) as AnnouncementRow[];
  if (announcements.length === 0) {
    return json({ processed: 0, message: "No due announcements" }, 200, ch);
  }

  let processed = 0;
  for (const row of announcements) {
    try {
      if (await pausedCheck(row.event_id)) {
        await supabase.from("announcements").update({ sent_at: now }).eq("id", row.id);
        processed++;
        continue;
      }
      const recipientIds = await getRecipientIds(supabase, row);
      if (recipientIds.length === 0) {
        await supabase.from("announcements").update({ sent_at: now }).eq("id", row.id);
        processed++;
        continue;
      }

      const notifRows = recipientIds.map((userId) => ({
        user_id: userId,
        event_id: row.event_id,
        type: "announcement",
        title: row.title,
        body: row.content,
        data: {},
      }));
      for (let i = 0; i < notifRows.length; i += NOTIF_INSERT_BATCH) {
        const chunk = notifRows.slice(i, i + NOTIF_INSERT_BATCH);
        const { error: notifErr } = await supabase.from("notifications").insert(chunk);
        if (notifErr) {
          console.error("Announcement notification batch insert failed:", row.id, notifErr);
          throw notifErr;
        }
      }

      const { data: users } = await supabase
        .from("users")
        .select("id, push_token")
        .in("id", recipientIds)
        .not("push_token", "is", null);

      const tokens = Array.from(
        new Set((users ?? []).map((u: { push_token: string }) => u.push_token).filter(Boolean)),
      );
      if (tokens.length > 0) {
        for (let offset = 0; offset < tokens.length; offset += EXPO_PUSH_BATCH) {
          const batch = tokens.slice(offset, offset + EXPO_PUSH_BATCH);
          const messages = batch.map((to: string) => ({
            to,
            title: row.title,
            body: (row.content ?? "").slice(0, 200),
            data: { event_id: row.event_id },
            ...EXPO_BANNER_FIELDS,
          }));
          const pushRes = await fetch(EXPO_PUSH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(messages),
          });
          if (!pushRes.ok) {
            console.warn("Expo push error:", await pushRes.text());
          }
        }
      }

      await supabase.from("announcements").update({ sent_at: now }).eq("id", row.id);
      processed++;
    } catch (err) {
      console.error("Process announcement error:", row.id, err);
    }
  }

  return json({ processed, total: announcements.length }, 200, ch);
});

async function getRecipientIds(
  supabase: ReturnType<typeof createClient>,
  row: AnnouncementRow
): Promise<string[]> {
  const type = row.target_type ?? "all";
  if (type === "specific" && row.target_user_ids?.length) {
    return row.target_user_ids;
  }
  if (type === "audience" && row.target_audience?.length) {
    const { data } = await supabase
      .from("event_members")
      .select("user_id")
      .eq("event_id", row.event_id)
      .in("role", row.target_audience);
    return (data ?? []).map((r: { user_id: string }) => r.user_id);
  }
  const { data } = await supabase
    .from("event_members")
    .select("user_id")
    .eq("event_id", row.event_id);
  return (data ?? []).map((r: { user_id: string }) => r.user_id);
}
