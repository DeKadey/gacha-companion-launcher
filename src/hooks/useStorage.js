import { useState, useEffect, useCallback } from 'react';

const EMPTY = { games: [] };

const isElectron = typeof window !== 'undefined' && !!window.api;

const UID_STATE_FIELDS = new Set([
  'pullLog', 'charPity', 'charGuaranteed', 'weaponPity', 'weaponGuaranteed',
  'chronicledPity', 'chronicledGuaranteed', 'fatePoints', 'currency', 'currentCurrency',
  'pullItems', 'goals', 'wishList', 'history', 'hsrBannerList', 'lastSynced',
  'excelImported', 'jsonImported',
]);

function readLocal() {
  try {
    const raw = localStorage.getItem('gacha-tracker');
    return raw ? JSON.parse(raw) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function writeLocal(data) {
  localStorage.setItem('gacha-tracker', JSON.stringify(data));
}

export function useStorage() {
  const [data, setData] = useState(EMPTY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function load() {
      if (isElectron) {
        // storage:read now returns fully assembled data (UID files merged in by main process)
        const result = await window.api.readStorage();
        setData(result || EMPTY);
      } else {
        setData(readLocal());
      }
      setReady(true);
    }
    load();
  }, []);

  const save = useCallback(async (newData) => {
    // Auto-assign uid='default' for any linked game that has no uid yet.
    const gamesWithUid = (newData.games ?? []).map(g =>
      (g.linkedDatabase && !g.uid) ? { ...g, uid: 'default' } : g
    );

    // Save new icons to files (only when iconFilename not yet set, i.e. freshly uploaded).
    // Keeps base64 iconPath in React state for display; strips it from user.json.
    const processedGames = isElectron
      ? await Promise.all(gamesWithUid.map(async g => {
          if (!g.iconPath?.startsWith('data:') || g.iconFilename) return g;
          const result = await window.api.saveIcon(g.id, g.iconPath);
          if (!result?.ok) return g;
          return { ...g, iconFilename: result.filename };
        }))
      : gamesWithUid;

    const normalized = { ...newData, games: processedGames };
    setData(normalized);

    if (isElectron) {
      const leanGames = processedGames.map(g => {
        // Always strip runtime iconPath — stored as a file, not in user.json
        const { iconPath: _ip, ...gNoIcon } = g;

        if (!gNoIcon.uid || !gNoIcon.linkedDatabase) return gNoIcon;

        const { apiBackup, ...rest } = gNoIcon.state ?? {};
        const configState = {};
        const uidState    = {};
        for (const [k, v] of Object.entries(rest)) {
          if (UID_STATE_FIELDS.has(k)) uidState[k] = v;
          else configState[k] = v;
        }

        // Fire-and-forget — write errors are non-fatal for the save flow
        window.api.writeGameState(gNoIcon.linkedDatabase, gNoIcon.uid, uidState);
        window.api.writeGameBackup(gNoIcon.linkedDatabase, gNoIcon.uid, apiBackup ?? []);

        return { ...gNoIcon, state: configState };
      });
      await window.api.writeStorage({ ...normalized, games: leanGames });
    } else {
      writeLocal(normalized);
    }
  }, []);

  return { data, save, ready };
}
