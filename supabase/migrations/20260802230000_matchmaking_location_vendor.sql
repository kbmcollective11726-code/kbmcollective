-- Attach matchmaking tables/locations to a vendor registration.
ALTER TABLE public.event_matchmaking_locations
  ADD COLUMN IF NOT EXISTS vendor_submission_id UUID
    REFERENCES public.event_registration_submissions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS event_matchmaking_locations_vendor_idx
  ON public.event_matchmaking_locations (event_id, vendor_submission_id)
  WHERE vendor_submission_id IS NOT NULL;

COMMENT ON COLUMN public.event_matchmaking_locations.vendor_submission_id IS
  'Optional home vendor for this table; used as default place when scheduling that vendor.';
