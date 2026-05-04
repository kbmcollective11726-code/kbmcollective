// 5-minute B2B reminder: in-app notification for the attendee + push when a token exists.
// Invoke via cron every 1–2 minutes (e.g. Supabase cron or external). Use x-cron-secret if set.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const ANDROID_CHANNEL_ID = "collectivelive_notifications_v2";
const REMIND_MINUTES = 5;

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
  "Access-Control-Allow-Headers": "Authorization, Content-Type, x-cron-secret",
};

function countExpoOkTickets(rawText: string): number {
  try {
    const parsed = JSON.parse(rawText) as {
      data?: Array<{ status?: string; message?: string; details?: { error?: string } }>;
    };
    const items = Array.isArray(parsed?.data) ? parsed.data : [];
    let ok = 0;
    for (const item of items) {
      if (item?.status === "ok") ok++;
      else {
        const msg = item?.message ?? item?.details?.error ?? JSON.stringify(item);
        console.warn("Expo push ticket error (B2B reminder):", msg);
      }
    }
    return ok;
  } catch {
    return 0;
  }
}

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

  // Slots starting in ~3–9 minutes (wide window for */2 cron + network delay)
  const from = new Date(Date.now() + (REMIND_MINUTES - 2) * 60 * 1000).toISOString();
  const to = new Date(Date.now() + (REMIND_MINUTES + 4) * 60 * 1000).toISOString();

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
    .in("id", attendeeIds);

  if (usersError) {
    console.error("Fetch users error:", usersError);
    return json({ error: usersError.message }, 500);
  }

  const tokenByUser = new Map<string, string>();
  for (const u of (users ?? []) as { id: string; push_token: string | null }[]) {
    if (u.push_token) tokenByUser.set(u.id, u.push_token);
  }

  let totalSent = 0;
  const now = new Date().toISOString();

  for (const booking of toProcess) {
    // Concurrency guard: reserve this booking before inserting notifications / pushing.
    // Prevents overlapping cron invocations from sending duplicate reminders.
    const { error: reserveErr } = await supabase
      .from("b2b_meeting_reminder_sent")
      .insert({ booking_id: booking.id, created_at: now });

    if ((reserveErr as { code?: string } | null)?.code === "23505") {
      continue;
    }
    if (reserveErr) {
      console.warn("B2B reminder reserve failed:", reserveErr);
      continue;
    }

    const slot = slotMap.get(booking.slot_id);
    if (!slot) continue;
    const boothInfo = boothMap.get(slot.booth_id);
    const vendorName = boothInfo?.vendor_name ?? "Vendor";
    const eventId = boothInfo?.event_id ?? null;

    const title = "Meeting starting soon";
    const body = `Meeting with ${vendorName} is starting soon.`;

    // In-app first so the bell always has the reminder if push fails or there is no token.
    const { error: notifErr } = await supabase.from("notifications").insert({
      user_id: booking.attendee_id,
      event_id: eventId,
      type: "meeting",
      title,
      body,
      data: { booth_id: slot.booth_id, slot_id: slot.id },
    });
    if (notifErr) {
      console.error("B2B reminder notifications insert failed:", booking.id, notifErr);
      // Allow future runs to retry if we couldn't even create the in-app notification.
      await supabase.from("b2b_meeting_reminder_sent").delete().eq("booking_id", booking.id);
      continue;
    }

    const token = tokenByUser.get(booking.attendee_id);
    if (token) {
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
        ...EXPO_BANNER_FIELDS,
      }];
      try {
        const pushRes = await fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(messages),
        });
        const rawText = await pushRes.text();
        if (!pushRes.ok) {
          console.warn("Expo push HTTP error for booking", booking.id, pushRes.status, rawText.slice(0, 500));
        } else {
          const okCount = countExpoOkTickets(rawText);
          totalSent += okCount;
          if (okCount === 0) {
            console.warn("Expo rejected B2B reminder push for booking", booking.id);
          }
        }
      } catch (e) {
        console.error("Push request failed for booking", booking.id, e);
      }
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
