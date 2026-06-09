import { processApiPulls, enrichApiPulls } from './genshinImport';
import { appendNewPulls, recomputeRolls } from '../../engine/pullUtils';

export function useGenshinSync({ setSyncState, syncCancelRef, handleUpdateGame, bannerDataRef }) {
  const GACHA_TO_BANNER = {
    '301': 'character', '400': 'character',
    '302': 'weapon',    '500': 'chronicled',
    '200': 'standard',  '100': 'beginner',
  };
  const BANNER_TYPES = [
    { type: '301', label: 'Character'   },
    { type: '400', label: 'Character'   },
    { type: '302', label: 'Weapon'      },
    { type: '500', label: 'Chronicled'  },
    { type: '200', label: 'Standard'    },
    { type: '100', label: 'Beginner'    },
  ];
  const delay = ms => new Promise(r => setTimeout(r, ms));

  async function handleStartGenshinSync(game) {
    syncCancelRef.current = false;

    function ifCancelled() {
      if (syncCancelRef.current) {
        setSyncState({ running: false, gameId: null, statusType: null, statusText: null });
        return true;
      }
      return false;
    }

    setSyncState({ running: true, gameId: game.id, statusType: 'loading', statusText: 'Retrieving wish URL… (may take a few seconds)' });

    try {
      const logResult = await window.api.readGenshinLog();
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

      const results = {};
      let totalPulls = 0;
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

      const charPulls = [...(results['301']?.pulls ?? []), ...(results['400']?.pulls ?? [])];
      const processed = processApiPulls(
        charPulls,
        results['302']?.pulls ?? [],
        results['500']?.pulls ?? [],
        results['200']?.pulls ?? [],
        results['100']?.pulls ?? [],
        workingLog,
      );
      const merged       = appendNewPulls(workingLog, processed.pullLog);
      const { banners, bannersDual } = bannerDataRef.current;
      const enriched     = enrichApiPulls(merged, banners, bannersDual, game.state.serverOffset ?? 8);
      const finalLog     = recomputeRolls(enriched);
      const newApiBackup = appendNewPulls(apiBackup, processed.pullLog.filter(p => p.source === 'api'));
      const lastSynced   = new Date().toISOString();

      handleUpdateGame({
        ...game,
        state: {
          ...game.state,
          pullLog:        finalLog,
          apiBackup:      newApiBackup,
          charPity:       processed.charPity,
          weaponPity:     processed.weaponPity,
          chronicledPity: processed.chronicledPity,
          lastSynced,
        },
      });

      setSyncState({ running: false, gameId: game.id, statusType: 'success', statusText: 'Sync complete' });

    } catch (err) {
      if (!syncCancelRef.current) {
        setSyncState({ running: false, gameId: game.id, statusType: 'error', statusText: err.message });
      }
    }
  }

  return { handleStartGenshinSync };
}
