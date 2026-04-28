function unwrapTestRailError(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  return data.error || data.message || JSON.stringify(data);
}

export function friendlyError(err, ctx = {}) {
  if (err && err.response) {
    const status = err.response.status;
    const trMsg = unwrapTestRailError(err.response.data);

    if (status === 401) {
      return 'TestRail rejected the credentials. Check TESTRAIL_USER and TESTRAIL_API_KEY in the server .env file.';
    }
    if (status === 403) {
      return 'TestRail says this account does not have access to the requested resource.';
    }
    if (status === 404) {
      if (ctx.planId) {
        return `Plan ID "${ctx.planId}" was not found in TestRail. Double-check the ID — note that this should be the Plan ID, not a Run or Project ID.`;
      }
      return 'TestRail could not find the requested resource.';
    }
    if (status === 429) {
      return 'TestRail rate limit hit. Wait a few seconds and try again.';
    }
    if (status === 400) {
      if (/plan_?id/i.test(trMsg) || /not a valid.*plan/i.test(trMsg)) {
        return `Plan ID "${ctx.planId || ''}" is not a valid TestRail plan. Make sure you entered a Plan ID (not a Run ID, Suite ID, or Project ID).`;
      }
      if (/run_?id/i.test(trMsg)) {
        return `TestRail says the run ID is invalid. ${trMsg}`;
      }
      if (/case_?id/i.test(trMsg)) {
        return `TestRail rejected one of the case IDs. Original message: ${trMsg}`;
      }
      return `TestRail rejected the request: ${trMsg || 'unknown reason'}.`;
    }
    if (status >= 500) {
      return 'TestRail is having a server issue. Please try again in a moment.';
    }
    if (status == 500) {
      return 'TestRail has not plan on this id re enter valid id';
    }
    return `TestRail returned HTTP ${status}: ${trMsg}`;
  }

  if (err && err.code) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      const url = process.env.TESTRAIL_BASE_URL || 'the configured URL';
      return `Could not reach TestRail at ${url}. Check the network and TESTRAIL_BASE_URL.`;
    }
    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') {
      return 'The TestRail request timed out. Check your connection and try again.';
    }
  }

  const m = err && err.message ? String(err.message) : '';

  if (/Missing or placeholder env var/i.test(m)) {
    return m.replace(/Please set it in .env/i, 'Please configure it in the server .env.');
  }

  if (/Could not find the body element/i.test(m) || /not a docx/i.test(m) || /Corrupted zip/i.test(m) || /End of central directory/i.test(m)) {
    return 'This file does not look like a valid .docx document. Please re-export it from Word/Google Docs and try again.';
  }

  if (!m) return 'An unknown error occurred.';
  return m;
}
