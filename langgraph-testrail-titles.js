'use strict';

/**
 * Maps the LangGraph → Guides matrix (doc) to TestRail case titles listed in
 * testrail-onvention.txt (CoPilotKit LangGraph run).
 *
 * Table shape: row0 = Page/Section | LangGraph.python | LangGraph.js
 * Section rows use "Section" in col1+2; some rows have empty col0 (continuation).
 */

function normSectionName(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** H1 may be "LangGraph" or "LangGraph (Yasir Khan)" after cleaning — still one section. */
function isLangGraphSection(sectionName) {
  const n = normSectionName(sectionName);
  return n === 'langgraph' || n.startsWith('langgraph');
}

function isLangGraphGuidesTable(headerTitles, sectionName) {
  if (!isLangGraphSection(sectionName)) return false;
  const h0 = normSectionName(headerTitles[0] || '');
  const h1 = normSectionName(headerTitles[1] || '');
  const h2 = normSectionName(headerTitles[2] || '');
  return h0.includes('page') && h0.includes('section')
    && h1.includes('langgraph') && h1.includes('python')
    && h2.includes('langgraph') && h2.includes('js');
}

const LG_QUICKSTART_PYTHON = 'Start from scratch | Python';
const LG_QUICKSTART_JS = 'Start from scratch | JS';

/**
 * Data row index (1 = first row after header) → { python, js } TestRail titles.
 * Use `null` to skip posting for that stack (section / empty row).
 * Exact spellings match testrail-onvention.txt (including "Generative Ui" typos).
 */
const LG_GUIDES_ROW_TITLES = {
  1: { python: 'Python | Chat with agent', js: 'JS | Chat with agent' },
  5: { python: 'Generative UI | Custom Graph (Python)', js: 'Generative UI | Custom Graph (JS)' },
  6: { python: 'Generative UI | Pre-built (Python)', js: 'Generative UI | Pre-built (JS)' },
  8: { python: 'Interactive | Custom Graph (Python)', js: 'Interactive | Custom Graph (JS)' },
  9: { python: 'Interactive | Pre-built (Python)', js: 'Interactive | Pre-built (JS)' },
  10: { python: 'Generative Ui | Interrupt-Based | Python', js: 'Generative Ui | Interrupt-Based | JS' },
  11: { python: 'Tool Rendering (Python)', js: 'Tool Rendering (JS)' },
  12: { python: 'State Rendering (Python)', js: 'State Rendering (JS)' },
  15: { python: 'Frontend Actions – Custom Graph (Python)', js: 'Frontend Actions – Custom Graph (JS)' },
  16: { python: 'Frontend Actions – Pre-built (Python)', js: 'Frontend Actions – Pre-built (JS)' },
  18: { python: 'Shared State | Reading Agent State (Python)', js: 'Shared State | Reading Agent State (JS)' },
  19: { python: 'Shared State | Writing Agent State (Python)', js: 'Shared State | Writing Agent State (JS)' },
  20: { python: 'Shared State | Agent State Input and Outputs (Python)', js: 'Shared State | Agent State Input and Outputs (JS)' },
  24: { python: 'Shared State | State Streaming – Manually Predictive (Python)', js: 'Shared State | State Streaming – Manually Predictive (JS)' },
  25: { python: 'Shared State | State Streaming – Tool-based Predictive (Python)', js: 'Shared State | State Streaming – Tool-based Predictive (JS)' },
  27: { python: 'Shared State | Readables – Custom Graph (Python)', js: 'Shared State | Readables – Custom Graph (JS)' },
  28: { python: 'Shared State | Readables – Pre-built (Python)', js: 'Shared State | Readables – Pre-built (JS)' },
  30: { python: 'LangGraph | Interrupts (Python)', js: 'LangGraph | Interrupts (JS)' },
  31: { python: 'LangGraph | Interrupts (Python)', js: 'LangGraph | Interrupts (JS)' },
  32: { python: 'LangGraph | Configurable (Python)', js: 'LangGraph | Configurable (JS)' },
  33: { python: 'LangGraph | Subgraphs(py)', js: null },
  35: { python: 'LangGraph | Deep Agents – LangSmith (Py)', js: null },
  36: { python: 'LangGraph | Deep Agents – FastAPI (py)', js: null },
  37: { python: 'LangGraph | Authentication', js: null },
  39: { python: 'Advanced | Disabling State Streaming (Python)', js: 'Advanced | Disabling State Streaming (JS)' },
  40: { python: 'Advanced | Manually Emitting Messages (Python)', js: 'Advanced | Manually Emitting Messages (JS)' },
  41: { python: 'Advanced | Exiting the Agent Loop (Python)', js: 'Advanced | Exiting the Agent Loop (JS)' },
  43: { python: 'Persistence | Loading Agent State (Python)', js: 'Persistence | Loading Agent State (JS)' },
  44: { python: 'Persistence | Threads (Python)', js: 'Persistence | Threads (JS)' },
  45: { python: 'Persistence | Message Persistence (Python)', js: 'Persistence | Message Persistence (JS)' },
};

/** True for the 2-row Quickstarts table (row0 = Python, row1 = JS; no header row). */
function isLangGraphQuickstartsTwoColTable(allRowCount, firstRowCol0, sectionName) {
  if (!isLangGraphSection(sectionName)) return false;
  if (allRowCount !== 2) return false;
  const a = normSectionName(firstRowCol0 || '');
  return a === 'python' || a === 'js';
}

/** row 0 headers like "", "Fast Api", "LangSmith" */
function isLangGraphQuickstartsThreeCol(headerTitles, sectionName) {
  if (!isLangGraphSection(sectionName)) return false;
  if (headerTitles.length !== 3) return false;
  const blob = headerTitles.join(' ').toLowerCase();
  return (blob.includes('fast api') || blob.includes('fastapi')) && blob.includes('langsmith');
}

function mapLangGraphQuickstartTwoCol(rowLabel) {
  const r = normSectionName(rowLabel);
  if (r === 'python') return { python: LG_QUICKSTART_PYTHON, js: null };
  if (r === 'js') return { python: null, js: LG_QUICKSTART_JS };
  return { python: null, js: null };
}

/** 3-col: row "Python" / "JS" × Fast Api | LangSmith → Use existing agent | Python – … */
function mapLangGraphQuickstartThreeCol(rowLabel) {
  const r = normSectionName(rowLabel);
  if (r === 'python') {
    return {
      col1: 'Use existing agent | Python – FastAPI',
      col2: 'Use existing agent | Python – LangSmith',
    };
  }
  return null;
}

/**
 * Small 2-column table under LangGraph: label | result (TestRail Tutorial / Video titles).
 */
function mapLangGraphTutorialVideoRow(firstColTitle) {
  const t = String(firstColTitle || '').trim();
  if (/research\s+agent\s+native\s+application/i.test(t)) {
    return 'Tutorial | Research Agent Native Application (ANA)';
  }
  if (/ai\s+travel\s+agentic\s+copilot/i.test(t)) {
    return 'Tutorial | AI Travel Agentic Copilot';
  }
  if (/video:\s*research\s+canvas/i.test(t) || /^research\s+canvas$/i.test(t.trim())) {
    return 'Video | Research Canvas';
  }
  return null;
}

/**
 * True when this is the 3-row Tutorial/Video table (ANA, Travel, Research Canvas).
 */
function isLangGraphTutorialVideoTable(allRows, $, sectionName, lgGuides, lgQs2, lgQs3) {
  if (!isLangGraphSection(sectionName) || lgGuides || lgQs2 || lgQs3) return false;
  if (allRows.length !== 3) return false;
  for (const tr of allRows) {
    const cells = $(tr).children('td, th').toArray();
    if (cells.length !== 2) return false;
    const a = String($(cells[0]).text() || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!a) return false;
    if (!mapLangGraphTutorialVideoRow(a)) return false;
  }
  return true;
}

module.exports = {
  isLangGraphSection,
  isLangGraphGuidesTable,
  LG_GUIDES_ROW_TITLES,
  isLangGraphQuickstartsTwoColTable,
  isLangGraphQuickstartsThreeCol,
  mapLangGraphQuickstartTwoCol,
  mapLangGraphQuickstartThreeCol,
  mapLangGraphTutorialVideoRow,
  isLangGraphTutorialVideoTable,
  LG_QUICKSTART_PYTHON,
  LG_QUICKSTART_JS,
};
