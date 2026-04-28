import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), '.data');
const FILE = path.join(DATA_DIR, 'statuses.json');

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAll() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

export function getStatusesForPlan(planId) {
  if (!planId) return {};
  const all = readAll();
  return all[String(planId)] || {};
}

export function setFrameworkStatus(planId, framework, status) {
  if (!planId || !framework) return;
  const all = readAll();
  const k = String(planId);
  if (!all[k]) all[k] = {};
  all[k][framework] = { ...status, updatedAt: Date.now() };
  writeAll(all);
}

export function clearStatusesForPlan(planId) {
  if (!planId) return;
  const all = readAll();
  delete all[String(planId)];
  writeAll(all);
}

export function classifySubmission(entry) {
  if (!entry) return 'none';
  if (entry.noMatchingRun) return 'none';

  const sent = entry.sent || 0;
  const skipped = Array.isArray(entry.skipped) ? entry.skipped.length : 0;
  const unmatched = Array.isArray(entry.unmatched) ? entry.unmatched.length : 0;
  const total = entry.rowCount || sent + skipped + unmatched;

  if (sent + skipped >= total && unmatched === 0 && total > 0) return 'complete';
  if (sent + skipped > 0) return 'partial';
  return 'none';
}
