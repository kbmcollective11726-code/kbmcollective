/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Optional. Deployed live-wall app origin (no path), e.g. https://your-wall.vercel.app */
  readonly VITE_LIVE_WALL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
