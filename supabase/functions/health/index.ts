// Public health check for the uptime monitor: 200 when the database answers, 503 otherwise.
// No auth and no data returned, so it can be polled without storing any key in the monitor.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const DB_TIMEOUT_MS = 5000;

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return respond(503, "config");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  try {
    const query = admin.from("events").select("id", { count: "exact", head: true }).limit(1);
    const timeout = new Promise<{ error: Error }>((resolve) =>
      setTimeout(() => resolve({ error: new Error("timeout") }), DB_TIMEOUT_MS)
    );
    const { error } = await Promise.race([query, timeout]);
    if (error) return respond(503, "database");
    return respond(200, "ok");
  } catch {
    return respond(503, "database");
  }
});

function respond(status: number, state: string) {
  return new Response(JSON.stringify({ status: state }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
