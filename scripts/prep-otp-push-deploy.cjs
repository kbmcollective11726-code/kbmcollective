const fs = require('fs');
const outDir = 'C:/Users/viper/.cursor/projects/c-Users-viper-OneDrive-Desktop-CollectiveLiveg/agent-tools';
fs.mkdirSync(outDir, { recursive: true });

function fixCorsImport(src) {
  return src.replace(/from\s+["']\.\.\/_shared\/cors\.ts["']/g, 'from "./_shared/cors.ts"');
}

const cors = fs.readFileSync('supabase/functions/_shared/cors.ts', 'utf8');

for (const name of ['platform-admin-email-otp', 'send-announcement-push']) {
  const index = fixCorsImport(
    fs.readFileSync(`supabase/functions/${name}/index.ts`, 'utf8'),
  );
  fs.writeFileSync(
    `${outDir}/edge-deploy-${name}.json`,
    JSON.stringify({
      name,
      entrypoint_path: 'index.ts',
      verify_jwt: true,
      files: [
        { name: 'index.ts', content: index },
        { name: '_shared/cors.ts', content: cors },
      ],
    }),
  );
  console.log('prepared', name);
}
