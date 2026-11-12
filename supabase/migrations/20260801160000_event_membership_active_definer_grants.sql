-- ASVS H5/H6: event-scoped membership suspend + tighten SECURITY DEFINER EXECUTE.

-- ---------------------------------------------------------------------------
-- 1) event_members.is_active (event-scoped suspend; default true)
-- ---------------------------------------------------------------------------
ALTER TABLE public.event_members
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.event_members.is_active IS
  'When false, member cannot access this event (event-admin suspend). Does not ban Auth globally.';

CREATE INDEX IF NOT EXISTS event_members_event_active_idx
  ON public.event_members (event_id)
  WHERE is_active = true;

-- Membership helper: require active membership row
CREATE OR REPLACE FUNCTION public.is_event_member(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.is_account_active((SELECT auth.uid())), false)
    AND EXISTS (
      SELECT 1
      FROM public.event_members em
      WHERE em.event_id = p_event_id
        AND em.user_id = (SELECT auth.uid())
        AND COALESCE(em.is_active, true) = true
    );
$$;

-- Keep anon EXECUTE: some RLS policies are role {public} and call membership helpers.
REVOKE ALL ON FUNCTION public.is_event_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_event_member(uuid) TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- 2) Revoke callable EXECUTE on trigger-only DEFINER functions (PostgREST noise)
-- ---------------------------------------------------------------------------
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
      AND p.proname LIKE 'trg_%'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      fn.signature
    );
  END LOOP;

  -- Ensure anon cannot write platform audit logs directly
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname = 'insert_platform_audit_log'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon',
      fn.signature
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role',
      fn.signature
    );
  END LOOP;
END
$$;
