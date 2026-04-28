import fs from 'node:fs';

const TTL_MS = 30 * 60 * 1000;

const g = globalThis;
if (!g.__TR_SESSIONS__) {
  g.__TR_SESSIONS__ = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of g.__TR_SESSIONS__.entries()) {
      if (now > s.expiresAt) {
        g.__TR_SESSIONS__.delete(id);
        if (s.filePath) fs.promises.unlink(s.filePath).catch(() => {});
      }
    }
  }, 5 * 60 * 1000).unref();
}

export function setSession(id, data) {
  g.__TR_SESSIONS__.set(id, { ...data, expiresAt: Date.now() + TTL_MS });
}

export function getSession(id) {
  const s = g.__TR_SESSIONS__.get(id);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    g.__TR_SESSIONS__.delete(id);
    if (s.filePath) fs.promises.unlink(s.filePath).catch(() => {});
    return null;
  }
  return s;
}
