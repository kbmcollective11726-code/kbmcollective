-- Emergency: older app builds still SELECT users.phone in the profile query.
-- Column REVOKE made PostgREST fail the entire profile load.
-- Row visibility remains RLS-scoped (self / platform admin / shared event co-member).
GRANT SELECT (phone) ON TABLE public.users TO authenticated;

COMMENT ON COLUMN public.users.phone IS
  'Phone. SELECT re-enabled for legacy mobile profile queries; RLS still scopes rows. Prefer get_user_networking_contact for intentional contact reads.';
