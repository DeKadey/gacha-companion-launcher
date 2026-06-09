import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useAccent } from '../../../shared/contexts/AccentContext';
import { useTheme } from '../../../shared/contexts/ThemeContext';
import { useT } from '../../../shared/i18n';
import { clampColorForTheme } from '../../../shared/utils/color';
import { Plus, MoreVertical, Edit2, Trash2, Home } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import './Sidebar.css';
import { ScrollArea } from '../../../shared/components/ScrollArea';

export default function Sidebar({
  games, selectedId,
  onSelect, onAddGame,
  onEdit, onDelete, onReorder,
  onHome, showHomepage,
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const [phase, setPhase] = useState('idle'); // 'idle' | 'expanding' | 'collapsing'
  const [activeId, setActiveId] = useState(null);
  const [kebab, setKebab] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    })
  );

  function toggle() {
    if (collapsed) {
      setCollapsed(false);
      setPhase('expanding');
    } else {
      setCollapsed(true);
      setPhase('collapsing');
    }
  }

  function handleAnimationEnd(e) {
    if (e.target === e.currentTarget && phase !== 'idle') setPhase('idle');
  }

  function restrictToYAxis({ transform }) {
    return { ...transform, x: 0 };
  }

  function handleDragStart({ active }) {
    setActiveId(active.id);
    setKebab(null);
  }

  function handleDragEnd({ active, over }) {
    setActiveId(null);
    if (over && active.id !== over.id) {
      onReorder(active.id, over.id);
    }
  }

  function openKebab(gameId, e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const popupH = 84;
    const y = rect.top + popupH > window.innerHeight ? rect.bottom - popupH : rect.top;
    setKebab({ gameId, x: rect.right + 6, y });
  }

  const activeGame = games.find(g => g.id === activeId);
  const gameIds = games.map(g => g.id);

  const layoutClass = `sidebar-layout${collapsed ? ' sidebar-layout--collapsed' : ''}`;
  const panelClass = [
    'sidebar-panel',
    phase === 'expanding' ? 'sidebar-panel--expanding' : '',
    phase === 'collapsing' ? 'sidebar-panel--collapsing' : '',
  ].filter(Boolean).join(' ');
  const toggleShapeClass = [
    'sidebar-toggle-shape',
    phase === 'expanding'  ? 'sidebar-toggle-shape--expanding'  :
    phase === 'collapsing' ? 'sidebar-toggle-shape--collapsing' :
    !collapsed             ? 'sidebar-toggle-shape--expanded'   : '',
  ].filter(Boolean).join(' ');
  const toggleOutlineClass = [
    'sidebar-toggle-outline',
    phase === 'expanding'  ? 'sidebar-toggle-outline--expanding'  :
    phase === 'collapsing' ? 'sidebar-toggle-outline--collapsing' :
    !collapsed             ? 'sidebar-toggle-outline--expanded'   : '',
  ].filter(Boolean).join(' ');
  const addBtnClass = [
    'sidebar-add',
    collapsed && phase === 'idle' ? 'sidebar-add--idle-collapsed' : '',
    phase === 'expanding'  ? 'sidebar-add--expanding'  : '',
    phase === 'collapsing' ? 'sidebar-add--collapsing' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={layoutClass}>

      {/* Layer 1: static background for the collapsed icon column */}
      <div className="sidebar-base" />
      <div className="sidebar-border-right" />

      {/* Layer 3: animated background panel for the extended area */}
      <div className={panelClass} onAnimationEnd={handleAnimationEnd} />

      {/* Layer 2: all content — hamburger, icons, names, home. DnD lives here. */}
      <div className="sidebar-content">
        <div className="sidebar-header">
          <button className="sidebar-toggle" onClick={toggle}>
            <svg width="16" height="16" viewBox="0 0 16 16" overflow="visible" xmlns="http://www.w3.org/2000/svg">
              <path
                className={toggleOutlineClass}
                d="M 8 -5 L 21 8 L 8 21 L -5 8 Z"
                fill="none"
              />
              <path
                className={toggleShapeClass}
                d="M 8 -1 L 17 8 L 8 17 L -1 8 Z"
                fill="currentColor"
              />
            </svg>
          </button>
          <button className="sidebar-home" title="Home" onClick={onHome}>
            <span className="sidebar-home-icon"><Home size={17} /></span>
          </button>
        </div>

        <DndContext
          sensors={sensors}
          modifiers={[restrictToYAxis]}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <ScrollArea style={{ flex: 1 }} viewportClassName="sidebar-nav">
            {games.length === 0 && !collapsed && (
              <p className="sidebar-empty">{t('No games yet.')}</p>
            )}
            <SortableContext items={gameIds} strategy={verticalListSortingStrategy}>
              {games.map(game => (
                <SortableGameItem
                  key={game.id}
                  game={game}
                  collapsed={collapsed}
                  selected={selectedId === game.id}
                  ghost={activeId === game.id}
                  onSelect={() => { setKebab(null); onSelect(game.id); }}
                  onOpenKebab={e => openKebab(game.id, e)}
                />
              ))}
            </SortableContext>
          </ScrollArea>

          <DragOverlay dropAnimation={{
            duration: 220,
            easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
          }}>
            {activeGame ? (
              <DragCloneItem
                game={activeGame}
                collapsed={collapsed}
                selected={selectedId === activeId}
              />
            ) : null}
          </DragOverlay>
        </DndContext>

        <div className="sidebar-footer">
          <button className={addBtnClass} onClick={onAddGame}>
            <span className="sidebar-add-icon"><Plus size={16} /></span>
            <span className="sidebar-add-text">{t('Add game')}</span>
          </button>
        </div>

        {kebab && (
          <KebabMenu
            position={{ x: kebab.x, y: kebab.y }}
            onEdit={() => { onEdit(kebab.gameId); setKebab(null); }}
            onDelete={() => { onDelete(kebab.gameId); setKebab(null); }}
            onClose={() => setKebab(null)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Sortable game item ───────────────────────────────────────────────────────

function SortableGameItem({ game, collapsed, selected, ghost, onSelect, onOpenKebab }) {
  const accentColor = useAccent();
  const activeTheme = useTheme();
  const raw = game.usesAppColor ? accentColor : game.color;
  const gameColor = clampColorForTheme(raw, activeTheme === 'dark');
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: game.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 200ms cubic-bezier(0.25, 1, 0.5, 1)',
    opacity: ghost ? 0 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="sidebar-item-row" {...attributes}>
      <button
        className={`sidebar-item ${selected ? 'sidebar-item--active' : ''}`}
        onClick={onSelect}
        title={game.name}
        {...listeners}
      >
        <span className="sidebar-item-icon"
          style={{ background: game.iconPath ? 'transparent' : gameColor }}>
          {game.iconPath
            ? <img src={game.iconPath} alt={game.name} className="sidebar-item-icon-img" />
            : game.name[0]?.toUpperCase()}
        </span>
        <span className="sidebar-item-name">{game.name}</span>
        {selected && <span className="sidebar-item-indicator" />}
      </button>

      <button
        className="sidebar-kebab"
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onOpenKebab(e); }}
        title="Options"
      >
        <MoreVertical size={14} />
      </button>
    </div>
  );
}

// ─── Drag clone ───────────────────────────────────────────────────────────────

function DragCloneItem({ game, collapsed, selected }) {
  const accentColor = useAccent();
  const activeTheme = useTheme();
  const raw = game.usesAppColor ? accentColor : game.color;
  const gameColor = clampColorForTheme(raw, activeTheme === 'dark');

  return (
    <div className="sidebar-item-row drag-clone">
      <button
        className={`sidebar-item ${selected ? 'sidebar-item--active' : ''}`}
        title={game.name}
      >
        <span className="sidebar-item-icon"
          style={{ background: game.iconPath ? 'transparent' : gameColor }}>
          {game.iconPath
            ? <img src={game.iconPath} alt={game.name} className="sidebar-item-icon-img" />
            : game.name[0]?.toUpperCase()}
        </span>
        {!collapsed && <span className="sidebar-item-name">{game.name}</span>}
      </button>
      {!collapsed && (
        <div className="sidebar-kebab" style={{ opacity: 0.4, pointerEvents: 'none' }}>
          <MoreVertical size={14} />
        </div>
      )}
    </div>
  );
}

// ─── Kebab popup ──────────────────────────────────────────────────────────────

function KebabMenu({ position, onEdit, onDelete, onClose }) {
  const t = useT();
  const ref = useRef();

  useEffect(() => {
    function onPointer(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return ReactDOM.createPortal(
    <div
      ref={ref}
      className="kebab-popup"
      style={{ top: position.y, left: position.x }}
    >
      <button className="kebab-option" onClick={onEdit}>
        <Edit2 size={13} />
        {t('Edit')}
      </button>
      <button className="kebab-option kebab-option--danger" onClick={onDelete}>
        <Trash2 size={13} />
        {t('Delete')}
      </button>
    </div>,
    document.body
  );
}
