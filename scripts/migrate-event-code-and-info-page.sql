-- Run this in Supabase SQL Editor if you already ran supabase-schema.sql before
-- (adds event_code, info page fields, and backfills event codes)

-- Add new columns to events
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS event_code TEXT UNIQUE;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS welcome_title TEXT;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS welcome_subtitle TEXT;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS hero_stat_1 TEXT;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS hero_stat_2 TEXT;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS hero_stat_3 TEXT;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS arrival_day_text TEXT;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS summit_days_text TEXT;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS theme_text TEXT;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS what_to_expect JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS points_section_intro TEXT;

-- Backfill event_code for existing events (6-char alphanumeric)
CREATE OR REPLACE FUNCTION public.generate_event_code_for_backfill()
RETURNS TRIGGER AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INT;
BEGIN
  IF NEW.event_code IS NULL OR NEW.event_code = '' THEN
    FOR attempt IN 1..30 LOOP
      result := '';
      FOR i IN 1..6 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
      END LOOP;
      IF NOT EXISTS (SELECT 1 FROM public.events WHERE event_code = result AND id != NEW.id) THEN
        NEW.event_code := result;
        RETURN NEW;
      END IF;
    END LOOP;
    NEW.event_code := result || substr(md5(gen_random_uuid()::text), 1, 2);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- One-time backfill: set event_code for rows that don't have it (use id-based unique suffix to avoid collisions)
UPDATE public.events
SET event_code = upper(substr(replace(md5(id::text || coalesce(event_code, '')), '-', ''), 1, 6))
WHERE event_code IS NULL OR event_code = '';

-- Ensure uniqueness: if any duplicates, append 2-char suffix from id
WITH dups AS (
  SELECT id, event_code, row_number() OVER (PARTITION BY event_code ORDER BY created_at) AS rn
  FROM public.events
)
UPDATE public.events e
SET event_code = e.event_code || upper(substr(md5(e.id::text), 1, 2))
FROM dups
WHERE e.id = dups.id AND dups.rn > 1;

-- Add unique constraint if not exists (migration may have added column without constraint)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_event_code_key') THEN
    ALTER TABLE public.events ADD CONSTRAINT events_event_code_key UNIQUE (event_code);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Trigger for new inserts (same as in main schema)
CREATE OR REPLACE FUNCTION public.generate_event_code()
RETURNS TRIGGER AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INT;
  attempt INT := 0;
BEGIN
  IF NEW.event_code IS NULL OR NEW.event_code = '' THEN
    LOOP
      result := '';
      FOR i IN 1..6 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
      END LOOP;
      IF NOT EXISTS (SELECT 1 FROM public.events WHERE event_code = result) THEN
        NEW.event_code := result;
        EXIT;
      END IF;
      attempt := attempt + 1;
      IF attempt > 20 THEN
        NEW.event_code := result || substr(md5(gen_random_uuid()::text), 1, 2);
        EXIT;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_event_code_on_insert ON public.events;
CREATE TRIGGER set_event_code_on_insert
    BEFORE INSERT ON public.events
    FOR EACH ROW
    EXECUTE FUNCTION public.generate_event_code();
