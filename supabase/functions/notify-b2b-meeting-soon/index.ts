// 5-minute B2B reminder: in-app + push for attendee and all booth representatives.
// meeting_slots.start_time is wall-clock UTC (same as schedule_sessions); interpret in events.reminder_timezone.
// Invoke via cron every 1–2 minutes (e.g. Supabase cron or external). Use x-cron-secret if set.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { DateTime } from "https://esm.sh/luxon@3.5.0";

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

function parseSessionDate(iso: string | null | undefined): Date | null {
  if (!iso || typeof iso !== "string") return null;
  const trimmed = iso.trim();
  const normalized = /^\d{4}-\d{2}-\d{2}\s/.test(trimmed)
    ? trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T")
    : trimmed;
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? null : new Date(t);
}

function getSessionDateKeyFromIso(iso: string | null | undefined): string | null {
  const d = parseSessionDate(iso);
  if (!d) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Wall-clock slot start as epoch ms in the given IANA timezone. */
function slotStartInZoneMs(startTimeIso: string, zone: string): number | null {
  const d = parseSessionDate(startTimeIso);
  if (!d) return null;
  const dateKey = getSessionDateKeyFromIso(startTimeIso);
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
    console.warn("Invalid zoned B2B slot time", { startTimeIso, zone, err: dt.invalidReason });
    return null;
  }
  return dt.toMillis();
}

type SlotRow = {
  id: string;
  booth_id: string;
  start_time: string;
  vendor_booths: {
    event_id: string;
    events: {
      reminder_timezone?: string | null;
      notifications_paused?: boolean | null;
      notifications_paused_until?: string | null;
      start_date?: string | null;
      end_date?: string | null;
      is_active?: boolean | null;
    } | null;
  } | null;
};
type BoothRow = {
  id: string;
  event_id: string;
  vendor_name: string;
  contact_user_id: string | null;
};
type BookingRow = { id: string; slot_id: string; attendee_id: string; status: string };

function buildRepIdsByBooth(
  booths: BoothRow[],
  repRows: { booth_id: string; user_id: string }[],
): Map<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const b of booths) {
    const set = new Set<string>();
    if (b.contact_user_id) set.add(b.contact_user_id);
    map.set(b.id, set);
  }
  for (const r of repRows) {
    const set = map.get(r.booth_id) ?? new Set<string>();
    set.add(r.user_id);
    map.set(r.booth_id, set);
  }
  const out = new Map<string, string[]>();
  for (const [boothId, set] of map) out.set(boothId, [...set]);
  return out;
}

