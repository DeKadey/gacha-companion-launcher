import { useState, useEffect } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { appendNewPulls, recomputeRolls } from './engine/pullUtils';
import { parseUid } from './engine/uidUtils';
import { enrichApiPulls } from './games/genshin/genshinImport';
import { enrichHsrApiPulls } from './games/hsr/hsrImport';
import { enrichZzzApiPulls } from './games/zzz/zzzImport';

const UID_STATE_FIELDS = new Set([
  'pullLog', 'charPity', 'charGuaranteed', 'weaponPity', 'weaponGuaranteed',
  'chronicledPity', 'chronicledGuaranteed', 'fatePoints', 'currency', 'currentCurrency',
  'pullItems', 'goals', 'wishList', 'history', 'hsrBannerList', 'lastSynced',
  'excelImported', 'jsonImported',
]);

export function useTrackerState({ data, save, ready, bannerDataRef, bannerDataReady, bannerSchedules }) {
  const [selectedId, setSelectedId]         = useState(null);
  const [showAddModal, setShowAddModal]     = useState(false);
  const [editingGameId, setEditingGameId]   = useState(null);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [showGameSettings, setShowGameSettings] = useState(false);

  // Derived
  const activeGames  = data.games.filter(g => !g.deleted);
  const deletedGames = data.games.filter(g => g.deleted);
  const selectedGame = data.games.find(g => g.id === selectedId) || null;
  const editingGame  = data.games.find(g => g.id === editingGameId) || null;

  // Auto-select first game on initial load
  useEffect(() => {
    if (!ready) return;
    const first = data.games.find(g => !g.deleted);
    if (first) setSelectedId(first.id);
  }, [ready]); // eslint-disable-line

  // On-load enrichment/migration — runs when the app is ready AND banner data has loaded.
  useEffect(() => {
    if (!ready || !bannerDataReady) return;
    const { banners, bannersDual } = bannerDataRef.current;
    const { hsr: hsrSchedule, zzz: zzzSchedule } = bannerSchedules;

    const needsRolls = data.games.some(g =>
      g.state?.pullLog?.some(p => p.roll == null)
    );
    const needsGenshinEnrich = banners && data.games.some(g =>
      g.linkedDatabase !== 'hsr' && g.linkedDatabase !== 'zzz' &&
      g.state?.pullLog?.some(p =>
        p.source === 'api' && (!p.bannerName || (p.rarity === 5 && p.won5050 == null))
      )
    );
    const hasHsrGames = hsrSchedule?.length > 0 &&
      data.games.some(g => g.linkedDatabase === 'hsr' && g.state?.pullLog?.some(p => p.source === 'api'));
    const hasZzzGames = zzzSchedule?.length > 0 &&
      data.games.some(g => g.linkedDatabase === 'zzz' && g.state?.pullLog?.some(p => p.source === 'api'));
    const needsServerOffsetFix = data.games.some(g => {
      const { serverOffset: derived } = parseUid(g.uid ?? '', g.linkedDatabase ?? '');
      return derived != null && derived !== g.state?.serverOffset;
    });

    if (!needsRolls && !needsGenshinEnrich && !hasHsrGames && !hasZzzGames && !needsServerOffsetFix) return;

    const migratedGames = data.games.map(g => {
      let log = g.state?.pullLog;
      const db = g.linkedDatabase;

      const { serverOffset: derivedOffset } = parseUid(g.uid ?? '', db ?? '');
      const serverOffset = derivedOffset ?? g.state?.serverOffset ?? 8;
      const serverOffsetChanged = derivedOffset != null && derivedOffset !== g.state?.serverOffset;

      if (!log?.length) {
        if (serverOffsetChanged) return { ...g, state: { ...g.state, serverOffset } };
        return g;
      }

      if (needsGenshinEnrich && db !== 'hsr' && db !== 'zzz') {
        log = enrichApiPulls(log, banners, bannersDual, serverOffset);
      }
      if (hasHsrGames && db === 'hsr') {
        log = enrichHsrApiPulls(log, hsrSchedule, serverOffset);
      }
      if (hasZzzGames && db === 'zzz') {
        log = enrichZzzApiPulls(log, zzzSchedule, serverOffset);
      }
      if (needsRolls && log.some(p => p.roll == null)) {
        log = recomputeRolls(log);
      }
      if (log === g.state.pullLog && !serverOffsetChanged) return g;
      return { ...g, state: { ...g.state, serverOffset, pullLog: log } };
    });

    const changed = migratedGames.some((g, i) => g !== data.games[i]);
    if (changed) save({ ...data, games: migratedGames });
  }, [ready, bannerDataReady, bannerSchedules]); // eslint-disable-line

  // ─── Game CRUD ────────────────────────────────────────────────────────────────

  function handleAddGame(newGame) {
    save({ ...data, games: [...data.games, newGame] });
    setSelectedId(newGame.id);
    setShowAddModal(false);
  }

  function handleUpdateGame(updatedGame) {
    save({ ...data, games: data.games.map(g => g.id === updatedGame.id ? updatedGame : g) });
    setEditingGameId(null);
  }

  function handleUpdateMultiple(updatedGames) {
    const patchMap = Object.fromEntries(updatedGames.map(g => [g.id, g]));
    save({ ...data, games: data.games.map(g => patchMap[g.id] ?? g) });
  }

  function handleDeleteGame(id) {
    save({ ...data, games: data.games.map(g =>
      g.id === id
        ? { ...g, deleted: true, linkedDatabase: null, enabledFeatures: {} }
        : g
    )});
    if (selectedId === id) {
      const next = activeGames.find(g => g.id !== id);
      setSelectedId(next ? next.id : null);
    }
  }

  function handleRestoreGame(id) {
    save({ ...data, games: data.games.map(g => g.id === id ? { ...g, deleted: false } : g) });
  }

  function handlePermanentDelete(id) {
    save({ ...data, games: data.games.filter(g => g.id !== id) });
  }

  function handleReorder(activeId, overId) {
    const games = data.games;
    const oldIndex = games.findIndex(g => g.id === activeId);
    const newIndex = games.findIndex(g => g.id === overId);
    if (oldIndex !== -1 && newIndex !== -1) {
      save({ ...data, games: arrayMove(games, oldIndex, newIndex) });
    }
  }

  async function handleGameUidChange(game, newUid) {
    const db = game.linkedDatabase;
    const exists = db ? await window.api?.uidExists(db, newUid) : false;

    const configState = {};
    const currentUidState = {};
    const { apiBackup: currentBackup, ...rest } = game.state ?? {};
    for (const [k, v] of Object.entries(rest)) {
      if (UID_STATE_FIELDS.has(k)) currentUidState[k] = v;
      else configState[k] = v;
    }
    configState._migrated = true;
    const { serverOffset: derivedOffset } = parseUid(newUid, db ?? '');
    if (derivedOffset != null) configState.serverOffset = derivedOffset;

    let uidState, apiBackup;
    if (exists) {
      [uidState, apiBackup] = await Promise.all([
        window.api.readGameState(db, newUid),
        window.api.readGameBackup(db, newUid),
      ]);
    } else {
      uidState  = currentUidState;
      apiBackup = currentBackup ?? [];
    }

    const updatedGame = { ...game, uid: newUid, state: { ...configState, ...uidState, apiBackup } };
    save({ ...data, games: data.games.map(g => g.id === game.id ? updatedGame : g) });

    if (db && game.uid === 'default' && newUid !== 'default') {
      window.api?.clearUidState?.(db, 'default');
    }
  }

  // ─── Game background handlers ──────────────────────────────────────────────

  async function handleGameBgUpload({ filename, buffer }) {
    const result = await window.api?.saveBackground({ filename, buffer });
    const hash = result?.hash ?? null;
    const oldFilename = selectedGame?.backgroundFilename;
    if (oldFilename && oldFilename !== filename) {
      await window.api?.deleteBackground(oldFilename);
    }
    handleUpdateGame({ ...selectedGame, backgroundFilename: filename, bgHash: hash });
  }

  async function handleGameBgRemove() {
    const filename = selectedGame?.backgroundFilename;
    if (filename) await window.api?.deleteBackground(filename);
    handleUpdateGame({ ...selectedGame, backgroundFilename: null, bgHash: null });
  }

  return {
    // State
    selectedId, setSelectedId,
    showAddModal, setShowAddModal,
    editingGameId, setEditingGameId,
    pendingDeleteId, setPendingDeleteId,
    showGameSettings, setShowGameSettings,
    // Derived
    activeGames, deletedGames, selectedGame, editingGame,
    // Handlers
    handleAddGame, handleUpdateGame, handleUpdateMultiple,
    handleDeleteGame, handleRestoreGame, handlePermanentDelete,
    handleReorder, handleGameUidChange,
    handleGameBgUpload, handleGameBgRemove,
  };
}
