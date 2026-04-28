'use strict';

require('dotenv').config();
const path = require('path');
const mammoth = require('mammoth');
const cheerio = require('cheerio');

const { STATUS_MAP, runWithParsedRows } = require('./testrail');

const PASS_ICON = '\u2705';
const FAIL_ICON = '\u274C';
const WARN_ICON = '\u26A0';

function classifyStatus(text) {
  const hasFail = text.includes(FAIL_ICON);
  const hasWarn = text.includes(WARN_ICON);
  const hasPass = text.includes(PASS_ICON);
  if (hasFail) return 'fail';
  if (hasWarn) return 'retest';
  if (hasPass) return 'pass';
  return null;
}

function cleanText(s) {
  return String(s || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanTitle(raw) {
  let t = cleanText(raw);
  t = t.replace(/\s*\[\s*\d+\s*\]\s*$/g, '');
  t = t.replace(/^[*_\s]+|[*_\s]+$/g, '');
  return t.trim();
}

function cleanSection(raw) {
  let t = cleanText(raw);
  t = t.replace(/\(([^)]*)\)/g, (m, inner) => (/\d/.test(inner) ? ' ' : `(${inner})`));
  t = t.replace(/\[[^\]]*\]/g, ' ');
  t = t.split(/\s-\s|\s\u2014\s/)[0];
  t = t.replace(/\b\d{1,4}([\/\-.]\d{1,4}){1,2}\b/g, ' ');
  t = t.replace(/\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(\s+\d{2,4})?/gi, ' ');
  t = t.replace(/\b(laiba|menahil|malaika|yasir(?:\s+khan)?)\b/gi, ' ');
  t = t.replace(/\bquickstart\s*$/i, ' ');
  t = t.replace(/\(\s*\)/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function parseSectionAliases(raw) {
  const map = new Map();
  if (!raw) return map;
  for (const pair of String(raw).split(/[,;\n]/)) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const from = pair.slice(0, eq).trim();
    const to = pair.slice(eq + 1).trim();
    if (from && to) map.set(from.toLowerCase(), to);
  }
  return map;
}

function applyAlias(name, aliases) {
  if (!aliases || !aliases.size) return name;
  const k = String(name || '').trim().toLowerCase();
  return aliases.get(k) || name;
}

function extractCellHtmlText($, cellEl) {
  const html = $.html(cellEl);
  const text = cheerio.load(html).root().text();
  return text;
}

function extractLoomLinks($, cellEl) {
  const out = [];
  $(cellEl).find('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    const txt = cleanText($(a).text());
    if (href && /loom\.com\//.test(href)) {
      out.push({ url: href, text: txt });
    }
  });
  return out;
}

