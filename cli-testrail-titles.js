'use strict';

/**
 * Maps the CLI Init matrix (doc row × column) to exact TestRail case titles
 * under the "CLI" run, matching your CoPilotKit suite naming.
 *
 * Column headers expected: "", "Existing Agent", "CLI (npm)", "pnpm", "yarn", "bun"
 */

function normRow(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s*\[\s*\d+\s*\]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normCol(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** @returns {'existing'|'npm'|'pnpm'|'yarn'|'bun'|null} */
function columnKind(header) {
  const h = normCol(header);
  if (!h) return null;
  if (h === 'existing agent' || h.includes('existing agent')) return 'existing';
  if (h === 'cli (npm)' || h.includes('cli (npm)')) return 'npm';
  if (h === 'npm' || h === 'cli npm') return 'npm';
  if (h === 'pnpm') return 'pnpm';
  if (h === 'yarn') return 'yarn';
  if (h === 'bun') return 'bun';
  return null;
}

/**
 * Doc first-column labels (typos tolerated) → internal row key
 * @returns {string|null} null = unknown row
 */
function rowKeyFromLabel(rowLabel) {
  const k = normRow(rowLabel).replace(/,/g, ' ').replace(/\s+/g, ' ');
  const aliases = [
    [/crewai\s*[-–]\s*flows?/, 'crewai'],
    [/laanggraph\s*[-–]\s*py|langgraph\s*\(?py\)?|langgraph\s*-\s*py/i, 'lg_py'],
    [/laanggraph\s*[-–]\s*js|langgraph\s*\(?js\)?|langgraph\s*-\s*js|^lg\s*js$/i, 'lg_js'],
    [/built\s*[-–]?\s*in\s*agent|built\s*in\s*agent/, 'builtin'],
    [/^mastra$/, 'mastra'],
    [/^agno$/, 'agno'],
    [/^llamaindex$/, 'llamaindex'],
    [/^pydantic$/, 'pydantic'],
    [/aws\s*strands?/, 'aws'],
    [/^adk$/, 'adk'],
    [/ms\s*,\s*net|ms\s*\.net|microsoft.*\.net/i, 'ms_net'],
    [/^(ms\s*py|microsoft.*\(py\)|microsoft.*python)/i, 'ms_py'],
    [/^openspec|open\s*spec/, 'openspec'],
    [/^a2a$/, 'a2a'],
  ];
  for (const [re, key] of aliases) {
    if (re.test(k)) return key;
  }
  return null;
}

const PM_PREFIX = {
  crewai: null,
  lg_py: 'LangGraph CLI py',
  lg_js: 'LangGraph CLI js',
  builtin: 'Built-in',
  mastra: 'Mastra',
  agno: 'Agno',
  llamaindex: 'Llamaindex',
  pydantic: 'Pydantic',
  aws: 'Aws strands',
  adk: 'ADK',
  ms_net: 'Microsoft-agent-framework (.NET)',
  ms_py: 'Microsoft-agent-framework (py)',
  openspec: 'OpenSpec',
  a2a: 'A2A',
};

const EXISTING_TITLE = {
  mastra: 'Mastra Use Existing Agent',
  agno: 'Agno Use Existing Agent',
  llamaindex: 'LlamaIndex Use Existing Agent',
  pydantic: 'Pydantic Use Existing Agent',
  aws: 'AWS Strands Use Existing Agent',
  lg_py: 'LangGraph – Use existing Agent Method | Langsmith',
  lg_js: 'LangGraph – Use existing Agent Method | FASTAPI',
  builtin: null,
  adk: 'Adk- Use existing agent method',
  ms_py: 'Microsoft-agent-framework (py) Use Existing Agent',
  ms_net: 'Microsoft-agent-framework (.NET) Use Existing Agent',
  openspec: 'OpenSpec Use Existing Agent',
  a2a: 'A2A Use Existing Agent',
  crewai: null,
};

/**
 * @param {string} rowLabel - first cell of a data row
 * @param {string} columnHeader - header cell for that column
 * @returns {string|null} exact TestRail title, or null if unmapped / skip
 */
function mapCliMatrixTitle(rowLabel, columnHeader) {
  const rk = rowKeyFromLabel(rowLabel);
  const ck = columnKind(columnHeader);
  if (!rk || !ck) return null;

  if (rk === 'crewai' || PM_PREFIX[rk] == null) return null;

  if (ck === 'existing') {
    return EXISTING_TITLE[rk] || null;
  }

  const prefix = PM_PREFIX[rk];
  if (!prefix) return null;
  return `${prefix} ${ck}`;
}

/**
 * True when this table's header row looks like the CLI package-manager matrix.
 */
function isCliPackageMatrixTable(headerTitles, sectionName) {
  if (normRow(sectionName) !== 'cli') return false;
  const kinds = new Set();
  for (const h of headerTitles) {
    const k = columnKind(h);
    if (k) kinds.add(k);
  }
  return kinds.has('existing') && kinds.has('npm') && kinds.has('pnpm') && kinds.has('yarn') && kinds.has('bun');
}

/** All TestRail titles for CLI matrix (for reference .txt), grouped conceptually */
function allCanonicalCliCaseTitles() {
  const out = [];
  const pm = ['npm', 'pnpm', 'yarn', 'bun'];
  const blocks = [
    ['Mastra', 'Mastra'],
    ['Agno', 'Agno'],
    ['Pydantic', 'Pydantic'],
    ['Llamaindex', 'Llamaindex'],
    ['Aws strands', 'Aws strands'],
    ['Microsoft-agent-framework (.NET)', 'Microsoft-agent-framework (.NET)'],
    ['Microsoft-agent-framework (py)', 'Microsoft-agent-framework (py)'],
    ['LangGraph CLI py', 'LangGraph CLI py'],
    ['LangGraph CLI js', 'LangGraph CLI js'],
    ['Built-in', 'Built-in'],
    ['OpenSpec', 'OpenSpec'],
    ['A2A', 'A2A'],
    ['ADK', 'ADK'],
  ];
  for (const [, prefix] of blocks) {
    for (const p of pm) out.push(`${prefix} ${p}`);
  }
  out.push(
    'Mastra Use Existing Agent',
    'Agno Use Existing Agent',
    'LlamaIndex Use Existing Agent',
    'Pydantic Use Existing Agent',
    'AWS Strands Use Existing Agent',
    'LangGraph – Use existing Agent Method | Langsmith',
    'LangGraph – Use existing Agent Method | FASTAPI',
    'Adk- Use existing agent method',
    'Microsoft-agent-framework (py) Use Existing Agent',
    'Microsoft-agent-framework (.NET) Use Existing Agent',
    'OpenSpec Use Existing Agent',
    'A2A Use Existing Agent',
  );
  return out;
}

module.exports = {
  mapCliMatrixTitle,
  isCliPackageMatrixTable,
  columnKind,
  rowKeyFromLabel,
  allCanonicalCliCaseTitles,
};
