import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const AUTH_RECOVERY_CONFIG_FILE = 'auth-recovery-config.js';

/**
 * public/auth-recovery.html is a static page (not bundled), so it can't read import.meta.env.
 * Emit its Supabase URL + publishable key from the build env so the repo never holds them.
 */
function authRecoveryConfig(env: Record<string, string>): Plugin {
  const source = () => {
    const config = {
      url: (env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, ''),
      anonKey: (env.VITE_SUPABASE_ANON_KEY ?? '').trim(),
    };
    return `window.__KBM_AUTH_CONFIG__ = ${JSON.stringify(config)};\n`;
  };
  return {
    name: 'auth-recovery-config',
    configureServer(server) {
      server.middlewares.use(`/${AUTH_RECOVERY_CONFIG_FILE}`, (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(source());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: AUTH_RECOVERY_CONFIG_FILE, source: source() });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), authRecoveryConfig(env)],
    server: { port: 5174 },
  };
});
