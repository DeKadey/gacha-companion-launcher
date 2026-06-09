import React, { useState, useRef, useEffect } from 'react';
import { Pencil } from 'lucide-react';
import PullCalculator from './PullCalculator';
import HistoryTab from './HistoryTab';
import WishListTab from './WishListTab';
import { useAccent } from '../../../shared/contexts/AccentContext';
import { useTheme } from '../../../shared/contexts/ThemeContext';
import { useT } from '../../../shared/i18n';
import { clampColorForTheme } from '../../../shared/utils/color';
import { getToday } from '../../../shared/utils/dateHelpers';
import './GameDashboard.css';
import { ScrollArea } from '../../../shared/components/ScrollArea';

function resolveColor(game, accentColor, activeTheme) {
  const raw = game.usesAppColor ? accentColor : game.color;
  return clampColorForTheme(raw, activeTheme === 'dark');
}

export function getCurrency(state) {
  return state.currency ?? state.currentCurrency ?? 0;
}

function getTotal(currency, pullItems, costPerPull) {
  return currency + pullItems * costPerPull;
}

function withTodayEntry(history, defaultTotal) {
  const today = getToday();
  if (history.length > 0 && history[history.length - 1].date === today) return history;
  const lastTotal = history.length > 0 ? history[history.length - 1].total : (defaultTotal ?? 0);
  return [...history, { date: today, income: 0, pulls: 0, total: lastTotal }];
}

function setTodayTotal(history, total) {
  const today = getToday();
  const h = withTodayEntry(history, total);
  return h.map(e => e.date === today ? { ...e, total } : e);
}

function incrementTodayField(history, field, delta, total) {
  const today = getToday();
  const h = withTodayEntry(history, total);
  return h.map(e => e.date === today ? { ...e, [field]: (e[field] ?? 0) + delta, total } : e);
}

