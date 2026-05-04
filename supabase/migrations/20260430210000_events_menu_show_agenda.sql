-- Toggle Agenda link in app hamburger menu (per event). Bottom tab unchanged.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS menu_show_agenda BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.events.menu_show_agenda IS
  'When false, hide Agenda from the app hamburger menu and bottom Agenda tab.';
