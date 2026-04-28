import { NextResponse } from 'next/server';
import { readPlan } from '../../../lib/planStore.js';
import { getStatusesForPlan, clearStatusesForPlan } from '../../../lib/statusStore.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const plan = readPlan();
  if (!plan?.planId) {
    return NextResponse.json({ planId: null, statuses: {} });
  }
  const statuses = getStatusesForPlan(plan.planId);
  return NextResponse.json({ planId: plan.planId, statuses });
}

export async function DELETE() {
  const plan = readPlan();
  if (plan?.planId) clearStatusesForPlan(plan.planId);
  return NextResponse.json({ ok: true });
}
