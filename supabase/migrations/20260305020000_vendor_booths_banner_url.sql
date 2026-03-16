-- Add optional banner image URL for vendor booths (uploaded to R2 / storage).
ALTER TABLE public.vendor_booths
  ADD COLUMN IF NOT EXISTS banner_url TEXT;
