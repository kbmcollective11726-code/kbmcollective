-- Event badges: opaque QR tokens, badge scans (vendor notes / attendance), admin reporting.
-- Run via Supabase SQL editor or: npm run supabase:run-sql supabase/migrations/20260428120000_event_badges.sql

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS badge_host_footer text;

CREATE TABLE IF NOT EXISTS public.event_badge_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_badge_tokens_event_user UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_badge_tokens_event ON public.event_badge_tokens(event_id);

CREATE TABLE IF NOT EXISTS public.badge_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  scanner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  scanner_kind text NOT NULL DEFAULT 'attendee',
  attended_meeting boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT badge_scans_unique_triple UNIQUE (event_id, scanner_user_id, subject_user_id)
);

CREATE INDEX IF NOT EXISTS idx_badge_scans_event ON public.badge_scans(event_id);
CREATE INDEX IF NOT EXISTS idx_badge_scans_scanner ON public.badge_scans(scanner_user_id);

ALTER TABLE public.event_badge_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badge_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Event admins read badge tokens" ON public.event_badge_tokens;
CREATE POLICY "Event admins read badge tokens"
  ON public.event_badge_tokens FOR SELECT
  USING (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Badge scans admin read" ON public.badge_scans;
CREATE POLICY "Badge scans admin read"
  ON public.badge_scans FOR SELECT
  USING (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Badge scans scanner read own" ON public.badge_scans;
CREATE POLICY "Badge scans scanner read own"
  ON public.badge_scans FOR SELECT
  USING (scanner_user_id = auth.uid());

-- Inserts/updates only via RPC (SECURITY DEFINER) below.

CREATE OR REPLACE FUNCTION public.ensure_event_badge_tokens(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.is_event_admin(p_event_id) OR public.is_platform_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  INSERT INTO public.event_badge_tokens (event_id, user_id, token)
  SELECT
    p_event_id,
    em.user_id,
    substring(
      md5(random()::text || clock_timestamp()::text || random()::text)
      || md5(gen_random_uuid()::text || random()::text || clock_timestamp()::text),
      1,
      48
    )
  FROM public.event_members em
  WHERE em.event_id = p_event_id
  ON CONFLICT (event_id, user_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_event_badge_tokens(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_event_badge_tokens(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_event_badge_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_user_id uuid;
  ev RECORD;
  sub RECORD;
  sr_role text;
  sr_roles text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;
  SELECT t.event_id, t.user_id INTO v_event_id, v_user_id
  FROM public.event_badge_tokens t
  WHERE t.token = trim(p_token);
  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.event_members em
    WHERE em.event_id = v_event_id AND em.user_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  IF v_user_id = auth.uid() THEN
    RETURN jsonb_build_object('error', 'cannot_scan_own_badge');
  END IF;
  SELECT id, full_name, email, company INTO sub FROM public.users WHERE id = v_user_id;
  SELECT id, name, venue, badge_host_footer INTO ev FROM public.events WHERE id = v_event_id;
  SELECT role, roles INTO sr_role, sr_roles
  FROM public.event_members WHERE event_id = v_event_id AND user_id = auth.uid();
  RETURN jsonb_build_object(
    'event_id', v_event_id,
    'scanner_kind', public.map_member_role_to_scanner_kind(COALESCE(sr_role, 'attendee'), COALESCE(sr_roles, ARRAY[]::text[])),
    'subject', jsonb_build_object(
      'user_id', sub.id,
      'full_name', COALESCE(sub.full_name, ''),
      'email', COALESCE(sub.email, ''),
      'company', COALESCE(sub.company, '')
    ),
    'event', jsonb_build_object(
      'name', COALESCE(ev.name, ''),
      'venue', COALESCE(ev.venue, ''),
      'badge_host_footer', COALESCE(ev.badge_host_footer, '')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_event_badge_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_event_badge_token(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.map_member_role_to_scanner_kind(p_role text, p_roles text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_role IN ('vendor', 'speaker', 'admin', 'super_admin') THEN p_role
    WHEN p_roles IS NOT NULL AND 'vendor' = ANY(p_roles) THEN 'vendor'
    WHEN p_roles IS NOT NULL AND 'speaker' = ANY(p_roles) THEN 'speaker'
    WHEN p_roles IS NOT NULL AND ('admin' = ANY(p_roles) OR 'super_admin' = ANY(p_roles)) THEN 'admin'
    ELSE 'attendee'
  END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_badge_scan(
  p_token text,
  p_note text,
  p_attended_meeting boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_subject uuid;
  v_scanner uuid := auth.uid();
  v_kind text;
  r_role text;
  r_roles text[];
BEGIN
  IF v_scanner IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;
  SELECT t.event_id, t.user_id INTO v_event_id, v_subject
  FROM public.event_badge_tokens t WHERE t.token = trim(p_token);
  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF v_subject = v_scanner THEN
    RETURN jsonb_build_object('error', 'cannot_scan_own_badge');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.event_members em WHERE em.event_id = v_event_id AND em.user_id = v_scanner
  ) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  SELECT role, roles INTO r_role, r_roles
  FROM public.event_members WHERE event_id = v_event_id AND user_id = v_scanner;
  v_kind := public.map_member_role_to_scanner_kind(COALESCE(r_role, 'attendee'), COALESCE(r_roles, ARRAY[]::text[]));

  INSERT INTO public.badge_scans (
    event_id, scanner_user_id, subject_user_id, scanner_kind, attended_meeting, note, updated_at
  ) VALUES (
    v_event_id, v_scanner, v_subject, v_kind, COALESCE(p_attended_meeting, false), NULLIF(trim(p_note), ''), now()
  )
  ON CONFLICT (event_id, scanner_user_id, subject_user_id)
  DO UPDATE SET
    attended_meeting = EXCLUDED.attended_meeting,
    note = EXCLUDED.note,
    scanner_kind = EXCLUDED.scanner_kind,
    updated_at = now();

  RETURN jsonb_build_object('ok', true, 'scanner_kind', v_kind);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_badge_scan(text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_badge_scan(text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_event_badge_scans(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rows jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT (public.is_event_admin(p_event_id) OR public.is_platform_admin(auth.uid())) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT jsonb_build_object(
      'id', bs.id,
      'scanner_kind', bs.scanner_kind,
      'attended_meeting', bs.attended_meeting,
      'note', bs.note,
      'created_at', bs.created_at,
      'updated_at', bs.updated_at,
      'scanner', jsonb_build_object(
        'user_id', su.id,
        'full_name', COALESCE(su.full_name, ''),
        'email', COALESCE(su.email, '')
      ),
      'subject', jsonb_build_object(
        'user_id', subj.id,
        'full_name', COALESCE(subj.full_name, ''),
        'email', COALESCE(subj.email, ''),
        'company', COALESCE(subj.company, '')
      )
    ) AS x
    FROM public.badge_scans bs
    JOIN public.users su ON su.id = bs.scanner_user_id
    JOIN public.users subj ON subj.id = bs.subject_user_id
    WHERE bs.event_id = p_event_id
    ORDER BY bs.updated_at DESC
  ) q;
  RETURN jsonb_build_object('rows', rows);
END;
$$;

REVOKE ALL ON FUNCTION public.list_event_badge_scans(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_event_badge_scans(uuid) TO authenticated;
