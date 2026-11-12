// Send push notifications to users (likes, comments, announcements).
// Called from app when someone likes, comments, or sends "Send now" announcement.
// Requires Authorization Bearer (user token). Uses service role to fetch push tokens.
// Recipients are authorized per action type (admin blast vs engagement vs chat).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Must match NOTIFICATION_CHANNEL_ID in app lib/notificationChannel.ts (sound + vibration on Android).
const ANDROID_CHANNEL_ID = "collectivelive_notifications_v2";
const MAX_RECIPIENTS = 2000;
/** Expo Push HTTP API recommends ≤100 messages per request. */
const EXPO_PUSH_BATCH = 100;

/** High priority + default sound + vibration (Android also uses channel pattern). Omit timeSensitive (needs iOS entitlement). */
const EXPO_BANNER_FIELDS = {
  sound: "default",
  priority: "high",
  channelId: ANDROID_CHANNEL_ID,
  badge: 1,
  vibrate: true,
} as const;

type AdminClient = ReturnType<typeof createClient>;

async function isPlatformAdmin(admin: AdminClient, userId: string): Promise<boolean> {
  const { data } = await admin.from("users").select("is_platform_admin").eq("id", userId).maybeSingle();
  return (data as { is_platform_admin?: boolean } | null)?.is_platform_admin === true;
}

async function isEventAdmin(admin: AdminClient, eventId: string, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("event_members")
    .select("role, roles, is_active")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  const row = data as { role?: string; roles?: string[] | null; is_active?: boolean | null } | null;
  if (!row || row.is_active === false) return false;
  if (row.role === "admin" || row.role === "super_admin") return true;
  const roles = Array.isArray(row.roles) ? row.roles : [];
  return roles.includes("admin") || roles.includes("super_admin");
}

async function isEventMember(admin: AdminClient, eventId: string, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("event_members")
    .select("user_id")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .neq("is_active", false)
    .maybeSingle();
  return !!data;
}

async function filterEventMembers(
  admin: AdminClient,
  eventId: string,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { data } = await admin
    .from("event_members")
    .select("user_id")
    .eq("event_id", eventId)
    .in("user_id", userIds)
    .neq("is_active", false);
  return (data ?? []).map((r: { user_id: string }) => r.user_id);
}

/**
 * Authorize recipients. Returns filtered IDs or an error message.
 */
