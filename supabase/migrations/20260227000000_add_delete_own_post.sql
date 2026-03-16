-- Soft-delete own post (bypasses RLS; only updates if auth.uid() = user_id)
CREATE OR REPLACE FUNCTION public.delete_own_post(post_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.posts SET is_deleted = true WHERE id = post_id AND user_id = auth.uid();
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_own_post(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_own_post(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_own_post(uuid) TO anon;
