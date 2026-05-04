-- Allow platform admins to update any row in public.users (e.g. web admin "All users").
-- Complements existing "Users can update own profile" policy (policies are OR-combined).

DROP POLICY IF EXISTS "Platform admins can update any user profile" ON public.users;

CREATE POLICY "Platform admins can update any user profile"
ON public.users
FOR UPDATE
TO authenticated
USING (public.is_platform_admin())
WITH CHECK (public.is_platform_admin());
