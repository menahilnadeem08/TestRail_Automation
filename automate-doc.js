'use strict';

require('dotenv').config();
const path = require('path');
const mammoth = require('mammoth');
const cheerio = require('cheerio');

const { STATUS_MAP, runWithParsedRows } = require('./testrail');
const {
  mapCliMatrixTitle,
  isCliPackageMatrixTable,
} = require('./cli-testrail-titles');
const {
  isLangGraphGuidesTable,
  LG_GUIDES_ROW_TITLES,
  isLangGraphQuickstartsTwoColTable,
  isLangGraphQuickstartsThreeCol,
  mapLangGraphQuickstartTwoCol,
  mapLangGraphQuickstartThreeCol,
  mapLangGraphTutorialVideoRow,
  isLangGraphTutorialVideoTable,
} = require('./langgraph-testrail-titles');

const PASS_ICON = '\u2705';
const FAIL_ICON = '\u274C';
const WARN_ICON = '\u26A0';

function classifyStatus(text) {
  const hasFail = text.includes(FAIL_ICON);
  const hasWarn = text.includes(WARN_ICON);
  const hasPass = text.includes(PASS_ICON);
  if (hasFail) return 'fail';
  if (hasWarn || hasPass) return 'pass';
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

/**
 * Docx/Google export often glues labels (no space before Issue Path / Error / etc.).
 */
function fixGluedIssueCommentLabels(s) {
  return s
    .replace(/(?<=\S)(?=Issue Path:)/gi, ' ')
    .replace(/(?<=\S)(?=Error:)/gi, ' ')
    .replace(/(?<=\S)(?=Explanation:)/gi, ' ')
    .replace(/(?<=\S)(?=Attempted fix:)/gi, ' ')
    .replace(/([.!?])(Explanation:)/gi, '$1 $2')
    .replace(/([.!?])(Attempted fix:)/gi, '$1 $2')
    .replace(/(Error:)(\S)/gi, '$1 $2')
    .replace(/(Explanation:)(\S)/gi, '$1 $2')
    .replace(/(Attempted fix:)(\S)/gi, '$1 $2');
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normIssueLabel(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Last path segment after `Issue Path:` (arrow-separated), before Error / Explanation / Attempted fix. */
function issuePathLastSegment(text) {
  const ipIdx = text.search(/\bIssue Path:\s*/i);
  if (ipIdx < 0) return null;
  const fromIp = text.slice(ipIdx);
  const pathMatch = fromIp.match(/^Issue Path:\s*(.+?)(?=\s+Error:|\s+Explanation:|\s+Attempted fix:|$)/is);
  if (!pathMatch) return null;
  const pathBody = pathMatch[1].trim();
  const segs = pathBody.split(/\s*(?:->|→|—)\s*/i).map((x) => x.trim()).filter(Boolean);
  const last = segs[segs.length - 1] || '';
  return last.length >= 2 ? last : null;
}

/** Remove leading link title when it only repeats the Issue Path leaf (e.g. "Display Only"). */
function stripLeadingDuplicateBeforeIssuePath(text) {
  const re = /\bIssue Path:\s*/i;
  const ipIdx = text.search(re);
  if (ipIdx <= 0) return text;
  const before = text.slice(0, ipIdx).replace(/\s+/g, ' ').trim();
  if (!before) return text;
  const last = issuePathLastSegment(text);
  if (!last) return text;
  if (normIssueLabel(before) === normIssueLabel(last)) {
    return text.slice(ipIdx).trim();
  }
  return text;
}

/** Remove trailing repeat of the same path leaf (redundant footer line). */
function stripTrailingDuplicatePathLeaf(text) {
  const last = issuePathLastSegment(text);
  if (!last || last.length < 2) return text;
  const tail = new RegExp(`\\s+${escapeRegExp(last)}\\s*$`, 'i');
  if (!tail.test(text)) return text;
  return text.replace(tail, '').replace(/\s+/g, ' ').trim();
}

/**
 * Build TestRail comment: strip status icons; fix glued labels; drop redundant leading/trailing
 * link title when it matches the Issue Path leaf. Do not strip all anchor text from the body.
 */
function buildComment({ rawCellText, looms }) {
  const stripped = rawCellText
    .replace(new RegExp(`[${PASS_ICON}${FAIL_ICON}${WARN_ICON}]`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let leftover = fixGluedIssueCommentLabels(stripped);
  leftover = stripLeadingDuplicateBeforeIssuePath(leftover);
  leftover = stripTrailingDuplicatePathLeaf(leftover);
  leftover = leftover.replace(/\s+/g, ' ').trim();

  const loomLines = looms.map((l) => {
    const cleanLinkText = (l.text || '')
      .replace(new RegExp(`[${PASS_ICON}${FAIL_ICON}${WARN_ICON}]`, 'g'), ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return `[${cleanLinkText || 'Loom'}](${l.url})`;
  });

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
      const cliMatrix = isCliPackageMatrixTable(headerTitles, currentSection);
      const firstCellRow0 = headerTitles[0] || '';
      const lgGuides = isLangGraphGuidesTable(headerTitles, currentSection);
      const lgQs2 =
        !lgGuides && isLangGraphQuickstartsTwoColTable(allRows.length, firstCellRow0, currentSection);
      const lgQs3 =
        !lgGuides && !lgQs2 && isLangGraphQuickstartsThreeCol(headerTitles, currentSection);
      const lgTutorialVideo = isLangGraphTutorialVideoTable(
        allRows,
        $,
        currentSection,
        lgGuides,
        lgQs2,
        lgQs3,
      );

      if (String(currentSection || '').trim().toLowerCase() === 'cli' && !cliMatrix) {
        continue;
      }

      allRows.forEach((tr, rowIdx) => {
        const cells = $(tr).children('td, th').toArray();
        if (cells.length < 2) return;

        const titleRaw = extractCellHtmlText($, cells[0]);
        const title = cleanTitle(titleRaw);
        if (!title && !(lgGuides && rowIdx > 0)) return;

        if (cliMatrix) {
          if (rowIdx === 0) return;
          for (let j = 1; j < cells.length; j++) {
            const mappedTitle = mapCliMatrixTitle(title, headerTitles[j]);
            if (!mappedTitle) continue;
            emitResultFromCell({
              $,
              cellEl: cells[j],
              title: mappedTitle,
              currentSection,
              results,
            });
          }
          return;
        }

        if (lgGuides) {
          if (rowIdx === 0) return;
          if (cells.length < 3) return;
          const entry = LG_GUIDES_ROW_TITLES[rowIdx];
          if (!entry) return;
          const pyRaw = extractCellHtmlText($, cells[1]);
          const jsRaw = extractCellHtmlText($, cells[2]);
          const pyHasStatus = classifyStatus(pyRaw);
          const jsHasStatus = classifyStatus(jsRaw);
          if (entry.python) {
            emitResultFromCell({
              $,
              cellEl: cells[1],
              title: entry.python,
              currentSection,
              results,
            });
          }
          if (entry.js) {
            if (jsHasStatus) {
              emitResultFromCell({
                $,
                cellEl: cells[2],
                title: entry.js,
                currentSection,
                results,
              });
            } else if (pyHasStatus) {
              emitResultFromCell({
                $,
                cellEl: cells[1],
                title: entry.js,
                currentSection,
                results,
              });
            }
          }
          return;
        }

        if (lgTutorialVideo) {
          const tvTitle = mapLangGraphTutorialVideoRow(title);
          if (!tvTitle) return;
          emitResultFromCell({
            $,
            cellEl: cells[1],
            title: tvTitle,
            currentSection,
            results,
          });
          return;
        }

        if (lgQs2) {
          const m = mapLangGraphQuickstartTwoCol(title);
          if (m.python) {
            emitResultFromCell({
              $,
              cellEl: cells[1],
              title: m.python,
              currentSection,
              results,
            });
          }
          if (m.js) {
            emitResultFromCell({
              $,
              cellEl: cells[1],
              title: m.js,
              currentSection,
              results,
            });
          }
          return;
        }

        if (lgQs3) {
          if (rowIdx === 0) return;
          if (cells.length < 3) return;
          const m = mapLangGraphQuickstartThreeCol(title);
          if (!m) return;
          emitResultFromCell({
            $,
            cellEl: cells[1],
            title: m.col1,
            currentSection,
            results,
          });
          emitResultFromCell({
            $,
            cellEl: cells[2],
            title: m.col2,
            currentSection,
            results,
          });
          return;
        }

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
  mapCliMatrixTitle,
  isCliPackageMatrixTable,
};
