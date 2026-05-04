-- Run in Supabase Dashboard → SQL Editor.
-- Expect 3 rows with non-zero lengths. If missing, see REMINDERS-5MIN-DEPLOY.md (vault.create_secret).
-- Does not print secret values (only lengths).

SELECT name, length(COALESCE(decrypted_secret::text, '')) AS secret_char_length
FROM vault.decrypted_secrets
WHERE name IN ('project_url', 'anon_key', 'cron_secret')
ORDER BY name;
