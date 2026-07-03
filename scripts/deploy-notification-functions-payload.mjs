/** Writes deploy payloads for notification-pause edge functions (for MCP deploy). */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, ".deploy-payloads");
fs.mkdirSync(outDir, { recursive: true });

const functions = [
  { name: "send-announcement-push", verify_jwt: true },
  { name: "process-scheduled-announcements", verify_jwt: false },
  { name: "notify-event-starting-soon", verify_jwt: false },
  { name: "notify-b2b-meeting-soon", verify_jwt: false },
  { name: "nudge-b2b-meeting-feedback", verify_jwt: false },
];

for (const { name, verify_jwt } of functions) {
  const content = fs.readFileSync(
    path.join(root, "supabase", "functions", name, "index.ts"),
    "utf8",
  );
  const payload = {
    name,
    entrypoint_path: "index.ts",
    verify_jwt,
    files: [{ name: "index.ts", content }],
  };
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(payload));
  console.log(name, content.length, "bytes");
}
