-- Allow optional point rules: session feedback (ratings) and B2B meeting feedback.

ALTER TABLE public.point_rules DROP CONSTRAINT IF EXISTS point_rules_action_check;

ALTER TABLE public.point_rules ADD CONSTRAINT point_rules_action_check CHECK (
  action IN (
    'post_photo',
    'receive_like',
    'give_like',
    'comment',
    'receive_comment',
    'connect',
    'attend_session',
    'complete_profile',
    'daily_streak',
    'vendor_meeting',
    'checkin',
    'share_linkedin',
    'session_feedback',
    'b2b_feedback'
  )
);

COMMENT ON CONSTRAINT point_rules_action_check ON public.point_rules IS
  'Allowed point rule actions; session_feedback / b2b_feedback are optional admin-added rules.';
