-- Seed standard solution categories for KBM QA Test Summit 2026.
INSERT INTO public.event_solution_categories (event_id, category_name, display_order)
VALUES
  ('616eceb2-3f76-495b-9b79-35da9e8d26fa', 'Technologies', 0),
  ('616eceb2-3f76-495b-9b79-35da9e8d26fa', 'Learning & Development', 1),
  ('616eceb2-3f76-495b-9b79-35da9e8d26fa', 'Culture & Engagement', 2),
  ('616eceb2-3f76-495b-9b79-35da9e8d26fa', 'Talent Acquisition', 3),
  ('616eceb2-3f76-495b-9b79-35da9e8d26fa', 'HR Software', 4),
  ('616eceb2-3f76-495b-9b79-35da9e8d26fa', 'Coaching', 5),
  ('616eceb2-3f76-495b-9b79-35da9e8d26fa', 'Consulting', 6),
  ('616eceb2-3f76-495b-9b79-35da9e8d26fa', 'Compensation & Benefits', 7),
  ('616eceb2-3f76-495b-9b79-35da9e8d26fa', 'Organizational Culture', 8),
  ('616eceb2-3f76-495b-9b79-35da9e8d26fa', 'Workforce & Leadership', 9),
  ('616eceb2-3f76-495b-9b79-35da9e8d26fa', 'Executive Leadership', 10),
  ('616eceb2-3f76-495b-9b79-35da9e8d26fa', 'Corporate Wellness', 11)
ON CONFLICT (event_id, category_name) DO NOTHING;
