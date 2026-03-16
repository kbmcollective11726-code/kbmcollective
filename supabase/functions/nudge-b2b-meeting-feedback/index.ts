// Send a one-time push nudge to rate a B2B meeting after it has ended.
// Run via cron every 15–30 minutes. Use x-cron-secret if set.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const ANDROID_CHANNEL_ID = "collectivelive_notifications_v2";
const NUDGE_WINDOW_START_MINS = 5;  // nudge 5 mins after meeting end
const NUDGE_WINDOW_END_MINS = 24 * 60; // up to 24 hours after

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, x-cron-secret",
};

type SlotRow = { id: string; booth_id: string; end_time: string };
type BoothRow = { id: string; vendor_name: string; event_id: string };
type BookingRow = { id: string; slot_id: string; attendee_id: string; status: string };

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

  const now = new Date();
  const windowStart = new Date(now.getTime() - NUDGE_WINDOW_END_MINS * 60 * 1000).toISOString();
  const windowEnd = new Date(now.getTime() - NUDGE_WINDOW_START_MINS * 60 * 1000).toISOString();

  // Slots that ended 5 mins to 24 hours ago
  const { data: slots, error: slotsError } = await supabase
    .from("meeting_slots")
    .select("id, booth_id, end_time")
    .lte("end_time", windowEnd)
    .gte("end_time", windowStart);

  if (slotsError) {
    console.error("Fetch meeting_slots error:", slotsError);
    return json({ error: slotsError.message }, 500);
  }

  const slotList = (slots ?? []) as SlotRow[];
  if (slotList.length === 0) {
    return json({ sent: 0, message: "No meetings in nudge window" }, 200);
  }

  const slotIds = slotList.map((s) => s.id);
  const boothIds = [...new Set(slotList.map((s) => s.booth_id))];

  const { data: bookings, error: bookError } = await supabase
    .from("meeting_bookings")
    .select("id, slot_id, attendee_id, status")
    .in("slot_id", slotIds)
    .eq("status", "confirmed");

  if (bookError) {
    console.error("Fetch meeting_bookings error:", bookError);
    return json({ error: bookError.message }, 500);
  }

  const bookingList = (bookings ?? []) as BookingRow[];
  if (bookingList.length === 0) {
    return json({ sent: 0, message: "No confirmed bookings" }, 200);
  }

  const bookingIds = bookingList.map((b) => b.id);

  const [feedbackRes, nudgeRes] = await Promise.all([
    supabase.from("b2b_meeting_feedback").select("booking_id").in("booking_id", bookingIds),
    supabase.from("b2b_meeting_feedback_nudge_sent").select("booking_id").in("booking_id", bookingIds),
  ]);

  const hasFeedback = new Set((feedbackRes.data ?? []).map((r: { booking_id: string }) => r.booking_id));
  const alreadyNudged = new Set((nudgeRes.data ?? []).map((r: { booking_id: string }) => r.booking_id));
  const toProcess = bookingList.filter((b) => !hasFeedback.has(b.id) && !alreadyNudged.has(b.id));
  if (toProcess.length === 0) {
    return json({ sent: 0, message: "No bookings to nudge (already rated or nudged)" }, 200);
  }

  const { data: booths, error: boothError } = await supabase
    .from("vendor_booths")
    .select("id, vendor_name, event_id")
    .in("id", boothIds);

  if (boothError) {
    console.error("Fetch vendor_booths error:", boothError);
    return json({ error: boothError.message }, 500);
  }

  const boothMap = new Map<string, BoothRow>();
  for (const b of (booths ?? []) as BoothRow[]) {
    boothMap.set(b.id, b);
  }
  const slotMap = new Map(slotList.map((s) => [s.id, s]));

  const attendeeIds = [...new Set(toProcess.map((b) => b.attendee_id))];
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, push_token")
    .in("id", attendeeIds)
    .not("push_token", "is", null);

  if (usersError) {
    console.error("Fetch users error:", usersError);
    return json({ error: usersError.message }, 500);
  }

  const tokenByUser = new Map<string, string>();
  for (const u of (users ?? []) as { id: string; push_token: string }[]) {
    if (u.push_token) tokenByUser.set(u.id, u.push_token);
  }

  let totalSent = 0;

  for (const booking of toProcess) {
    const slot = slotMap.get(booking.slot_id);
    if (!slot) continue;
    const booth = boothMap.get(slot.booth_id);
    const vendorName = booth?.vendor_name ?? "this vendor";
    const eventId = booth?.event_id ?? null;
    const token = tokenByUser.get(booking.attendee_id);
    if (!token) continue;

    const title = "Rate your meeting";
    const body = `How was your meeting with ${vendorName}? Tap to rate it.`;
    const messages = [{
      to: token,
      title,
      body,
      data: {
        type: "b2b_rate_nudge",
        boothId: slot.booth_id,
        bookingId: booking.id,
        url: `collectivelive://expo/${slot.booth_id}`,
      },
      sound: "default",
      priority: "high",
      channelId: ANDROID_CHANNEL_ID,
      badge: 1,
    }];

    try {
      const pushRes = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messages),
      });
      if (pushRes.ok) {
        totalSent += 1;
        await supabase.from("b2b_meeting_feedback_nudge_sent").insert({
          booking_id: booking.id,
        });
        await supabase.from("notifications").insert({
          user_id: booking.attendee_id,
          event_id: eventId,
          type: "meeting",
          title,
          body,
          data: { booth_id: slot.booth_id, booking_id: booking.id, nudge: true },
        });
      } else {
        console.warn("Expo push error for booking", booking.id, await pushRes.text());
      }
    } catch (e) {
      console.error("Push request failed for booking", booking.id, e);
    }
  }

  return json({ sent: totalSent, bookings: toProcess.length }, 200);
});

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
