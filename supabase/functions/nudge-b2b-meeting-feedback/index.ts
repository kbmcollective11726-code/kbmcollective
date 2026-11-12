// Send a one-time push nudge to rate a B2B meeting after it has ended.
// meeting_slots.end_time is wall-clock UTC (same as schedule_sessions); interpret in events.reminder_timezone.
// Run via cron every 15 minutes. Use x-cron-secret if set.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { DateTime } from "https://esm.sh/luxon@3.5.0";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const ANDROID_CHANNEL_ID = "collectivelive_notifications_v2";

const EXPO_BANNER_FIELDS = {
  sound: "default",
  priority: "high",
  channelId: ANDROID_CHANNEL_ID,
  badge: 1,
  vibrate: true,
} as const;

const NUDGE_WINDOW_START_MINS = 5; // nudge 5 mins after the venue end time
const NUDGE_WINDOW_END_MINS = 24 * 60; // up to 24 hours after

type SlotRow = { id: string; booth_id: string; end_time: string };
type BoothRow = {
  id: string;
  vendor_name: string;
  event_id: string;
  reminder_timezone: string | null;
};
type BookingRow = { id: string; slot_id: string; attendee_id: string; status: string };

function parseSessionDate(iso: string | null | undefined): Date | null {
  if (!iso || typeof iso !== "string") return null;
  const trimmed = iso.trim();
  const normalized = /^\d{4}-\d{2}-\d{2}\s/.test(trimmed)
    ? trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T")
    : trimmed;
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? null : new Date(t);
}

function getDateKeyFromIso(iso: string | null | undefined): string | null {
  const d = parseSessionDate(iso);
  if (!d) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Wall-clock slot end as epoch ms in the event timezone. */
function wallClockInZoneMs(iso: string, zone: string): number | null {
  const d = parseSessionDate(iso);
  if (!d) return null;
  const dateKey = getDateKeyFromIso(iso);
  if (!dateKey) return null;
  const m = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1]!, 10);
  const mo = parseInt(m[2]!, 10);
  const day = parseInt(m[3]!, 10);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const dt = DateTime.fromObject(
    { year: y, month: mo, day: day, hour, minute, second: 0, millisecond: 0 },
    { zone },
  );
  if (!dt.isValid) {
    console.warn("Invalid zoned B2B end time", { iso, zone, err: dt.invalidReason });
    return null;
  }
  return dt.toMillis();
}

Deno.serve(async (req: Request) => {
  const ch = corsHeaders(req, "Authorization, Content-Type, apikey");
  if (req.method === "OPTIONS") {
    return corsPreflightResponse(req, "Authorization, Content-Type, apikey");
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

  const defaultZone = (Deno.env.get("SESSION_REMINDER_TIMEZONE") ?? "America/New_York").trim() ||
    "America/New_York";

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const nowMs = Date.now();
  const fromStr = DateTime.utc().minus({ days: 2 }).toISODate()!;
  const toStr = DateTime.utc().plus({ days: 2 }).toISODate()!;

  // Wide fetch by the stored clock date, then keep only meetings that have
  // actually ended in the event timezone (5 minutes to 24 hours ago).
  const { data: slots, error: slotsError } = await supabase
    .from("meeting_slots")
    .select("id, booth_id, end_time")
    .gte("end_time", `${fromStr}T00:00:00.000Z`)
    .lte("end_time", `${toStr}T23:59:59.999Z`);

  if (slotsError) {
    console.error("Fetch meeting_slots error:", slotsError);
    return json({ error: slotsError.message }, 500, ch);
  }

  const slotList = (slots ?? []) as SlotRow[];
  if (slotList.length === 0) {
    return json({ sent: 0, message: "No meetings in nudge window" }, 200, ch);
  }

  const boothIds = [...new Set(slotList.map((s) => s.booth_id))];
  const { data: booths, error: boothError } = await supabase
    .from("vendor_booths")
    .select("id, vendor_name, event_id, events!inner(reminder_timezone, notifications_paused, notifications_paused_until)")
    .in("id", boothIds);

  if (boothError) {
    console.error("Fetch vendor_booths error:", boothError);
    return json({ error: boothError.message }, 500, ch);
  }

  const boothMap = new Map<string, BoothRow & { notifications_paused: boolean }>();
  for (const b of (booths ?? []) as (BoothRow & {
    events?: {
      reminder_timezone?: string | null;
      notifications_paused?: boolean;
      notifications_paused_until?: string | null;
    } | null;
  })[]) {
    const untilMs = b.events?.notifications_paused_until ? Date.parse(b.events.notifications_paused_until) : NaN;
    const activePause =
      b.events?.notifications_paused === true &&
      (!Number.isFinite(untilMs) || untilMs > nowMs);
    boothMap.set(b.id, {
      id: b.id,
      vendor_name: b.vendor_name,
      event_id: b.event_id,
      reminder_timezone: (b.events?.reminder_timezone ?? "").trim() || null,
      notifications_paused: activePause,
    });
  }

  const earliestEndMs = nowMs - NUDGE_WINDOW_END_MINS * 60 * 1000;
  const latestEndMs = nowMs - NUDGE_WINDOW_START_MINS * 60 * 1000;
  const dueSlots = slotList.filter((slot) => {
    const booth = boothMap.get(slot.booth_id);
    if (!booth) return false;
    const zone = booth.reminder_timezone || defaultZone;
    const endMs = wallClockInZoneMs(slot.end_time, zone);
    if (endMs == null) return false;
    return endMs >= earliestEndMs && endMs <= latestEndMs;
  });

  if (dueSlots.length === 0) {
    return json({
      sent: 0,
      message: "No meetings in nudge window (timezone-aware, 5 min to 24 h after end)",
    }, 200, ch);
  }

  const slotIds = dueSlots.map((s) => s.id);

  const { data: bookings, error: bookError } = await supabase
    .from("meeting_bookings")
    .select("id, slot_id, attendee_id, status")
    .in("slot_id", slotIds)
    .eq("status", "confirmed");

  if (bookError) {
    console.error("Fetch meeting_bookings error:", bookError);
    return json({ error: bookError.message }, 500, ch);
  }

  const bookingList = (bookings ?? []) as BookingRow[];
  if (bookingList.length === 0) {
    return json({ sent: 0, message: "No confirmed bookings" }, 200, ch);
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
    return json({ sent: 0, message: "No bookings to nudge (already rated or nudged)" }, 200, ch);
  }

  const slotMap = new Map(dueSlots.map((s) => [s.id, s]));

  const attendeeIds = [...new Set(toProcess.map((b) => b.attendee_id))];
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, push_token")
    .in("id", attendeeIds)
    .not("push_token", "is", null);

  if (usersError) {
    console.error("Fetch users error:", usersError);
    return json({ error: usersError.message }, 500, ch);
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
    if (booth?.notifications_paused === true) continue;
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
      ...EXPO_BANNER_FIELDS,
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

  return json({ sent: totalSent, bookings: toProcess.length }, 200, ch);
});

function json(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
