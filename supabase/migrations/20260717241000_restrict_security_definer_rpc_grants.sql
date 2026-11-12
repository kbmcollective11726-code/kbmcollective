-- Remove PostgreSQL's default PUBLIC execute grant from privileged callable
-- SECURITY DEFINER functions. Public registration predicates are intentionally
-- not included because anonymous portal RLS depends on them.
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname = ANY (ARRAY[
        'admin_clear_user_report',
        'admin_clear_user_reports',
        'admin_count_event_meetings_for_user',
        'admin_list_booth_meeting_bookings',
        'admin_remove_user_block',
        'admin_transfer_event_meetings',
        'can_manage_chat_group_members',
        'clear_event_sponsor_clicks',
        'delete_own_post',
        'ensure_event_badge_tokens',
        'generate_event_match_suggestions',
        'get_b2b_vendor_performance',
        'get_chat_group_member_count',
        'get_event_b2b_feedback',
        'get_event_session_feedback',
        'get_meeting_request_target_profile',
        'get_platform_audit_tile_detail',
        'get_platform_security_overview',
        'get_session_attendance_report',
        'get_session_rating_stats',
        'get_vendor_attendee_brief',
        'has_platform_admin_step_up',
        'is_account_active',
        'is_event_admin',
        'is_member_of_chat_group',
        'is_platform_admin',
        'link_my_delegate_submission',
        'link_my_vendor_submission',
        'list_badge_scan_attendee_with_vendor_meetings',
        'list_badge_scan_meeting_options',
        'list_brute_force_anomalies',
        'list_event_badge_scans',
        'list_event_safety_records',
        'list_event_sponsor_click_log',
        'list_event_sponsor_click_stats',
        'list_platform_safety_overview',
        'list_platform_user_audit',
        'list_suspicious_users',
        'list_vendor_attendee_badge_tokens',
        'list_vendor_badge_scans_for_event',
        'list_vendor_meeting_attendance_for_event',
        'list_vendor_prior_interaction_flags',
        'publish_matchmaking_meeting_to_app',
        'rank_submission_matches',
        'record_session_check_in',
        'registration_submission_owned_by_auth',
        'resolve_event_badge_token',
        'sync_submission_solution_categories',
        'upsert_badge_scan',
        'upsert_vendor_attendee_note',
        'user_failed_logins_7d',
        'users_have_block'
      ])
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      fn.signature
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role',
      fn.signature
    );
  END LOOP;

  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname = ANY (ARRAY[
        'notify_platform_admins_orphan_signup',
        'notify_platform_admins_security_alert',
        'process_brute_force_anomaly_alerts',
        'process_orphan_account_auto_deactivations'
      ])
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      fn.signature
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      fn.signature
    );
  END LOOP;
END
$$;
