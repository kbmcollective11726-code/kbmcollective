-- Security hardening: pin search_path = public on functions flagged by the
-- Supabase advisor (function_search_path_mutable). This makes object lookups
-- deterministic. Behavior is unchanged because all referenced objects already
-- live in the public schema.

ALTER FUNCTION generate_event_code_for_backfill() SET search_path = public;
ALTER FUNCTION generate_event_code() SET search_path = public;
ALTER FUNCTION handle_new_user() SET search_path = public;
ALTER FUNCTION map_member_role_to_scanner_kind(text, text[]) SET search_path = public;
ALTER FUNCTION sync_event_member_primary_role() SET search_path = public;
ALTER FUNCTION update_comments_count() SET search_path = public;
ALTER FUNCTION update_likes_count() SET search_path = public;
ALTER FUNCTION update_member_points() SET search_path = public;
ALTER FUNCTION update_updated_at() SET search_path = public;
