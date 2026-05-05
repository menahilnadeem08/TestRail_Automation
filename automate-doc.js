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
const {
  isCrewAIFlowsSection,
  isCrewAIGuidesTable,
  isCrewAIQuickstartTable,
  CREWAI_GUIDES_ROW_TITLES,
} = require('./crewai-testrail-titles');

const PASS_ICON = '\u2705';
const FAIL_ICON = '\u274C';
const WARN_ICON = '\u26A0';
const BLOCK_ICON = '\u{1F6AB}'; // 🚫 — TestRail blocked

function classifyStatus(text) {
  const t = String(text || '');
  const hasFail = t.includes(FAIL_ICON);
  const hasBlock = t.includes(BLOCK_ICON);
  const hasWarn = t.includes(WARN_ICON);
  const hasPass = t.includes(PASS_ICON);
  if (hasFail) return 'fail';
  if (hasBlock) return 'blocked';
  if (hasWarn || hasPass) return 'pass';
  return null;
}

/**
 * SKIP_TITLES uses table column headers as TestRail case titles. For Built-in Agent, the
 * Quickstart row’s "CLI" column is one blob of results but TestRail’s case is named "Quickstart",
 * not "CLI" — without this mapping uploads stay unmatched / Untested.
 */
function mapSkipTitlesTestRailTitle(sectionName, rowLabel, columnHeader) {
  const s = String(sectionName || '').toLowerCase();
  const r = String(rowLabel || '').trim().toLowerCase();
  const c = String(columnHeader || '').trim().toLowerCase();
  if (r !== 'quickstart' || !c) return columnHeader;
  const builtin = /\bbuilt[-\s]?in\b/.test(s) || s.includes('builtin');
  if (builtin && (c === 'cli' || /^cli\b/.test(c))) {
    return 'Quickstart';
  }
  return columnHeader;
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


/**
 * Walk cell DOM in order; emit Markdown for links so TestRail keeps click targets.
 * Plain text and newlines are preserved; <a href> → [label](url) with a trailing space.
 */
function extractCellResultMarkdown($, cellEl) {
  const buf = [];
  function walk(el) {
    $(el).contents().each((_, node) => {
      if (node.type === 'text') {
        buf.push(node.data || '');
        return;
      }
      if (node.type !== 'tag') return;
      const tag = String(node.name || node.tagName || '').toLowerCase();
      if (tag === 'script' || tag === 'style') return;
      if (tag === 'br') {
        buf.push('\n');
        return;
      }
      if (tag === 'a') {
        const $a = $(node);
        const text = $a.text().replace(/\u00A0/g, ' ').trim();
        const href = ($a.attr('href') || '').trim();
        if (href && /^javascript:/i.test(href)) {
          if (text) buf.push(text, ' ');
          return;
        }
        if (href && text) {
          const esc = text.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
          buf.push(`[${esc}](${href})`);
        } else if (text) {
          buf.push(text);
        }
        buf.push(' ');
        return;
      }
      walk(node);
    });
  }
  walk(cellEl);
  return buf.join('').replace(/\u00A0/g, ' ');
}

/** Plain-text view of Markdown (for inject rules that expect raw words). */
function markdownToPlainForCompare(md) {
  return md.replace(/\[((?:\\]|[^\]])*)\]\([^)]+\)/g, (_, inner) => inner.replace(/\\\]/g, ']'));
}

/**
 * Apply Your Components → Display Only path fix on Markdown: compare denuded string, then mirror
 * replacement on MD and drop a trailing duplicate `[Display Only](...)` or plain “Display Only”.
 */
function injectDisplayOnlyForMarkdownBody($, cellEl, md) {
  const plain = markdownToPlainForCompare(md);
  const plainFixed = injectDisplayOnlyBeforeErrorIfLonelyLink($, cellEl, plain);
  if (plainFixed === plain) return md;
  let out = md.replace(/(Your Components\s*->\s*)Error:/gi, '$1Display Only Error:');
  out = out.replace(/\s+\[Display Only\]\([^)]+\)\s*$/i, '').trim();
  out = out.replace(/\s+Display Only\s*$/i, '').trim();
  return out;
}