function buildComment({ rawCellText, looms }) {
  const stripped = rawCellText
    .replace(new RegExp(`[${PASS_ICON}${FAIL_ICON}${WARN_ICON}]`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const loomLines = looms.map((l) => `[${l.text || 'Loom'}](${l.url})`);

  let leftover = stripped;
  for (const l of looms) {
    if (l.text) leftover = leftover.split(l.text).join(' ');
  }
  leftover = leftover.replace(/\s+/g, ' ').trim();

  const parts = [];
  if (leftover) parts.push(leftover);
  if (loomLines.length) parts.push(loomLines.join('\n'));
  return parts.join('\n\n');
}

function parseSkipTitles(raw) {
  const set = new Set();
  if (!raw) return set;
  for (const t of String(raw).split(/[,;\n]/)) {
    const v = t.trim().toLowerCase();
    if (v) set.add(v);
  }
  return set;
}

function emitResultFromCell({ $, cellEl, title, currentSection, results }) {
  const resultRaw = extractCellHtmlText($, cellEl);
  const status = classifyStatus(resultRaw);
  if (!status || !(status in STATUS_MAP)) return false;

  const looms = extractLoomLinks($, cellEl);
  const comment = buildComment({ rawCellText: cleanText(resultRaw), looms });

  results.push({
    section: currentSection,
    title,
    status,
    status_id: STATUS_MAP[status],
    comment,
    loomCount: looms.length,
  });
  return true;
}

async function parseDocx(filePath, aliases, skipTitles) {
  const { value: html } = await mammoth.convertToHtml({ path: filePath });
  const $ = cheerio.load(html);

  const orderedNodes = [];
  $('body').children().each((_, el) => orderedNodes.push(el));

  const results = [];
  let currentSection = null;
  const skippedByTitle = [];
  const expandedFromRowLabel = [];

  for (const node of orderedNodes) {
    const tag = node.tagName && node.tagName.toLowerCase();
    if (!tag) continue;

    if (tag === 'h1') {
      const raw = $(node).text();
      currentSection = applyAlias(cleanSection(raw), aliases);
      continue;
    }

    if (tag === 'table') {
      const allRows = $(node).find('tr').toArray();
      const headerCells = allRows.length > 0 ? $(allRows[0]).children('td, th').toArray() : [];
      const headerTitles = headerCells.map((c) => cleanTitle(extractCellHtmlText($, c)));

      allRows.forEach((tr, rowIdx) => {
        const cells = $(tr).children('td, th').toArray();
        if (cells.length < 2) return;

        const titleRaw = extractCellHtmlText($, cells[0]);
        const title = cleanTitle(titleRaw);
        if (!title) return;

        if (skipTitles && skipTitles.has(title.toLowerCase())) {
          let emittedAny = false;
          for (let j = 1; j < cells.length; j++) {
            const colTitle = headerTitles[j];
            if (!colTitle) continue;
            const ok = emitResultFromCell({
              $,
              cellEl: cells[j],
              title: colTitle,
              currentSection,
              results,
            });
            if (ok) {
              emittedAny = true;
              expandedFromRowLabel.push({ section: currentSection, rowLabel: title, columnTitle: colTitle });
            }
          }
          if (!emittedAny) {
            skippedByTitle.push({ section: currentSection, title });
          }
          return;
        }

        if (rowIdx === 0) return;

        emitResultFromCell({
          $,
          cellEl: cells[1],
          title,
          currentSection,
          results,
        });
      });
    }
  }

  if (expandedFromRowLabel.length) {
    console.log(`Expanded ${expandedFromRowLabel.length} sub-test(s) from row labels in SKIP_TITLES (using table column headers as titles):`);
    expandedFromRowLabel.forEach((e) => console.log(`  • [${e.section}] "${e.rowLabel}" → "${e.columnTitle}"`));
  }
  if (skippedByTitle.length) {
    console.log(`SKIP_TITLES applied — skipped ${skippedByTitle.length} row(s) by title (no usable column headers):`);
    const counts = skippedByTitle.reduce((acc, s) => {
      acc[s.title] = (acc[s.title] || 0) + 1;
      return acc;
    }, {});
    Object.entries(counts).forEach(([t, n]) => console.log(`  • "${t}" × ${n}`));
  }

  return results;
}

async function main() {
  const env = process.env;
  const filePath = path.resolve(env.DOCX_PATH || './_Testing Doc 21st Apr (1).docx');
  console.log(`Reading docx: ${filePath}`);

  const aliases = parseSectionAliases(env.SECTION_ALIASES);
  if (aliases.size) {
    console.log(`Applying ${aliases.size} section alias(es):`);
    aliases.forEach((to, from) => console.log(`  "${from}" → "${to}"`));
  }

  const skipTitles = parseSkipTitles(env.SKIP_TITLES || 'Quickstart');
  if (skipTitles.size) {
    console.log(`Will ignore rows whose title (case-insensitive) is one of: ${[...skipTitles].join(', ')}`);
  }

  const parsed = await parseDocx(filePath, aliases, skipTitles);
  console.log(`Parsed ${parsed.length} test result row(s) from docx.`);

  const bySection = parsed.reduce((acc, r) => {
    const s = r.section || '(no section)';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
  console.log('Per-section counts:');
  Object.entries(bySection).forEach(([s, n]) => console.log(`  ${s}: ${n}`));

  await runWithParsedRows(parsed, env);
}

if (require.main === module) {
  main().catch((err) => {
    if (err.response) {
      console.error('TestRail API error:', err.response.status, err.response.data);
    } else {
      console.error('Error:', err.message);
    }
    process.exit(1);
  });
}

module.exports = {
  parseDocx,
  parseSectionAliases,
  parseSkipTitles,
};
