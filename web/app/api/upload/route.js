import { NextResponse } from 'next/server';

import { loadParentEnv } from '../../../lib/env.js';
import { getSession } from '../../../lib/sessions.js';
import { readPlan } from '../../../lib/planStore.js';
import {
  setFrameworkStatus,
  classifySubmission,
} from '../../../lib/statusStore.js';
import { friendlyError } from '../../../lib/errors.js';

import { runWithParsedRows } from '../../../../testrail.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  loadParentEnv();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sessionId, framework, dryRun } = body || {};
  if (!sessionId || !framework) {
    return NextResponse.json(
      { error: 'sessionId and framework are required' },
      { status: 400 }
    );
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json(
      { error: 'Session expired or not found. Please re-upload the document.' },
      { status: 404 }
    );
  }

  const filtered = session.parsed.filter((r) => (r.section || '') === framework);
  if (!filtered.length) {
    return NextResponse.json(
      { error: `No rows found for framework "${framework}"` },
      { status: 400 }
    );
  }

  const storedPlan = readPlan();
  if (!storedPlan?.planId) {
    return NextResponse.json(
      {
        error:
          'No TestRail Plan ID is set. Please set one in the UI (Step 0) before uploading.',
      },
      { status: 400 }
    );
  }
  const planId = storedPlan.planId;

  const env = {
    ...process.env,
    DRY_RUN:
      typeof dryRun === 'boolean' ? String(dryRun) : process.env.DRY_RUN,
    TESTRAIL_PLAN_ID: planId,
    TESTRAIL_RUN_ID: '',
  };

  const logs = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const capture = (level) => (...args) => {
    const line = args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2)))
      .join(' ');
    logs.push({ level, line });
    origLog(`[${level}]`, line);
  };
  console.log = capture('log');
  console.warn = capture('warn');
  console.error = capture('error');

  try {
    const result = await runWithParsedRows(filtered, env);
    const isDryRun = String(env.DRY_RUN || 'true').toLowerCase() === 'true';

    if (!isDryRun && result?.summary?.length) {
      const entry = result.summary[0];
      const state = classifySubmission(entry);
      setFrameworkStatus(planId, framework, {
        state,
        sent: entry.sent || 0,
        skipped: Array.isArray(entry.skipped) ? entry.skipped.length : 0,
        unmatched: Array.isArray(entry.unmatched) ? entry.unmatched.length : 0,
        total: entry.rowCount || 0,
        runId: entry.runId || null,
        runName: entry.runName || null,
        noMatchingRun: !!entry.noMatchingRun,
      });
    }

    return NextResponse.json({
      ok: true,
      framework,
      sentCount: filtered.length,
      dryRun: isDryRun,
      result,
      logs,
    });
  } catch (err) {
    const msg = friendlyError(err, { planId });
    return NextResponse.json({ error: msg, logs }, { status: 500 });
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
}
