-- Defense-in-depth: strip dangerous HTML from portal rich-text columns on write.
-- Client already sanitizes; this blocks direct PostgREST updates with script payloads.

CREATE OR REPLACE FUNCTION public.sanitize_portal_html(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text := COALESCE(input, '');
BEGIN
  -- Remove script/style/iframe/object/embed blocks
  v := regexp_replace(v, '(?is)<script\b[^>]*>.*?</script>', '', 'g');
  v := regexp_replace(v, '(?is)<style\b[^>]*>.*?</style>', '', 'g');
  v := regexp_replace(v, '(?is)<iframe\b[^>]*>.*?</iframe>', '', 'g');
  v := regexp_replace(v, '(?is)<object\b[^>]*>.*?</object>', '', 'g');
  v := regexp_replace(v, '(?is)<embed\b[^>]*/?>', '', 'g');
  v := regexp_replace(v, '(?is)<link\b[^>]*/?>', '', 'g');
  v := regexp_replace(v, '(?is)<meta\b[^>]*/?>', '', 'g');
  -- Strip inline event handlers and javascript: URLs
  v := regexp_replace(v, '(?i)\son[a-z]+\s*=\s*("[^"]*"|''[^'']*''|[^\s>]+)', '', 'g');
  v := regexp_replace(v, '(?i)javascript\s*:', '', 'g');
  v := regexp_replace(v, '(?i)vbscript\s*:', '', 'g');
  v := regexp_replace(v, '(?i)data\s*:\s*text/html', 'data:text/plain', 'g');
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sanitize_event_portal_html()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.delegate_hotel_content := public.sanitize_portal_html(NEW.delegate_hotel_content);
    NEW.stage2_holding_message := public.sanitize_portal_html(NEW.stage2_holding_message);
    RETURN NEW;
  END IF;
  IF NEW.delegate_hotel_content IS DISTINCT FROM OLD.delegate_hotel_content THEN
    NEW.delegate_hotel_content := public.sanitize_portal_html(NEW.delegate_hotel_content);
  END IF;
  IF NEW.stage2_holding_message IS DISTINCT FROM OLD.stage2_holding_message THEN
    NEW.stage2_holding_message := public.sanitize_portal_html(NEW.stage2_holding_message);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_sanitize_portal_html ON public.events;
DROP TRIGGER IF EXISTS event_matchmaking_settings_sanitize_portal_html ON public.event_matchmaking_settings;
CREATE TRIGGER event_matchmaking_settings_sanitize_portal_html
  BEFORE INSERT OR UPDATE OF delegate_hotel_content, stage2_holding_message
  ON public.event_matchmaking_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sanitize_event_portal_html();

REVOKE ALL ON FUNCTION public.sanitize_portal_html(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sanitize_portal_html(text) TO authenticated, service_role;
