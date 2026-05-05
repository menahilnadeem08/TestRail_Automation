
'use strict';

function norm(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isCrewAIFlowsSection(sectionName) {
  const n = norm(sectionName);
  return n.includes('crewai flows');
}

function isCrewAIGuidesTable(headerTitles, sectionName) {
  if (!isCrewAIFlowsSection(sectionName)) return false;
  const h0 = norm(headerTitles[0] || '');
  const h1 = norm(headerTitles[1] || '');
  return h0.includes('page') || h0.includes('section') && h1.includes('results');
}

/**
 * Quickstart table under CrewAI Flows.
 * Row 0:  | Copilotkit CLI | Code Along
 * Row 1: Quickstart [1] | N/A | ❌...
 */
function isCrewAIQuickstartTable(headerTitles, sectionName) {
  if (!isCrewAIFlowsSection(sectionName)) return false;
  const blob = headerTitles.join(' ').toLowerCase();
  return blob.includes('cli') && blob.includes('code along');
}

const CREWAI_GUIDES_ROW_TITLES = {
  1: 'Chat with an Agent',
  3: 'Your Components',
  4: 'Display-only',
  5: 'Interactive',
  6: 'Tool Rendering',
  7: 'State Rendering',
  10: 'Shared State – Reading Agent State',
  11: 'Shared State – Writing Agent State',
  12: 'Shared State – Predictive State Updates',
  13: 'Frontend Actions',
  15: 'Multi-Agent Flows',
  17: 'Persistence | Loading Agent State',
  18: 'Persistence | Threads',
  19: 'Persistence | Message Persistence',
  21: 'Advanced | Disabling State Streaming',
  22: 'Advanced | Manually Emitting Messages',
  23: 'Advanced | Exiting the Agent Loop',
};

module.exports = {
  isCrewAIFlowsSection,
  isCrewAIGuidesTable,
  isCrewAIQuickstartTable,
  CREWAI_GUIDES_ROW_TITLES,
};
