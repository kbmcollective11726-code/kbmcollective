# CollectiveLive assets

Add these image files so the app builds and runs:

- **icon.png** — 1024×1024 px (App icon)
- **splash.png** — 1284×2778 px or similar (Splash screen)
- **adaptive-icon.png** — 1024×1024 px (Android adaptive icon)

You can use the same image for icon and adaptive-icon. Generate them with [Expo's asset generator](https://www.npmjs.com/package/@expo/configure-splash-screen) or any image editor.

If you prefer to use Expo's default assets first, run:

```bash
npx create-expo-app@latest _temp --template blank-typescript
```

Then copy `_temp/assets/*` into this folder and delete `_temp`.
