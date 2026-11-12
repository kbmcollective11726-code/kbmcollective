-- Covering index for FK event_matchmaking_locations.vendor_submission_id
-- (existing composite partial index does not fully satisfy the FK lint).
CREATE INDEX IF NOT EXISTS event_matchmaking_locations_vendor_submission_id_idx
  ON public.event_matchmaking_locations (vendor_submission_id);

-- Revoke dangerous / non-public SECURITY DEFINER EXECUTE from anon.
-- Keep intentional live-wall + registration portal RPCs callable by anon.
REVOKE EXECUTE ON FUNCTION public.purge_expired_security_logs(integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_chat_group_members(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_user_profile() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_member_of_chat_group(uuid, uuid) FROM anon;

-- purge should not be callable by random signed-in users either (cron/service_role only).
REVOKE EXECUTE ON FUNCTION public.purge_expired_security_logs(integer, integer) FROM authenticated;
