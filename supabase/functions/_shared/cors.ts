/** Shared CORS allowlist for browser-facing Edge Functions. */
const ALLOWED_ORIGINS = new Set([
  "https://cadmin.kbmcollective.org",
  "https://connect.kbmcollective.org",
  "https://wall.kbmcollective.org",
  "https://live-wall-six.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
]);

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // Preview deploys
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:") return false;
    if (u.hostname.endsWith(".vercel.app")) {
      return (
        u.hostname.includes("admin-setup") ||
        u.hostname.includes("live-wall") ||
        u.hostname.includes("cadmin")
      );
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * CORS headers for an incoming request.
 * - Browser with allowlisted Origin → reflect that origin
 * - Native / no Origin (Expo, cron) → omit Allow-Origin (CORS N/A)
 * - Browser with bad Origin → omit Allow-Origin (browser blocks)
 */
export function corsHeaders(
  req: Request,
  extraAllowHeaders = "Authorization, Content-Type, apikey",
): Record<string, string> {
  const origin = req.headers.get("Origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": extraAllowHeaders,
  };
  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return headers;
}

export function corsPreflightResponse(
  req: Request,
  extraAllowHeaders?: string,
): Response {
  const origin = req.headers.get("Origin");
  if (origin && !isAllowedOrigin(origin)) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req, extraAllowHeaders),
  });
}
