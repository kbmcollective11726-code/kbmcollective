// Send push notification when a B2B meeting is starting in ~5 minutes.
// Invoke via cron every 1–2 minutes (e.g. Supabase cron or external). Use x-cron-secret if set.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const ANDROID_CHANNEL_ID = "collectivelive_notifications_v2";
const REMIND_MINUTES = 5;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, x-cron-secret",
};

type SlotRow = { id: string; booth_id: string; start_time: string };
type BoothRow = { id: string; event_id: string; vendor_name: string };
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

  // Slots starting in ~4–6 minutes
  const from = new Date(Date.now() + (REMIND_MINUTES - 1) * 60 * 1000).toISOString();
  const to = new Date(Date.now() + (REMIND_MINUTES + 1) * 60 * 1000).toISOString();

  const { data: slots, error: slotsError } = await supabase
    .from("meeting_slots")
    .select("id, booth_id, start_time")
    .gte("start_time", from)
    .lte("start_time", to);

  if (slotsError) {
    console.error("Fetch meeting_slots error:", slotsError);
    return json({ error: slotsError.message }, 500);
  }

  const slotList = (slots ?? []) as SlotRow[];
  if (slotList.length === 0) {
    return json({ sent: 0, message: "No B2B meetings starting in 5 mins" }, 200);
  }

  const slotIds = slotList.map((s) => s.id);
  const boothIds = [...new Set(slotList.map((s) => s.booth_id))];

  // Bookings for these slots (exclude cancelled)
  const { data: bookings, error: bookError } = await supabase
    .from("meeting_bookings")
    .select("id, slot_id, attendee_id, status")
    .in("slot_id", slotIds)
    .neq("status", "cancelled");

  if (bookError) {
    console.error("Fetch meeting_bookings error:", bookError);
    return json({ error: bookError.message }, 500);
  }

  const bookingList = (bookings ?? []) as BookingRow[];
  if (bookingList.length === 0) {
    return json({ sent: 0, message: "No bookings for these slots" }, 200);
  }

  // Already sent for these bookings?
  const { data: alreadySent } = await supabase
    .from("b2b_meeting_reminder_sent")
    .select("booking_id")
    .in("booking_id", bookingList.map((b) => b.id));

  const sentSet = new Set((alreadySent ?? []).map((r: { booking_id: string }) => r.booking_id));
  const toProcess = bookingList.filter((b) => !sentSet.has(b.id));
  if (toProcess.length === 0) {
    return json({ sent: 0, message: "Reminders already sent for these bookings" }, 200);
  }

  // Vendor names and event_id
  const { data: booths, error: boothError } = await supabase
    .from("vendor_booths")
    .select("id, event_id, vendor_name")
    .in("id", boothIds);

  if (boothError) {
    console.error("Fetch vendor_booths error:", boothError);
    return json({ error: boothError.message }, 500);
  }

  const boothMap = new Map<string, { vendor_name: string; event_id: string }>();
  for (const b of (booths ?? []) as BoothRow[]) {
    boothMap.set(b.id, { vendor_name: b.vendor_name ?? "Vendor", event_id: b.event_id });
  }

  const slotMap = new Map(slotList.map((s) => [s.id, s]));

  // User push tokens for all attendees we need to notify
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
  const now = new Date().toISOString();

  for (const booking of toProcess) {
    const slot = slotMap.get(booking.slot_id);
    if (!slot) continue;
    const boothInfo = boothMap.get(slot.booth_id);
    const vendorName = boothInfo?.vendor_name ?? "Vendor";
    const eventId = boothInfo?.event_id ?? null;
    const token = tokenByUser.get(booking.attendee_id);
    if (!token) continue;

    const title = "Meeting starting soon";
    const body = `Meeting with ${vendorName} starts in ${REMIND_MINUTES} minutes.`;
    const messages = [{
      to: token,
      title,
      body,
      data: {
        type: "meeting_reminder",
        boothId: slot.booth_id,
        slotId: slot.id,
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
        await supabase.from("notifications").insert({
          user_id: booking.attendee_id,
          event_id: eventId,
          type: "meeting",
          title,
          body,
          data: { booth_id: slot.booth_id, slot_id: slot.id },
        });
        await supabase.from("b2b_meeting_reminder_sent").insert({
          booking_id: booking.id,
          created_at: now,
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
