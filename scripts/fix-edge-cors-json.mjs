import fs from "fs";
import path from "path";

function writeRetry(file, src, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try {
      fs.writeFileSync(file, src);
      return;
    } catch (e) {
      if (i === tries - 1) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400 * (i + 1));
    }
  }
}

const root = "supabase/functions";
const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("_"));
let fixed = 0;
for (const d of dirs) {
  const file = path.join(root, d.name, "index.ts");
  if (!fs.existsSync(file)) continue;
  let src = fs.readFileSync(file, "utf8");
  if (!src.includes("_shared/cors.ts")) continue;
  if (src.includes("headers: Record<string, string>")) {
    console.log("ok", d.name);
    continue;
  }
  if (!src.includes("...ch,")) {
    console.log("skip-no-ch", d.name);
    continue;
  }

  src = src.replace(
    /function json\(body: object, status: number\) \{\r?\n  return new Response\(JSON\.stringify\(body\), \{\r?\n    status,\r?\n    headers: \{ \.\.\.ch, "Content-Type": "application\/json" \},\r?\n  \}\);\r?\n\}/,
    `function json(body: object, status: number, headers: Record<string, string>) {\n  return new Response(JSON.stringify(body), {\n    status,\n    headers: { ...headers, "Content-Type": "application/json" },\n  });\n}`
  );

  src = src.replace(/return json\(([\s\S]*?), (\d+)\);/g, (full, body, status) => {
    if (full.includes(", ch)")) return full;
    return `return json(${body}, ${status}, ch);`;
  });

  writeRetry(file, src);
  fixed++;
  console.log("fixed", d.name);
}
console.log("total", fixed);
