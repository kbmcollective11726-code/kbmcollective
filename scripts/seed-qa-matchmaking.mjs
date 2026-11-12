/**
 * Seed matchmaking test data for KBM QA Test Summit 2026.
 * Idempotent: removes prior QA seed rows (emails matching qa.mm.*@kbm.test) then inserts fresh set.
 *
 * Usage: node scripts/seed-qa-matchmaking.mjs
 */
import { readFileSync, existsSync } from 'fs';
import pg from 'pg';

function loadEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}

loadEnv();

const EVENT_ID = '616eceb2-3f76-495b-9b79-35da9e8d26fa';
const SEED_EMAIL_LIKE = 'qa.mm.%@kbm.test';

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

function wallIso(day, hour, minute = 0) {
  // wall-clock stored as UTC (project convention)
  return new Date(Date.UTC(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
    hour,
    minute,
    0,
    0,
  )).toISOString();
}

await c.connect();
await c.query('BEGIN');

try {
  const ev = await c.query(`SELECT id, name FROM events WHERE id = $1`, [EVENT_ID]);
  if (!ev.rows[0]) throw new Error('Event not found: KBM QA Test Summit 2026');
  console.log('Seeding for', ev.rows[0].name);

  const forms = await c.query(
    `SELECT id, audience FROM event_registration_forms WHERE event_id = $1 AND is_active = true`,
    [EVENT_ID],
  );
  const attendeeForm = forms.rows.find((f) => f.audience === 'attendee');
  const vendorForm = forms.rows.find((f) => f.audience === 'vendor');
  if (!attendeeForm || !vendorForm) throw new Error('Missing attendee/vendor forms');

  // Remove prior seed submissions (cascades requests/reviews/categories links)
  const deleted = await c.query(
    `DELETE FROM event_registration_submissions
     WHERE event_id = $1 AND email ILIKE $2
     RETURNING id, email`,
    [EVENT_ID, SEED_EMAIL_LIKE],
  );
  console.log('Removed prior seed submissions:', deleted.rowCount);

  // Ensure portal / matching settings exist and are open enough for admin testing
  await c.query(
    `INSERT INTO event_matchmaking_settings (event_id, registration_open, meeting_requests_open, max_meetings_per_attendee)
     VALUES ($1, true, true, 8)
     ON CONFLICT (event_id) DO UPDATE SET
       registration_open = true,
       meeting_requests_open = true,
       updated_at = now()`,
    [EVENT_ID],
  );

  const cats = await c.query(
    `SELECT id, category_name FROM event_solution_categories
     WHERE event_id = $1 AND COALESCE(is_hidden, false) = false
     ORDER BY display_order NULLS LAST, category_name
     LIMIT 8`,
    [EVENT_ID],
  );
  if (cats.rows.length < 3) throw new Error('Need solution categories on the event');
  const [catTech, catHr, catSales, catOps] = cats.rows;

  const vendors = [
    {
      key: 'alpha',
      first: 'Grant',
      last: 'Ellison',
      company: 'Practica Learning',
      title: 'VP Partnerships',
      email: 'qa.mm.vendor.alpha@kbm.test',
      diaries: 2,
      cats: [catTech.id, catHr.id],
    },
    {
      key: 'beta',
      first: 'Kirsten',
      last: 'Nguyen',
      company: 'Medline Solutions',
      title: 'Enterprise AE',
      email: 'qa.mm.vendor.beta@kbm.test',
      diaries: 1,
      cats: [catTech.id, catSales.id],
    },
    {
      key: 'gamma',
      first: 'Marcus',
      last: 'Cole',
      company: 'Northstar Analytics',
      title: 'Founder',
      email: 'qa.mm.vendor.gamma@kbm.test',
      diaries: 1,
      cats: [catOps.id, catHr.id].filter(Boolean),
    },
  ];

  const delegates = [
    {
      key: 'avery',
      first: 'Avery',
      last: 'Chen',
      company: 'Autodesk',
      title: 'Director of L&D',
      email: 'qa.mm.delegate.avery@kbm.test',
      cats: [catTech.id, catHr.id],
    },
    {
      key: 'blair',
      first: 'Blair',
      last: 'Patel',
      company: 'Regions Bank',
      title: 'CHRO office',
      email: 'qa.mm.delegate.blair@kbm.test',
      cats: [catHr.id, catSales.id],
    },
    {
      key: 'casey',
      first: 'Casey',
      last: 'Brooks',
      company: 'Acme Manufacturing',
      title: 'VP Operations',
      email: 'qa.mm.delegate.casey@kbm.test',
      cats: [catOps.id, catTech.id].filter(Boolean),
    },
    {
      key: 'dana',
      first: 'Dana',
      last: 'Rivera',
      company: 'Northwind Retail',
      title: 'Head of Talent',
      email: 'qa.mm.delegate.dana@kbm.test',
      cats: [catHr.id],
    },
    {
      key: 'erin',
      first: 'Erin',
      last: 'Walsh',
      company: 'Summit Health',
      title: 'COO',
      email: 'qa.mm.delegate.erin@kbm.test',
      cats: [catSales.id, catOps.id].filter(Boolean),
    },
  ];

  async function insertSubmission(row, audience, formId) {
    const res = await c.query(
      `INSERT INTO event_registration_submissions (
         event_id, form_id, user_id, attendee_type,
         first_name, last_name, email, company_name, job_title,
         status, submitted_at, profile_complete, registration_status, matching_opt_in,
         concurrent_meetings_per_slot
       ) VALUES (
         $1, $2, NULL, $3,
         $4, $5, $6, $7, $8,
         'submitted', now(), true, 'approved', true,
         $9
       )
       RETURNING id`,
      [
        EVENT_ID,
        formId,
        audience,
        row.first,
        row.last,
        row.email,
        row.company,
        row.title,
        row.diaries ?? 1,
      ],
    );
    const id = res.rows[0].id;
    for (const catId of row.cats) {
      if (!catId) continue;
      await c.query(
        `INSERT INTO event_registration_solution_categories (submission_id, category_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, catId],
      );
    }
    return id;
  }

  const vendorIds = {};
  for (const v of vendors) {
    vendorIds[v.key] = await insertSubmission(v, 'vendor', vendorForm.id);
    console.log('Vendor', v.company, vendorIds[v.key]);
  }

  const delegateIds = {};
  for (const d of delegates) {
    delegateIds[d.key] = await insertSubmission(d, 'attendee', attendeeForm.id);
    console.log('Delegate', d.first, delegateIds[d.key]);
  }

  // Also approve / opt-in existing Steph + Omar so they stay usable in tests
  await c.query(
    `UPDATE event_registration_submissions
     SET registration_status = 'approved', profile_complete = true, matching_opt_in = true, updated_at = now()
     WHERE event_id = $1 AND id IN (
       'c98a02e2-619d-4716-b303-e8c89ab6904e',
       '8256f594-ac21-4ace-872f-f4eb0539a4cd'
     )`,
    [EVENT_ID],
  );

  const omarId = 'c98a02e2-619d-4716-b303-e8c89ab6904e';
  const stephId = '8256f594-ac21-4ace-872f-f4eb0539a4cd';

  async function upsertRequest({
    fromId,
    toId,
    toCompany,
    toPerson,
    interest,
    priority,
    response = 'pending',
  }) {
    // Remove prior pair either direction for clean seed between these two if from seed
    await c.query(
      `DELETE FROM event_meeting_interest_requests
       WHERE event_id = $1 AND submission_id = $2 AND target_submission_id = $3`,
      [EVENT_ID, fromId, toId],
    );
    await c.query(
      `INSERT INTO event_meeting_interest_requests (
         event_id, submission_id, target_submission_id, target_company_name, target_person_name,
         reason, interest_level, priority, response_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        EVENT_ID,
        fromId,
        toId,
        toCompany,
        toPerson,
        'QA seed meeting request',
        interest,
        priority,
        response,
      ],
    );
  }

  // Mutual High — Practica ↔ Avery
  await upsertRequest({
    fromId: vendorIds.alpha,
    toId: delegateIds.avery,
    toCompany: 'Autodesk',
    toPerson: 'Avery Chen',
    interest: 'high',
    priority: 0,
  });
  await upsertRequest({
    fromId: delegateIds.avery,
    toId: vendorIds.alpha,
    toCompany: 'Practica Learning',
    toPerson: 'Grant Ellison',
    interest: 'high',
    priority: 0,
  });

  // Mutual High — Medline ↔ Blair
  await upsertRequest({
    fromId: vendorIds.beta,
    toId: delegateIds.blair,
    toCompany: 'Regions Bank',
    toPerson: 'Blair Patel',
    interest: 'high',
    priority: 0,
  });
  await upsertRequest({
    fromId: delegateIds.blair,
    toId: vendorIds.beta,
    toCompany: 'Medline Solutions',
    toPerson: 'Kirsten Nguyen',
    interest: 'high',
    priority: 0,
  });

  // Both asked, not Mutual (vendor medium / delegate high) — Practica ↔ Casey
  await upsertRequest({
    fromId: vendorIds.alpha,
    toId: delegateIds.casey,
    toCompany: 'Acme Manufacturing',
    toPerson: 'Casey Brooks',
    interest: 'medium',
    priority: 1,
  });
  await upsertRequest({
    fromId: delegateIds.casey,
    toId: vendorIds.alpha,
    toCompany: 'Practica Learning',
    toPerson: 'Grant Ellison',
    interest: 'high',
    priority: 1,
  });

  // Vendor Low · Delegate High — Omar ↔ Steph (refresh)
  await upsertRequest({
    fromId: omarId,
    toId: stephId,
    toCompany: 'KBM Collective',
    toPerson: 'Steph Ketron',
    interest: 'low',
    priority: 0,
  });
  await upsertRequest({
    fromId: stephId,
    toId: omarId,
    toCompany: 'KBM Collective',
    toPerson: 'Omar Braham',
    interest: 'high',
    priority: 0,
  });

  // One-way vendor pick — Medline → Dana high
  await upsertRequest({
    fromId: vendorIds.beta,
    toId: delegateIds.dana,
    toCompany: 'Northwind Retail',
    toPerson: 'Dana Rivera',
    interest: 'high',
    priority: 1,
  });

  // One-way delegate pick — Erin → Northstar high; Northstar → Erin medium
  await upsertRequest({
    fromId: delegateIds.erin,
    toId: vendorIds.gamma,
    toCompany: 'Northstar Analytics',
    toPerson: 'Marcus Cole',
    interest: 'high',
    priority: 0,
  });
  await upsertRequest({
    fromId: vendorIds.gamma,
    toId: delegateIds.erin,
    toCompany: 'Summit Health',
    toPerson: 'Erin Walsh',
    interest: 'medium',
    priority: 0,
  });

  // Extra vendor picks for ranking tests — Practica also wants Blair/Dana
  await upsertRequest({
    fromId: vendorIds.alpha,
    toId: delegateIds.blair,
    toCompany: 'Regions Bank',
    toPerson: 'Blair Patel',
    interest: 'high',
    priority: 2,
  });
  await upsertRequest({
    fromId: vendorIds.alpha,
    toId: delegateIds.dana,
    toCompany: 'Northwind Retail',
    toPerson: 'Dana Rivera',
    interest: 'low',
    priority: 3,
  });

  // Ensure a couple locations + sample day slots for Jul 3–4 2026 (event dates)
  const loc = await c.query(
    `INSERT INTO event_matchmaking_locations (event_id, name, capacity, sort_order, is_active)
     VALUES ($1, 'QA Table 1', 2, 0, true),
            ($1, 'QA Table 2', 1, 1, true)
     ON CONFLICT (event_id, name) DO UPDATE SET is_active = true, capacity = EXCLUDED.capacity
     RETURNING id, name`,
    [EVENT_ID],
  );
  console.log('Locations', loc.rows);

  // Clear prior QA-labeled slots then add a day of 30-min slots
  await c.query(
    `DELETE FROM event_matchmaking_time_slots
     WHERE event_id = $1 AND label ILIKE 'QA seed%'`,
    [EVENT_ID],
  );

  const slotRows = [];
  let sort = 100;
  for (const day of ['2026-07-03', '2026-07-04']) {
    for (let minutes = 9 * 60; minutes + 30 <= 12 * 60; minutes += 30) {
      const sh = Math.floor(minutes / 60);
      const sm = minutes % 60;
      const eh = Math.floor((minutes + 30) / 60);
      const em = (minutes + 30) % 60;
      slotRows.push([
        EVENT_ID,
        wallIso(day, sh, sm),
        wallIso(day, eh, em),
        `QA seed ${day}`,
        sort++,
      ]);
    }
  }
  for (const row of slotRows) {
    await c.query(
      `INSERT INTO event_matchmaking_time_slots (event_id, start_time, end_time, label, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (event_id, start_time, end_time) DO UPDATE SET is_active = true, label = EXCLUDED.label`,
      row,
    );
  }
  console.log('Time slots upserted:', slotRows.length);

  await c.query('COMMIT');
  console.log(`
Done. Open cadmin → KBM QA Test Summit 2026 → Matchmaking:
  • Matching & approve → vendor "Practica Learning · Grant Ellison"
      – Avery should show Mutual (both High)
      – Casey Both-asked / not Mutual (medium/high)
  • Vendor "Medline Solutions · Kirsten Nguyen" → Blair Mutual High
  • Slots & locations has QA tables + Jul 3–4 morning slots
  • Seed emails use qa.mm.*@kbm.test (safe to re-run this script)
`);
} catch (e) {
  await c.query('ROLLBACK');
  console.error(e);
  process.exitCode = 1;
} finally {
  await c.end();
}
