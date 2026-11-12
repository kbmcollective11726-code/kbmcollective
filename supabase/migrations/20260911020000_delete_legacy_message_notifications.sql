-- Chat content lives in Chat hub + device push. Remove legacy in-app message rows
-- so notification bells / unread do not count ghost chat alerts.
DELETE FROM public.notifications
WHERE type = 'message';
