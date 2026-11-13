// Platform admin "App health" outside checks: websites, database round trip, photo storage,
// Expo push service, and recent Sentry issues. Database-side checks live in platform_health_snapshot().
// Optional secrets: SENTRY_AUTH_TOKEN (read-only issue access), SENTRY_ORG, SENTRY_PROJECT, SENTRY_API_BASE.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CHECK_TIMEOUT_MS = 8000;

const SITES = [
  { id: "cadmin", label: "Admin site (cadmin)", url: "https://cadmin.kbmcollective.org/" },
  { id: "connect", label: "Event website (connect)", url: "https://connect.kbmcollective.org/" },
  { id: "wall", label: "Live wall", url: "https://wall.kbmcollective.org/" },
];

type Status = "ok" | "warn" | "fail" | "not_set_up";

type CheckResult = {
  id: string;
  label: string;
  status: Status;
  detail: string;
  ms?: number;
};

type SentryIssue = {
  short_id: string;
  title: string;
  count: number;
  users: number;
  first_seen: string;
  last_seen: string;
  url: string;
  is_new: boolean;
};

async function timed<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<{ value?: T; error?: string; ms: number }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const value = await fn(controller.signal);
    return { value, ms: Date.now() - started };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return { error: aborted ? "timed out" : e instanceof Error ? e.message : String(e), ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function speedStatus(ms: number): Status {
  return ms > 4000 ? "warn" : "ok";
}

async function checkSite(site: (typeof SITES)[number]): Promise<CheckResult> {
  const r = await timed((signal) => fetch(site.url, { method: "GET", redirect: "follow", signal }));
  if (r.error || !r.value) {
    return { id: site.id, label: site.label, status: "fail", detail: `Not reachable (${r.error ?? "no response"}).`, ms: r.ms };
  }
  await r.value.body?.cancel();
  if (!r.value.ok) {
    return { id: site.id, label: site.label, status: "fail", detail: `Returned HTTP ${r.value.status}.`, ms: r.ms };
  }
  return {
    id: site.id,
    label: site.label,
    status: speedStatus(r.ms),
    detail: r.ms > 4000 ? `Up but slow (${r.ms} ms).` : `Up (${r.ms} ms).`,
    ms: r.ms,
  };
}

async function checkDatabase(admin: ReturnType<typeof createClient>): Promise<CheckResult> {
  const r = await timed(async () => {
    const { error } = await admin.from("events").select("id", { count: "exact", head: true }).limit(1);
    if (error) throw new Error(error.message);
    return true;
  });
  if (r.error) return { id: "database", label: "Database", status: "fail", detail: `Not answering (${r.error}).`, ms: r.ms };
  return {
    id: "database",
    label: "Database",
    status: r.ms > 2000 ? "warn" : "ok",
    detail: r.ms > 2000 ? `Answering slowly (${r.ms} ms).` : `Answering (${r.ms} ms).`,
    ms: r.ms,
  };
}

async function checkPhotos(admin: ReturnType<typeof createClient>): Promise<CheckResult> {
  const { data, error } = await admin
    .from("posts")
    .select("image_url")
    .eq("is_deleted", false)
    .not("image_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { id: "photos", label: "Photo storage", status: "warn", detail: "Could not look up a recent photo." };
  const url = (data as { image_url?: string | null } | null)?.image_url;
  if (!url) return { id: "photos", label: "Photo storage", status: "ok", detail: "No photos posted yet." };
  const r = await timed((signal) => fetch(url, { method: "HEAD", signal }));
  if (r.error || !r.value) {
    return { id: "photos", label: "Photo storage", status: "fail", detail: `Latest photo did not load (${r.error ?? "no response"}).`, ms: r.ms };
  }
  if (!r.value.ok) {
    return { id: "photos", label: "Photo storage", status: "fail", detail: `Latest photo returned HTTP ${r.value.status}.`, ms: r.ms };
  }
  return { id: "photos", label: "Photo storage", status: speedStatus(r.ms), detail: `Latest photo loads (${r.ms} ms).`, ms: r.ms };
}

async function checkExpoPush(): Promise<CheckResult> {
  const r = await timed((signal) =>
    fetch("https://exp.host/--/api/v2/push/getReceipts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [] }),
      signal,
    })
  );
  if (r.error || !r.value) {
    return { id: "push", label: "Push notification service", status: "fail", detail: `Not reachable (${r.error ?? "no response"}).`, ms: r.ms };
  }
  await r.value.body?.cancel();
  if (!r.value.ok) {
    return { id: "push", label: "Push notification service", status: "fail", detail: `Returned HTTP ${r.value.status}.`, ms: r.ms };
  }
  return { id: "push", label: "Push notification service", status: speedStatus(r.ms), detail: `Reachable (${r.ms} ms).`, ms: r.ms };
}

async function checkSentry(): Promise<{ check: CheckResult; issues: SentryIssue[] }> {
  const token = Deno.env.get("SENTRY_AUTH_TOKEN");
  const org = Deno.env.get("SENTRY_ORG") ?? "kbm-collective";
  const project = Deno.env.get("SENTRY_PROJECT") ?? "react-native";
  const base = (Deno.env.get("SENTRY_API_BASE") ?? "https://sentry.io").replace(/\/+$/, "");
  if (!token) {
    return {
      check: {
        id: "sentry",
        label: "App errors (Sentry)",
        status: "not_set_up",
        detail: "Not connected yet. Add a read-only Sentry token as the SENTRY_AUTH_TOKEN server secret.",
      },
      issues: [],
    };
  }
  const url = `${base}/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/issues/?query=is:unresolved&statsPeriod=24h&sort=date&limit=10`;
  const r = await timed((signal) => fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal }));
  if (r.error || !r.value) {
    return { check: { id: "sentry", label: "App errors (Sentry)", status: "warn", detail: `Could not reach Sentry (${r.error ?? "no response"}).` }, issues: [] };
  }
  if (!r.value.ok) {
    await r.value.body?.cancel();
    return { check: { id: "sentry", label: "App errors (Sentry)", status: "warn", detail: `Sentry returned HTTP ${r.value.status}. Check the token.` }, issues: [] };
  }
  const raw = (await r.value.json()) as Array<Record<string, unknown>>;
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const issues: SentryIssue[] = (Array.isArray(raw) ? raw : []).map((i) => {
    const firstSeen = String(i.firstSeen ?? "");
    return {
      short_id: String(i.shortId ?? ""),
      title: String(i.title ?? "Unknown error"),
      count: Number(i.count ?? 0),
      users: Number(i.userCount ?? 0),
      first_seen: firstSeen,
      last_seen: String(i.lastSeen ?? ""),
      url: String(i.permalink ?? ""),
      is_new: Date.parse(firstSeen) > dayAgo,
    };
  });
  const newCount = issues.filter((i) => i.is_new).length;
  const affected = issues.reduce((sum, i) => sum + i.users, 0);
  const status: Status = issues.length === 0 ? "ok" : newCount > 0 || affected >= 5 ? "warn" : "ok";
  const detail = issues.length === 0
    ? "No app errors in the last 24 hours."
    : `${issues.length} error type${issues.length === 1 ? "" : "s"} seen in the last 24 hours${newCount > 0 ? ` (${newCount} new)` : ""}.`;
  return { check: { id: "sentry", label: "App errors (Sentry)", status, detail }, issues };
}

