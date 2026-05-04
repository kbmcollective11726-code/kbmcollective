-- Keep booth contact users in vendor_booth_reps so vendor-facing app logic
-- can consistently see booth meetings without a mobile rebuild.
-- Safe/additive for live conference use:
-- 1) Backfill existing contacts as reps.
-- 2) Auto-add future contacts as reps on insert/update.

-- Backfill all current booth contacts.
INSERT INTO public.vendor_booth_reps (booth_id, user_id)
SELECT vb.id, vb.contact_user_id
FROM public.vendor_booths vb
WHERE vb.contact_user_id IS NOT NULL
ON CONFLICT (booth_id, user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_vendor_booth_contact_rep()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ensure new/updated booth contact is always a booth rep.
  IF NEW.contact_user_id IS NOT NULL THEN
    INSERT INTO public.vendor_booth_reps (booth_id, user_id)
    VALUES (NEW.id, NEW.contact_user_id)
    ON CONFLICT (booth_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_vendor_booth_contact_rep_trigger ON public.vendor_booths;

CREATE TRIGGER sync_vendor_booth_contact_rep_trigger
AFTER INSERT OR UPDATE OF contact_user_id ON public.vendor_booths
FOR EACH ROW
EXECUTE FUNCTION public.sync_vendor_booth_contact_rep();
