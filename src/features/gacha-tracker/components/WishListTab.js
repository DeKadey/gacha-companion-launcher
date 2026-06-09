import React, { useState, useEffect, useRef } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { simulateCombined, pullsAtProbability } from '../engine/simulation';
import ConfirmDialog from '../../../shared/components/ConfirmDialog';
import { useT } from '../../../shared/i18n';
import './WishListTab.css';

const PROB_SNAPS = [0, 0.15, 0.25, 0.50, 0.75, 0.99, 1.00];
const PROB_LABELS = ['0%', '15%', '25%', '50%', '75%', '99%', '100%'];
const RUNS = 50_000;

function totalPullsFromGame(game) {
  const currency = game.state.currency ?? game.state.currentCurrency ?? 0;
  const pullItems = game.state.pullItems ?? 0;
  const costPerPull = game.charBanner.costPerPull;
  return Math.floor(currency / costPerPull) + pullItems;
}

export default function WishListTab({ game, onUpdate, color }) {
  const t = useT();
  const { state, charBanner, weaponBanner } = game;
  const chronicledBanner = game.chronicledBanner ?? { softPity: 74, hardPity: 90, has5050: true };
  const wishList = state.wishList ?? [];
  const totalPulls = totalPullsFromGame(game);

  const [confirmRemoveId, setConfirmRemoveId] = useState(null);
  const confirmEntry = wishList.find(e => e.id === confirmRemoveId);

  function updateState(patch) {
    onUpdate({ ...game, state: { ...state, ...patch } });
  }

  // --- Editable copy labels ---
  const [editingCharLabel, setEditingCharLabel] = useState(false);
  const [editingWeaponLabel, setEditingWeaponLabel] = useState(false);
  const [charLabelDraft, setCharLabelDraft] = useState('');
  const [weaponLabelDraft, setWeaponLabelDraft] = useState('');

  function startEditCharLabel() { setCharLabelDraft(game.charCopyLabel || 'Character'); setEditingCharLabel(true); }
  function commitCharLabel() {
    if (charLabelDraft.trim()) onUpdate({ ...game, charCopyLabel: charLabelDraft.trim() });
    setEditingCharLabel(false);
  }
  function startEditWeaponLabel() { setWeaponLabelDraft(game.weaponCopyLabel || 'Weapon'); setEditingWeaponLabel(true); }
  function commitWeaponLabel() {
    if (weaponLabelDraft.trim()) onUpdate({ ...game, weaponCopyLabel: weaponLabelDraft.trim() });
    setEditingWeaponLabel(false);
  }

  function updateWishList(newList) {
    onUpdate({ ...game, state: { ...state, wishList: newList } });
  }

  function addEntry() {
    updateWishList([...wishList, {
      id: crypto.randomUUID(),
      label: '',
      charCopies: 0,
      weaponCopies: 0,
      probability: 0.50,
    }]);
  }

  function confirmRemove(id) { setConfirmRemoveId(id); }
  function doRemove() {
    updateWishList(wishList.filter(e => e.id !== confirmRemoveId));
    setConfirmRemoveId(null);
  }

  function patchEntry(id, patch) {
    updateWishList(wishList.map(e => e.id === id ? { ...e, ...patch } : e));
  }

  const charLabel = game.charCopyLabel || 'Character';
  const weaponLabel = game.weaponCopyLabel || 'Weapon';

  return (
    <div className="wishlist-tab">

      {/* Banner pity sections */}
      <div className="wl-banner-section">
        <p className="section-title">{t('Character Banner')}</p>
        <div className="pity-row">
          <PityCard label={t('Pity')} value={state.charPity} max={charBanner.hardPity} color={color}
            onEdit={v => updateState({ charPity: Math.min(charBanner.hardPity - 1, Math.max(0, v)) })} />
          {charBanner.has5050 && (
            <GuaranteeCard value={state.charGuaranteed}
              onToggle={() => updateState({ charGuaranteed: !state.charGuaranteed })} />
          )}
        </div>
        <PityBar current={state.charPity} soft={charBanner.softPity} hard={charBanner.hardPity} color={color} />
      </div>

      {weaponBanner && (
        <div className="wl-banner-section">
          <p className="section-title">{t('Weapon / LC Banner')}</p>
          <div className="pity-row">
            <PityCard label={t('Pity')} value={state.weaponPity} max={weaponBanner.hardPity} color={color}
              onEdit={v => updateState({ weaponPity: Math.min(weaponBanner.hardPity - 1, Math.max(0, v)) })} />
            {weaponBanner.has5050 && (
              <GuaranteeCard value={state.weaponGuaranteed}
                onToggle={() => updateState({ weaponGuaranteed: !state.weaponGuaranteed })} />
            )}
            {weaponBanner.specialMechanicId !== 'none' && (
              <StatCard label={t('Fate Points')} value={state.fatePoints}
                sub={`/ ${weaponBanner.specialMechanicConfig?.fatePointsNeeded ?? 1}`}
                color={color} editable compact
                onEdit={v => updateState({ fatePoints: Math.max(0, Number(v)) })} />
            )}
          </div>
          <PityBar current={state.weaponPity} soft={weaponBanner.softPity} hard={weaponBanner.hardPity} color={color} />
        </div>
      )}

      {game.linkedDatabase === 'genshin' && (
        <div className="wl-banner-section">
          <p className="section-title">{t('Chronicled Wish')}</p>
          <div className="pity-row">
            <PityCard label={t('Pity')} value={state.chronicledPity ?? 0} max={chronicledBanner.hardPity} color={color}
              onEdit={v => updateState({ chronicledPity: Math.min(chronicledBanner.hardPity - 1, Math.max(0, v)) })} />
            {chronicledBanner.has5050 && (
              <GuaranteeCard value={state.chronicledGuaranteed ?? false}
                onToggle={() => updateState({ chronicledGuaranteed: !(state.chronicledGuaranteed ?? false) })} />
            )}
          </div>
          <PityBar current={state.chronicledPity ?? 0} soft={chronicledBanner.softPity} hard={chronicledBanner.hardPity} color={color} />
        </div>
      )}

      {/* Labels bar + Add goal (right-aligned) */}
      <div className="wishlist-labels-bar">
        <div className="wishlist-labels-group">
          <span className="wishlist-labels-hint">{t('Labels')}</span>
          <EditableLabel
            value={charLabel}
            editing={editingCharLabel}
            draft={charLabelDraft}
            onStartEdit={startEditCharLabel}
            onChangeDraft={setCharLabelDraft}
            onCommit={commitCharLabel}
            onCancel={() => setEditingCharLabel(false)}
          />
          <span className="wishlist-labels-sep">·</span>
          <EditableLabel
            value={weaponLabel}
            editing={editingWeaponLabel}
            draft={weaponLabelDraft}
            onStartEdit={startEditWeaponLabel}
            onChangeDraft={setWeaponLabelDraft}
            onCommit={commitWeaponLabel}
            onCancel={() => setEditingWeaponLabel(false)}
          />
        </div>
        <button className="wishlist-add-btn" onClick={addEntry}>
          <Plus size={14} /> {t('Add goal')}
        </button>
      </div>

      {/* Column header */}
      {wishList.length > 0 && (
        <div className="wishlist-header-row">
          <div className="wishlist-col-label">{t('Goal')}</div>
          <div className="wishlist-col-copies">{charLabel}</div>
          <div className="wishlist-col-copies">{weaponLabel}</div>
          <div className="wishlist-col-prob-snap">{t('Probability')}</div>
          <div className="wishlist-col-pulls">{t('Pulls Needed')}</div>
          <div className="wishlist-col-pulls">{t('Pulls Left')}</div>
          <div className="wishlist-col-del" />
        </div>
      )}

      {/* Entries */}
      <div className="wishlist-entries">
        {wishList.map(entry => (
          <WishListEntry
            key={entry.id}
            entry={entry}
            game={game}
            charLabel={charLabel}
            weaponLabel={weaponLabel}
            totalPulls={totalPulls}
            color={color}
            onPatch={patch => patchEntry(entry.id, patch)}
            onRemove={() => confirmRemove(entry.id)}
          />
        ))}
      </div>

      {confirmEntry && (
        <ConfirmDialog
          title={t('Remove goal?')}
          message={`"${confirmEntry.label || t('Unnamed')}" ${t('will be removed from your wish list.')}`}
          confirmLabel={t('Remove')} danger
          onConfirm={doRemove}
          onCancel={() => setConfirmRemoveId(null)}
        />
      )}
    </div>
  );
}

