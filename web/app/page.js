'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default function Home() {
  const fileInputRef = useRef(null);
  const dropzoneRef = useRef(null);
  const step2Ref = useRef(null);
  const logsRef = useRef(null);

  const [file, setFile] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [frameworks, setFrameworks] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [selectedFramework, setSelectedFramework] = useState('');
  const [dryRun, setDryRun] = useState(false);

  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parseAlert, setParseAlert] = useState(null);
  const [uploadAlert, setUploadAlert] = useState(null);
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);
  const [showLogs, setShowLogs] = useState(false);

  const [planInput, setPlanInput] = useState('');
  const [storedPlan, setStoredPlan] = useState(null);
  const [planSaving, setPlanSaving] = useState(false);
  const [planAlert, setPlanAlert] = useState(null);
  const [planLoaded, setPlanLoaded] = useState(false);

  const [statuses, setStatuses] = useState({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    try {
      const v = localStorage.getItem('sidebarCollapsed');
      if (v === '1') setSidebarCollapsed(true);
    } catch {}
    try {
      const t = document.documentElement.getAttribute('data-theme');
      setTheme(t === 'light' ? 'light' : 'dark');
    } catch {}
  }, []);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    try {
      if (next === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
      localStorage.setItem('theme', next);
    } catch {}
  };

  useEffect(() => {
    try {
      localStorage.setItem('sidebarCollapsed', sidebarCollapsed ? '1' : '0');
    } catch {}
  }, [sidebarCollapsed]);

  const sidebarFrameworks = useMemo(() => {
    const countByName = new Map();
    for (const f of frameworks) countByName.set(f.name, f.count);

    const out = [];
    for (const [name, st] of Object.entries(statuses)) {
      const state = st?.state;
      if (state !== 'complete' && state !== 'partial') continue;
      out.push({
        name,
        count: countByName.has(name) ? countByName.get(name) : null,
      });
    }
    return out.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
  }, [frameworks, statuses]);

  const refreshStatuses = async () => {
    try {
      const r = await fetch('/api/statuses');
      const data = await r.json();
      setStatuses(data?.statuses || {});
    } catch {}
  };

  useEffect(() => {
    fetch('/api/plan')
      .then((r) => r.json())
      .then((data) => {
        if (data && data.planId) {
          setStoredPlan(data);
          setPlanInput(data.planId);
        }
      })
      .catch(() => {})
      .finally(() => setPlanLoaded(true));

    refreshStatuses();
  }, []);

  const handleSavePlan = async () => {
    const v = String(planInput || '').trim();
    if (!v) {
      setPlanAlert({ type: 'error', msg: 'Plan ID is required.' });
      return;
    }
    setPlanSaving(true);
    setPlanAlert(null);
    try {
      const r = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: v }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to save plan ID');
      setStoredPlan(data);
      setPlanAlert({
        type: 'success',
        msg: `Plan ID <b>${escapeHtml(data.planId)}</b> saved. It will be used by everyone for the next 24&nbsp;hours.`,
      });
      refreshStatuses();
    } catch (err) {
      setPlanAlert({ type: 'error', msg: err.message });
    } finally {
      setPlanSaving(false);
    }
  };

  const handleClearPlan = async () => {
    setPlanSaving(true);
    setPlanAlert(null);
    try {
      const r = await fetch('/api/plan', { method: 'DELETE' });
      if (!r.ok) throw new Error('Failed to clear plan ID');
      setStoredPlan(null);
      setPlanInput('');
      setPlanAlert({ type: 'info', msg: 'Stored Plan ID cleared.' });
    } catch (err) {
      setPlanAlert({ type: 'error', msg: err.message });
    } finally {
      setPlanSaving(false);
    }
  };

  function formatExpiry(ts) {
    if (!ts) return '';
    const ms = ts - Date.now();
    if (ms <= 0) return 'expired';
    const h = Math.floor(ms / (1000 * 60 * 60));
    const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (h > 0) return `expires in ${h}h ${m}m`;
    return `expires in ${m}m`;
  }

  useEffect(() => {
    const dz = dropzoneRef.current;
    if (!dz) return;
    const onDragEnter = (e) => { e.preventDefault(); dz.classList.add('drag'); };
    const onDragLeave = (e) => { e.preventDefault(); dz.classList.remove('drag'); };
    const onDrop = (e) => {
      e.preventDefault();
      dz.classList.remove('drag');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (!/\.docx$/i.test(f.name)) {
        setParseAlert({ type: 'error', msg: 'Only .docx files are accepted.' });
        return;
      }
      setFile(f);
      setParseAlert(null);
    };
    dz.addEventListener('dragenter', onDragEnter);
    dz.addEventListener('dragover', onDragEnter);
    dz.addEventListener('dragleave', onDragLeave);
    dz.addEventListener('drop', onDrop);
    return () => {
      dz.removeEventListener('dragenter', onDragEnter);
      dz.removeEventListener('dragover', onDragEnter);
      dz.removeEventListener('dragleave', onDragLeave);
      dz.removeEventListener('drop', onDrop);
    };
  }, []);

  const onFileChange = (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) setFile(f);
  };

  const removeFile = () => {
    if (fileInputRef.current) fileInputRef.current.value = '';
    setFile(null);
    setParseAlert(null);
  };

  const handleParse = async () => {
    if (!file) return;
    setParsing(true);
    setParseAlert(null);
    try {
      const fd = new FormData();
      fd.append('docFile', file);
      const r = await fetch('/api/parse', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Parse failed');

      setSessionId(data.sessionId);
      setFrameworks(data.frameworks);
      setTotalRows(data.totalRows);
      setSelectedFramework(data.frameworks[0]?.name || '');

      setParseAlert({
        type: 'success',
        msg: `Parsed <b>${data.totalRows}</b> row(s) across <b>${data.frameworks.length}</b> framework(s).`,
      });
      setTimeout(() => {
        step2Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    } catch (err) {
      setParseAlert({ type: 'error', msg: err.message });
    } finally {
      setParsing(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setSessionId(null);
    setFrameworks([]);
    setTotalRows(0);
    setSelectedFramework('');
    setParseAlert(null);
    setUploadAlert(null);
    setLogs([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUpload = async () => {
    if (!sessionId || !selectedFramework) return;
    setUploading(true);
    setUploadAlert(null);
    setLogs([]);
    setResult(null);
    setShowLogs(false);

    try {
      const r = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, framework: selectedFramework, dryRun }),
      });
      const data = await r.json();

      if (data.logs && data.logs.length) setLogs(data.logs);

      if (!r.ok) throw new Error(data.error || 'Upload failed');

      setResult(data.result || null);
      const msg = data.dryRun
        ? `Dry run completed for <b>${escapeHtml(selectedFramework)}</b>. No results were posted.`
        : `Successfully sent results for <b>${escapeHtml(selectedFramework)}</b> to TestRail.`;
      setUploadAlert({ type: data.dryRun ? 'info' : 'success', msg });
      if (!data.dryRun) refreshStatuses();
    } catch (err) {
      setUploadAlert({ type: 'error', msg: err.message });
    } finally {
      setUploading(false);
    }
  };

  const selectedCount =
    frameworks.find((f) => f.name === selectedFramework)?.count ?? 0;

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="sidebar-title">Frameworks</div>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((v) => !v)}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? '›' : '‹'}
          </button>
        </div>

        {!sidebarCollapsed && (
          <div className="sidebar-body">
            {sidebarFrameworks.length === 0 ? (
              <div className="sidebar-empty">
                {storedPlan
                  ? 'No submissions yet. Frameworks will appear here once you upload results (completed or partial).'
                  : 'Set a TestRail Plan ID and upload results — frameworks with completed or partial submissions will appear here.'}
              </div>
            ) : (
              <FrameworkChecklist
                frameworks={sidebarFrameworks}
                statuses={statuses}
                planId={storedPlan?.planId}
                onSelect={(name) => {
                  if (frameworks.some((f) => f.name === name)) {
                    setSelectedFramework(name);
                  }
                }}
                selected={selectedFramework}
                compact
              />
            )}
          </div>
        )}
      </aside>

      <div className="main">
        <div className="wrap">
          <div className="header">
            <div className="logo" />
            <div>
              <h1>TestRail Uploader</h1>
              <div className="subtitle">
                Upload a test report and post results for one framework at a time.
              </div>
            </div>
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              <span className="icon-sun" aria-hidden="true">☀</span>
              <span className="icon-moon" aria-hidden="true">☾</span>
            </button>
          </div>

      <div className="card">
        <div className="step-title">
          <span className="step-num">0</span> TestRail Plan ID
        </div>

        <label className="field-label" htmlFor="planInput">
          The numeric ID of the TestRail plan to post results into. Saved
          server-side and used by everyone for 24&nbsp;hours.
        </label>
        <div className="row" style={{ alignItems: 'stretch' }}>
          <div className="grow">
            <input
              id="planInput"
              type="text"
              inputMode="numeric"
              placeholder="e.g. 255"
              value={planInput}
              onChange={(e) => setPlanInput(e.target.value)}
              disabled={!planLoaded}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={handleSavePlan}
            disabled={planSaving || !planLoaded}
          >
            {planSaving ? (
              <>
                <span className="spinner" /> Saving...
              </>
            ) : storedPlan ? (
              'Update'
            ) : (
              'Save'
            )}
          </button>
          {storedPlan && (
            <button
              className="btn btn-ghost"
              onClick={handleClearPlan}
              disabled={planSaving}
            >
              Clear
            </button>
          )}
        </div>

        {storedPlan && (
          <div className="stats">
            <span>
              Current: <b>{storedPlan.planId}</b>
            </span>
            <span>{formatExpiry(storedPlan.expiresAt)}</span>
          </div>
        )}
        {!storedPlan && planLoaded && (
          <div className="stats">
            <span style={{ color: 'var(--warn)' }}>
              No Plan ID is set. Set one before uploading.
            </span>
          </div>
        )}

        {planAlert && (
          <div
            className={`alert ${planAlert.type}`}
            dangerouslySetInnerHTML={{ __html: planAlert.msg }}
          />
        )}
      </div>

      <div className="card">
        <div className="step-title">
          <span className="step-num">1</span> Upload .docx report
        </div>

        <label
          ref={dropzoneRef}
          className="dropzone"
          htmlFor="fileInput"
        >
          <div className="icon">⬆</div>
          <div>
            <b>Click to choose</b> or drag and drop a <code>.docx</code> file
          </div>
          <div className="hint">Max 50&nbsp;MB</div>
        </label>
        <input
          id="fileInput"
          ref={fileInputRef}
          type="file"
          accept=".docx"
          onChange={onFileChange}
        />

        {file && (
          <>
            <div className="row" style={{ marginTop: 14 }}>
              <span className="file-pill">
                <span>📄</span>
                <span>{file.name}</span>
                <span className="x" title="Remove" onClick={removeFile}>✕</span>
              </span>
              <button
                className="btn btn-primary"
                onClick={handleParse}
                disabled={parsing}
              >
                {parsing ? (
                  <>
                    <span className="spinner" /> Parsing...
                  </>
                ) : (
                  'Parse document'
                )}
              </button>
            </div>
            {!sessionId && (
              <div className="hint-line">
                Click <b>Parse document</b> to detect the frameworks in this file.
                You&apos;ll then be able to pick which one to upload.
              </div>
            )}
          </>
        )}

        {parseAlert && (
          <div
            className={`alert ${parseAlert.type}`}
            dangerouslySetInnerHTML={{ __html: parseAlert.msg }}
          />
        )}
      </div>

      {sessionId && frameworks.length > 0 && (
        <div className="card" ref={step2Ref}>
          <div className="step-title">
            <span className="step-num">2</span> Choose framework
          </div>

          <label className="field-label" htmlFor="frameworkSelect">
            Framework
          </label>
          <select
            id="frameworkSelect"
            value={selectedFramework}
            onChange={(e) => setSelectedFramework(e.target.value)}
          >
            {frameworks.map((f) => {
              const st = statuses[f.name]?.state;
              const icon = st === 'complete' ? '✓ ' : st === 'partial' ? '~ ' : '';
              return (
                <option key={f.name} value={f.name}>
                  {icon}
                  {f.name} — {f.count} row(s)
                </option>
              );
            })}
          </select>

          <div className="stats">
            <span>
              Total parsed: <b>{totalRows}</b> row(s)
            </span>
            <span>
              Selected framework: <b>{selectedCount}</b> row(s)
            </span>
          </div>

          <div
            className="row"
            style={{ marginTop: 16, justifyContent: 'space-between' }}
          >
            <label className="checkbox">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
              <span>Dry run (don&apos;t actually post to TestRail)</span>
            </label>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-ghost" onClick={handleReset}>
                Start over
              </button>
              <button
                className="btn btn-primary"
                onClick={handleUpload}
                disabled={uploading || !storedPlan}
                title={!storedPlan ? 'Set a TestRail Plan ID first' : ''}
              >
                {uploading ? (
                  <>
                    <span className="spinner" /> Uploading...
                  </>
                ) : (
                  'Upload to TestRail'
                )}
              </button>
            </div>
          </div>

          {uploadAlert && (
            <div
              className={`alert ${uploadAlert.type}`}
              dangerouslySetInnerHTML={{ __html: uploadAlert.msg }}
            />
          )}

          {result && <ResultSummary result={result} />}

          {logs.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="link-btn"
                onClick={() => setShowLogs((s) => !s)}
              >
                {showLogs ? 'Hide technical details' : 'Show technical details'}
              </button>
              {showLogs && (
                <div className="logs" ref={logsRef}>
                  {logs.map((l, i) => (
                    <div key={i} className={`l-${l.level}`}>
                      {l.line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

          <div className="footer">
            Frameworks are detected from the document headings. Configuration is read
            from <code>../.env</code>.
          </div>
        </div>
      </div>
    </div>
  );
}

const STATUS_NAMES = {
  1: 'Passed',
  2: 'Blocked',
  3: 'Untested',
  4: 'Retest',
  5: 'Failed',
};

const STATUS_CLASS = {
  1: 'pill-pass',
  2: 'pill-block',
  3: 'pill-untested',
  4: 'pill-retest',
  5: 'pill-fail',
};

function statusLabel(id) {
  return STATUS_NAMES[id] || `status ${id}`;
}

function ResultSummary({ result }) {
  if (!result || !Array.isArray(result.summary) || result.summary.length === 0) {
    return null;
  }
  const dryRun = !!result.dryRun;

  return (
    <div className="result-block">
      {result.planName && (
        <div className="result-plan">
          Plan: <b>{result.planName}</b>
          {result.planId ? ` (#${result.planId})` : ''}
        </div>
      )}

      {result.summary.map((s, idx) => (
        <ResultEntry key={idx} entry={s} dryRun={dryRun} />
      ))}
    </div>
  );
}

function ResultEntry({ entry, dryRun }) {
  const skipped = Array.isArray(entry.skipped) ? entry.skipped : [];
  const unmatched = Array.isArray(entry.unmatched) ? entry.unmatched : [];

  if (entry.noMatchingRun) {
    return (
      <div className="result-card result-warn">
        <div className="result-headline">
          No matching TestRail run found for <b>{entry.section}</b>.
        </div>
        <div className="result-sub">
          {entry.rowCount} row(s) from the document could not be uploaded
          because there is no run named like &quot;{entry.section}&quot; in this
          plan. Try a different Plan ID or rename the run/section.
        </div>
      </div>
    );
  }

  return (
    <div className="result-card">
      <div className="result-headline">
        Run <b>{entry.runName || `#${entry.runId}`}</b>
        {entry.runId ? ` (#${entry.runId})` : ''}
      </div>

      <div className="stat-grid">
        <Stat label="Tests in run" value={entry.testsFound ?? 0} />
        <Stat
          label={dryRun ? 'Would send' : 'Sent'}
          value={dryRun ? Math.max(0, (entry.rowCount || 0) - skipped.length - unmatched.length) : entry.sent}
          tone="positive"
        />
        <Stat
          label="Already-resulted (skipped)"
          value={skipped.length}
          tone={skipped.length > 0 ? 'muted' : undefined}
        />
        <Stat
          label="Unmatched titles"
          value={unmatched.length}
          tone={unmatched.length > 0 ? 'warn' : undefined}
        />
      </div>

      {skipped.length > 0 && (
        <details className="details-block" open>
          <summary>
            Skipped because they already have a result ({skipped.length})
          </summary>
          <ul className="result-list">
            {skipped.map((s, i) => (
              <li key={i}>
                <span className="result-title">{s.title}</span>
                <span className={`pill ${STATUS_CLASS[s.currentStatusId] || ''}`}>
                  {statusLabel(s.currentStatusId)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {unmatched.length > 0 && (
        <details className="details-block">
          <summary>
            Titles in the document not found in the run ({unmatched.length})
          </summary>
          <ul className="result-list">
            {unmatched.map((t, i) => (
              <li key={i}>
                <span className="result-title">{t}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {skipped.length === 0 && unmatched.length === 0 && entry.sent > 0 && (
        <div className="result-sub">
          All test titles matched and were sent to TestRail.
        </div>
      )}
      {skipped.length === entry.rowCount && entry.rowCount > 0 && (
        <div className="result-sub">
          Nothing new was sent — every test in this run already has a result.
          Untick &quot;Skip if already resulted&quot; in the server config to
          overwrite them.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className={`stat-box ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

const STATE_META = {
  complete: { icon: '✓', label: 'Submitted', cls: 'state-complete' },
  partial:  { icon: '◐', label: 'Partial',   cls: 'state-partial'  },
  none:     { icon: '○', label: 'Not yet',   cls: 'state-none'     },
};

function FrameworkChecklist({ frameworks, statuses, planId, onSelect, selected, compact }) {
  if (!frameworks || frameworks.length === 0) return null;

  return (
    <div className={`checklist ${compact ? 'checklist-compact' : ''}`}>
      <div className="checklist-head">
        <div>Submission status {planId ? <span className="muted">· plan #{planId}</span> : null}</div>
        {!compact && (
          <div className="legend">
            <span className="legend-item state-complete">
              <span className="state-dot" /> Submitted
            </span>
            <span className="legend-item state-partial">
              <span className="state-dot" /> Partial
            </span>
            <span className="legend-item state-none">
              <span className="state-dot" /> Not yet
            </span>
          </div>
        )}
      </div>

      <ul className="checklist-list">
        {frameworks.map((f) => {
          const st = statuses[f.name];
          const state = st?.state || 'none';
          const meta = STATE_META[state] || STATE_META.none;
          const isSelectable = typeof f.count === 'number' && f.count > 0;
          return (
            <li
              key={f.name}
              className={`checklist-row ${meta.cls} ${selected === f.name ? 'is-selected' : ''} ${isSelectable ? '' : 'is-disabled'}`}
              onClick={() => isSelectable && onSelect && onSelect(f.name)}
              title={
                isSelectable
                  ? `Click to select ${f.name}`
                  : `${f.name} — parse a document containing this framework to select it`
              }
            >
              <span className="state-dot" aria-hidden="true">{meta.icon}</span>
              <span className="cl-name">{f.name}</span>
              <span className="cl-count">
                {typeof f.count === 'number' ? `${f.count} row(s)` : '—'}
              </span>
              {st ? (
                <span className="cl-detail">
                  {st.noMatchingRun
                    ? 'no matching run'
                    : `${(st.sent || 0) + (st.skipped || 0)}/${st.total} in TestRail` +
                      (st.unmatched ? ` · ${st.unmatched} missing` : '')}
                </span>
              ) : (
                <span className="cl-detail muted">not submitted</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
