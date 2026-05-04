import { NextResponse } from 'next/server';
import { readPlan, writePlan, clearPlan } from '../../../lib/planStore.js';
import { loadParentEnv } from '../../../lib/env.js';
import { makeClient } from '../../../../testrail.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const plan = readPlan();
  return NextResponse.json(plan || { planId: null });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { planId } = body || {};
  const trimmed = String(planId || '').trim();
  if (!trimmed) {
    return NextResponse.json({ error: 'planId is required' }, { status: 400 });
  }
  if (!/^\d+$/.test(trimmed)) {
    return NextResponse.json(
      { error: 'planId must be a number (e.g. 255)' },
      { status: 400 }
    );
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    null;

  loadParentEnv();
  let planName = null;
  try {
    const api = makeClient(process.env);
    const plan = await api.get(`get_plan/${trimmed}`);
    planName = plan.name;
  } catch (err) {
    console.error('Failed to fetch plan name from TestRail:', err.message);
  }

  const data = writePlan(trimmed, planName, ip);
  return NextResponse.json(data);
}

export async function DELETE() {
  clearPlan();
  return NextResponse.json({ ok: true });
}
