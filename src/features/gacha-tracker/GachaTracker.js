import React from 'react';
import Sidebar from './components/Sidebar';
import TitleBar from '../../shared/components/TitleBar';
import GameDashboard from './components/GameDashboard';
import AddGameModal from './components/AddGameModal';
import EditGameModal from './components/EditGameModal';
import EmptyState from './components/EmptyState';
import ConfirmDialog from '../../shared/components/ConfirmDialog';
import GameSettingsModal from './components/GameSettingsModal';
import { useTrackerState } from './useTrackerState';
import { useSyncRouter } from './useSyncRouter';

export default function GachaTracker({
  revealed,
  data,
  save,
  ready,
  bannerDataRef,
  bannerDataReady,
  bannerSchedules,
  bannerPanelWidths,
  gameBgUrl,
  onGoHome,
  onGameSelect,
}) {
  const tracker = useTrackerState({ data, save, ready, bannerDataRef, bannerDataReady, bannerSchedules });
  const sync    = useSyncRouter({ handleUpdateGame: tracker.handleUpdateGame, bannerDataRef });

  return (
    <>
      <div className={`app-ui${revealed ? '' : ' app-ui--hidden'}`}>
        <Sidebar
          games={tracker.activeGames}
          selectedId={tracker.selectedId}
          onSelect={(id) => { tracker.setSelectedId(id); onGameSelect?.(id); }}
          onAddGame={() => tracker.setShowAddModal(true)}
          onEdit={(id) => tracker.setEditingGameId(id)}
          onDelete={(id) => tracker.setPendingDeleteId(id)}
          onReorder={tracker.handleReorder}
          onHome={onGoHome}
          showHomepage={false}
        />
        <div className="app-right">
          <TitleBar />
          <main className="app-main">
            {tracker.selectedGame ? (
              <GameDashboard
                game={tracker.selectedGame}
                onUpdate={tracker.handleUpdateGame}
                onOpenSettings={() => tracker.setShowGameSettings(true)}
                bannerPanelWidths={bannerPanelWidths}
                bannerSchedule={
                  tracker.selectedGame.linkedDatabase === 'hsr' ? bannerSchedules.hsr :
                  tracker.selectedGame.linkedDatabase === 'zzz' ? bannerSchedules.zzz :
                  bannerSchedules.genshin
                }
              />
            ) : (
              <EmptyState onAddGame={() => tracker.setShowAddModal(true)} />
            )}
          </main>
        </div>
      </div>

      {tracker.showAddModal && (
        <AddGameModal
          onAdd={tracker.handleAddGame}
          onClose={() => tracker.setShowAddModal(false)}
        />
      )}
      {tracker.editingGame && (
        <EditGameModal
          game={tracker.editingGame}
          onUpdate={tracker.handleUpdateGame}
          onClose={() => tracker.setEditingGameId(null)}
        />
      )}
      {tracker.pendingDeleteId && (() => {
        const game = data.games.find(g => g.id === tracker.pendingDeleteId);
        return game ? (
          <ConfirmDialog
            title="Move to bin?"
            message={`"${game.name}" will be moved to the bin. You can restore it at any time.`}
            confirmLabel="Move to bin" danger
            onConfirm={() => { tracker.handleDeleteGame(tracker.pendingDeleteId); tracker.setPendingDeleteId(null); }}
            onCancel={() => tracker.setPendingDeleteId(null)}
          />
        ) : null;
      })()}
      {tracker.showGameSettings && tracker.selectedGame && (
        <GameSettingsModal
          game={tracker.selectedGame}
          bgUrl={gameBgUrl}
          onUpload={tracker.handleGameBgUpload}
          onRemove={tracker.handleGameBgRemove}
          onUpdate={tracker.handleUpdateGame}
          onUpdateMany={tracker.handleUpdateMultiple}
          onClose={() => tracker.setShowGameSettings(false)}
          activeGames={tracker.activeGames}
          syncState={sync.syncState}
          onStartSync={sync.handleStartSync}
          onCancelSync={sync.handleCancelSync}
          formatSyncTime={sync.formatSyncTime}
          onUidChange={tracker.handleGameUidChange}
        />
      )}
    </>
  );
}