async function sendExpoBatch(
  messages: Record<string, unknown>[],
): Promise<number> {
  if (messages.length === 0) return 0;
  try {
    const pushRes = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    });
    const rawText = await pushRes.text();
    if (!pushRes.ok) {
      console.warn("Expo push HTTP error:", pushRes.status, rawText.slice(0, 500));
      return 0;
    }
    return countExpoOkTickets(rawText);
  } catch (e) {
    console.error("Push request failed:", e);
    return 0;
  }
}

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

  const defaultZone = (Deno.env.get("SESSION_REMINDER_TIMEZONE") ?? "America/New_York").trim() ||
    "America/New_York";

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const nowMs = Date.now();
  const windowLo = nowMs + (REMIND_MINUTES - 2) * 60 * 1000;
  const windowHi = nowMs + (REMIND_MINUTES + 4) * 60 * 1000;

  const fromStr = DateTime.utc().minus({ days: 1 }).toISODate()!;
  const toStr = DateTime.utc().plus({ days: 21 }).toISODate()!;

  const { data: slotsRaw, error: slotsError } = await supabase
    .from("meeting_slots")
    .select(
      "id, booth_id, start_time, vendor_booths!inner(event_id, events!inner(reminder_timezone, notifications_paused, notifications_paused_until, start_date, end_date, is_active))",
    )
    .gte("start_time", `${fromStr}T00:00:00.000Z`)
    .lte("start_time", `${toStr}T23:59:59.999Z`);

  if (slotsError) {
    console.error("Fetch meeting_slots error:", slotsError);
    return json({ error: slotsError.message }, 500);
  }

  const slotList = ((slotsRaw ?? []) as SlotRow[]).filter((s) => {
    const ev = s.vendor_booths?.events;
    if (!ev || ev.is_active === false) return false;
    const startDate = ev.start_date ?? "";
    const endDate = ev.end_date ?? "";
    if (startDate && startDate > toStr) return false;
    if (endDate && endDate < fromStr) return false;
    return true;
  });

  const due: SlotRow[] = [];
  for (const s of slotList) {
    const ev = s.vendor_booths?.events;
    const untilMs = ev?.notifications_paused_until ? Date.parse(ev.notifications_paused_until) : NaN;
    const activePause =
      ev?.notifications_paused === true &&
      (!Number.isFinite(untilMs) || untilMs > nowMs);
    if (activePause) continue;

    const zone = (ev?.reminder_timezone ?? "").trim() || defaultZone;
    const startMs = slotStartInZoneMs(s.start_time, zone);
    if (startMs == null) continue;
    if (startMs >= windowLo && startMs <= windowHi) {
      due.push(s);
    }
  }

  if (due.length === 0) {
    return json({
      sent: 0,
      message: "No B2B meetings starting in reminder window (timezone-aware, ~3-9 min before start)",
      hint: `Set Edge secret SESSION_REMINDER_TIMEZONE or events.reminder_timezone (default ${defaultZone}).`,
    }, 200);
  }

  const slotIds = due.map((s) => s.id);
  const boothIds = [...new Set(due.map((s) => s.booth_id))];

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

  const { data: alreadySent } = await supabase
    .from("b2b_meeting_reminder_sent")
    .select("booking_id")
    .in("booking_id", bookingList.map((b) => b.id));

  const sentSet = new Set((alreadySent ?? []).map((r: { booking_id: string }) => r.booking_id));
  const toProcess = bookingList.filter((b) => !sentSet.has(b.id));
  if (toProcess.length === 0) {
    return json({ sent: 0, message: "Reminders already sent for these bookings" }, 200);
  }

  const { data: booths, error: boothError } = await supabase
    .from("vendor_booths")
    .select("id, event_id, vendor_name, contact_user_id")
    .in("id", boothIds);

  if (boothError) {
    console.error("Fetch vendor_booths error:", boothError);
    return json({ error: boothError.message }, 500);
  }

  const boothRows = (booths ?? []) as BoothRow[];
  const boothMap = new Map<string, { vendor_name: string; event_id: string }>();
  for (const b of boothRows) {
    boothMap.set(b.id, {
      vendor_name: b.vendor_name ?? "Vendor",
      event_id: b.event_id,
    });
  }

  const { data: repRows, error: repErr } = await supabase
    .from("vendor_booth_reps")
    .select("booth_id, user_id")
    .in("booth_id", boothIds);

  if (repErr) {
    console.error("Fetch vendor_booth_reps error:", repErr);
    return json({ error: repErr.message }, 500);
  }

  const repIdsByBooth = buildRepIdsByBooth(boothRows, (repRows ?? []) as { booth_id: string; user_id: string }[]);
  const slotMap = new Map(due.map((s) => [s.id, s]));

  const attendeeIds = [...new Set(toProcess.map((b) => b.attendee_id))];
  const allRepIds = [...new Set([...repIdsByBooth.values()].flat())];
  const allNotifyUserIds = [...new Set([...attendeeIds, ...allRepIds])];

  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, push_token, full_name")
    .in("id", allNotifyUserIds);

  if (usersError) {
    console.error("Fetch users error:", usersError);
    return json({ error: usersError.message }, 500);
  }

  const tokenByUser = new Map<string, string>();
  const nameByUser = new Map<string, string>();
  for (const u of (users ?? []) as { id: string; push_token: string | null; full_name: string | null }[]) {
    if (u.push_token) tokenByUser.set(u.id, u.push_token);
    const name = u.full_name?.trim();
    if (name) nameByUser.set(u.id, name);
  }

  let totalSent = 0;
  const now = new Date().toISOString();

  for (const booking of toProcess) {
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

    const attendeeName = nameByUser.get(booking.attendee_id) ?? "An attendee";
    const pushDataBase = {
      type: "meeting_reminder",
      boothId: slot.booth_id,
      slotId: slot.id,
      event_id: eventId ?? undefined,
      url: `collectivelive://expo/${slot.booth_id}`,
    };

    const attendeeTitle = "Meeting starting soon";
    const attendeeBody = `Meeting with ${vendorName} is starting soon.`;
    const vendorTitle = "Booth meeting starting soon";
    const vendorBody = `Meeting with ${attendeeName} is starting soon at your booth.`;

    const notifRows = [
      {
        user_id: booking.attendee_id,
        event_id: eventId,
        type: "meeting",
        title: attendeeTitle,
        body: attendeeBody,
        data: { booth_id: slot.booth_id, slot_id: slot.id },
      },
    ];

    const repIds = (repIdsByBooth.get(slot.booth_id) ?? []).filter((id) => id !== booking.attendee_id);
    for (const repId of repIds) {
      notifRows.push({
        user_id: repId,
        event_id: eventId,
        type: "meeting",
        title: vendorTitle,
        body: vendorBody,
        data: { booth_id: slot.booth_id, slot_id: slot.id },
      });
    }

    const { error: notifErr } = await supabase.from("notifications").insert(notifRows);
    if (notifErr) {
      console.error("B2B reminder notifications insert failed:", booking.id, notifErr);
      await supabase.from("b2b_meeting_reminder_sent").delete().eq("booking_id", booking.id);
      continue;
    }

    const pushMessages: Record<string, unknown>[] = [];
    const attendeeToken = tokenByUser.get(booking.attendee_id);
    if (attendeeToken) {
      pushMessages.push({
        to: attendeeToken,
        title: attendeeTitle,
        body: attendeeBody,
        data: pushDataBase,
        ...EXPO_BANNER_FIELDS,
      });
    }
    for (const repId of repIds) {
      const token = tokenByUser.get(repId);
      if (!token) continue;
      pushMessages.push({
        to: token,
        title: vendorTitle,
        body: vendorBody,
        data: pushDataBase,
        ...EXPO_BANNER_FIELDS,
      });
    }

    totalSent += await sendExpoBatch(pushMessages);
  }

  return json({ sent: totalSent, bookings: toProcess.length }, 200);
});

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
