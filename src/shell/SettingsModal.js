import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { X, ChevronDown, ChevronLeft, ChevronRight, Upload, Trash2 } from 'lucide-react';
import { COLORS, ColorPicker } from '../shared/components/ColorPicker';
import { LANGUAGES, useT } from '../shared/i18n';
import ConfirmDialog from '../shared/components/ConfirmDialog';
import './SettingsModal.css';
import { ScrollArea } from '../shared/components/ScrollArea';

const APP_VERSION = '4.17.18';
const SECTIONS = ['General', 'Appearance', 'Bin', 'About'];

const TEXT_SIZES = [
  { value: 100, label: 'Small' },
  { value: 115, label: 'Normal' },
  { value: 130, label: 'Large' },
];

const WINDOW_SIZES = [
  { id: 'XS', desc: '960×540' },
  { id: 'S',  desc: '1120×630' },
  { id: 'M',  desc: '1280×720' },
  { id: 'L',  desc: '1600×900' },
  { id: 'XL', desc: '1920×1080' },
];

export default function SettingsModal({
  settings,
  onAccentChange, onThemeChange,
  onTextSizeChange, onWindowSizeChange, onLanguageChange,
  onMinimizeOnCloseChange,
  onResetDefaults,
  deletedGames, onRestoreGame, onPermanentDelete,
  appBgUrl, onAppBgUpload, onAppBgRemove,
  activeGames, onRemoveGameBackground,
  onClose,
}) {
  const t = useT();
  const [section, setSection] = useState('General');
  const [subPanel, setSubPanel] = useState(null);
  const [isClosing, setIsClosing] = useState(false);
  const escapeBlockedRef = useRef(false);
  const [launchOnStartup, setLaunchOnStartup] = useState(false);

  useEffect(() => {
    window.api?.getLoginItem().then(v => setLaunchOnStartup(v ?? false));
  }, []);

  function handleLaunchOnStartupChange(v) {
    setLaunchOnStartup(v);
    window.api?.setLoginItem(v);
  }

  function requestClose() { setIsClosing(true); }

  function handleSectionChange(s) {
    setSection(s);
    setSubPanel(null);
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        if (escapeBlockedRef.current) return;
        if (subPanel) { setSubPanel(null); return; }
        requestClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [subPanel]);

  const setEscapeBlocked = (v) => { escapeBlockedRef.current = v; };

  return (
    <div className={`modal-overlay${isClosing ? ' modal-overlay--closing' : ''}`}>
      <div className={`settings-modal${isClosing ? ' settings-modal--closing' : ''}`}
        onAnimationEnd={() => { if (isClosing) onClose(); }}>
        <aside className="settings-sidebar">
          <p className="settings-sidebar-title">{t('Settings')}</p>
          {SECTIONS.map(s => (
            <button
              key={s}
              className={`settings-nav-item ${section === s ? 'settings-nav-item--active' : ''}`}
              onClick={() => handleSectionChange(s)}
            >
              {t(s)}
              {s === 'Bin' && deletedGames.length > 0 && (
                <span className="settings-bin-badge">{deletedGames.length}</span>
              )}
            </button>
          ))}
        </aside>

        <div className="settings-content">
          <div className="settings-content-header">
            <h2 className="settings-section-title">{t(section)}</h2>
            <button className="modal-close" onClick={requestClose}><X size={18} /></button>
          </div>
          <ScrollArea style={{ flex: 1 }} viewportClassName="settings-content-body">
            {section === 'General' && (
              <GeneralSection
                textSize={settings.textSize ?? 100}
                windowSize={settings.windowSize ?? 'M'}
                language={settings.language ?? 'en'}
                minimizeOnClose={settings.minimizeOnClose ?? false}
                launchOnStartup={launchOnStartup}
                onTextSizeChange={onTextSizeChange}
                onWindowSizeChange={onWindowSizeChange}
                onLanguageChange={onLanguageChange}
                onMinimizeOnCloseChange={onMinimizeOnCloseChange}
                onLaunchOnStartupChange={handleLaunchOnStartupChange}
                onResetDefaults={onResetDefaults}
                setEscapeBlocked={setEscapeBlocked}
              />
            )}
            {section === 'Appearance' && (
              <AppearanceSection
                accentColor={settings.accentColor ?? '#5A82D1'}
                theme={settings.theme ?? 'dark'}
                onAccentChange={onAccentChange}
                onThemeChange={onThemeChange}
                appBgUrl={appBgUrl}
                onAppBgUpload={onAppBgUpload}
                onAppBgRemove={onAppBgRemove}
                onOpenGameBackgrounds={() => setSubPanel('game-backgrounds')}
              />
            )}
            {section === 'Bin' && (
              <BinSection
                games={deletedGames}
                onRestore={onRestoreGame}
                onDelete={onPermanentDelete}
                setEscapeBlocked={setEscapeBlocked}
              />
            )}
            {section === 'About' && <AboutSection />}
          </ScrollArea>

          {/* Slide-in sub-panel — covers the full right content area */}
          <div className={`settings-subpanel${subPanel ? ' settings-subpanel--open' : ''}`}>
            {subPanel === 'game-backgrounds' && (
              <GameBackgroundsPanel
                activeGames={activeGames ?? []}
                onRemoveGameBackground={onRemoveGameBackground}
                onBack={() => setSubPanel(null)}
                onCloseModal={requestClose}
                setEscapeBlocked={setEscapeBlocked}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── General ──────────────────────────────────────────────────────────────────

function GeneralSection({ textSize, windowSize, language, minimizeOnClose, launchOnStartup, onTextSizeChange, onWindowSizeChange, onLanguageChange, onMinimizeOnCloseChange, onLaunchOnStartupChange, onResetDefaults, setEscapeBlocked }) {
  const t = useT();
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  function openResetConfirm() { setShowResetConfirm(true); setEscapeBlocked(true); }
  function closeResetConfirm() { setShowResetConfirm(false); setEscapeBlocked(false); }

  return (
    <div className="settings-section">
      <div className="settings-field">
        <label className="settings-field-label">{t('Behavior')}</label>
        <div className="settings-checkboxes">
          <SettingsCheckbox
            label={t('Launch on Windows startup')}
            checked={launchOnStartup}
            onChange={onLaunchOnStartupChange}
          />
          <SettingsCheckbox
            label={t('Minimize upon closing')}
            hint={t('The × button will minimize the window instead of quitting.')}
            checked={minimizeOnClose}
            onChange={onMinimizeOnCloseChange}
          />
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-field-label">{t('Text size')}</label>
        <p className="settings-field-hint">{t('Scales all text across the application.')}</p>
        <div className="toggle-group" style={{ marginTop: 6 }}>
          {TEXT_SIZES.map(s => (
            <button
              key={s.value}
              className={`toggle-btn ${textSize === s.value ? 'toggle-btn--active' : ''}`}
              onClick={() => onTextSizeChange(s.value)}
            >{t(s.label)}</button>
          ))}
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-field-label">{t('Window size')}</label>
        <p className="settings-field-hint">{t('Sets the application window dimensions.')}</p>
        <div className="window-size-group" style={{ marginTop: 6 }}>
          {WINDOW_SIZES.map(s => (
            <button
              key={s.id}
              className={`window-size-btn ${windowSize === s.id ? 'window-size-btn--active' : ''}`}
              onClick={() => onWindowSizeChange(s.id)}
            >
              <span className="window-size-id">{s.id}</span>
              <span className="window-size-desc">{s.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-field-label">{t('Language')}</label>
        <p className="settings-field-hint">{t('All application text will use the selected language.')}</p>
        <div style={{ marginTop: 6 }}>
          <LanguageDropdown
            value={language}
            onChange={onLanguageChange}
            setEscapeBlocked={setEscapeBlocked}
          />
        </div>
      </div>

      <div className="settings-reset-wrap">
        <button className="settings-reset-btn" onClick={openResetConfirm}>
          {t('Restore default settings')}
        </button>
      </div>

      {showResetConfirm && (
        <ConfirmDialog
          title={t('Restore default settings?')}
          message={t('All settings will be reset to their defaults. Your games will not be affected.')}
          confirmLabel={t('Restore defaults')} danger
          onConfirm={() => { closeResetConfirm(); onResetDefaults(); }}
          onCancel={closeResetConfirm}
        />
      )}
    </div>
  );
}

// ─── Language dropdown (portal-based to avoid overflow clipping) ──────────────

function LanguageDropdown({ value, onChange, setEscapeBlocked }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef();
  const panelRef = useRef();
  const current = LANGUAGES.find(l => l.code === value) ?? LANGUAGES[0];

  function openDropdown() {
    const rect = triggerRef.current.getBoundingClientRect();
    const panelH = 230;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= panelH + 4 ? rect.bottom + 4 : rect.top - panelH - 4;
    setPos({ top, left: rect.left, width: Math.max(rect.width, 240) });
    setSearch('');
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setEscapeBlocked(false);
  }

  useEffect(() => {
    if (!open) return;
    setEscapeBlocked(true);
    function onDown(e) {
      if (panelRef.current && !panelRef.current.contains(e.target) &&
          !triggerRef.current?.contains(e.target)) {
        close();
      }
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]); // eslint-disable-line

  const filtered = LANGUAGES.filter(l =>
    l.name.toLowerCase().includes(search.toLowerCase()) ||
    l.native.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="lang-dropdown-wrap">
      <button
        ref={triggerRef}
        className="lang-dropdown-trigger"
        onClick={() => open ? close() : openDropdown()}
      >
        <span className="lang-trigger-native">{current.native}</span>
        <span className="lang-trigger-name">{current.name}</span>
        <ChevronDown size={12} className={`lang-chevron ${open ? 'lang-chevron--open' : ''}`} />
      </button>

      {open && ReactDOM.createPortal(
        <div
          ref={panelRef}
          className="lang-dropdown-panel"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          <div className="lang-search-wrap">
            <input
              className="lang-search-input"
              placeholder="Search languages..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="lang-list">
            {filtered.map(l => (
              <button
                key={l.code}
                className={`lang-option ${l.code === value ? 'lang-option--active' : ''}`}
                onClick={() => { onChange(l.code); close(); }}
              >
                <span className="lang-option-native">{l.native}</span>
                <span className="lang-option-name">{l.name}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="lang-no-results">No languages found.</p>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Appearance ───────────────────────────────────────────────────────────────

const ACCEPTED_BG_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'mp4'];
const ACCEPTED_BG_ATTR = ACCEPTED_BG_EXTS.map(e => `.${e}`).join(',');
const BG_VIDEO_EXTS = ['mp4'];
const BG_MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const BG_MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function AppearanceSection({ accentColor, theme, onAccentChange, onThemeChange, appBgUrl, onAppBgUpload, onAppBgRemove, onOpenGameBackgrounds }) {
  const t = useT();
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef();

  async function handleFile(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!ACCEPTED_BG_EXTS.includes(ext)) return;
    const isVideo = BG_VIDEO_EXTS.includes(ext);
    const maxBytes = isVideo ? BG_MAX_VIDEO_BYTES : BG_MAX_IMAGE_BYTES;
    if (file.size > maxBytes) {
      alert(`Background ${isVideo ? 'videos' : 'images'} must be ${isVideo ? '100' : '25'} MB or smaller.`);
      return;
    }
    const buffer = await file.arrayBuffer();
    const filename = `app-bg-${crypto.randomUUID()}.${ext}`;
    onAppBgUpload({ filename, buffer });
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }

  return (
    <div className="settings-section">
      <div className="settings-field">
        <label className="settings-field-label">{t('Theme')}</label>
        <p className="settings-field-hint">{t('Controls the overall look of the application.')}</p>
        <div className="toggle-group" style={{ marginTop: 6 }}>
          <button className={`toggle-btn ${theme === 'light' ? 'toggle-btn--active' : ''}`}
            onClick={() => onThemeChange('light')}>{t('Light')}</button>
          <button className={`toggle-btn ${theme === 'dark' ? 'toggle-btn--active' : ''}`}
            onClick={() => onThemeChange('dark')}>{t('Dark')}</button>
          <button className={`toggle-btn ${theme === 'system' ? 'toggle-btn--active' : ''}`}
            onClick={() => onThemeChange('system')}>{t('Follow Windows')}</button>
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-field-label">{t('Accent color')}</label>
        <p className="settings-field-hint">{t('Applied across the entire application and used as the default game color.')}</p>
        <div style={{ marginTop: 4 }}>
          <ColorPicker
            color={accentColor}
            activeColor={accentColor}
            presets={COLORS}
            onPickPreset={onAccentChange}
            onPickCustom={onAccentChange}
          />
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-field-label">{t('Global Background')}</label>
        <p className="settings-field-hint">{t('Shown when no per-game background is set. JPG, PNG, WEBP, GIF, AVIF and MP4 supported.')}</p>
        <div style={{ marginTop: 6 }}>
          {appBgUrl ? (
            <div className="settings-bg-preview">
              {/\.(mp4|webm|mov)$/i.test(appBgUrl)
                ? <video src={appBgUrl} className="settings-bg-img" autoPlay loop muted playsInline />
                : <img src={appBgUrl} alt="App background" className="settings-bg-img" />
              }
              <div className="settings-bg-actions">
                <div
                  className={`settings-dropzone settings-dropzone--compact${dragging ? ' settings-dropzone--drag' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input ref={fileInputRef} type="file" accept={ACCEPTED_BG_ATTR} style={{ display: 'none' }}
                    onChange={e => { handleFile(e.target.files[0]); e.target.value = ''; }} />
                  <Upload size={13} />
                  <span>{t('Replace')}</span>
                </div>
                <button className="settings-bg-remove-btn" onClick={onAppBgRemove}>
                  <Trash2 size={13} /> {t('Remove')}
                </button>
              </div>
            </div>
          ) : (
            <div
              className={`settings-dropzone${dragging ? ' settings-dropzone--drag' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input ref={fileInputRef} type="file" accept={ACCEPTED_BG_ATTR} style={{ display: 'none' }}
                onChange={e => { handleFile(e.target.files[0]); e.target.value = ''; }} />
              <Upload size={20} />
              <span>{t('Drop image here or click to browse')}</span>
            </div>
          )}
        </div>
      </div>
      <div className="settings-field">
        <label className="settings-field-label">{t('Game Backgrounds')}</label>
        <p className="settings-field-hint">{t('View and manage background images set per game.')}</p>
        <button className="settings-bg-nav-btn" onClick={onOpenGameBackgrounds} style={{ marginTop: 6 }}>
          <span>{t('Manage game backgrounds')}</span>
          <ChevronRight size={14} className="settings-bg-nav-arrow" />
        </button>
      </div>
    </div>
  );
}

// ─── Game Backgrounds sub-panel ───────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ANIMATED_EXTS = ['gif', 'mp4'];
function getFileType(filename) {
  const ext = (filename ?? '').split('.').pop().toLowerCase();
  return ANIMATED_EXTS.includes(ext) ? 'Animated' : 'Image';
}

function GameBackgroundsPanel({ activeGames, onRemoveGameBackground, onBack, onCloseModal, setEscapeBlocked }) {
  const t = useT();
  const [bgFiles, setBgFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => {
    window.api?.listBackgrounds().then(files => {
      setBgFiles(files ?? []);
      setLoading(false);
    });
  }, []);

  // Only show files actively linked to a game
  const entries = bgFiles
    .map(file => ({ ...file, game: activeGames.find(g => g.backgroundFilename === file.filename) }))
    .filter(e => e.game);

  const confirmEntry = entries.find(e => e.game.id === confirmId);

  function openConfirm(gameId) { setConfirmId(gameId); setEscapeBlocked(true); }
  function closeConfirm() { setConfirmId(null); setEscapeBlocked(false); }

  async function handleDelete() {
    if (!confirmId) return;
    await onRemoveGameBackground(confirmId);
    setBgFiles(prev => prev.filter(f => f.filename !== confirmEntry?.filename));
    closeConfirm();
  }

  return (
    <>
      <div className="settings-content-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="settings-subpanel-back" onClick={onBack} title="Back">
            <ChevronLeft size={16} />
          </button>
          <h2 className="settings-section-title">{t('Game Backgrounds')}</h2>
        </div>
        <button className="modal-close" onClick={onCloseModal}><X size={18} /></button>
      </div>
      <ScrollArea style={{ flex: 1 }} viewportClassName="settings-content-body">
        {loading ? (
          <p className="settings-placeholder">{t('Loading...')}</p>
        ) : entries.length === 0 ? (
          <p className="settings-placeholder">{t('No game backgrounds set.')}</p>
        ) : (
          <div className="settings-gamebg-list">
            {entries.map(({ filename, sizeBytes, game }) => (
              <div key={game.id} className="settings-gamebg-item">
                <div className="settings-bin-icon" style={{ background: game.iconPath ? 'transparent' : game.color }}>
                  {game.iconPath
                    ? <img src={game.iconPath} alt={game.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 }} />
                    : game.name[0]?.toUpperCase()
                  }
                </div>
                <div className="settings-gamebg-info">
                  <span className="settings-gamebg-name">{game.name}</span>
                  <span className="settings-gamebg-meta">{getFileType(filename)} · {formatBytes(sizeBytes)}</span>
                </div>
                <button className="btn btn-danger settings-gamebg-remove" onClick={() => openConfirm(game.id)}>
                  <Trash2 size={13} /> {t('Remove')}
                </button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {confirmEntry && (
        <ConfirmDialog
          title={t('Remove background?')}
          message={`"${confirmEntry.game.name}" ${t('will have its background removed.')}`}
          confirmLabel={t('Remove')} danger
          onConfirm={handleDelete}
          onCancel={closeConfirm}
        />
      )}
    </>
  );
}

// ─── Bin ─────────────────────────────────────────────────────────────────────

function BinSection({ games, onRestore, onDelete, setEscapeBlocked }) {
  const t = useT();
  const [confirmId, setConfirmId] = useState(null);
  const confirmGame = games.find(g => g.id === confirmId);

  function openConfirm(id) { setConfirmId(id); setEscapeBlocked(true); }
  function closeConfirm() { setConfirmId(null); setEscapeBlocked(false); }

  if (games.length === 0) {
    return (
      <div className="settings-section">
        <p className="settings-placeholder">{t('Bin is empty.')}</p>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <p className="settings-field-hint" style={{ marginTop: -8 }}>
        {t('Restore a game to bring it back, or permanently delete it.')}
      </p>
      <div className="settings-bin-list">
        {games.map(game => (
          <div key={game.id} className="settings-bin-item">
            <div
              className="settings-bin-icon"
              style={{ background: game.iconPath ? 'transparent' : game.color }}
            >
              {game.iconPath
                ? <img src={game.iconPath} alt={game.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 }} />
                : game.name[0]?.toUpperCase()
              }
            </div>
            <span className="settings-bin-name">{game.name}</span>
            <div className="settings-bin-actions">
              <button className="btn btn-ghost" onClick={() => onRestore(game.id)}>
                {t('Restore')}
              </button>
              <button className="btn btn-danger" onClick={() => openConfirm(game.id)}>
                {t('Delete permanently')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirmGame && (
        <ConfirmDialog
          title={t('Delete permanently?')}
          message={`"${confirmGame.name}" ${t('will be deleted forever. This cannot be undone.')}`}
          confirmLabel={t('Delete forever')} danger
          onConfirm={() => { onDelete(confirmId); closeConfirm(); }}
          onCancel={closeConfirm}
        />
      )}
    </div>
  );
}

// ─── Checkbox toggle ──────────────────────────────────────────────────────────

function SettingsCheckbox({ label, hint, checked, onChange }) {
  return (
    <label className="settings-checkbox-row">
      <span className="settings-checkbox-wrap">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
        <span className="settings-checkbox-box" />
      </span>
      <span className="settings-checkbox-text">
        <span className="settings-checkbox-label">{label}</span>
        {hint && <span className="settings-field-hint">{hint}</span>}
      </span>
    </label>
  );
}

// ─── About ────────────────────────────────────────────────────────────────────

function AboutSection() {
  const t = useT();
  return (
    <div className="settings-section">
      <div className="about-app">
        <p className="about-name">Gacha Tracker</p>
        <p className="about-version">Version {APP_VERSION}</p>
        <p className="about-desc">
          {t('Personal desktop app for tracking gacha game currencies, pity counters, and running Monte Carlo pull simulations.')}
        </p>
      </div>
    </div>
  );
}
