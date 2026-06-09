import React from 'react';
import { Plus } from 'lucide-react';
import { useT } from '../../../shared/i18n';
import './EmptyState.css';

export default function EmptyState({ onAddGame }) {
  const t = useT();
  return (
    <div className="empty-state">
      <div className="empty-icon">◈</div>
      <h2 className="empty-title">{t('No game selected')}</h2>
      <p className="empty-sub">{t('Add a game to start tracking your pulls and currency.')}</p>
      <button className="btn btn-primary" onClick={onAddGame}>
        <Plus size={15} />
        {t('Add your first game')}
      </button>
    </div>
  );
}
