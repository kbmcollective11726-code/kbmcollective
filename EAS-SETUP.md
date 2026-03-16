# EAS Build – Supabase config for TestFlight / production

The app reads `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` at **build time**.  
Your `.env` file is not used by EAS Build (it’s gitignored), so production builds need these values set as **EAS environment variables**. Your local `.env` is correct; EAS Build runs in the cloud and doesn't have access to it.

## One-time setup

From your project root, run (use the same values as in your local `.env`):

```bash
eas env:create production --name EXPO_PUBLIC_SUPABASE_URL --value "https://YOUR_PROJECT_REF.supabase.co" --type string --visibility plaintext --non-interactive
eas env:create production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "YOUR_ANON_KEY" --type string --visibility sensitive --non-interactive
```

Get the URL and anon key from: **Supabase Dashboard → Your project → Settings → API**.

## After adding env vars

Rebuild and submit to TestFlight:

```bash
eas build --platform ios --profile production --auto-submit
```

The new build will include your Supabase config and sign-in will work.
