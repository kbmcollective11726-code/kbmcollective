// 5-minute session reminder: in-app row for every event member + push when a token exists.
// Session start_time is wall-clock digits in UTC (see wallClockLocalPickerToSessionIso).
// Interpret that wall clock in SESSION_REMINDER_TIMEZONE (default America/New_York).
// Set Edge secret SESSION_REMINDER_TIMEZONE to the venue IANA zone if not America/New_York.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
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

// ~5 min before start; wide window so pg_cron every 2 min + jitter still fires once.
const WINDOW_MIN_BEFORE_LO = 3;
const WINDOW_MIN_BEFORE_HI = 9;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, x-cron-secret",
};

/** Parse Expo push API response; count tickets with status "ok". Logs failures (invalid tokens, etc.). */
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
        console.warn("Expo push ticket error (session reminder):", msg);
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

/** Wall-clock session start as epoch ms in the given IANA timezone. */
function sessionStartInZoneMs(startTimeIso: string, zone: string): number | null {
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
    console.warn("Invalid zoned session time", { startTimeIso, zone, err: dt.invalidReason });
    return null;
  }
  return dt.toMillis();
}

type SessionRow = {
  id: string;
  event_id: string;
  title: string;
  start_time: string;
  day_number: number;
  location: string | null;
  room: string | null;
};

/** Single normalized venue string for same-room detection (prefers room, then location). */
function effectiveRoomVenue(location: string | null, room: string | null): string | null {
  const r = (room ?? "").trim();
  const l = (location ?? "").trim();
  const v = r || l;
  if (!v) return null;
  return v.replace(/\s+/g, " ").toLowerCase();
}

