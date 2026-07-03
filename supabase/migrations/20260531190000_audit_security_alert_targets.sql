-- Populate target + IP on automated security audit rows so cadmin timeline is clearer.

CREATE OR REPLACE FUNCTION public.notify_platform_admins_security_alert(
  p_alert_type TEXT,
  p_dedupe_key TEXT,
  p_title TEXT,
  p_body TEXT,
  p_details JSONB DEFAULT '{}'::jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_ids UUID[];
  uid UUID;
  v_ip TEXT := NULLIF(trim(p_details->>'ip_address'), '');
  v_email TEXT := NULLIF(trim(COALESCE(p_details->>'email', p_details->>'target_email')), '');
  v_target_email TEXT := NULL;
  v_target_name TEXT := NULL;
BEGIN
  IF NULLIF(trim(p_alert_type), '') IS NULL OR NULLIF(trim(p_dedupe_key), '') IS NULL THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.platform_security_alert_dedupe d
    WHERE d.alert_type = p_alert_type AND d.dedupe_key = p_dedupe_key
  ) THEN
    RETURN false;
  END IF;

  IF p_alert_type = 'brute_force_email' AND v_email IS NOT NULL THEN
    v_target_email := v_email;
  ELSIF p_alert_type IN ('brute_force_ip', 'ip_scan') AND v_ip IS NOT NULL THEN
    v_target_name := 'IP ' || v_ip;
  END IF;

  SELECT COALESCE(array_agg(u.id), ARRAY[]::uuid[])
  INTO admin_ids
  FROM public.users u
  WHERE COALESCE(u.is_platform_admin, false) = true;

  IF admin_ids IS NOT NULL THEN
    FOREACH uid IN ARRAY admin_ids
    LOOP
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (
        uid,
        'security_alert',
        p_title,
        p_body,
        jsonb_build_object(
          'alert_type', p_alert_type,
          'dedupe_key', p_dedupe_key
        ) || COALESCE(p_details, '{}'::jsonb)
      );
    END LOOP;
  END IF;

  INSERT INTO public.platform_security_alert_dedupe (alert_type, dedupe_key, details)
  VALUES (p_alert_type, p_dedupe_key, COALESCE(p_details, '{}'::jsonb))
  ON CONFLICT DO NOTHING;

  PERFORM public.insert_platform_audit_log(
    'security',
    p_alert_type,
    NULL,
    NULL,
    v_target_email,
    v_target_name,
    NULL,
    v_ip,
    jsonb_build_object(
      'dedupe_key', p_dedupe_key,
      'title', p_title,
      'body', p_body,
      'summary', p_body
    ) || COALESCE(p_details, '{}'::jsonb)
  );

  RETURN true;
END;
$$;
