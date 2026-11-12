-- Fix: All users page selects password_reset_blocked, but H4 column lockdown
-- revoked SELECT on that column → "permission denied for table users".
-- Allow SELECT of the admin flag (not a secret like push_token). RLS still
-- scopes which rows are visible (self / co-member / platform admin).
-- Also restore UPDATE columns platform admins need for All users actions;
-- field-level triggers still block non-admins from changing security fields.

GRANT SELECT (password_reset_blocked) ON TABLE public.users TO authenticated;

GRANT UPDATE (
  is_active,
  is_platform_admin,
  password_reset_blocked,
  updated_at
) ON TABLE public.users TO authenticated;