function EditableLabel({ value, editing, draft, onStartEdit, onChangeDraft, onCommit, onCancel }) {
  const inputRef = useRef();
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  if (editing) {
    return (
      <input ref={inputRef} className="wishlist-label-input" value={draft}
        onChange={e => onChangeDraft(e.target.value)}
        onBlur={onCommit}
        onKeyDown={e => { if (e.key === 'Enter') onCommit(); if (e.key === 'Escape') onCancel(); }} />
    );
  }
  return (
    <button className="wishlist-label-btn" onClick={onStartEdit}>
      {value}
      <Pencil size={11} className="wishlist-label-pencil" />
    </button>
  );
}

function WishListEntry({ entry, game, totalPulls, color, onPatch, onRemove }) {
  const t = useT();
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(entry.label || '');
  const [sortedResults, setSortedResults] = useState(null);
  const [calculating, setCalculating] = useState(false);

  const probability = entry.probability ?? 0.50;
  const probIdx = PROB_SNAPS.indexOf(probability);
  const safeProbIdx = probIdx === -1 ? 3 : probIdx;

  useEffect(() => {
    if (entry.charCopies === 0 && entry.weaponCopies === 0) { setSortedResults(null); return; }
    setCalculating(true);
    const id = setTimeout(() => {
      try {
        setSortedResults(simulateCombined({
          charBanner: game.charBanner,
          weaponBanner: game.weaponBanner,
          charCopies: entry.charCopies,
          weaponCopies: entry.weaponCopies,
          startCharPity: game.state.charPity ?? 0,
          startCharGuaranteed: game.state.charGuaranteed ?? false,
          startWeaponPity: game.state.weaponPity ?? 0,
          startWeaponGuaranteed: game.state.weaponGuaranteed ?? false,
          runs: RUNS,
        }));
      } catch { setSortedResults(null); }
      setCalculating(false);
    }, 0);
    return () => clearTimeout(id);
  }, [ // eslint-disable-line
    entry.charCopies, entry.weaponCopies,
    game.charBanner, game.weaponBanner,
    game.state.charPity, game.state.charGuaranteed,
    game.state.weaponPity, game.state.weaponGuaranteed,
  ]);

  const pullsNeeded = sortedResults ? pullsAtProbability(sortedResults, probability) : null;
  const pullsLeft = pullsNeeded !== null ? Math.max(0, totalPulls - pullsNeeded) : null;

  function commitLabel() {
    if (labelDraft.trim()) onPatch({ label: labelDraft.trim() });
    setEditingLabel(false);
  }

  return (
    <div className="wishlist-entry">
      <div className="wishlist-col-label">
        {editingLabel ? (
          <input className="wishlist-entry-label-input" placeholder={t('Goal name…')}
            value={labelDraft} onChange={e => setLabelDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={e => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') setEditingLabel(false); }}
            autoFocus />
        ) : (
          <button className="wishlist-entry-label-btn"
            onClick={() => { setLabelDraft(entry.label); setEditingLabel(true); }}>
            {entry.label || <span className="wishlist-entry-label-empty">{t('Unnamed')}</span>}
          </button>
        )}
      </div>

      <div className="wishlist-col-copies">
        <CopiesInput value={entry.charCopies} onChange={v => onPatch({ charCopies: v })} color={color} />
      </div>

      <div className="wishlist-col-copies">
        <CopiesInput value={entry.weaponCopies} onChange={v => onPatch({ weaponCopies: v })} color={color} />
      </div>

      <div className="wishlist-col-prob-snap">
        <ProbSnapper idx={safeProbIdx} onChange={i => onPatch({ probability: PROB_SNAPS[i] })} color={color} />
      </div>

      <div className="wishlist-col-pulls">
        {calculating ? <span className="wishlist-calculating">…</span>
          : pullsNeeded !== null ? <span className="wishlist-pulls-value" style={{ color }}>{pullsNeeded}</span>
          : <span className="wishlist-pulls-empty">—</span>}
      </div>

      <div className="wishlist-col-pulls">
        {calculating ? <span className="wishlist-calculating">…</span>
          : pullsLeft !== null
            ? <span className={`wishlist-pulls-value ${pullsLeft === 0 ? 'wishlist-pulls-zero' : ''}`}
                style={pullsLeft > 0 ? { color } : {}}>{pullsLeft}</span>
            : <span className="wishlist-pulls-empty">—</span>}
      </div>

      <div className="wishlist-col-del">
        <button className="wishlist-del-btn" onClick={onRemove} title={t('Remove')}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function ProbSnapper({ idx, onChange, color }) {
  return (
    <div className="prob-snapper">
      <input className="prob-snapper-range" type="range"
        min="0" max={PROB_SNAPS.length - 1} step="1" value={idx}
        onChange={e => onChange(Number(e.target.value))}
        style={{ '--snapper-color': color }} />
      <span className="prob-snapper-label">{PROB_LABELS[idx]}</span>
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
    <div className="copies-input-wrap">
      <button className="copies-adj-btn" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0}>−</button>
      {editing ? (
        <input
          className="copies-edit-inline"
          type="number" min="0"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
          autoFocus
        />
      ) : (
        <span
          className="copies-value"
          style={{ cursor: 'text', ...(value > 0 ? { color } : {}) }}
          onClick={startEdit}
          title="Click to edit"
        >{value}</span>
      )}
      <button className="copies-adj-btn" onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

// ── Pity sub-components (used by banner sections) ──────────────────────────────

function PityCard({ label, value, max, color, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function startEdit() { setDraft(String(value)); setEditing(true); }
  function commitEdit() { onEdit(Math.min(max - 1, Math.max(0, Number(draft)))); setEditing(false); }
  function adjust(delta) { onEdit(Math.min(max - 1, Math.max(0, value + delta))); }

  return (
    <div className="pity-card">
      <div className="pity-card-left" onClick={editing ? undefined : startEdit}>
        <span className="stat-label">{label}</span>
        {editing ? (
          <input className="stat-edit-input" value={draft}
            onChange={e => setDraft(e.target.value)} onBlur={commitEdit}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
            autoFocus onClick={e => e.stopPropagation()} />
        ) : (
          <span className="stat-value" style={{ color }}>{value}</span>
        )}
        <span className="stat-sub">/ {max}</span>
        {!editing && <span className="stat-edit-hint">click to edit</span>}
      </div>
      <div className="pity-card-divider" />
      <div className="pity-card-controls">
        <button className="pity-adj-btn" onClick={() => adjust(1)} disabled={value >= max - 1}>+</button>
        <button className="pity-adj-btn" onClick={() => adjust(-1)} disabled={value <= 0}>−</button>
      </div>
    </div>
  );
}

function GuaranteeCard({ value, onToggle }) {
  return (
    <div className="pity-card guarantee-card">
      <div className="pity-card-left">
        <span className="stat-label">Guarantee</span>
        <span className="stat-value" style={{ color: value ? '#4ecb8d' : 'var(--text-muted)' }}>
          {value ? 'Yes' : 'No'}
        </span>
        <span className="stat-sub">{value ? 'Next is featured' : 'No guarantee'}</span>
      </div>
      <div className="pity-card-divider" />
      <div className="guarantee-toggle-wrap">
        <label className="toggle-switch">
          <input type="checkbox" checked={value} onChange={onToggle} />
          <span className="toggle-track" />
        </label>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color, editable, onEdit, compact }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function startEdit() { setDraft(String(value)); setEditing(true); }
  function commitEdit() { onEdit(draft); setEditing(false); }

  return (
    <div className={`stat-card ${compact ? 'stat-card--compact' : ''} ${editable ? 'stat-card--clickable' : ''}`}
      style={{ borderColor: color + '33' }} onClick={editable ? startEdit : undefined}>
      <span className="stat-label">{label}</span>
      {editing ? (
        <input className="stat-edit-input" value={draft}
          onChange={e => setDraft(e.target.value)} onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
          autoFocus onClick={e => e.stopPropagation()} />
      ) : (
        <span className="stat-value" style={{ color }}>{value}</span>
      )}
      <span className="stat-sub">{sub}</span>
      {editable && !editing && <span className="stat-edit-hint">click to edit</span>}
    </div>
  );
}

function PityBar({ current, soft, hard, color }) {
  const pct = Math.min((current / hard) * 100, 100);
  const softPct = (soft / hard) * 100;
  return (
    <div className="pity-bar-wrap">
      <div className="pity-bar-track">
        <div className="pity-bar-fill"
          style={{ width: `${pct}%`, background: current >= soft ? '#f0a854' : color }} />
        <div className="pity-bar-soft-marker" style={{ left: `${softPct}%` }} />
      </div>
      <div className="pity-bar-labels">
        <span>0</span>
        <span style={{ color: '#f0a854' }}>soft {soft}</span>
        <span>{hard}</span>
      </div>
    </div>
  );
}
