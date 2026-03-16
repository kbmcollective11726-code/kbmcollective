// Process scheduled announcements: send due announcements (notifications + push) and set sent_at.
// Invoke via cron (e.g. every minute) or manually with x-cron-secret header.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Must match NOTIFICATION_CHANNEL_ID in app/_layout.tsx for sound + vibration on Android.
const ANDROID_CHANNEL_ID = "collectivelive_notifications_v2";

interface AnnouncementRow {
  id: string;
  event_id: string;
  title: string;
  content: string | null;
  target_type: string | null;
  target_audience: string[] | null;
  target_user_ids: string[] | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
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

  const now = new Date().toISOString();
  const { data: rows, error: fetchError } = await supabase
    .from("announcements")
    .select("id, event_id, title, content, target_type, target_audience, target_user_ids")
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", now)
    .is("sent_at", null);

  if (fetchError) {
    console.error("Fetch scheduled announcements error:", fetchError);
    return json({ error: fetchError.message }, 500);
  }

  const announcements = (rows ?? []) as AnnouncementRow[];
  if (announcements.length === 0) {
    return json({ processed: 0, message: "No due announcements" }, 200);
  }

  let processed = 0;
  for (const row of announcements) {
    try {
      const recipientIds = await getRecipientIds(supabase, row);
      if (recipientIds.length === 0) {
        await supabase.from("announcements").update({ sent_at: now }).eq("id", row.id);
        processed++;
        continue;
      }

      for (const userId of recipientIds) {
        await supabase.from("notifications").insert({
          user_id: userId,
          event_id: row.event_id,
          type: "announcement",
          title: row.title,
          body: row.content,
          data: {},
        });
      }

      const { data: users } = await supabase
        .from("users")
        .select("id, push_token")
        .in("id", recipientIds)
        .not("push_token", "is", null);

      const tokens = (users ?? []).map((u: { push_token: string }) => u.push_token).filter(Boolean);
      if (tokens.length > 0) {
        const messages = tokens.map((to: string) => ({
          to,
          title: row.title,
          body: (row.content ?? "").slice(0, 200),
          data: { event_id: row.event_id },
          sound: "default",
          priority: "high",
          channelId: ANDROID_CHANNEL_ID,
          badge: 1,
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

      await supabase.from("announcements").update({ sent_at: now }).eq("id", row.id);
      processed++;
    } catch (err) {
      console.error("Process announcement error:", row.id, err);
    }
  }

  return json({ processed, total: announcements.length }, 200);
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

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-cron-secret",
  };
}