/** True = skip same-room reminders (default). False = always remind. */
function wantsSkipSameRoom(row: { session_reminder_skip_same_room?: boolean | null } | null): boolean {
  return row?.session_reminder_skip_same_room !== false;
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

  const defaultZone = (Deno.env.get("SESSION_REMINDER_TIMEZONE") ?? "America/New_York").trim() || "America/New_York";

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const now = DateTime.utc();
  const fromStr = now.minus({ days: 1 }).toISODate()!;
  const toStr = now.plus({ days: 21 }).toISODate()!;

  type EvRow = { id: string; reminder_timezone?: string | null };
  let eventRows: EvRow[] = [];
  const evTz = await supabase
    .from("events")
    .select("id, reminder_timezone")
    .eq("is_active", true)
    .lte("start_date", toStr)
    .gte("end_date", fromStr);
  if (evTz.error) {
    const evIdOnly = await supabase
      .from("events")
      .select("id")
      .eq("is_active", true)
      .lte("start_date", toStr)
      .gte("end_date", fromStr);
    if (evIdOnly.error) {
      console.error("Fetch events error:", evIdOnly.error);
      return json({ error: evIdOnly.error.message }, 500);
    }
    eventRows = (evIdOnly.data ?? []) as EvRow[];
  } else {
    eventRows = (evTz.data ?? []) as EvRow[];
  }

  const eventIds = eventRows.map((e) => e.id);
  const zoneByEvent = new Map<string, string>();
  for (const e of eventRows) {
    const z = (e.reminder_timezone ?? "").trim();
    zoneByEvent.set(e.id, z || defaultZone);
  }

  if (eventIds.length === 0) {
    return json({ sent: 0, message: "No active events in date window" }, 200);
  }

  const { data: sessionRows, error: sessionsError } = await supabase
    .from("schedule_sessions")
    .select("id, event_id, title, start_time, day_number, location, room")
    .eq("is_active", true)
    .in("event_id", eventIds);

  if (sessionsError) {
    console.error("Fetch sessions error:", sessionsError);
    return json({ error: sessionsError.message }, 500);
  }

  const nowMs = Date.now();
  const windowLo = nowMs + WINDOW_MIN_BEFORE_LO * 60 * 1000;
  const windowHi = nowMs + WINDOW_MIN_BEFORE_HI * 60 * 1000;

  const list = (sessionRows ?? []) as SessionRow[];
  const due: SessionRow[] = [];

  for (const s of list) {
    const zone = zoneByEvent.get(s.event_id) ?? defaultZone;
    const startMs = sessionStartInZoneMs(s.start_time, zone);
    if (startMs == null) continue;
    if (startMs >= windowLo && startMs <= windowHi) {
      due.push(s);
    }
  }

  if (due.length === 0) {
    return json({
      sent: 0,
      message: "No sessions starting in ~5 mins (timezone-aware)",
      hint: `Set Edge secret SESSION_REMINDER_TIMEZONE or events.reminder_timezone (default ${defaultZone}).`,
    }, 200);
  }

  const { data: alreadySent } = await supabase
    .from("session_reminder_sent")
    .select("session_id")
    .in("session_id", due.map((s) => s.id));

  const sentSet = new Set((alreadySent ?? []).map((r: { session_id: string }) => r.session_id));
  const toProcess = due.filter((s) => !sentSet.has(s.id));
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
    const zone = zoneByEvent.get(session.event_id) ?? defaultZone;

    // No recipients: still attempt to reserve/record so we don't re-run repeatedly.
    if (userIds.length === 0) {
      const { error: reserveErr } = await supabase.from("session_reminder_sent").insert({ session_id: session.id });
      // Another concurrent run may have already reserved this session.
      if ((reserveErr as { code?: string } | null)?.code === "23505") continue;
      if (reserveErr) console.warn("Session reminder reserve failed (no recipients):", reserveErr);
      continue;
    }

    // Concurrency guard: reserve this session before inserting notifications/pushing.
    // Prevents overlapping cron invocations from sending duplicates.
    const { error: reserveErr } = await supabase.from("session_reminder_sent").insert({ session_id: session.id });
    if ((reserveErr as { code?: string } | null)?.code === "23505") {
      continue;
    }
    if (reserveErr) {
      console.warn("Session reminder reserve failed:", reserveErr);
      continue;
    }

    const { data: daySessionsRaw, error: dayErr } = await supabase
      .from("schedule_sessions")
      .select("id, start_time, day_number, location, room")
      .eq("event_id", session.event_id)
      .eq("day_number", session.day_number ?? 1)
      .eq("is_active", true);
    if (dayErr) {
      console.warn("Session reminder: could not load day sessions", session.id, dayErr);
    }
    const daySessions = (daySessionsRaw ?? []) as Pick<
      SessionRow,
      "id" | "start_time" | "day_number" | "location" | "room"
    >[];

    const daySessionIds = daySessions.map((s) => s.id);
    const bookmarksByUser = new Map<string, Set<string>>();
    if (userIds.length > 0 && daySessionIds.length > 0) {
      const { data: schedRows } = await supabase
        .from("user_schedule")
        .select("user_id, session_id")
        .in("user_id", userIds)
        .in("session_id", daySessionIds);
      for (const row of schedRows ?? []) {
        const uid = (row as { user_id: string }).user_id;
        const sid = (row as { session_id: string }).session_id;
        if (!bookmarksByUser.has(uid)) bookmarksByUser.set(uid, new Set());
        bookmarksByUser.get(uid)!.add(sid);
      }
    }

    const { data: userPrefs } = await supabase
      .from("users")
      .select("id, push_token, session_reminder_skip_same_room")
      .in("id", userIds);
    const prefByUser = new Map<string, { push_token: string | null; session_reminder_skip_same_room?: boolean | null }>();
    for (const u of userPrefs ?? []) {
      const row = u as { id: string; push_token: string | null; session_reminder_skip_same_room?: boolean | null };
      prefByUser.set(row.id, row);
    }

    const startMsS = sessionStartInZoneMs(session.start_time, zone);
    const recipientUserIds: string[] = [];
    for (const uid of userIds) {
      const pref = prefByUser.get(uid) ?? null;
      if (!wantsSkipSameRoom(pref)) {
        recipientUserIds.push(uid);
        continue;
      }
      const marked = bookmarksByUser.get(uid) ?? new Set<string>();
      if (!marked.has(session.id)) {
        recipientUserIds.push(uid);
        continue;
      }
      if (startMsS == null) {
        recipientUserIds.push(uid);
        continue;
      }
      let best: (typeof daySessions)[0] | null = null;
      let bestMs = -1;
      for (const s of daySessions) {
        if (!marked.has(s.id) || s.id === session.id) continue;
        const ms = sessionStartInZoneMs(s.start_time, zone);
        if (ms == null || ms >= startMsS) continue;
        if (ms > bestMs) {
          bestMs = ms;
          best = s;
        }
      }
      if (!best) {
        recipientUserIds.push(uid);
        continue;
      }
      const ra = effectiveRoomVenue(best.location, best.room);
      const rb = effectiveRoomVenue(session.location, session.room);
      if (ra && rb && ra === rb) {
        continue;
      }
      recipientUserIds.push(uid);
    }

    const title = "Event starting soon";
    const body = `${session.title ?? "A session"} is starting soon. Check the Agenda.`;

    const notifRows = recipientUserIds.map((user_id: string) => ({
      user_id,
      event_id: session.event_id,
      type: "schedule_change",
      title,
      body,
      data: { session_id: session.id },
    }));

    const BATCH = 80;
    let insertsOk = true;
    if (notifRows.length > 0) {
      for (let i = 0; i < notifRows.length; i += BATCH) {
        const chunk = notifRows.slice(i, i + BATCH);
        const { error: notifErr } = await supabase.from("notifications").insert(chunk);
        if (notifErr) {
          console.error("Session reminder notifications insert failed:", session.id, notifErr);
          insertsOk = false;
          break;
        }
      }
    }
    if (!insertsOk) {
      // Allow future runs to retry if we couldn't even create the in-app notifications.
      await supabase.from("session_reminder_sent").delete().eq("session_id", session.id);
      continue;
    }

    const { data: users } = recipientUserIds.length > 0
      ? await supabase.from("users").select("id, push_token").in("id", recipientUserIds)
      : { data: [] as { id: string; push_token: string | null }[] };

    const tokens = Array.from(new Set((users ?? [])
      .map((u: { push_token: string | null }) => u.push_token)
      .filter((t: string | null): t is string => Boolean(t))));

    if (tokens.length > 0) {
      const messages = tokens.map((to: string) => ({
        to,
        title,
        body,
        data: {
          type: "session_reminder",
          event_id: session.event_id,
          session_id: session.id,
          url: "collectivelive://schedule",
        },
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
          console.warn("Expo push HTTP error (session reminder):", pushRes.status, rawText.slice(0, 500));
        } else {
          const okCount = countExpoOkTickets(rawText);
          totalSent += okCount;
          if (okCount < tokens.length) {
            console.warn(
              `Session reminder: Expo accepted ${okCount}/${tokens.length} pushes for session ${session.id}`,
            );
          }
        }
      } catch (e) {
        console.error("Push request failed:", e);
      }
    }
  }

  return json({ sent: totalSent, sessions: toProcess.length }, 200);
});

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
