import React, { useEffect, useRef, useState } from 'react';
import { X, Upload, Trash2, Download, RefreshCw, XCircle } from 'lucide-react';
import { DATABASES, DATABASE_FEATURES } from './GameFormSteps';
import { replaceBannerPulls, preserveNewerApiPulls, recomputeRolls } from '../engine/pullUtils';
import { parseZzzRngMoe, ZZZ_ALL_BANNERS } from '../games/zzz/zzzImport';
import { parseUid } from '../engine/uidUtils';
import ConfirmDialog from '../../../shared/components/ConfirmDialog';
import { useT } from '../../../shared/i18n';
import './GameSettingsModal.css';
import { ScrollArea } from '../../../shared/components/ScrollArea';

const ACCEPTED_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'mp4'];
const ACCEPT_ATTR = ACCEPTED_EXTS.map(e => `.${e}`).join(',');

export default function GameSettingsModal({
  game, bgUrl, onUpload, onRemove, onUpdate, onUpdateMany, onClose,
  activeGames,
  syncState, onStartSync, onCancelSync, formatSyncTime,
  onUidChange,
}) {
  const t = useT();
  const [dragging, setDragging] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  // Defer bg-preview image mount until after slide-in completes.
  // Mounting a data-URL <img> during the animation triggers a main-thread decode
  // that causes a repaint mid-slide. We render a placeholder instead and swap
  // in the real media once the panel has settled.
  const [panelSettled, setPanelSettled] = useState(false);
  const [linkedDatabase, setLinkedDatabase] = useState(game.linkedDatabase ?? null);
  const [enabledFeatures, setEnabledFeatures] = useState(game.enabledFeatures ?? {});
  // Import status for the pull history section
  const [importStatus, setImportStatus] = useState(null); // { type, message }
  const [confirmClear, setConfirmClear] = useState(false);
  const [uid, setUid] = useState(game.uid ?? '');
  const [uidInput, setUidInput] = useState(game.uid ?? '');
  const [uidEditing, setUidEditing] = useState(!game.uid);
  const [confirmUidOverwrite, setConfirmUidOverwrite] = useState(false);
  const [pendingUid, setPendingUid] = useState(null);
  const [uidError, setUidError] = useState(null);

  useEffect(() => {
    setUid(game.uid ?? '');
    setUidInput(game.uid ?? '');
    setUidEditing(!game.uid);
  }, [game.uid]);
  // Pending mismatch confirmation: { jsonResult, excelResult } or null
  const [mismatchPending, setMismatchPending] = useState(null);
  // Pending database conflict: { newDbId, conflictGame } or null
  const [conflictPending, setConflictPending] = useState(null);
  const importInputRef = useRef();
  const hsrImportRef   = useRef();
  const zzzImportRef   = useRef();

  // Derive import status from the stored pull log rather than session flags.
  // hasBannerData: Excel was imported (pulls carry bannerName).
  // has5050Data:   JSON was imported (5-star pulls carry won5050).
  // Both remain true after a game sync because existing pulls keep their enriched fields.
  const pullLog      = game.state.pullLog ?? [];
  const hasBannerData = pullLog.some(p => p.bannerName != null);
  const has5050Data   = pullLog.some(p => p.rarity === 5 && p.won5050 != null);

  const progressColor = game.usesAppColor
    ? 'var(--accent)'
    : (game.color ?? 'var(--accent)');

  function handleDatabaseChange(dbId) {
    const next = dbId || null;
    if (next) {
      // Only block if the conflicting game has no UID — a UID-linked game can share a database
      const conflict = (activeGames ?? []).find(
        g => g.id !== game.id && g.linkedDatabase === next && !g.uid
      );
      if (conflict) {
        setConflictPending({ newDbId: next, conflictGame: conflict });
        return;
      }
    }
    applyDatabaseChange(next);
  }

  function applyDatabaseChange(next) {
    setLinkedDatabase(next);
    setEnabledFeatures({});
    onUpdate({ ...game, linkedDatabase: next, enabledFeatures: {} });
  }

  function confirmConflict() {
    const { newDbId, conflictGame } = conflictPending;
    setConflictPending(null);
    setLinkedDatabase(newDbId);
    setEnabledFeatures({});
    // Unlink the other game and link this one atomically
    onUpdateMany([
      { ...conflictGame, linkedDatabase: null, enabledFeatures: {} },
      { ...game,         linkedDatabase: newDbId, enabledFeatures: {} },
    ]);
  }

  async function handleUidSave() {
    const trimmed = uidInput.trim();
    if (!trimmed) return;
    const db = game.linkedDatabase;
    if (db) {
      const { valid, error } = parseUid(trimmed, db);
      if (!valid) {
        setUidError(error ?? 'Invalid UID.');
        return;
      }
    }
    setUidError(null);
    const exists = db ? await window.api?.uidExists(db, trimmed) : false;
    if (exists) {
      setPendingUid(trimmed);
      setConfirmUidOverwrite(true);
    } else {
      applyUidChange(trimmed);
    }
  }

  function applyUidChange(newUid) {
    setUid(newUid);
    setUidEditing(false);
    setPendingUid(null);
    setConfirmUidOverwrite(false);
    setUidError(null);
    onUidChange?.(game, newUid);
  }

  function handleUidEdit() {
    setUidInput(uid);
    setUidEditing(true);
    setUidError(null);
  }

  function cancelConflict() {
    setConflictPending(null);
    // The <select> reverts because linkedDatabase state was never changed
  }

  function handleClearHistory() {
    onUpdate({
      ...game,
      state: {
        ...game.state,
        pullLog:              [],
        charPity:             0,
        charGuaranteed:       false,
        weaponPity:           0,
        weaponGuaranteed:     false,
        chronicledPity:       0,
        chronicledGuaranteed: false,
      },
    });
    setConfirmClear(false);
  }

  function handleFeatureToggle(featureId) {
    const next = { ...enabledFeatures, [featureId]: !enabledFeatures[featureId] };
    setEnabledFeatures(next);
    onUpdate({ ...game, linkedDatabase, enabledFeatures: next });
  }

  const selectedDb = DATABASES.find(db => db.id === linkedDatabase) ?? null;
  const features = selectedDb ? (DATABASE_FEATURES[selectedDb.id] ?? []) : [];

  // ── Pull history import (.json or .xlsx) ──────────────────────────────────

  async function handleImportFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'json') {
      await handleJsonFile(file);
    } else if (ext === 'xlsx') {
      await handleExcelFile(file);
    } else {
      setImportStatus({ type: 'error', message: 'Unsupported file type. Select a .json or .xlsx file from Paimon.moe.' });
    }
  }

  async function handleJsonFile(file) {
    setImportStatus({ type: 'loading', message: 'Reading JSON…' });
    try {
      const text   = await file.text();
      const result = await window.api.parsePaimonMoe(text, game.state.pullLog ?? []);
      if (!result.ok) { setImportStatus({ type: 'error', message: result.error }); return; }

      if (hasBannerData && (game.state.pullLog?.length ?? 0) > 0) {
        // Excel data already present — cross-check counts
        const mismatch = await window.api.detectMismatch(result.pullLog, game.state.pullLog);
        if (mismatch.diffs && mismatch.diffs.length > 0) {
          setMismatchPending({ type: 'json', jsonResult: result, excelLog: game.state.pullLog });
          return;
        }
        await applyJsonOverExcel(result, game.state.pullLog);
      } else {
        applyJsonOnly(result);
      }
    } catch (err) {
      setImportStatus({ type: 'error', message: err.message });
    }
  }

  async function handleExcelFile(file) {
    setImportStatus({ type: 'loading', message: 'Reading Excel…' });
    try {
      const buffer = await file.arrayBuffer();
      const result = await window.api.parseExcelMoe(buffer, game.state.pullLog ?? []);
      if (!result.ok) { setImportStatus({ type: 'error', message: result.error }); return; }

      if (has5050Data && (game.state.pullLog?.length ?? 0) > 0) {
        // JSON data already present — cross-check counts
        const mismatch = await window.api.detectMismatch(game.state.pullLog, result.pullLog);
        if (mismatch.diffs && mismatch.diffs.length > 0) {
          setMismatchPending({ type: 'excel', excelResult: result, jsonLog: game.state.pullLog });
          return;
        }
        await applyExcelOverJson(result, game.state.pullLog);
      } else {
        applyExcelOnly(result);
      }
    } catch (err) {
      setImportStatus({ type: 'error', message: err.message });
    }
  }

  // Apply JSON-only (no Excel present)
  function applyJsonOnly(result) {
    const replaced  = replaceBannerPulls(
      game.state.pullLog ?? [],
      result.pullLog,
      ['character', 'weapon', 'chronicled', 'standard', 'beginner'],
    );
    const finalLog  = recomputeRolls(preserveNewerApiPulls(game.state.pullLog ?? [], replaced));
    const nextState = buildNextState(finalLog, result, {
      serverOffset: result.serverOffset ?? 8,
    });
    onUpdate({ ...game, state: nextState });
    setImportStatus({
      type: 'success',
      message: `Imported ${result.totalImported} pulls from JSON. Upload the Excel to enable banner matching.`,
    });
  }

  // Apply Excel-only (no JSON present)
  function applyExcelOnly(result) {
    const replaced  = replaceBannerPulls(
      game.state.pullLog ?? [],
      result.pullLog,
      ['character', 'weapon', 'standard', 'beginner'],
    );
    const finalLog  = recomputeRolls(preserveNewerApiPulls(game.state.pullLog ?? [], replaced));
    const nextState = buildNextState(finalLog, result, {});
    onUpdate({ ...game, state: nextState });
    setImportStatus({
      type: 'success',
      message: `Imported ${result.totalImported} pulls from Excel. Upload the JSON to enable 50/50 tracking.`,
    });
  }

  // Apply JSON on top of existing Excel data (merge won5050 into Excel entries)
  async function applyJsonOverExcel(jsonResult, existingExcelLog) {
    try {
      const mergeResult = await window.api.mergeJsonIntoExcel(jsonResult.pullLog, existingExcelLog);
      if (!mergeResult.ok) throw new Error(mergeResult.error);
      const merged = recomputeRolls(preserveNewerApiPulls(game.state.pullLog ?? [], mergeResult.merged));

      const nextState = buildNextState(merged, jsonResult, {
        jsonImported:   true,
        excelImported:  true,
        serverOffset:   jsonResult.serverOffset ?? (game.state.serverOffset ?? 8),
      });
      onUpdate({ ...game, state: nextState });
      await writePullDb(merged);
      setImportStatus({
        type: 'success',
        message: `JSON + Excel linked — ${merged.length} pulls enriched with banner names and 50/50 data.`,
      });
    } catch (err) {
      setImportStatus({ type: 'error', message: err.message });
    }
  }

  // Apply Excel on top of existing JSON data (merge bannerName/roll into JSON entries)
  async function applyExcelOverJson(excelResult, existingJsonLog) {
    try {
      const mergeResult = await window.api.mergeJsonIntoExcel(existingJsonLog, excelResult.pullLog);
      if (!mergeResult.ok) throw new Error(mergeResult.error);
      const merged = recomputeRolls(preserveNewerApiPulls(game.state.pullLog ?? [], mergeResult.merged));

      const nextState = buildNextState(merged, excelResult, {
        jsonImported:   true,
        excelImported:  true,
        serverOffset:   game.state.serverOffset ?? 8,
      });
      onUpdate({ ...game, state: nextState });
      await writePullDb(merged);
      setImportStatus({
        type: 'success',
        message: `JSON + Excel linked — ${merged.length} pulls enriched with banner names and 50/50 data.`,
      });
    } catch (err) {
      setImportStatus({ type: 'error', message: err.message });
    }
  }

  async function writePullDb(pullLog) {
    try {
      await window.api.writePullDb(game.id, {
        version:     1,
        gameId:      game.id,
        lastUpdated: new Date().toISOString(),
        pulls:       pullLog,
      });
    } catch (_) {
      // Non-fatal — DB write failure doesn't block the import
    }
  }

  // Shared helper: build the next game state from an import result
  function buildNextState(finalLog, result, extra) {
    return {
      ...game.state,
      pullLog:               finalLog,
      charPity:              result.charPity              ?? game.state.charPity              ?? 0,
      charGuaranteed:        result.charGuaranteed        ?? game.state.charGuaranteed        ?? false,
      weaponPity:            result.weaponPity            ?? game.state.weaponPity            ?? 0,
      weaponGuaranteed:      result.weaponGuaranteed      ?? game.state.weaponGuaranteed      ?? false,
      chronicledPity:        result.chronicledPity        ?? game.state.chronicledPity        ?? 0,
      chronicledGuaranteed:  result.chronicledGuaranteed  ?? game.state.chronicledGuaranteed  ?? false,
      ...extra,
    };
  }

  // ── HSR Excel-only import ─────────────────────────────────────────────────

  async function handleHsrImportFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'xlsx') {
      setImportStatus({ type: 'error', message: 'Unsupported file type. Select the starrailstation-warp-data.xlsx export.' });
      return;
    }

    setImportStatus({ type: 'loading', message: 'Reading Excel…' });
    try {
      const buffer = await file.arrayBuffer();
      const result = await window.api.parseHsrExcel(buffer);
      if (!result.ok) { setImportStatus({ type: 'error', message: result.error }); return; }

      const replaced = replaceBannerPulls(
        game.state.pullLog ?? [],
        result.pullLog,
        ['character', 'weapon', 'standard', 'beginner'],
      );
      const finalLog = recomputeRolls(replaced);

      onUpdate({
        ...game,
        state: {
          ...game.state,
          pullLog:          finalLog,
          charPity:         result.charPity         ?? 0,
          weaponPity:       result.weaponPity        ?? 0,
          charGuaranteed:   false,
          weaponGuaranteed: false,
          hsrBannerList:    result.bannerList        ?? [],
        },
      });

      setImportStatus({
        type: 'success',
        message: `Imported ${result.totalImported.toLocaleString()} pulls ` +
          `(${result.charCount} Character, ${result.weaponCount} Light Cone, ` +
          `${result.standardCount} Stellar, ${result.beginnerCount} Departure).`,
      });
    } catch (err) {
      setImportStatus({ type: 'error', message: err.message });
    }
  }

  // ── ZZZ rng.moe backup import ─────────────────────────────────────────────

  async function handleZzzImportFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      setImportStatus({ type: 'error', message: 'Select the .json backup file exported from zzz.rng.moe.' });
      return;
    }

    setImportStatus({ type: 'loading', message: 'Reading rng.moe backup…' });
    try {
      const text   = await file.text();
      const result = parseZzzRngMoe(text, game.state.pullLog ?? []);

      const replaced = replaceBannerPulls(game.state.pullLog ?? [], result.pullLog, ZZZ_ALL_BANNERS);
      const finalLog = recomputeRolls(replaced);

      onUpdate({
        ...game,
        state: {
          ...game.state,
          pullLog:    finalLog,
          charPity:   0,
          weaponPity: 0,
        },
      });

      const { counts } = result;
      setImportStatus({
        type: 'success',
        message: `Imported ${result.totalImported.toLocaleString()} pulls ` +
          `(${counts.character ?? 0} Exclusive, ${counts.weapon ?? 0} W-Engine, ` +
          `${counts.standard ?? 0} Stable, ${counts.bangboo ?? 0} Bangboo).`,
      });
    } catch (err) {
      setImportStatus({ type: 'error', message: err.message });
    }
  }

  // ── Mismatch dialog ───────────────────────────────────────────────────────

  async function proceedWithMismatch() {
    const pending = mismatchPending;
    setMismatchPending(null);
    if (!pending) return;

    if (pending.type === 'json') {
      // JSON over existing Excel
      await applyJsonOverExcel(pending.jsonResult, pending.excelLog);
    } else {
      // Excel over existing JSON
      await applyExcelOverJson(pending.excelResult, pending.jsonLog);
    }
  }

  function cancelMismatch() {
    setMismatchPending(null);
    setImportStatus({ type: 'error', message: 'Import cancelled.' });
  }

  function requestClose() { setIsClosing(true); }

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !isClosing) requestClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isClosing]);

  async function handleFile(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!ACCEPTED_EXTS.includes(ext)) return;
    const buffer = await file.arrayBuffer();
    const filename = `${crypto.randomUUID()}.${ext}`;
    onUpload({ filename, buffer });
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }

  function onFileInput(e) {
    handleFile(e.target.files[0]);
    e.target.value = '';
  }

  return (
    <div className={`gs-modal${isClosing ? ' gs-modal--closing' : ''}`}>
      <div className="gs-backdrop" onClick={requestClose} />
      <div className={`gs-panel${isClosing ? ' gs-panel--closing' : ''}`}
        onAnimationEnd={(e) => { if (e.target === e.currentTarget && isClosing) onClose(); }}>
        <div className={`gs-panel-inner${isClosing ? ' gs-panel-inner--closing' : ''}`}
          onAnimationEnd={(e) => { if (e.animationName === 'gsSlideIn') setPanelSettled(true); }}>
        <div className="gs-header">
          <h2 className="gs-title">{t('Game Settings')}</h2>
          <button className="gs-close" onClick={requestClose}><X size={18} /></button>
        </div>
        <ScrollArea style={{ flex: 1 }} viewportClassName="gs-body">
          <div className="gs-field">
            <label className="gs-field-label">{t('Background')}</label>
            <p className="gs-field-hint">{t('JPG, PNG, WEBP, GIF, AVIF and MP4 supported.')}</p>

            {bgUrl ? (
              <div className="gs-bg-preview">
                <div className="gs-bg-img-wrap">
                  <div className="gs-bg-placeholder" />
                  {panelSettled && (
                    /\.(mp4|webm|mov)$/i.test(bgUrl)
                      ? <video src={bgUrl} className="gs-bg-img gs-bg-img--reveal" autoPlay loop muted playsInline />
                      : <img src={bgUrl} alt="Background" className="gs-bg-img gs-bg-img--reveal" />
                  )}
                </div>
                <div className="gs-bg-actions">
                  <BgDropZone
                    dragging={dragging}
                    setDragging={setDragging}
                    onDrop={onDrop}
                    onFileInput={onFileInput}
                    compact
                  />
                  <button className="gs-remove-btn" onClick={onRemove}>
                    <Trash2 size={14} /> {t('Remove')}
                  </button>
                </div>
              </div>
            ) : (
              <BgDropZone
                dragging={dragging}
                setDragging={setDragging}
                onDrop={onDrop}
                onFileInput={onFileInput}
              />
            )}
          </div>

          {/* ── Database + Features ── */}
          <div className="gs-field">
            <label className="gs-field-label">{t('Linked Database')}</label>
            <p className="gs-field-hint">{t('Unlocks database-powered features in a future update.')}</p>
            <select
              className="gs-select"
              value={linkedDatabase ?? ''}
              onChange={e => handleDatabaseChange(e.target.value)}
            >
              <option value="">None</option>
              {DATABASES.map(db => (
                <option key={db.id} value={db.id}>{db.name}</option>
              ))}
            </select>
          </div>

          {selectedDb && (
            <div className="gs-field">
              <label className="gs-field-label">{t('UID')}</label>
              {uidEditing ? (
                <div className="gs-uid-row">
                  <input
                    type="text"
                    className={`gs-uid-input${uidError ? ' gs-uid-input--error' : ''}`}
                    value={uidInput}
                    onChange={e => { setUidInput(e.target.value); if (uidError) setUidError(null); }}
                    onKeyDown={e => { if (e.key === 'Enter') handleUidSave(); }}
                    placeholder={t('Enter your UID')}
                    autoFocus
                  />
                  <button
                    className="gs-uid-save-btn"
                    onClick={handleUidSave}
                    disabled={!uidInput.trim()}
                  >
                    {t('Save')}
                  </button>
                  {uidError && <span className="gs-uid-error">{uidError}</span>}
                </div>
              ) : (
                <div className="gs-uid-row">
                  <span className="gs-uid-value">{uid || '—'}</span>
                  <button
                    className="gs-uid-edit-btn"
                    onClick={handleUidEdit}
                    disabled={uid !== 'default' && pullLog.length > 0}
                    title={uid !== 'default' && pullLog.length > 0 ? t('Clear pull history to change UID') : ''}
                  >
                    {t('Edit')}
                  </button>
                </div>
              )}
            </div>
          )}

          {selectedDb && (
            <div className="gs-field">
              <label className="gs-field-label">{t('Features')}</label>
              {features.length > 0 && (
                <div className="gs-features-list">
                  {features.map(feature => (
                    <div key={feature.id} className="gs-feature-item">
                      <div className="gs-feature-info">
                        <span className="gs-feature-name">{feature.name}</span>
                        {feature.desc && (
                          <span className="gs-feature-desc">{feature.desc}</span>
                        )}
                      </div>
                      <label className="gs-toggle-wrap">
                        <input
                          type="checkbox"
                          className="gs-toggle-input"
                          checked={!!enabledFeatures[feature.id]}
                          onChange={() => handleFeatureToggle(feature.id)}
                        />
                        <span
                          className="gs-toggle-track"
                          style={enabledFeatures[feature.id]
                            ? { background: progressColor, borderColor: progressColor }
                            : undefined}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              )}

              {/* Clear pull history */}
              <div className="gs-feature-item gs-feature-item--danger">
                <div className="gs-feature-info">
                  <span className="gs-feature-name">{t('Clear Pull History')}</span>
                  <span className="gs-feature-desc">{t('Permanently removes all recorded pulls and resets pity.')}</span>
                </div>
                <button
                  className="gs-clear-btn"
                  disabled={pullLog.length === 0}
                  onClick={() => setConfirmClear(true)}
                >
                  {t('Clear')}
                </button>
              </div>
            </div>
          )}

          {/* ── Pull History (HSR) ── */}
          {linkedDatabase === 'hsr' && (() => {
            const isSyncRunning = syncState.running && syncState.gameId === game.id;
            const syncForHere   = syncState.gameId === game.id && !!syncState.statusType;

            return (
              <div className="gs-field">
                <label className="gs-field-label">{t('Pull History')}</label>
                <p className="gs-field-hint">
                  {t('Import the Excel export from StarRailStation, or sync directly from the game.')}
                </p>

                {/* Import status message */}
                {importStatus && (
                  <div className={`gs-import-status gs-import-status--${importStatus.type}`}>
                    {importStatus.message}
                  </div>
                )}

                {/* Sync status — only shown when no import status */}
                {!importStatus && syncForHere && (
                  <div className={`gs-import-status gs-import-status--${syncState.statusType}`}>
                    {syncState.statusText}
                  </div>
                )}

                <div className="gs-import-btns">
                  <button
                    className="gs-import-btn"
                    onClick={() => hsrImportRef.current?.click()}
                    disabled={isSyncRunning}
                  >
                    <Download size={14} />
                    {t('Import from StarRailStation (.xlsx)')}
                  </button>
                  <input
                    ref={hsrImportRef}
                    type="file"
                    accept=".xlsx"
                    style={{ display: 'none' }}
                    onChange={handleHsrImportFile}
                  />

                  {/* Sync from Game / Cancel */}
                  {isSyncRunning ? (
                    <button
                      className="gs-import-btn gs-import-btn--cancel"
                      onClick={onCancelSync}
                    >
                      <XCircle size={14} />
                      {t('Cancel')}
                    </button>
                  ) : (
                    <button
                      className="gs-import-btn gs-import-btn--sync"
                      onClick={() => { setImportStatus(null); onStartSync(game); }}
                    >
                      <RefreshCw size={14} />
                      {t('Sync from Game')}
                    </button>
                  )}
                </div>

                {/* Last synced timestamp */}
                {game.state.lastSynced && (
                  <p className="gs-field-hint">
                    {t('Last synced')}: {formatSyncTime(game.state.lastSynced)} (Local)
                  </p>
                )}
              </div>
            );
          })()}

          {/* ── Pull History (ZZZ) ── */}
          {linkedDatabase === 'zzz' && (() => {
            const isSyncRunning = syncState.running && syncState.gameId === game.id;
            const syncForHere   = syncState.gameId === game.id && !!syncState.statusType;

            return (
              <div className="gs-field">
                <label className="gs-field-label">{t('Pull History')}</label>
                <p className="gs-field-hint">
                  {t('Import your backup from zzz.rng.moe, or sync directly from the game.')}
                </p>

                {importStatus && (
                  <div className={`gs-import-status gs-import-status--${importStatus.type}`}>
                    {importStatus.message}
                  </div>
                )}

                {!importStatus && syncForHere && (
                  <div className={`gs-import-status gs-import-status--${syncState.statusType}`}>
                    {syncState.statusText}
                  </div>
                )}

                <div className="gs-import-btns">
                  <button
                    className="gs-import-btn"
                    onClick={() => { setImportStatus(null); zzzImportRef.current?.click(); }}
                  >
                    <Upload size={14} />
                    {t('Import rng.moe Backup')}
                  </button>
                  <input
                    ref={zzzImportRef}
                    type="file"
                    accept=".json"
                    style={{ display: 'none' }}
                    onChange={handleZzzImportFile}
                  />

                  {isSyncRunning ? (
                    <button
                      className="gs-import-btn gs-import-btn--cancel"
                      onClick={onCancelSync}
                    >
                      <XCircle size={14} />
                      {t('Cancel')}
                    </button>
                  ) : (
                    <button
                      className="gs-import-btn gs-import-btn--sync"
                      onClick={() => { setImportStatus(null); onStartSync(game); }}
                    >
                      <RefreshCw size={14} />
                      {t('Sync from Game')}
                    </button>
                  )}
                </div>

                {game.state.lastSynced && (
                  <p className="gs-field-hint">
                    {t('Last synced')}: {formatSyncTime(game.state.lastSynced)} (Local)
                  </p>
                )}
              </div>
            );
          })()}

          {/* ── Pull History (Genshin only) ── */}
          {linkedDatabase === 'genshin' && (() => {
            const isSyncRunning = syncState.running && syncState.gameId === game.id;
            const syncForHere   = syncState.gameId === game.id && !!syncState.statusType;

            return (
              <div className="gs-field">
                <label className="gs-field-label">{t('Pull History')}</label>
                <p className="gs-field-hint">
                  {t('Import both the JSON and Excel exports from Paimon.moe for full banner matching and 50/50 tracking.')}
                </p>

                {/* File status indicators */}
                <div className="gs-import-indicators">
                  <span className={`gs-import-indicator ${has5050Data ? 'gs-import-indicator--ok' : 'gs-import-indicator--missing'}`}>
                    JSON {has5050Data ? '✓' : '—'}
                  </span>
                  <span className={`gs-import-indicator ${hasBannerData ? 'gs-import-indicator--ok' : 'gs-import-indicator--missing'}`}>
                    Excel {hasBannerData ? '✓' : '—'}
                  </span>
                </div>

                {/* Import status message */}
                {importStatus && (
                  <div className={`gs-import-status gs-import-status--${importStatus.type}`}>
                    {importStatus.message}
                  </div>
                )}

                {/* API sync status — only shown when no import status */}
                {!importStatus && syncForHere && (
                  <div className={`gs-import-status gs-import-status--${syncState.statusType}`}>
                    {syncState.statusText}
                  </div>
                )}

                <div className="gs-import-btns">
                  {/* Paimon.moe import (.json or .xlsx) */}
                  <button
                    className="gs-import-btn"
                    onClick={() => importInputRef.current?.click()}
                    disabled={isSyncRunning}
                  >
                    <Download size={14} />
                    {t('Import from Paimon.moe (.json / .xlsx)')}
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".json,.xlsx"
                    style={{ display: 'none' }}
                    onChange={handleImportFile}
                  />

                  {/* Sync from Game / Cancel */}
                  {isSyncRunning ? (
                    <button
                      className="gs-import-btn gs-import-btn--cancel"
                      onClick={onCancelSync}
                    >
                      <XCircle size={14} />
                      {t('Cancel')}
                    </button>
                  ) : (
                    <button
                      className="gs-import-btn gs-import-btn--sync"
                      onClick={() => { setImportStatus(null); onStartSync(game); }}
                    >
                      <RefreshCw size={14} />
                      {t('Sync from Game')}
                    </button>
                  )}
                </div>

                {/* Last synced timestamp */}
                {game.state.lastSynced && (
                  <p className="gs-field-hint">
                    {t('Last synced')}: {formatSyncTime(game.state.lastSynced)} (Local)
                  </p>
                )}
              </div>
            );
          })()}
        </ScrollArea>
        </div> {/* gs-panel-inner */}
      </div>

      {/* ── Clear history confirm dialog ── */}
      {confirmClear && (
        <ConfirmDialog
          title={t('Clear Pull History')}
          message={t('This will remove all imported pulls and reset pity. Pulls synced from the game are preserved for deduplication and will be restored on the next sync.')}
          confirmLabel={t('Delete')}
          danger
          onConfirm={handleClearHistory}
          onCancel={() => setConfirmClear(false)}
        />
      )}

      {/* ── UID overwrite confirm dialog ── */}
      {confirmUidOverwrite && (
        <ConfirmDialog
          title={t('UID Already Exists')}
          message={t('A profile for this UID already exists. Switching to it will replace your current pull history with the saved data.')}
          confirmLabel={t('Switch')}
          onConfirm={() => applyUidChange(pendingUid)}
          onCancel={() => { setConfirmUidOverwrite(false); setPendingUid(null); }}
        />
      )}

      {/* ── Database conflict confirm dialog ── */}
      {conflictPending && (
        <ConfirmDialog
          title="Database already linked"
          message={`"${conflictPending.conflictGame.name}" is already linked to ${DATABASES.find(d => d.id === conflictPending.newDbId)?.name ?? conflictPending.newDbId}. Linking here will unlink it from there. To link a new database, please add your UID to the already linked database.`}
          confirmLabel="Proceed"
          onConfirm={confirmConflict}
          onCancel={cancelConflict}
        />
      )}

      {/* ── Mismatch confirm dialog ── */}
      {mismatchPending && (
        <div className="gs-mismatch-overlay">
          <div className="gs-mismatch-dialog">
            <p className="gs-mismatch-title">Data mismatch detected</p>
            <p className="gs-mismatch-body">
              Excel and JSON data mismatch, data may be incorrect! Proceed?
            </p>
            <div className="gs-mismatch-btns">
              <button className="gs-mismatch-btn gs-mismatch-btn--cancel" onClick={cancelMismatch}>
                Cancel
              </button>
              <button className="gs-mismatch-btn gs-mismatch-btn--proceed" onClick={proceedWithMismatch}>
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BgDropZone({ dragging, setDragging, onDrop, onFileInput, compact }) {
  const inputRef = useRef();
  return (
    <div
      className={`gs-dropzone${dragging ? ' gs-dropzone--drag' : ''}${compact ? ' gs-dropzone--compact' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        style={{ display: 'none' }}
        onChange={onFileInput}
      />
      <Upload size={compact ? 14 : 22} className="gs-dropzone-icon" />
      <span className="gs-dropzone-text">
        {compact ? 'Replace' : 'Drop image or video here, or click to browse'}
      </span>
    </div>
  );
}
