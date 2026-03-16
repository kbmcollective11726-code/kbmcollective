// Send push notifications to users (likes, comments, announcements).
// Called from app when someone likes, comments, or sends "Send now" announcement.
// Requires Authorization Bearer (user token). Uses service role to fetch push tokens.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Must match NOTIFICATION_CHANNEL_ID in app/_layout.tsx for sound + vibration on Android.
const ANDROID_CHANNEL_ID = "collectivelive_notifications_v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
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

  let body: { event_id?: string; title?: string; body?: string; recipient_user_ids?: string[]; post_id?: string; chat_user_id?: string; group_id?: string; booth_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { event_id, title, body: bodyText, recipient_user_ids, post_id, chat_user_id, group_id, booth_id } = body;
  if (!title || !Array.isArray(recipient_user_ids) || recipient_user_ids.length === 0) {
    return json({ error: "Missing title or recipient_user_ids" }, 400);
  }
  // Dedupe so the same user never gets duplicate push for one request
  const uniqueIds = [...new Set(recipient_user_ids as string[])];

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: users } = await admin
    .from("users")
    .select("id, push_token")
    .in("id", uniqueIds)
    .not("push_token", "is", null);

  const tokens = (users ?? []).map((u: { push_token: string }) => u.push_token).filter(Boolean);
  if (tokens.length === 0) {
    return json({ sent: 0, message: "No push tokens found for recipients" }, 200);
  }

  const pushData: Record<string, string> = {};
  if (event_id) pushData.event_id = event_id;
  if (post_id) {
    pushData.post_id = post_id;
    pushData.url = `collectivelive://post/${post_id}`;
  }
  if (chat_user_id) {
    pushData.chat_user_id = chat_user_id;
    pushData.url = `collectivelive://chat/${chat_user_id}`;
  }
  if (group_id) {
    pushData.group_id = group_id;
    pushData.url = `collectivelive://group/${group_id}`;
  }
  if (booth_id) {
    pushData.boothId = booth_id;
    pushData.url = `collectivelive://expo/${booth_id}`;
  }

  const messages = tokens.map((to: string) => ({
    to,
    title,
    body: (bodyText ?? "").slice(0, 200),
    data: pushData,
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
    if (!pushRes.ok) {
      const errText = await pushRes.text();
      console.warn("Expo push error:", errText);
      return json({ sent: 0, error: errText }, 500);
    }
  } catch (err) {
    console.error("Expo push request failed:", err);
    return json({ sent: 0, error: String(err) }, 500);
  }

  return json({ sent: tokens.length }, 200);
});

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