function injectDisplayOnlyBeforeErrorIfLonelyLink($, cellEl, text) {
  const hasJump = /Your Components\s*->\s*Error:/i.test(text);
  const already = /Your Components\s*->\s*Display Only\s*Error:/i.test(text);
  if (!hasJump || already) return text;
  const hasDisplayOnlyLink = $(cellEl).find('a').toArray().some((a) => /^display\s*only$/i.test($(a).text().replace(/\u00A0/g, ' ').trim()));
  if (!hasDisplayOnlyLink) return text;
  const next = text.replace(/(Your Components\s*->\s*)Error:/gi, '$1Display Only Error:');
  if (next === text) return text;
  return next.replace(/\s+Display Only\s*$/i, '').trim();
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

/** Insert line breaks so Issue Path, Error, Explanation, and Attempted fix read as separate blocks in TestRail. */
function formatCommentSectionSpacing(s) {
  let t = String(s || '');
  t = t.replace(/\)\s*(?=Issue Path:)/gi, ')\n\n');
  t = t.replace(/(Display Only)(?=Error:)/gi, '$1 ');
  t = t.replace(/(Issue Path:[^\n]+?)\s*(Error:)/gi, '$1\n\n$2');
  t = t.replace(/(Error:[^\n]+?)\s*(Explanation:)/gi, '$1\n\n$2');
  t = t.replace(/(Explanation:[^\n]+?)\s*(Attempted fix:)/gi, '$1\n\n$2');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t;
}

/** Strip status icons for TestRail; empty remainder → TestRail’s default Passed text for passes; blocked-only text is set in emitResultFromCell. */
function finalizeCommentBody(body) {
  let t = String(body || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\)(?=Error:)/g, ') ')
    .replace(/\)(?=Explanation:)/gi, ') ')
    .replace(/\)(?=Attempted fix:)/gi, ') ')
    .replace(/\.(?=Explanation:)/gi, '. ')
    .replace(/\.(?=Attempted fix:)/gi, '. ');
  t = formatCommentSectionSpacing(t);
  return t
    .replace(new RegExp(`[${PASS_ICON}${FAIL_ICON}${WARN_ICON}${BLOCK_ICON}]`, 'g'), ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
  let body = extractCellResultMarkdown($, cellEl);
  body = injectDisplayOnlyForMarkdownBody($, cellEl, body);
  const resultRaw = body;
  const status = classifyStatus(resultRaw);
  if (!status || !(status in STATUS_MAP)) return false;

  const looms = extractLoomLinks($, cellEl);
  let comment = finalizeCommentBody(body) || '';
  if (status === 'blocked' && !comment) {
    comment = 'The test was blocked.';
  }

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
      const crewaiGuides = isCrewAIGuidesTable(headerTitles, currentSection);
      const crewaiQs = isCrewAIQuickstartTable(headerTitles, currentSection);

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
          const jsRaw = extractCellHtmlText($, cells[2]);
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

        if (crewaiQs) {
          if (rowIdx === 0) return;
          if (cells.length < 3) return;
          emitResultFromCell({
            $,
            cellEl: cells[2],
            title: 'Quickstart – Code Along',
            currentSection,
            results,
          });
          return;
        }

        if (crewaiGuides) {
          if (rowIdx === 0) return;
          const mappedTitle = CREWAI_GUIDES_ROW_TITLES[rowIdx];
          if (!mappedTitle) return;
          emitResultFromCell({
            $,
            cellEl: cells[1],
            title: mappedTitle,
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
            const testRailTitle = mapSkipTitlesTestRailTitle(currentSection, title, colTitle);
            const ok = emitResultFromCell({
              $,
              cellEl: cells[j],
              title: testRailTitle,
              currentSection,
              results,
            });
            if (ok) {
              emittedAny = true;
              expandedFromRowLabel.push({
                section: currentSection,
                rowLabel: title,
                columnTitle: colTitle,
                mappedTitle: testRailTitle,
              });
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
    expandedFromRowLabel.forEach((e) => {
      const mapNote = e.mappedTitle && e.mappedTitle !== e.columnTitle
        ? ` → TestRail "${e.mappedTitle}"`
        : '';
      console.log(`  • [${e.section}] "${e.rowLabel}" → column "${e.columnTitle}"${mapNote}`);
    });
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
