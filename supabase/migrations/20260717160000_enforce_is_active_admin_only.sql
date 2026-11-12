-- Only platform / event admins may change users.is_active (blocks self-reactivation).

CREATE OR REPLACE FUNCTION public.enforce_is_active_admin_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN
    RETURN NEW;
  END IF;

  -- Service role / triggers without JWT (e.g. orphan auto-deactivate) may omit auth.uid().
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.is_platform_admin(v_uid) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.event_members em
    WHERE em.user_id = NEW.id
      AND public.is_event_admin(em.event_id)
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only event or platform admins can activate or deactivate accounts'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_users_enforce_is_active_admin_only ON public.users;
CREATE TRIGGER trg_users_enforce_is_active_admin_only
  BEFORE UPDATE OF is_active ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_is_active_admin_only();

COMMENT ON FUNCTION public.enforce_is_active_admin_only() IS
  'Prevents users from flipping their own is_active; only platform/event admins may change it.';