export default function GameDashboard({ game, onUpdate, onOpenSettings, bannerPanelWidths, bannerSchedule }) {
  const t = useT();
  const accentColor = useAccent();
  const activeTheme = useTheme();
  const [tab, setTab] = useState('status');

  // ── Settings hint animation (pulsating border on the Game Settings button) ──
  // Triggered when user hovers over a missing-file indicator in HistoryTab.
  const hintBorderRef  = useRef(null);
  const hintTimerRef   = useRef(null);
  const hintPhaseRef   = useRef('idle');   // 'idle' | 'waiting' | 'active' | 'fading'
  const hintCountRef   = useRef(0);        // number of concurrent hover sources

  function startHintAnimation() {
    const el = hintBorderRef.current;
    if (!el) return;
    // Cancel any in-progress fade-out, reset to clean state
    clearTimeout(hintTimerRef.current);
    el.style.transition = '';
    el.style.opacity    = '';
    el.classList.remove('active');

    hintPhaseRef.current = 'waiting';
    hintTimerRef.current = setTimeout(() => {
      if (hintPhaseRef.current !== 'waiting') return;
      hintPhaseRef.current = 'active';
      if (hintBorderRef.current) hintBorderRef.current.classList.add('active');
    }, 500);
  }

  function stopHintAnimation() {
    clearTimeout(hintTimerRef.current);
    const el = hintBorderRef.current;
    if (!el) { hintPhaseRef.current = 'idle'; return; }

    if (hintPhaseRef.current === 'active') {
      // Capture the current animated opacity and start a 0.3s fade to zero
      const curOpacity = parseFloat(getComputedStyle(el).opacity) || 0;
      el.classList.remove('active');
      el.style.opacity    = String(curOpacity);
      el.getBoundingClientRect(); // force reflow so the transition starts from curOpacity
      el.style.transition = 'opacity 0.3s ease-out';
      el.style.opacity    = '0';
      hintPhaseRef.current = 'fading';
      hintTimerRef.current = setTimeout(() => {
        if (hintPhaseRef.current === 'fading' && hintBorderRef.current) {
          hintBorderRef.current.style.transition = '';
          hintBorderRef.current.style.opacity    = '';
          hintPhaseRef.current = 'idle';
        }
      }, 350);
    } else {
      hintPhaseRef.current = 'idle';
    }
  }

  // When the import state changes (e.g. Excel is uploaded and disabled banner cards
  // are removed from the DOM), mouseLeave events won't fire for the removed elements,
  // leaving hintCountRef stuck at > 0. Reset everything when the flags change.
  useEffect(() => {
    hintCountRef.current = 0;
    clearTimeout(hintTimerRef.current);
    const el = hintBorderRef.current;
    if (el) {
      el.classList.remove('active');
      el.style.transition = '';
      el.style.opacity    = '';
    }
    hintPhaseRef.current = 'idle';
  }, [game.state.excelImported, game.state.jsonImported]);

  // Multiple banner cards can each trigger enter/leave — track count to avoid
  // stopping the animation prematurely when moving between cards.
  function onSettingsHintEnter() {
    hintCountRef.current++;
    if (hintCountRef.current === 1) startHintAnimation();
  }

  function onSettingsHintLeave() {
    hintCountRef.current = Math.max(0, hintCountRef.current - 1);
    if (hintCountRef.current === 0) stopHintAnimation();
  }
  const { state, charBanner, weaponBanner } = game;
  const color = resolveColor(game, accentColor, activeTheme);
  const costPerPull = charBanner.costPerPull;

  const currency = getCurrency(state);
  const pullItems = state.pullItems ?? 0;
  const total = getTotal(currency, pullItems, costPerPull);
  const totalPulls = Math.floor(total / costPerPull);

  function addIncome(amount) {
    const newCurrency = Math.max(0, currency + amount);
    const newTotal = getTotal(newCurrency, pullItems, costPerPull);
    const history = incrementTodayField(state.history ?? [], 'income', amount, newTotal);
    onUpdate({ ...game, state: { ...state, currency: newCurrency, history } });
  }

  function addPullItems(count) {
    const newPullItems = Math.max(0, pullItems + count);
    const newTotal = getTotal(currency, newPullItems, costPerPull);
    const history = incrementTodayField(state.history ?? [], 'pulls', count, newTotal);
    onUpdate({ ...game, state: { ...state, pullItems: newPullItems, history } });
  }

  function setCurrencyDirect(value) {
    const newCurrency = Math.max(0, value);
    const newTotal = getTotal(newCurrency, pullItems, costPerPull);
    const history = setTodayTotal(state.history ?? [], newTotal);
    onUpdate({ ...game, state: { ...state, currency: newCurrency, history } });
  }

  function setPullItemsDirect(value) {
    const newPullItems = Math.max(0, value);
    const newTotal = getTotal(currency, newPullItems, costPerPull);
    const history = setTodayTotal(state.history ?? [], newTotal);
    onUpdate({ ...game, state: { ...state, pullItems: newPullItems, history } });
  }

  const TABS = [
    ['status', t('Status')],
    ['history', t('History')],
    ['wishlist', t('Wish List')],
    ['calculator', t('Calculator')],
  ];

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div className="dashboard-title-row">
          <div className="dashboard-icon" style={{ background: game.iconPath ? 'transparent' : color }}>
            {game.iconPath
              ? <img src={game.iconPath} alt={game.name} className="dashboard-icon-img" />
              : game.name[0]?.toUpperCase()
            }
          </div>
          <h1 className="dashboard-title">{game.name}</h1>
          <button className="dashboard-settings-btn" onClick={onOpenSettings} title="Game Settings">
            {/* Pulsating hint border — shown when a file import is needed */}
            <span ref={hintBorderRef} className="dashboard-settings-hint-border" />
            <Pencil size={15} />
            <span className="dashboard-settings-label">Game Settings</span>
          </button>
        </div>
        <div className="dashboard-tabs" style={{ borderBottomColor: color + '44' }}>
          {TABS.map(([key, label]) => (
            <button key={key}
              className={`dashboard-tab ${tab === key ? 'dashboard-tab--active' : ''}`}
              style={tab === key ? { borderBottomColor: color, color } : {}}
              onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea style={{ flex: 1, minHeight: 0 }} viewportClassName="dashboard-content">
        {tab === 'status' && (
          <StatusTab
            game={game} charBanner={charBanner}
            currency={currency} pullItems={pullItems} total={total} totalPulls={totalPulls}
            color={color} costPerPull={costPerPull}
            onAddIncome={addIncome}
            onAddPullItems={addPullItems}
            onSetCurrency={setCurrencyDirect}
            onSetPullItems={setPullItemsDirect}
          />
        )}
        <div style={{ display: tab !== 'history' ? 'none' : 'contents' }}>
          <HistoryTab
            game={game}
            onUpdate={onUpdate}
            color={color}
            bannerPanelWidths={bannerPanelWidths}
            prefetchedSchedule={bannerSchedule}
            onSettingsHintEnter={onSettingsHintEnter}
            onSettingsHintLeave={onSettingsHintLeave}
          />
        </div>
        {tab === 'wishlist' && (
          <WishListTab game={game} onUpdate={onUpdate} color={color} />
        )}
        {tab === 'calculator' && <PullCalculator game={game} color={color} />}
      </ScrollArea>
    </div>
  );
}

function StatusTab({ game, charBanner, currency, pullItems, total, totalPulls, color, costPerPull, onAddIncome, onAddPullItems, onSetCurrency, onSetPullItems }) {
  const t = useT();
  return (
    <div className="status-tab">
      <div className="status-section">
        <p className="section-title">{t('Current Resources')}</p>
        <div className="resources-grid">
          <ResourceCard
            label={charBanner.currencyName || t('Pull Currency')}
            value={currency}
            sub={`${Math.floor(currency / costPerPull)} ${t('pulls')}`}
            color={color}
            onSet={onSetCurrency}
          />
          <ResourceCard
            label={game.pullItemName || t('Pull Items')}
            value={pullItems}
            sub={`${pullItems} ${t('pulls')}`}
            color={color}
            onSet={onSetPullItems}
            isInt
          />
        </div>
        <div className="total-bar">
          <div className="total-bar-item">
            <span className="total-bar-label">{t('Total')} {charBanner.currencyName || t('Pull Currency')}</span>
            <span className="total-bar-value" style={{ color }}>{currency.toLocaleString()}</span>
          </div>
          <div className="total-bar-sep" />
          <div className="total-bar-item total-bar-item--center">
            <span className="total-bar-label">{t('Total')} {game.pullItemName || t('Pull Items')}</span>
            <span className="total-bar-value" style={{ color }}>{pullItems.toLocaleString()}</span>
          </div>
          <div className="total-bar-sep" />
          <div className="total-bar-item total-bar-item--right">
            <span className="total-bar-label">{t('Total pulls')}</span>
            <span className="total-bar-value" style={{ color }}>{totalPulls.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="status-section">
        <p className="section-title">{t('Add Income')}</p>
        <div className="income-panel">
          <IncomeRow
            label={charBanner.currencyName || t('Pull Currency')}
            color={color}
            onAdd={onAddIncome}
          />
          <div className="income-panel-sep" />
          <PullItemsStepper
            label={game.pullItemName || t('Pull Items')}
            value={pullItems}
            color={color}
            onStep={onAddPullItems}
          />
        </div>
      </div>
    </div>
  );
}

function ResourceCard({ label, value, sub, color, onSet, isInt }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function startEdit() { setDraft(String(value)); setEditing(true); }
  function commitEdit() {
    const v = isInt ? parseInt(draft, 10) : Number(draft);
    if (!isNaN(v)) onSet(v);
    setEditing(false);
  }

  return (
    <div className="resource-card">
      <div className="resource-card-top">
        <span className="stat-label">{label}</span>
        <button className="resource-edit-btn" onClick={startEdit} title="Edit directly">
          <Pencil size={12} />
        </button>
      </div>
      {editing ? (
        <input className="stat-edit-input resource-edit-input" value={draft}
          onChange={e => setDraft(e.target.value)} onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
          autoFocus />
      ) : (
        <span className="stat-value resource-value" style={{ color }}>{value.toLocaleString()}</span>
      )}
      <span className="stat-sub">{sub}</span>
    </div>
  );
}

function PullItemsStepper({ label, value, color, onStep }) {
  return (
    <div className="pull-stepper">
      <span className="pull-stepper-label">{label}</span>
      <div className="pull-stepper-btns">
        <button className="pull-stepper-btn" onClick={() => onStep(-1)} disabled={value <= 0}>−</button>
        <button className="pull-stepper-btn" onClick={() => onStep(1)} style={{ color }}>+</button>
      </div>
    </div>
  );
}

function IncomeRow({ label, color, onAdd, isInt }) {
  const [draft, setDraft] = useState('');
  const parsed = isInt ? parseInt(draft, 10) : Number(draft);
  const canAdd = draft !== '' && draft !== '-' && !isNaN(parsed) && parsed !== 0;

  function commit() {
    if (canAdd) { onAdd(parsed); setDraft(''); }
  }

  return (
    <div className="income-row">
      <span className="income-row-label">{label}</span>
      <input
        className="income-row-input"
        type="number"
        placeholder="0"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); }}
      />
      <button
        className="income-row-btn"
        style={{ background: color }}
        onClick={commit}
        disabled={!canAdd}
      >
        Add
      </button>
    </div>
  );
}
