// Every ~10 min (pg_cron): alert platform admins about recent accounts with no event membership.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

function json(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function isRetryableMessage(message: string): boolean {
  return /TypeError|Connection reset|Connect|fetch failed|timed out|ECONNRESET|network/i
    .test(message);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Retry transient Edge → PostgREST connect failures (connection reset by peer). */
async function withRetry<T extends { error: { message: string } | null }>(
  label: string,
  fn: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let last: T | undefined;
  for (let i = 0; i < attempts; i++) {
    last = await fn();
    if (!last.error) return last;
    const msg = last.error.message ?? "";
    if (!isRetryableMessage(msg) || i === attempts - 1) {
      if (last.error) console.error(label, last.error);
      return last;
    }
    console.warn(`${label} retry ${i + 1}/${attempts - 1}: ${msg}`);
    await sleep(300 * (i + 1));
  }
  return last!;
}

type OrphanCandidate = {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
};

function isFreshSignup(createdAt: string): boolean {
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) return false;
  return Date.now() - createdMs < 48 * 60 * 60 * 1000;
}

function buildAlertCopy(user: OrphanCandidate) {
  const name = user.full_name || "Unknown";
  const fresh = isFreshSignup(user.created_at);
  const subject = fresh
    ? `[KBM] New account with no event membership: ${user.email}`
    : `[KBM] Account with no event membership: ${user.email}`;
  const nuance = fresh
    ? "created a KBM account and is not on any event roster yet."
    : "has a recent KBM account with no event membership. This can mean they never joined an event, or membership was removed (for example after an event was deleted).";
  const text =
    `${name} (${user.email}) ${nuance}\n\n` +
    `Account created: ${user.created_at}\n\n` +
    `Review in cadmin: https://cadmin.kbmcollective.org/platform/audit`;
  const html =
    `<p><strong>${name}</strong> (` +
    `<a href="mailto:${user.email}">${user.email}</a>` +
    `) ${nuance}</p>` +
    `<p>Account created: ${user.created_at}</p>` +
    `<p><a href="https://cadmin.kbmcollective.org/platform/audit">Open Security audit in cadmin</a></p>`;
  return { subject, text, html };
}

Deno.serve(async (req: Request) => {
  const ch = corsHeaders(req, "Authorization, Content-Type, apikey");
  if (req.method === "OPTIONS") {
    return corsPreflightResponse(req, "Authorization, Content-Type, apikey");
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, ch);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Server configuration error" }, 500, ch);
    }

    const headerSecret = req.headers.get("x-cron-secret");
    if (!cronSecret || headerSecret !== cronSecret) {
      return json({ error: "Unauthorized" }, 401, ch);
    }

    const admin: SupabaseClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: candidates, error: qErr } = await withRetry(
      "list_orphan_signup_candidates",
      () =>
        admin.rpc("list_orphan_signup_candidates", {
          p_min_age_minutes: 10,
          p_limit: 50,
        }),
    );

    if (qErr) {
      const status = isRetryableMessage(qErr.message) ? 503 : 500;
      return json({ error: qErr.message }, status, ch);
    }

    let processed = 0;
    for (const row of (candidates ?? []) as OrphanCandidate[]) {
      const user = row;
      const { error: notifyErr } = await withRetry(
        "notify_platform_admins_orphan_signup",
        () =>
          admin.rpc("notify_platform_admins_orphan_signup", {
            p_user_id: user.id,
            p_email: user.email,
            p_full_name: user.full_name ?? "",
          }),
      );
      if (notifyErr) continue;

      processed += 1;
      const { subject, text, html } = buildAlertCopy(user);

      try {
        await fetch(`${supabaseUrl}/functions/v1/send-security-alert-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}`,
            "x-cron-secret": cronSecret,
          },
          body: JSON.stringify({ subject, text, html }),
        });
      } catch (e) {
        console.error("send-security-alert-email", e);
      }
    }

    return json({ ok: true, processed }, 200, ch);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("process-orphan-signup-alerts fatal", e);
    const status = isRetryableMessage(message) ? 503 : 500;
    return json({ error: message }, status, ch);
  }
});
