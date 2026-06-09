import { processZzzApiPulls, enrichZzzApiPulls } from './zzzImport';
import { appendNewPulls, recomputeRolls } from '../../engine/pullUtils';
import { parseUid } from '../../engine/uidUtils';

export function useZzzSync({ setSyncState, syncCancelRef, handleUpdateGame }) {
  const GACHA_TO_BANNER = { '2001': 'character', '3001': 'weapon', '1001': 'standard', '5001': 'bangboo' };
  const BANNER_TYPES = [
    { type: '2001', label: 'Exclusive', realType: '2' },
    { type: '3001', label: 'W-Engine',  realType: '3' },
    { type: '1001', label: 'Stable',    realType: '1' },
    { type: '5001', label: 'Bangboo',   realType: '5' },
  ];
  const delay = ms => new Promise(r => setTimeout(r, ms));

  async function handleStartZzzSync(game) {
    syncCancelRef.current = false;

    function ifCancelled() {
      if (syncCancelRef.current) {
        setSyncState({ running: false, gameId: null, statusType: null, statusText: null });
        return true;
      }
      return false;
    }

    setSyncState({ running: true, gameId: game.id, statusType: 'loading', statusText: 'Retrieving signal URL… (open your Signal Search in-game first)' });

    try {
      const logResult = await window.api.readZzzLog();
      if (ifCancelled()) return;
      if (!logResult.ok) {
        setSyncState({ running: false, gameId: game.id, statusType: 'error', statusText: logResult.error });
        return;
      }

      const { url } = logResult;
      const existingLog = game.state.pullLog ?? [];
      const apiBackup   = game.state.apiBackup ?? [];
      const workingLog  = appendNewPulls([...apiBackup], existingLog);

      const latestIdByBanner = {};
      for (const p of workingLog) {
        if (!p.id || p.source !== 'api') continue;
        if (!latestIdByBanner[p.banner] || p.id > latestIdByBanner[p.banner])
          latestIdByBanner[p.banner] = p.id;
      }

      await delay(2000);
      if (ifCancelled()) return;

      const results  = {};
      let totalPulls = 0;
      let currentLabel = '';

      const unsubProgress = window.api.onFetchProgress(({ count }) => {
        setSyncState({ running: true, gameId: game.id, statusType: 'loading', statusText: `Fetching ${currentLabel} banner… (${totalPulls + count} pulls so far)` });
      });

      for (const { type, label, realType } of BANNER_TYPES) {
        if (ifCancelled()) { unsubProgress(); return; }
        currentLabel = label;
        const cutoffId = latestIdByBanner[GACHA_TO_BANNER[type]] ?? null;
        setSyncState({ running: true, gameId: game.id, statusType: 'loading', statusText: `Fetching ${label} banner… (${totalPulls} pulls so far)` });
        const r = await window.api.fetchWishHistory(url, type, null, { real_gacha_type: realType, size: '5', pageDelay: '300', cutoffId });
        if (ifCancelled()) { unsubProgress(); return; }
        if (!r.ok) {
          unsubProgress();
          setSyncState({ running: false, gameId: game.id, statusType: 'error', statusText: r.error });
          return;
        }
        results[type] = r;
        totalPulls += r.pulls?.length ?? 0;
        await delay(2000);
        if (ifCancelled()) { unsubProgress(); return; }
      }

      unsubProgress();

      const processed = processZzzApiPulls(
        results['2001']?.pulls ?? [],
        results['3001']?.pulls ?? [],
        results['1001']?.pulls ?? [],
        results['5001']?.pulls ?? [],
        workingLog,
      );

      const zzzScheduleFetch = await window.api.fetchZzzBanners().catch(() => ({ ok: false, bannerSchedule: [] }));
      const zzzSchedule      = zzzScheduleFetch.ok ? (zzzScheduleFetch.bannerSchedule ?? []) : [];

      const { serverOffset: derivedOffset } = parseUid(game.uid ?? '', 'zzz');
      const serverOffset = derivedOffset ?? game.state.serverOffset ?? 8;

      const merged       = appendNewPulls(workingLog, processed.pullLog);
      const enriched     = enrichZzzApiPulls(merged, zzzSchedule, serverOffset);
      const finalLog     = recomputeRolls(enriched);
      const newApiBackup = appendNewPulls(apiBackup, processed.pullLog.filter(p => p.source === 'api'));
      const lastSynced   = new Date().toISOString();

      handleUpdateGame({
        ...game,
        state: {
          ...game.state,
          serverOffset,
          pullLog:    finalLog,
          apiBackup:  newApiBackup,
          charPity:   processed.charPity,
          weaponPity: processed.weaponPity,
          lastSynced,
        },
      });

      const newCount = totalPulls > 0 ? `${totalPulls} new pull${totalPulls === 1 ? '' : 's'}` : 'already up to date';
      setSyncState({ running: false, gameId: game.id, statusType: 'success', statusText: `Sync complete — ${newCount}` });

    } catch (err) {
      if (!syncCancelRef.current) {
        setSyncState({ running: false, gameId: game.id, statusType: 'error', statusText: err.message });
      }
    }
  }

  return { handleStartZzzSync };
}
