-- Clear connection request history (for testing / fixing stuck requests)
-- Run in Supabase SQL Editor. This lets both users send/accept again from a clean state.

-- Option A: Delete only PENDING requests (keeps accepted/declined history)
-- DELETE FROM public.connection_requests WHERE status = 'pending';

-- Option B: Delete ALL connection requests for a specific event (replace EVENT_ID)
-- DELETE FROM public.connection_requests WHERE event_id = 'EVENT_ID';

-- Option C: Delete ALL connection requests (full reset for testing)
DELETE FROM public.connection_requests;

-- If you also want to clear existing connections so everyone starts fresh:
-- DELETE FROM public.connections;
