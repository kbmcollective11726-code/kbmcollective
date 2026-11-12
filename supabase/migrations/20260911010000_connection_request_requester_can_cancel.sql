-- Allow the sender to withdraw a pending connection request (delete so they can re-send later).
DROP POLICY IF EXISTS "Requester can cancel pending request" ON public.connection_requests;
CREATE POLICY "Requester can cancel pending request"
  ON public.connection_requests
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (
    (SELECT auth.uid()) = requester_id
    AND status = 'pending'
    AND public.is_account_active((SELECT auth.uid()))
  );
