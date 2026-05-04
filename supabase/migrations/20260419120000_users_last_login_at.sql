-- Track the last time an auth user signed in, mirrored onto public.users for admin views.
-- Additive-only: nullable column + trigger sync from auth.users.last_sign_in_at.

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Backfill existing rows from auth.users when available.
UPDATE public.users u
SET last_login_at = a.last_sign_in_at
FROM auth.users a
WHERE a.id = u.id
  AND a.last_sign_in_at IS NOT NULL
  AND (
    u.last_login_at IS NULL
    OR a.last_sign_in_at > u.last_login_at
  );

CREATE OR REPLACE FUNCTION public.sync_last_login_at_from_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.last_sign_in_at IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.users u
  SET last_login_at = NEW.last_sign_in_at
  WHERE u.id = NEW.id
    AND (u.last_login_at IS NULL OR NEW.last_sign_in_at > u.last_login_at);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_last_sign_in_sync ON auth.users;

CREATE TRIGGER on_auth_user_last_sign_in_sync
AFTER UPDATE OF last_sign_in_at ON auth.users
FOR EACH ROW
WHEN (NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at)
EXECUTE FUNCTION public.sync_last_login_at_from_auth();
