import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), '.data');
const FILE = path.join(DATA_DIR, 'plan.json');
const TTL_MS = 24 * 60 * 60 * 1000;

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function readPlan() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!data || !data.planId || !data.expiresAt) return null;
    if (Date.now() > data.expiresAt) return null;
    return data;
  } catch {
    return null;
  }
}

export function writePlan(planId, planName, setBy) {
  ensureDir();
  const now = Date.now();
  const data = {
    planId: String(planId).trim(),
    planName: planName || null,
    setAt: now,
    expiresAt: now + TTL_MS,
    setBy: setBy || null,
  };
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

export function clearPlan() {
  try {
    fs.unlinkSync(FILE);
  } catch {}
}
