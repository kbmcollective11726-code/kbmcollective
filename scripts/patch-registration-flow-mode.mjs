import fs from 'node:fs';

const path = 'admin-setup/src/pages/EventMatchmaking.tsx';
let s = fs.readFileSync(path, 'utf8');
let changes = [];

if (!s.includes('registrationFlowMode')) {
  const stateRe = /(const \[vendorStage2Active, setVendorStage2Active\] = useState\(false\);)/;
  if (!stateRe.test(s)) throw new Error('state anchor missing');
  s = s.replace(
    stateRe,
    `$1\n  const [registrationFlowMode, setRegistrationFlowMode] = useState<'one_step' | 'two_step'>('two_step');`,
  );
  changes.push('state');
}

if (!s.includes('stage2_expected_open_at, registration_flow_mode')) {
  const before = s;
  s = s.replace(
    /stage2_expected_open_at(?!, registration_flow_mode)/,
    'stage2_expected_open_at, registration_flow_mode',
  );
  if (s === before) throw new Error('select replace failed');
  changes.push('select');
}

if (!s.includes('setRegistrationFlowMode(')) {
  const loadRe = /(setVendorStage2Active\(Boolean\(settings\?\.vendor_stage2_active\)\);)/;
  if (!loadRe.test(s)) throw new Error('load anchor missing');
  s = s.replace(
    loadRe,
    `$1\n      setRegistrationFlowMode(\n        (settings as { registration_flow_mode?: string } | null)?.registration_flow_mode === 'one_step'\n          ? 'one_step'\n          : 'two_step',\n      );`,
  );
  changes.push('load');
}

if (!s.includes('registration_flow_mode: registrationFlowMode')) {
  const upsertRe = /(vendor_stage2_active: vendorStage2Active,)/;
  if (!upsertRe.test(s)) throw new Error('upsert anchor missing');
  s = s.replace(upsertRe, `$1\n        registration_flow_mode: registrationFlowMode,`);
  changes.push('upsert');
}

if (!s.includes('name="registrationFlowMode"')) {
  const markers = [
    "Registration links show as closed.",
    'Registration links show as closed.',
    'Registration links show as closed',
    'New sign-ups are allowed.',
  ];
  let idx = -1;
  for (const m of markers) {
    idx = s.indexOf(m);
    if (idx >= 0) break;
  }
  if (idx < 0) throw new Error('UI marker missing');
  const after = s.slice(idx);
  const labelEndRel = after.indexOf('</label>');
  if (labelEndRel < 0) throw new Error('label end missing');
  const insertAt = idx + labelEndRel + '</label>'.length;
  const ui = `
        <div className={styles.formStack} style={{ marginTop: 16 }}>
          <p className={styles.fieldHelp} style={{ marginBottom: 8 }}>
            Registration flow — click Save Stage 2 settings below to persist.
          </p>
          <label className={styles.toggleCard}>
            <input
              type="radio"
              name="registrationFlowMode"
              checked={registrationFlowMode === 'two_step'}
              onChange={() => setRegistrationFlowMode('two_step')}
            />
            <span>
              <strong>Two-step</strong>
              <span className={styles.toggleCardHint}>
                Account + short form now; full profile later in the portal when Stage 2 is active.
              </span>
            </span>
          </label>
          <label className={styles.toggleCard}>
            <input
              type="radio"
              name="registrationFlowMode"
              checked={registrationFlowMode === 'one_step'}
              onChange={() => setRegistrationFlowMode('one_step')}
            />
            <span>
              <strong>One-step</strong>
              <span className={styles.toggleCardHint}>
                Account + full registration form on the public link (no holding screen for profile).
              </span>
            </span>
          </label>
        </div>`;
  s = s.slice(0, insertAt) + ui + s.slice(insertAt);
  changes.push('ui');
}

fs.writeFileSync(path, s);
console.log('OK changes:', changes.join(', '));
