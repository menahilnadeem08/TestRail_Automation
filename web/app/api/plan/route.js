import { NextResponse } from 'next/server';
import { readPlan, writePlan, clearPlan } from '../../../lib/planStore.js';

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

  const data = writePlan(trimmed, ip);
  return NextResponse.json(data);
}

export async function DELETE() {
  clearPlan();
  return NextResponse.json({ ok: true });
}