async function authorizeRecipients(
  admin: AdminClient,
  callerId: string,
  opts: {
    event_id?: string;
    post_id?: string;
    chat_user_id?: string;
    group_id?: string;
    booth_id?: string;
    recipient_user_ids: string[];
  },
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string; status: number }> {
  const uniqueIds = [...new Set(opts.recipient_user_ids)].filter(Boolean);
  if (uniqueIds.length === 0) {
    return { ok: false, error: "Missing recipient_user_ids", status: 400 };
  }
  if (uniqueIds.length > MAX_RECIPIENTS) {
    return { ok: false, error: `Too many recipients (max ${MAX_RECIPIENTS})`, status: 400 };
  }

  // Chat DM / connection push: chat_user_id is the sender (tap opens chat with them);
  // exactly one recipient, not the caller, and both must share the event.
  if (opts.chat_user_id) {
    if (opts.chat_user_id !== callerId) {
      return { ok: false, error: "chat_user_id must be the sender", status: 403 };
    }
    if (uniqueIds.length !== 1) {
      return { ok: false, error: "Chat push must have exactly one recipient", status: 403 };
    }
    const recipientId = uniqueIds[0];
    if (recipientId === callerId) {
      return { ok: false, error: "Cannot push to self", status: 400 };
    }
    const eventId = typeof opts.event_id === "string" ? opts.event_id.trim() : "";
    if (!eventId) {
      return { ok: false, error: "event_id required for chat push", status: 400 };
    }
    const bothMembers =
      (await isEventMember(admin, eventId, callerId)) &&
      (await isEventMember(admin, eventId, recipientId));
    if (!bothMembers && !(await isPlatformAdmin(admin, callerId))) {
      return { ok: false, error: "Not allowed to notify this chat peer", status: 403 };
    }
    return { ok: true, ids: uniqueIds };
  }

  // Group chat: caller + all recipients must be members of the group
  if (opts.group_id) {
    const { data: memberships } = await admin
      .from("chat_group_members")
      .select("user_id")
      .eq("group_id", opts.group_id)
      .in("user_id", [callerId, ...uniqueIds]);
    const memberSet = new Set((memberships ?? []).map((m: { user_id: string }) => m.user_id));
    if (!memberSet.has(callerId)) {
      return { ok: false, error: "Not a group member", status: 403 };
    }
    const allowed = uniqueIds.filter((id) => memberSet.has(id) && id !== callerId);
    if (allowed.length === 0) {
      return { ok: false, error: "No authorized group recipients", status: 403 };
    }
    return { ok: true, ids: allowed };
  }

  // Engagement (like/comment): notify post author only; caller must belong to post's event
  if (opts.post_id) {
    const { data: post } = await admin
      .from("posts")
      .select("id, user_id, event_id, is_deleted")
      .eq("id", opts.post_id)
      .maybeSingle();
    const row = post as { id: string; user_id: string; event_id: string; is_deleted?: boolean } | null;
    if (!row || row.is_deleted) {
      return { ok: false, error: "Post not found", status: 404 };
    }
    const callerOk =
      (await isEventMember(admin, row.event_id, callerId)) ||
      (await isEventAdmin(admin, row.event_id, callerId)) ||
      (await isPlatformAdmin(admin, callerId));
    if (!callerOk) {
      return { ok: false, error: "Not allowed for this post", status: 403 };
    }
    if (uniqueIds.length !== 1) {
      return { ok: false, error: "Post push may only notify one person", status: 403 };
    }
    if (uniqueIds[0] !== row.user_id) {
      // Comment likes notify the comment's author, who must have commented on this post.
      const { count } = await admin
        .from("comments")
        .select("id", { count: "exact", head: true })
        .eq("post_id", row.id)
        .eq("user_id", uniqueIds[0]);
      if (!count) {
        return { ok: false, error: "Post push may only notify the post author or a commenter", status: 403 };
      }
    }
    if (uniqueIds[0] === callerId) {
      return { ok: true, ids: [] }; // no-op self notify
    }
    return { ok: true, ids: uniqueIds };
  }

  // Booth: caller must be event member; recipients must be event members of booth's event
  if (opts.booth_id) {
    const { data: booth } = await admin
      .from("vendor_booths")
      .select("id, event_id")
      .eq("id", opts.booth_id)
      .maybeSingle();
    const b = booth as { id: string; event_id: string } | null;
    if (!b?.event_id) {
      return { ok: false, error: "Booth not found", status: 404 };
    }
    const callerOk =
      (await isEventMember(admin, b.event_id, callerId)) ||
      (await isEventAdmin(admin, b.event_id, callerId)) ||
      (await isPlatformAdmin(admin, callerId));
    if (!callerOk) {
      return { ok: false, error: "Not allowed for this booth", status: 403 };
    }
    const allowed = await filterEventMembers(admin, b.event_id, uniqueIds);
    if (allowed.length === 0) {
      return { ok: false, error: "No authorized booth recipients", status: 403 };
    }
    return { ok: true, ids: allowed };
  }

  // Announcement / schedule blast: event admin or platform admin; recipients must be event members
  if (!opts.event_id) {
    return { ok: false, error: "event_id required for broadcast push", status: 400 };
  }
  const adminOk =
    (await isEventAdmin(admin, opts.event_id, callerId)) ||
    (await isPlatformAdmin(admin, callerId));
  if (!adminOk) {
    return { ok: false, error: "Admin role required to broadcast push", status: 403 };
  }
  const allowed = await filterEventMembers(admin, opts.event_id, uniqueIds);
  if (allowed.length === 0) {
    return { ok: false, error: "No recipients are members of this event", status: 403 };
  }
  return { ok: true, ids: allowed };
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
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Server configuration error" }, 500, ch);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Authorization required" }, 401, ch);
  }

  const userJwt = authHeader.slice(7);
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller } } = await callerClient.auth.getUser(userJwt);
  if (!caller?.id) {
    return json({ error: "Invalid token" }, 401, ch);
  }
  const { data: accountActive } = await callerClient.rpc("is_account_active", {
    p_user_id: caller.id,
  });
  if (accountActive !== true) {
    return json({ error: "Account is deactivated" }, 403, ch);
  }

  let body: {
    event_id?: string;
    title?: string;
    body?: string;
    recipient_user_ids?: string[];
    post_id?: string;
    chat_user_id?: string;
    group_id?: string;
    booth_id?: string;
    kind?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, ch);
  }

  const { event_id, title, body: bodyText, recipient_user_ids, post_id, chat_user_id, group_id, booth_id, kind } = body;
  if (!title || !Array.isArray(recipient_user_ids) || recipient_user_ids.length === 0) {
    return json({ error: "Missing title or recipient_user_ids" }, 400, ch);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const authz = await authorizeRecipients(admin, caller.id, {
    event_id,
    post_id,
    chat_user_id,
    group_id,
    booth_id,
    recipient_user_ids: recipient_user_ids as string[],
  });
  if (!authz.ok) {
    return json({ error: authz.error }, authz.status);
  }
  const uniqueIds = authz.ids;
  if (uniqueIds.length === 0) {
    return json({ sent: 0, message: "No authorized recipients" }, 200, ch);
  }

  if (event_id) {
    const { data: evRow, error: evErr } = await admin
      .from("events")
      .select("notifications_paused, notifications_paused_until")
      .eq("id", event_id)
      .maybeSingle();
    if (evErr) {
      return json({ error: "Could not check notification pause" }, 500, ch);
    }
    const muted = (evRow as { notifications_paused?: boolean; notifications_paused_until?: string | null } | null);
    const untilMs = muted?.notifications_paused_until ? Date.parse(muted.notifications_paused_until) : NaN;
    const activePause =
      muted?.notifications_paused === true &&
      (!Number.isFinite(untilMs) || untilMs > Date.now());
    if (activePause) {
      return json({ sent: 0, message: "Notifications paused for this event" }, 200, ch);
    }
  }

  const { data: users } = await admin
    .from("users")
    .select("id, push_token")
    .in("id", uniqueIds)
    .not("push_token", "is", null);

  const tokens = Array.from(
    new Set((users ?? []).map((u: { push_token: string }) => u.push_token).filter(Boolean)),
  );
  if (tokens.length === 0) {
    return json({ sent: 0, message: "No push tokens found for recipients" }, 200, ch);
  }

  const pushData: Record<string, string> = {};
  if (event_id) pushData.event_id = event_id;
  if (post_id) {
    pushData.post_id = post_id;
    pushData.url = `collectivelive://post/${post_id}`;
  }
  if (chat_user_id && kind === "connection_request") {
    pushData.type = "connection_request";
    pushData.requester_id = chat_user_id;
  } else if (chat_user_id) {
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
    ...EXPO_BANNER_FIELDS,
  }));

  try {
    let okCount = 0;
    const ticketErrors: string[] = [];
    for (let offset = 0; offset < messages.length; offset += EXPO_PUSH_BATCH) {
      const batch = messages.slice(offset, offset + EXPO_PUSH_BATCH);
      const pushRes = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      });
      const rawText = await pushRes.text();
      if (!pushRes.ok) {
        console.warn("Expo push HTTP error:", pushRes.status, rawText);
        return json({ sent: okCount, error: "Push delivery failed" }, 500, ch);
      }
      let parsed: { data?: Array<{ status?: string; message?: string; details?: { error?: string } }> } = {};
      try {
        parsed = JSON.parse(rawText);
      } catch {
        okCount += batch.length;
        continue;
      }
      const items = Array.isArray(parsed?.data) ? parsed.data : [];
      if (items.length === 0) {
        okCount += batch.length;
        continue;
      }
      for (const item of items) {
        if (item?.status === "ok") okCount++;
        else {
          const msg =
            item?.message ??
            item?.details?.error ??
            (typeof item === "object" && item !== null ? JSON.stringify(item) : String(item));
          ticketErrors.push(String(msg));
          console.warn("Expo push ticket error:", msg);
        }
      }
    }
    if (okCount === 0 && tokens.length > 0) {
      return json({
        sent: 0,
        error: "Expo rejected all notifications",
        ticket_errors: ticketErrors,
      }, 502, ch);
    }
    return json({ sent: okCount, ticket_errors: ticketErrors.length ? ticketErrors : undefined }, 200, ch);
  } catch (err) {
    console.error("Expo push request failed:", err);
    return json({ sent: 0, error: "Push request failed" }, 500, ch);
  }
});

function json(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
