-- Expose subject's event role kind (same mapping as scanner) for peer badge-scan UI.
CREATE OR REPLACE FUNCTION public.resolve_event_badge_token (p_token text) RETURNS jsonb
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
  sub_role text;
  sub_roles text[];
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
  SELECT role, roles INTO sub_role, sub_roles
  FROM public.event_members WHERE event_id = v_event_id AND user_id = v_user_id;
  RETURN jsonb_build_object(
    'event_id', v_event_id,
    'scanner_kind', public.map_member_role_to_scanner_kind(COALESCE(sr_role, 'attendee'), COALESCE(sr_roles, ARRAY[]::text[])),
    'subject_kind', public.map_member_role_to_scanner_kind(COALESCE(sub_role, 'attendee'), COALESCE(sub_roles, ARRAY[]::text[])),
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
