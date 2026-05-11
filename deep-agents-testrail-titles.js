'use strict';

/**
 * Maps the Deep Agents (doc) to TestRail case titles.
 */

function normSectionName(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isDeepAgentsSection(sectionName) {
  const n = normSectionName(sectionName);
  return n.includes('deep agents');
}

/**
 * Guides table shape: row0 = Page/Section | LangGraph.python | LangGraph.js
 */
function isDeepAgentsGuidesTable(headerTitles, sectionName) {
  if (!isDeepAgentsSection(sectionName)) return false;
  const h0 = normSectionName(headerTitles[0] || '');
  const h1 = normSectionName(headerTitles[1] || '');
  const h2 = normSectionName(headerTitles[2] || '');
  return (
    h0.includes('page') && h0.includes('section') &&
    h1.includes('langgraph') && h1.includes('python') &&
    h2.includes('langgraph') && h2.includes('js')
  );
}

/**
 * Data row index -> { python, js } TestRail titles.
 */
const DEEP_AGENTS_GUIDES_ROW_TITLES = {
  3: { python: 'Generative UI | Your Components | Display Only Py', js: 'Generative UI | Your Components | Display Only Js' },
  4: { python: 'Generative UI | Your Components | Interactive Py', js: 'Generative UI | Your Components | Interactive Js' },
  5: { python: 'Generative UI | Your Components | Interrupt-Based Py', js: 'Generative UI | Your Components | Interrupt-Based Js' },
  6: { python: 'Tool Rendering Py', js: 'Tool Rendering Js' },
  7: { python: 'State Rendering Py', js: 'State Rendering Js' },
  9: { python: 'Frontend tools Py', js: 'Frontend tools Js' },
  10: { python: 'Reading agent state Py', js: 'Reading agent state Js' },
  11: { python: 'Writing agent state Py', js: 'Writing agent state Js' },
  12: { python: 'Input/Output Schemas Py', js: null }, // C464 is missing in user list
  14: { python: 'State Streaming | Prebuilt agent Py', js: 'State Streaming | Prebuilt agent Js' },
  16: { python: 'State Streaming | Custom Graph | Manually Predictive Py', js: 'State Streaming | Custom Graph | Manually Predictive Js' },
  17: { python: 'State Streaming | Custom Graph | Tool-based Predictive Py', js: 'State Streaming | Custom Graph | Tool-based Predictive Js' },
  19: { python: 'Human in the Loop | Interrupts py', js: 'Human in the Loop | Interrupts Js' },
};

/**
 * Deep Agents Quickstart has 3 rows: Python, JS, FastAPI
 */
function isDeepAgentsQuickstartTable(allRowCount, firstRowCol0, sectionName) {
  if (!isDeepAgentsSection(sectionName)) return false;
  if (allRowCount !== 3) return false;
  const a = normSectionName(firstRowCol0 || '');
  return a === 'python' || a === 'js' || a === 'fastapi';
}

function mapDeepAgentsQuickstart(rowLabel) {
  const r = normSectionName(rowLabel);
  if (r === 'python') return { python: 'Python', js: null, fastapi: null };
  if (r === 'js') return { python: null, js: 'JS', fastapi: null };
  if (r === 'fastapi') return { python: null, js: null, fastapi: 'FastAPI' };
  return { python: null, js: null, fastapi: null };
}

module.exports = {
  isDeepAgentsSection,
  isDeepAgentsGuidesTable,
  DEEP_AGENTS_GUIDES_ROW_TITLES,
  isDeepAgentsQuickstartTable,
  mapDeepAgentsQuickstart,
};