Deno.serve(async (req: Request) => {
  const ch = corsHeaders(req, "Authorization, Content-Type, apikey, x-client-info");
  if (req.method === "OPTIONS") {
    return corsPreflightResponse(req, "Authorization, Content-Type, apikey, x-client-info");
  }
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405, ch);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server is missing configuration" }, 500, ch);
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Unauthorized" }, 401, ch);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: authData, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !authData?.user) return json({ error: "Unauthorized" }, 401, ch);

  const { data: me } = await admin
    .from("users")
    .select("is_platform_admin, is_active")
    .eq("id", authData.user.id)
    .maybeSingle();
  const row = me as { is_platform_admin?: boolean | null; is_active?: boolean | null } | null;
  if (row?.is_platform_admin !== true || row?.is_active === false) {
    return json({ error: "Forbidden" }, 403, ch);
  }

  const [sites, database, photos, push, sentry] = await Promise.all([
    Promise.all(SITES.map(checkSite)),
    checkDatabase(admin),
    checkPhotos(admin),
    checkExpoPush(),
    checkSentry(),
  ]);

  return json(
    {
      generated_at: new Date().toISOString(),
      checks: [...sites, database, photos, push, sentry.check],
      sentry_issues: sentry.issues,
    },
    200,
    ch,
  );
});

function json(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
