-- Add contact_phone to events for "request to create event" signup flow (KBM reaches out for payment/setup)
ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS contact_phone TEXT;

COMMENT ON COLUMN public.events.contact_phone IS 'Phone number provided when user requested to create this event; used by KBM to reach out for payment/setup.';
