import { useState, useRef } from 'react';
import { useGenshinSync } from './games/genshin/useGenshinSync';
import { useHsrSync } from './games/hsr/useHsrSync';
import { useZzzSync } from './games/zzz/useZzzSync';

export function useSyncRouter({ handleUpdateGame, bannerDataRef }) {
  const [syncState, setSyncState] = useState({
    running: false, gameId: null, statusType: null, statusText: null,
  });
  const syncCancelRef = useRef(false);

  const deps = { setSyncState, syncCancelRef, handleUpdateGame, bannerDataRef };

  const { handleStartGenshinSync } = useGenshinSync(deps);
  const { handleStartHsrSync }     = useHsrSync(deps);
  const { handleStartZzzSync }     = useZzzSync(deps);

  function handleStartSync(game) {
    if (syncState.running) return;
    if (game.linkedDatabase === 'hsr') {
      handleStartHsrSync(game);
    } else if (game.linkedDatabase === 'zzz') {
      handleStartZzzSync(game);
    } else {
      handleStartGenshinSync(game);
    }
  }

  function handleCancelSync() {
    syncCancelRef.current = true;
    setSyncState({ running: false, gameId: null, statusType: null, statusText: null });
  }

  function formatSyncTime(isoStr) {
    const d = new Date(isoStr);
    const dd   = String(d.getDate()).padStart(2, '0');
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh   = String(d.getHours()).padStart(2, '0');
    const min  = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy}, ${hh}:${min}`;
  }

  return { syncState, handleStartSync, handleCancelSync, formatSyncTime };
}
