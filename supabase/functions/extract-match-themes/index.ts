/**
 * Extract short match themes from open-text goal answers via Claude Haiku.
 * Stores themes on event_registration_submissions.match_themes for SQL scoring.
 *
 * Secrets: ANTHROPIC_API_KEY (optional — no-ops with skipped:true when missing)
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";

const MODEL = Deno.env.get("ANTHROPIC_MATCH_MODEL")?.trim() || "claude-haiku-4-5";

type Body = {
  submission_id?: string;
  event_id?: string;
  limit?: number;
  force?: boolean;
};

function json(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function normalizeThemes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = item
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s/-]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 48);
    if (t.length < 3 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 8) break;
  }
  return out;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function extractThemesWithHaiku(apiKey: string, text: string): Promise<string[]> {
  const prompt =
    `Extract 3-8 short matchmaking theme tags from this event registrant open-text answer. ` +
    `Tags should be concrete topics useful for vendor↔buyer matching (e.g. leadership development, employee wellness, hcm software, DEI strategy). ` +
    `Return ONLY a JSON array of strings. No commentary.\n\nTEXT:\n${text.slice(0, 4000)}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 400)}`);
  }

  const payload = await res.json() as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const textOut = (payload.content ?? [])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text as string)
    .join("\n")
    .trim();

  const jsonMatch = textOut.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    return normalizeThemes(JSON.parse(jsonMatch[0]));
  } catch {
    return [];
  }
}

async function loadOpenTextBundle(
  // deno-lint-ignore no-explicit-any
  admin: any,
  submissionId: string,
): Promise<{ text: string; hash: string }> {
  const { data: rows, error } = await admin
    .from("event_registration_answers")
    .select("answer_text, question:event_registration_questions!inner(prompt, question_type, used_in_matching)")
    .eq("submission_id", submissionId);
  if (error) throw error;

  const parts: string[] = [];
  for (const row of rows ?? []) {
    const q = row.question as {
      prompt?: string;
      question_type?: string;
      used_in_matching?: boolean;
    } | null;
    if (!q || q.used_in_matching !== true) continue;
    if (q.question_type !== "textarea" && q.question_type !== "text") continue;
    const prompt = (q.prompt || "").toLowerCase();
    if (!/hoping to (accomplish|get)/.test(prompt) && !/^what are you hoping/.test(prompt)) {
      // Still allow other used_in_matching open text, but skip company description
      if (/company description|terms|privacy|consent/.test(prompt)) continue;
      if (q.question_type !== "textarea") continue;
    }
    const answer = (row.answer_text || "").trim();
    if (answer.length < 12) continue;
    parts.push(`${q.prompt}: ${answer}`);
  }

  const text = parts.join("\n\n").trim();
  return { text, hash: text ? await sha256Hex(text) : "" };
}

async function processSubmission(
  // deno-lint-ignore no-explicit-any
  admin: any,
  apiKey: string | undefined,
  submissionId: string,
  force: boolean,
): Promise<Record<string, unknown>> {
  const { data: sub, error: subErr } = await admin
    .from("event_registration_submissions")
    .select("id, match_themes_source_hash")
    .eq("id", submissionId)
    .maybeSingle();
  if (subErr) throw subErr;
  if (!sub) return { submission_id: submissionId, ok: false, reason: "not_found" };

  const { text, hash } = await loadOpenTextBundle(admin, submissionId);
  if (!text) {
    await admin
      .from("event_registration_submissions")
      .update({
        match_themes: [],
        match_themes_source_hash: null,
        match_themes_updated_at: new Date().toISOString(),
      })
      .eq("id", submissionId);
    return { submission_id: submissionId, ok: true, themes: [], reason: "no_open_text" };
  }

  if (!force && sub.match_themes_source_hash === hash) {
    return { submission_id: submissionId, ok: true, skipped: true, reason: "unchanged" };
  }

  if (!apiKey) {
    return { submission_id: submissionId, ok: false, skipped: true, reason: "no_api_key" };
  }

  const themes = await extractThemesWithHaiku(apiKey, text);
  const { error: updErr } = await admin
    .from("event_registration_submissions")
    .update({
      match_themes: themes,
      match_themes_source_hash: hash,
      match_themes_updated_at: new Date().toISOString(),
    })
    .eq("id", submissionId);
  if (updErr) throw updErr;

  return { submission_id: submissionId, ok: true, themes };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  const headers = corsHeaders(req);

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, headers);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: "Server misconfigured" }, 500, headers);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: authData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !authData.user) {
      return json({ error: "Unauthorized" }, 401, headers);
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const force = body.force === true;
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim() || undefined;

    const { data: aiEnabled } = await admin.rpc("is_match_ai_themes_enabled");
    if (aiEnabled !== true) {
      return json({
        ok: false,
        skipped: true,
        reason: "feature_disabled",
        error: "AI open-text themes are disabled by platform admin",
      }, 200, headers);
    }

    const { data: isPlatformAdmin } = await userClient.rpc("is_platform_admin", {
      p_user_id: authData.user.id,
    });

    if (body.submission_id) {
      const submissionId = body.submission_id.trim();
      const { data: sub } = await admin
        .from("event_registration_submissions")
        .select("id, event_id, user_id")
        .eq("id", submissionId)
        .maybeSingle();
      if (!sub) return json({ error: "Submission not found" }, 404, headers);

      const owns = sub.user_id === authData.user.id;
      const { data: isEventAdmin } = await userClient.rpc("is_event_admin", {
        p_event_id: sub.event_id,
      });
      if (!owns && !isEventAdmin && !isPlatformAdmin) {
        return json({ error: "Forbidden" }, 403, headers);
      }

      const result = await processSubmission(admin, apiKey, submissionId, force);
      return json(result, 200, headers);
    }

    if (body.event_id) {
      const eventId = body.event_id.trim();
      const { data: isEventAdmin } = await userClient.rpc("is_event_admin", {
        p_event_id: eventId,
      });
      if (!isEventAdmin && !isPlatformAdmin) {
        return json({ error: "Forbidden" }, 403, headers);
      }

      const limit = Math.min(Math.max(Number(body.limit) || 40, 1), 100);
      const { data: rows, error } = await admin
        .from("event_registration_submissions")
        .select("id")
        .eq("event_id", eventId)
        .eq("status", "submitted")
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (error) throw error;

      const results = [];
      for (const row of rows ?? []) {
        results.push(await processSubmission(admin, apiKey, row.id, force));
      }
      return json({
        ok: true,
        processed: results.length,
        skipped_no_key: results.filter((r) => r.reason === "no_api_key").length,
        results,
      }, 200, headers);
    }

    return json({ error: "Provide submission_id or event_id" }, 400, headers);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Theme extraction failed";
    return json({ error: message }, 500, headers);
  }
});
