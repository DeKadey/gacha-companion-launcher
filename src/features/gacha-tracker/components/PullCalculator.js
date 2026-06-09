import React, { useState, useCallback } from 'react';
import { Pencil } from 'lucide-react';
import { simulateCombined, pullsToCurrency } from '../engine/simulation';
import './PullCalculator.css';

const RUNS = 100_000;

function statsFromSorted(sorted) {
  const runs = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const pct = (p) => sorted[Math.min(Math.floor(runs * p), runs - 1)];
  return {
    average: Math.round(sum / runs),
    median: pct(0.5),
    p50: pct(0.5),
    p75: pct(0.75),
    p90: pct(0.9),
    p95: pct(0.95),
    p99: pct(0.99),
  };
}

export default function PullCalculator({ game, color }) {
  const { charBanner, weaponBanner, state } = game;
  const gameColor = color;

  const defaultCharLabel = game.charCopyLabel || 'Character';
  const defaultWeaponLabel = game.weaponCopyLabel || 'Weapon';

  const [charLabelLocal, setCharLabelLocal] = useState(defaultCharLabel);
  const [weaponLabelLocal, setWeaponLabelLocal] = useState(defaultWeaponLabel);
  const [editingCharLabel, setEditingCharLabel] = useState(false);
  const [editingWeaponLabel, setEditingWeaponLabel] = useState(false);
  const [charLabelDraft, setCharLabelDraft] = useState('');
  const [weaponLabelDraft, setWeaponLabelDraft] = useState('');

  const [charCopies, setCharCopies] = useState(0);
  const [weaponCopies, setWeaponCopies] = useState(0);
  const [useCurrentPity, setUseCurrentPity] = useState(false);
  const [charGuaranteed, setCharGuaranteed] = useState(false);
  const [weaponGuaranteed, setWeaponGuaranteed] = useState(false);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  const canRun = charCopies > 0 || weaponCopies > 0;

  function setCharCopiesAndClear(v) { setCharCopies(v); setResult(null); }
  function setWeaponCopiesAndClear(v) { setWeaponCopies(v); setResult(null); }

  function commitCharLabel() {
    if (charLabelDraft.trim()) setCharLabelLocal(charLabelDraft.trim());
    setEditingCharLabel(false);
  }
  function commitWeaponLabel() {
    if (weaponLabelDraft.trim()) setWeaponLabelLocal(weaponLabelDraft.trim());
    setEditingWeaponLabel(false);
  }

  const run = useCallback(() => {
    if (!canRun) return;
    setRunning(true);
    setResult(null);
    setTimeout(() => {
      const sorted = simulateCombined({
        charBanner,
        weaponBanner,
        charCopies,
        weaponCopies,
        startCharPity: useCurrentPity ? (state.charPity ?? 0) : 0,
        startCharGuaranteed: charGuaranteed,
        startWeaponPity: useCurrentPity ? (state.weaponPity ?? 0) : 0,
        startWeaponGuaranteed: weaponGuaranteed,
        runs: RUNS,
      });
      setResult(statsFromSorted(sorted));
      setRunning(false);
    }, 10);
  }, [charBanner, weaponBanner, charCopies, weaponCopies, useCurrentPity, charGuaranteed, weaponGuaranteed, state, canRun]);

  function resultDesc() {
    const parts = [];
    if (charCopies > 0) parts.push(`${charCopies} ${charLabelLocal} ${charCopies === 1 ? 'copy' : 'copies'}`);
    if (weaponCopies > 0) parts.push(`${weaponCopies} ${weaponLabelLocal} ${weaponCopies === 1 ? 'copy' : 'copies'}`);
    return `To get ${parts.join(' and ')}:`;
  }

  return (
    <div className="calculator">
      <div className="calc-panel">
        <h3 className="section-title">Configuration</h3>

        {/* Target */}
        <div className="calc-field">
          <label className="calc-label">Target</label>
          <div className="calc-target-grid">
            <div className="calc-target-col">
              {editingCharLabel ? (
                <input className="calc-target-label-input"
                  value={charLabelDraft}
                  onChange={e => setCharLabelDraft(e.target.value)}
                  onBlur={commitCharLabel}
                  onKeyDown={e => { if (e.key === 'Enter') commitCharLabel(); if (e.key === 'Escape') setEditingCharLabel(false); }}
                  autoFocus />
              ) : (
                <button className="calc-target-label-btn"
                  onClick={() => { setCharLabelDraft(charLabelLocal); setEditingCharLabel(true); }}>
                  {charLabelLocal} <Pencil size={10} className="calc-target-pencil" />
                </button>
              )}
              <CopiesInput value={charCopies} onChange={setCharCopiesAndClear} color={gameColor} />
            </div>
            <div className="calc-target-col">
              {editingWeaponLabel ? (
                <input className="calc-target-label-input"
                  value={weaponLabelDraft}
                  onChange={e => setWeaponLabelDraft(e.target.value)}
                  onBlur={commitWeaponLabel}
                  onKeyDown={e => { if (e.key === 'Enter') commitWeaponLabel(); if (e.key === 'Escape') setEditingWeaponLabel(false); }}
                  autoFocus />
              ) : (
                <button className="calc-target-label-btn"
                  onClick={() => { setWeaponLabelDraft(weaponLabelLocal); setEditingWeaponLabel(true); }}>
                  {weaponLabelLocal} <Pencil size={10} className="calc-target-pencil" />
                </button>
              )}
              <CopiesInput value={weaponCopies} onChange={setWeaponCopiesAndClear} color={gameColor} />
            </div>
          </div>
        </div>

        {/* Start from current pity */}
        <div className="calc-field">
          <label className="calc-label">Start from current pity?</label>
          <div className="calc-toggle-group">
            <button
              className={`calc-toggle-btn ${useCurrentPity ? 'calc-toggle-btn--active' : ''}`}
              style={useCurrentPity ? { color: gameColor, background: gameColor + '18' } : {}}
              onClick={() => setUseCurrentPity(true)}>Yes</button>
            <button
              className={`calc-toggle-btn ${!useCurrentPity ? 'calc-toggle-btn--active' : ''}`}
              style={!useCurrentPity ? { color: gameColor, background: gameColor + '18' } : {}}
              onClick={() => setUseCurrentPity(false)}>No (start fresh)</button>
          </div>
          {useCurrentPity && (
            <p className="calc-pity-hint">
              {charLabelLocal}: {state.charPity ?? 0} · {weaponLabelLocal}: {state.weaponPity ?? 0}
            </p>
          )}
        </div>

        {/* Guarantee status */}
        {(charBanner?.has5050 || weaponBanner?.has5050) && (
          <div className="calc-field">
            <label className="calc-label">Guarantee status</label>
            <div className="calc-guarantee-row">
              {charBanner?.has5050 && (
                <div className="calc-guarantee-item">
                  <span className="calc-guarantee-label">{charLabelLocal}</span>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={charGuaranteed} onChange={() => setCharGuaranteed(v => !v)} />
                    <span className="toggle-track" />
                  </label>
                </div>
              )}
              {weaponBanner?.has5050 && (
                <div className="calc-guarantee-item">
                  <span className="calc-guarantee-label">{weaponLabelLocal}</span>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={weaponGuaranteed} onChange={() => setWeaponGuaranteed(v => !v)} />
                    <span className="toggle-track" />
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        <button
          className="calc-run-btn"
          onClick={run}
          disabled={running || !canRun}
          style={{ background: gameColor }}
        >
          {running ? 'Simulating…' : 'Run simulation'}
        </button>
        <p className="calc-run-hint">Runs 100,000 simulated pulls for accuracy</p>
      </div>

      {result && (
        <div className="calc-results">
          <h3 className="section-title">Results</h3>
          <p className="calc-results-sub">{resultDesc()}</p>

          <div className="results-grid">
            <ResultCard label="Average pulls" value={result.average}
              sub={formatCurrency(result.average, charBanner)} color={gameColor} big />
            <ResultCard label="Median pulls" value={result.median}
              sub={formatCurrency(result.median, charBanner)} color={gameColor} big />
          </div>

          <div className="percentile-table">
            <h4 className="percentile-title">Probability thresholds</h4>
            <p className="percentile-hint">
              Within X pulls, Y% of players would have reached their goal.
            </p>
            {[
              { label: '50% of players', pulls: result.p50 },
              { label: '75% of players', pulls: result.p75 },
              { label: '90% of players', pulls: result.p90 },
              { label: '95% of players', pulls: result.p95 },
              { label: '99% of players', pulls: result.p99 },
            ].map(row => (
              <div key={row.label} className="percentile-row">
                <span className="percentile-label">{row.label}</span>
                <span className="percentile-pulls" style={{ color: gameColor }}>{row.pulls} pulls</span>
                <span className="percentile-cost">{formatCurrency(row.pulls, charBanner)}</span>
              </div>
            ))}
          </div>

          <p className="calc-disclaimer">
            Results are estimates from Monte Carlo simulation using your configured rates. Actual results depend on luck.
          </p>
        </div>
      )}
    </div>
  );
}

function CopiesInput({ value, onChange, color }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function startEdit() { setDraft(String(value)); setEditing(true); }
  function commitEdit() {
    const v = parseInt(draft, 10);
    if (!isNaN(v) && v >= 0) onChange(v);
    setEditing(false);
  }

  return (
    <div className="copies-input">
      <button className="copies-btn" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0}>−</button>
      {editing ? (
        <input className="copies-edit-input"
          type="number" min="0"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
          autoFocus />
      ) : (
        <span className="copies-value" onClick={startEdit} title="Click to edit"
          style={{ cursor: 'text', color: value > 0 ? color : undefined }}>{value}</span>
      )}
      <button className="copies-btn" onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

function ResultCard({ label, value, sub, color, big }) {
  return (
    <div className="result-card">
      <span className="result-label">{label}</span>
      <span className={`result-value ${big ? 'result-value--big' : ''}`} style={{ color }}>{value}</span>
      <span className="result-sub">{sub}</span>
    </div>
  );
}

function formatCurrency(pulls, banner) {
  if (!banner) return '';
  return `${pullsToCurrency(pulls, banner.costPerPull).toLocaleString()} ${banner.currencyName}`;
}
