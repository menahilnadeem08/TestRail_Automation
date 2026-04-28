'use strict';

const axios = require('axios');

const UNTESTED_STATUS_ID = 3;

const STATUS_MAP = {
  pass: 1,
  passed: 1,
  fail: 5,
  failed: 5,
  blocked: 2,
  retest: 4,
  untested: 3,
};

function isPlaceholder(value) {
  if (!value) return true;
  const v = String(value).trim().toLowerCase();
  return v === '' || v === 'you@example.com' || v.startsWith('https://yourcompany');
}

function requireEnv(name, value) {
  if (isPlaceholder(value)) {
    throw new Error(`Missing or placeholder env var: ${name}. Please set it in .env`);
  }
}

function normalizeTitle(title) {
  return String(title || '')
    .replace(/\s*\[\s*\d+\s*\]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*-\s*/g, '-')
    .trim()
    .toLowerCase();
}

function alphanumKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function makeClient(env) {
  requireEnv('TESTRAIL_BASE_URL', env.TESTRAIL_BASE_URL);
  requireEnv('TESTRAIL_USER', env.TESTRAIL_USER);
  requireEnv('TESTRAIL_API_KEY', env.TESTRAIL_API_KEY);

  const baseURL = `${env.TESTRAIL_BASE_URL.replace(/\/+$/, '')}/index.php?`;
  const client = axios.create({
    baseURL,
    auth: { username: env.TESTRAIL_USER, password: env.TESTRAIL_API_KEY },
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  return {
    get: async (endpoint) => (await client.get(`/api/v2/${endpoint}`)).data,
    post: async (endpoint, data) => (await client.post(`/api/v2/${endpoint}`, data)).data,
  };
}

async function fetchTestsInRun(api, runId) {
  let tests = [];
  let offset = 0;
  const limit = 250;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const data = await api.get(`get_tests/${runId}&limit=${limit}&offset=${offset}`);
    const batch = Array.isArray(data) ? data : data.tests || [];
    tests = tests.concat(batch);
    if (batch.length < limit) break;
    offset += limit;
    if (data && data._links && !data._links.next) break;
  }
  return tests;
}

async function getRunsForPlan(api, planId) {
  const plan = await api.get(`get_plan/${planId}`);
  const runs = [];
  for (const entry of plan.entries || []) {
    for (const r of entry.runs || []) {
      runs.push({
        id: r.id,
        name: r.name,
        entry_name: entry.name,
        config: r.config || '',
      });
    }
  }
  return { plan, runs };
}

function pickRunForSection(runs, section) {
  if (!section) return null;
  const sNorm = normalizeTitle(section);
  const sKey = alphanumKey(section);

  let best = null;
  let bestScore = 0;

  for (const r of runs) {
    const candidates = [r.name, r.entry_name, r.config].filter(Boolean);
    for (const c of candidates) {
      const cNorm = normalizeTitle(c);
      const cKey = alphanumKey(c);
      let score = 0;
      if (cNorm === sNorm || cKey === sKey) score = 1000;
      else if (sNorm.startsWith(cNorm) || cNorm.startsWith(sNorm)) score = 500 + cNorm.length;
      else if (sKey.startsWith(cKey) || cKey.startsWith(sKey)) score = 400 + cKey.length;
      else if (sNorm.includes(cNorm) || cNorm.includes(sNorm)) score = 200 + cNorm.length;
      else if (sKey.includes(cKey) || cKey.includes(sKey)) score = 100 + cKey.length;

      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
  }
  return best;
}

async function sendResultsForRun(api, runId, rowsForRun, dryRun, skipIfResulted) {
  console.log(`\nFetching tests for run ${runId}...`);
  const tests = await fetchTestsInRun(api, runId);
  console.log(`  Found ${tests.length} tests in run ${runId}.`);

  const byTitle = new Map();
  for (const t of tests) {
    const k = normalizeTitle(t.title);
    if (!byTitle.has(k)) byTitle.set(k, t);
  }

  const payload = [];
  const unmatched = [];
  const skipped = [];
  for (const r of rowsForRun) {
    const test = byTitle.get(normalizeTitle(r.title));
    if (!test) {
      unmatched.push(r.title);
      continue;
    }
    if (skipIfResulted && test.status_id && test.status_id !== UNTESTED_STATUS_ID) {
      skipped.push({ title: r.title, currentStatusId: test.status_id });
      continue;
    }
    payload.push({
      case_id: test.case_id,
      status_id: r.status_id,
      comment: r.comment,
    });
  }

  if (unmatched.length) {
    console.warn(`  WARN: ${unmatched.length} title(s) not found in run ${runId}:`);
    unmatched.forEach((t) => console.warn(`    - ${t}`));
  }
  if (skipped.length) {
    console.log(`  SKIP_IF_RESULTED=true → skipping ${skipped.length} test(s) that already have a result:`);
    skipped.forEach((s) => console.log(`    - ${s.title} (current status_id=${s.currentStatusId})`));
  }
  if (!payload.length) {
    console.log(`  Nothing to send for run ${runId}.`);
    return { runId, sent: 0, testsFound: tests.length, unmatched, skipped, dryRun: !!dryRun };
  }

  console.log(`  Prepared ${payload.length} result(s) for run ${runId}.`);
  if (dryRun) {
    console.log('  [DRY_RUN] Payload:', JSON.stringify(payload, null, 2));
    return { runId, sent: 0, testsFound: tests.length, unmatched, skipped, dryRun: true };
  }

  const resp = await api.post(`add_results_for_cases/${runId}`, { results: payload });
  const count = Array.isArray(resp) ? resp.length : 0;
  console.log(`  ✓ TestRail accepted ${count} result(s) for run ${runId}.`);
  return { runId, sent: count, testsFound: tests.length, unmatched, skipped, dryRun: false };
}

async function runWithParsedRows(parsed, env) {
  if (!parsed.length) {
    console.log('Nothing to send. Exiting.');
    return { dryRun: false, summary: [], sectionless: [] };
  }

  const dryRun = String(env.DRY_RUN || 'true').toLowerCase() === 'true';
  const skipIfResulted = String(env.SKIP_IF_RESULTED || 'true').toLowerCase() === 'true';
  console.log(`Flags: DRY_RUN=${dryRun}  SKIP_IF_RESULTED=${skipIfResulted}`);

  const api = makeClient(env);

  if (env.TESTRAIL_RUN_ID && String(env.TESTRAIL_RUN_ID).trim() !== '') {
    console.log(`\nUsing TESTRAIL_RUN_ID=${env.TESTRAIL_RUN_ID} (single-run mode).`);
    const res = await sendResultsForRun(api, env.TESTRAIL_RUN_ID, parsed, dryRun, skipIfResulted);
    return { dryRun, summary: [{ section: null, ...res }], sectionless: [] };
  }

  requireEnv('TESTRAIL_PLAN_ID', env.TESTRAIL_PLAN_ID);
  console.log(`\nFetching plan ${env.TESTRAIL_PLAN_ID}...`);
  const { plan, runs } = await getRunsForPlan(api, env.TESTRAIL_PLAN_ID);
  console.log(`Plan: "${plan.name}" — ${runs.length} run(s):`);
  runs.forEach((r) => console.log(`  • run_id=${r.id}  name="${r.name}"  entry="${r.entry_name}"  config="${r.config}"`));

  const groups = new Map();
  const sectionless = [];
  for (const r of parsed) {
    if (!r.section) { sectionless.push(r); continue; }
    if (!groups.has(r.section)) groups.set(r.section, []);
    groups.get(r.section).push(r);
  }

  if (sectionless.length) {
    console.warn(`\n${sectionless.length} row(s) had no section header and will be skipped:`);
    sectionless.forEach((r) => console.warn(`  - ${r.title} [${r.status}]`));
  }

  const summary = [];
  for (const [section, rows] of groups.entries()) {
    const run = pickRunForSection(runs, section);
    if (!run) {
      console.warn(`\nNo run in plan ${env.TESTRAIL_PLAN_ID} matches section "${section}". Skipping ${rows.length} row(s).`);
      summary.push({
        section,
        runId: null,
        runName: null,
        sent: 0,
        testsFound: 0,
        unmatched: [],
        skipped: [],
        noMatchingRun: true,
        rowCount: rows.length,
        dryRun,
      });
      continue;
    }
    console.log(`\nSection "${section}" → run_id=${run.id} ("${run.name}")`);
    const res = await sendResultsForRun(api, run.id, rows, dryRun, skipIfResulted);
    summary.push({ section, runId: run.id, runName: run.name, rowCount: rows.length, ...res });
  }

  console.log('\n=== Summary ===');
  for (const s of summary) {
    const compact = {
      section: s.section,
      runId: s.runId,
      sent: s.sent,
      unmatched: s.unmatched,
      skipped: Array.isArray(s.skipped) ? s.skipped.length : s.skipped,
    };
    console.log(JSON.stringify(compact));
  }
  if (dryRun) console.log('\nDRY_RUN=true → no results were actually posted. Set DRY_RUN=false in .env to send.');

  return {
    dryRun,
    planId: env.TESTRAIL_PLAN_ID,
    planName: plan && plan.name ? plan.name : null,
    summary,
    sectionless: sectionless.map((r) => ({ title: r.title, status: r.status })),
  };
}

module.exports = {
  STATUS_MAP,
  UNTESTED_STATUS_ID,
  normalizeTitle,
  alphanumKey,
  isPlaceholder,
  requireEnv,
  makeClient,
  fetchTestsInRun,
  getRunsForPlan,
  pickRunForSection,
  sendResultsForRun,
  runWithParsedRows,
};
