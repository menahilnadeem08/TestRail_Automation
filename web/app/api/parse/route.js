import { NextResponse } from 'next/server';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';

import { loadParentEnv } from '../../../lib/env.js';
import { setSession } from '../../../lib/sessions.js';
import { friendlyError } from '../../../lib/errors.js';

import {
  parseDocx,
  parseSectionAliases,
  parseSkipTitles,
} from '../../../../automate-doc.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPLOAD_DIR = path.join(os.tmpdir(), 'testrail-ui-uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export async function POST(request) {
  loadParentEnv();

  let savedPath = null;
  try {
    const form = await request.formData();
    const file = form.get('docFile');

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (!/\.docx$/i.test(file.name)) {
      return NextResponse.json(
        { error: 'Only .docx files are accepted' },
        { status: 400 }
      );
    }
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File too large (max 50 MB)' },
        { status: 400 }
      );
    }

    const id = crypto.randomBytes(8).toString('hex');
    const safeName = file.name.replace(/[^\w.\-]+/g, '_');
    savedPath = path.join(UPLOAD_DIR, `${id}__${safeName}`);

    const buf = Buffer.from(await file.arrayBuffer());
    await fs.promises.writeFile(savedPath, buf);

    const aliases = parseSectionAliases(process.env.SECTION_ALIASES);
    const skipTitles = parseSkipTitles(process.env.SKIP_TITLES || 'Quickstart');
    const parsed = await parseDocx(savedPath, aliases, skipTitles);

    const counts = parsed.reduce((acc, r) => {
      const s = r.section || '(no section)';
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});

    const frameworks = Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const sessionId = crypto.randomBytes(12).toString('hex');
    setSession(sessionId, {
      filePath: savedPath,
      originalName: file.name,
      parsed,
    });

    return NextResponse.json({
      sessionId,
      originalName: file.name,
      totalRows: parsed.length,
      frameworks,
    });
  } catch (err) {
    console.error('Parse error:', err);
    if (savedPath) fs.promises.unlink(savedPath).catch(() => {});
    return NextResponse.json(
      { error: friendlyError(err) },
      { status: 500 }
    );
  }
}
