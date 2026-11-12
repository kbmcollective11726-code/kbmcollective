ALTER TABLE public.event_solution_categories
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.event_solution_categories.is_hidden IS
  'When true, category is hidden from registrant multi-selects but kept for admin management.';
COMMENT ON COLUMN public.event_solution_categories.is_default IS
  'Seeded platform default category; event admins may hide/reorder but only platform admins may delete.';

UPDATE public.event_solution_categories
SET is_default = true
WHERE category_name IN (
  'Technologies',
  'Learning & Development',
  'Culture & Engagement',
  'Talent Acquisition',
  'HR Software',
  'Coaching',
  'Consulting',
  'Compensation & Benefits',
  'Organizational Culture',
  'Workforce & Leadership',
  'Executive Leadership',
  'Corporate Wellness'
);
