import { processHsrApiPulls, enrichHsrApiPulls } from './hsrImport';
import { appendNewPulls, recomputeRolls } from '../../engine/pullUtils';
import { parseUid } from '../../engine/uidUtils';

export function useHsrSync({ setSyncState, syncCancelRef, handleUpdateGame }) {
  const GACHA_TO_BANNER = { '11': 'character', '12': 'weapon', '1': 'standard', '2': 'beginner' };
  const BANNER_TYPES = [
    { type: '11', label: 'Character'  },
    { type: '12', label: 'Light Cone' },
    { type: '1',  label: 'Stellar'    },
    { type: '2',  label: 'Departure'  },
  ];
  const delay = ms => new Promise(r => setTimeout(r, ms));

  async function handleStartHsrSync(game) {
    syncCancelRef.current = false;

    function ifCancelled() {
      if (syncCancelRef.current) {
        setSyncState({ running: false, gameId: null, statusType: null, statusText: null });
        return true;
      }
      return false;
    }

    setSyncState({ running: true, gameId: game.id, statusType: 'loading', statusText: 'Retrieving warp URL… (open your Warp History in-game first)' });

    try {
      const logResult = await window.api.readHsrLog();
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

      const results   = {};
      let totalPulls  = 0;
      let currentLabel = '';

      const unsubProgress = window.api.onFetchProgress(({ count }) => {
        setSyncState({ running: true, gameId: game.id, statusType: 'loading', statusText: `Fetching ${currentLabel} banner… (${totalPulls + count} pulls so far)` });
      });

      for (const { type, label } of BANNER_TYPES) {
        if (ifCancelled()) { unsubProgress(); return; }
        currentLabel = label;
        const cutoffId = latestIdByBanner[GACHA_TO_BANNER[type]] ?? null;
        setSyncState({ running: true, gameId: game.id, statusType: 'loading', statusText: `Fetching ${label} banner… (${totalPulls} pulls so far)` });
        const r = await window.api.fetchWishHistory(url, type, null, { pageDelay: '300', cutoffId });
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

      const scheduleFetch  = await window.api.fetchHsrBanners().catch(() => ({ ok: false, bannerSchedule: [] }));
      const bannerSchedule = scheduleFetch.ok ? (scheduleFetch.bannerSchedule ?? []) : [];

      const processed = processHsrApiPulls(
        results['11']?.pulls ?? [],
        results['12']?.pulls ?? [],
        results['1']?.pulls  ?? [],
        results['2']?.pulls  ?? [],
        workingLog,
      );

      const { serverOffset: derivedOffset } = parseUid(game.uid ?? '', 'hsr');
      const serverOffset = derivedOffset ?? game.state.serverOffset ?? 8;

      const merged       = appendNewPulls(workingLog, processed.pullLog);
      const enriched     = enrichHsrApiPulls(merged, bannerSchedule, serverOffset);
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

  return { handleStartHsrSync };
}
