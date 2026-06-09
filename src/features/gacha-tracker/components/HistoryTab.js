import React, { useState, useMemo, useEffect, useCallback, useRef, startTransition } from 'react';
import ReactDOM from 'react-dom';
import { useT } from '../../../shared/i18n';
import { bannerImageCache } from '../../../shared/utils/bannerImageCache';
import { getToday } from '../../../shared/utils/dateHelpers';
import { HSR_BANNER_LABELS, HSR_ALL_BANNERS } from '../games/hsr/hsrImport';
import { ZZZ_BANNER_LABELS, ZZZ_ALL_BANNERS } from '../games/zzz/zzzImport';
import './HistoryTab.css';
import { ScrollArea } from '../../../shared/components/ScrollArea';

// ─── Shared helpers ───────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

// ─── Pull log view ────────────────────────────────────────────────────────────

const RARITY_COLORS = { 3: '#5b9fc9', 4: '#9573c8', 5: '#c8943c' };
const RARITY_BG     = { 3: 'rgba(91,159,201,0.1)', 4: 'rgba(149,115,200,0.1)', 5: 'rgba(200,148,60,0.12)' };
const BANNER_LABELS = { character: 'Character', weapon: 'Weapon', chronicled: 'Chronicled', standard: 'Standard', beginner: 'Beginner' };
const ALL_BANNERS   = ['character', 'weapon', 'chronicled', 'standard', 'beginner'];

// 50/50 fate color — handles both new string enum and old boolean values
function fateColor(won5050, rarity) {
  if (rarity !== 5) return null;
  if (won5050 === 'won'       || won5050 === true)  return '#4ade80'; // green
  if (won5050 === 'lost'      || won5050 === false) return '#f87171'; // red
  if (won5050 === 'guaranteed')                      return '#fbbf24'; // yellow
  return null;
}

// Normalise a name for comparison
function slugToKey(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Convert a pull's "YYYY-MM-DD HH:MM:SS" timestamp from server-local time to
// UTC+8 so it can be compared with banner start/end times (also UTC+8).
function toUTC8(timeStr, serverOffset) {
  if (!timeStr || serverOffset === 8) return timeStr;
  const [date, time] = timeStr.split(' ');
  const [y, m, d]  = date.split('-').map(Number);
  const [h, mi, s] = time.split(':').map(Number);
  const utcMs = Date.UTC(y, m - 1, d, h - serverOffset, mi, s);
  const dt = new Date(utcMs + 8 * 3_600_000);
  const p = n => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())} ${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:${p(dt.getUTCSeconds())}`;
}

const PAGE_SIZE = 50;

// Chrome < 128 (Electron 28 / Chrome 120) returns unscaled layout coordinates
// from getBoundingClientRect() for elements inside a CSS `zoom` container.
// Multiply by the .app-main zoom factor to get true viewport coordinates so
// position:fixed portals at document.body land in the right place.
function getScaledRect(el) {
  const rect  = el.getBoundingClientRect();
  const appEl = document.querySelector('.app-main');
  const zoom  = appEl ? (parseFloat(window.getComputedStyle(appEl).zoom) || 1) : 1;
  if (zoom === 1) return rect;
  return {
    top:    rect.top    * zoom,
    left:   rect.left   * zoom,
    width:  rect.width  * zoom,
    height: rect.height * zoom,
    right:  rect.right  * zoom,
    bottom: rect.bottom * zoom,
  };
}

function RarityToggle({ rarity, active, onToggle }) {
  const stars = '★'.repeat(rarity);
  const color = RARITY_COLORS[rarity];
  return (
    <button
      className={`pl-rarity-btn${active ? ` pl-rarity-btn--on pl-rarity-btn--r${rarity}` : ''}`}
      style={active ? { borderColor: color, color } : {}}
      onClick={onToggle}
    >
      {stars}
    </button>
  );
}

// Column layout: Stars | Name | Banner | Type | Roll | 50/50 | Pity | Date
function PullRow({ pull, weaponLabel = 'Wpn', bannerLabels = BANNER_LABELS }) {
  const color = RARITY_COLORS[pull.rarity] ?? '#888';
  const bg    = RARITY_BG[pull.rarity]    ?? 'transparent';
  const stars = '★'.repeat(pull.rarity ?? 3);

  const dateLabel   = pull.time ? pull.time.slice(0, 10).replace(/-/g, '/') : '—';
  const bannerLabel = bannerLabels[pull.banner] ?? pull.banner ?? '—';
  const typeLabel   = pull.type === 'character' ? 'Char' : pull.type === 'weapon' ? weaponLabel : '—';
  const dot         = fateColor(pull.won5050, pull.rarity);

  return (
    <div
      className={`pl-row${pull.rarity === 5 ? ' pl-row--five' : ''}`}
      style={pull.rarity === 5 ? { background: bg, borderLeftColor: color } : {}}
    >
      <span className="pl-stars" style={{ color }}>{stars}</span>
      <span className="pl-name" style={pull.rarity === 5 ? { color } : {}}>{pull.name}</span>
      <span className="pl-banner">{bannerLabel}</span>
      <span className="pl-type">{typeLabel}</span>
      <span className="pl-roll">{pull.roll != null ? pull.roll : '—'}</span>
      <span className="pl-fate">
        {dot && <span className="pl-fate-dot" style={{ background: dot }} />}
      </span>
      <span className="pl-pity">{pull.pity != null ? pull.pity : '—'}</span>
      <span className="pl-date">{dateLabel}</span>
    </div>
  );
}

// ─── File-missing tooltip (portal — escapes the overflow:hidden root container) ─
// Renders centered above the anchor element with a 5px gap and a downward arrow.

function FileMissingTooltip({ anchorRect, text }) {
  if (!anchorRect) return null;
  // bottom-center of the tooltip sits 5px above the top of the anchor
  const style = {
    position:  'fixed',
    top:       anchorRect.top - 5,
    left:      anchorRect.left + anchorRect.width / 2,
    transform: 'translate(-50%, -100%)',
  };
  return ReactDOM.createPortal(
    <div className="pl-json-missing-tooltip-portal" style={style}>
      {text}
      <div className="pl-json-missing-tooltip-arrow" />
    </div>,
    document.body,
  );
}

// ─── Banner card tooltip (portal — escapes the overflow:auto scroll container) ─

function BannerTooltip({ text, cardRect }) {
  if (!cardRect) return null;
  // Position: right edge of tooltip is 5px left of card's left edge; vertically centered on card
  const style = {
    top:  cardRect.top + cardRect.height / 2,
    left: cardRect.left - 5,
  };
  return ReactDOM.createPortal(
    <div className="pl-banner-tooltip" style={style}>{text}</div>,
    document.body,
  );
}

// ─── Banner panel ─────────────────────────────────────────────────────────────

// Load a banner image via IPC. All three games use repo-backed disk cache.
function loadBannerImage(gameId, featuredId) {
  if (!featuredId) return Promise.resolve(null);
  if (gameId === 'hsr') return (window.api.getHsrBannerImage?.(featuredId) ?? Promise.resolve(null)).catch(() => null);
  if (gameId === 'zzz') return (window.api.getZzzBannerImage?.(featuredId) ?? Promise.resolve(null)).catch(() => null);
  return (window.api.getGenshinBannerImageById?.(featuredId) ?? Promise.resolve(null)).catch(() => null);
}

function PairedBannerCard({ group, gameId, selected, onClick, color, disabled, hintText, onHintEnter, onHintLeave }) {
  const featuredIds = group.featuredIds.slice(0, gameId === 'hsr' ? 4 : 2);
  const count = featuredIds.length;
  const shouldScroll = count > 2;
  const idsKey = featuredIds.join(',');

  const [imgSrcs, setImgSrcs] = useState(() =>
    count === 0 ? [null] : featuredIds.map(id => bannerImageCache.get(`${gameId}:${id}`) ?? null)
  );
  const [cardRect, setCardRect] = useState(null);
  const cardRef = useRef(null);

  // Fast path: all images cached. Slow path: lazy via IntersectionObserver.
  useEffect(() => {
    if (count === 0) return;
    const fromCache = featuredIds.map(id => bannerImageCache.get(`${gameId}:${id}`) ?? null);
    if (fromCache.every(s => s !== null)) { setImgSrcs(fromCache); return; }
    const el = cardRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      obs.disconnect();
      Promise.all(featuredIds.map(id => {
        const c = bannerImageCache.get(`${gameId}:${id}`);
        return c ? Promise.resolve(c) : loadBannerImage(gameId, id);
      })).then(srcs => setImgSrcs(srcs.map(s => s ?? null)));
    }, { threshold: 0.05 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [idsKey, gameId]); // idsKey is a stable join of featuredIds; avoids array identity churn

  function handleMouseEnter() {
    if (disabled && cardRef.current) {
      setCardRect(getScaledRect(cardRef.current));
      onHintEnter?.();
    }
  }
  function handleMouseLeave() {
    if (disabled) { setCardRect(null); onHintLeave?.(); }
  }

  const accentColor = color ?? 'var(--accent)';

  return (
    <>
      <button
        ref={cardRef}
        className={`pl-bcard pl-bcard--${group.type}${selected ? ' pl-bcard--selected' : ''}${disabled ? ' pl-bcard--disabled' : ''}`}
        style={selected && !disabled ? { outline: `2px solid ${accentColor}`, outlineOffset: '2px' } : {}}
        onClick={disabled ? undefined : onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        title={disabled ? undefined : group.version ?? ''}
      >
        {shouldScroll ? (
          <div className="pl-bcard-imgs pl-bcard-imgs--scroll">
            <div
              className="pl-bcard-imgs-strip"
              style={{ '--pl-scroll-dist': `-${count * 28}px`, '--pl-scroll-dur': `${count * 1.2}s` }}
            >
              {/* Doubled strip: seamless loop — end of first copy aligns with start of second */}
              {Array.from({ length: count * 2 }, (_, i) => {
                const idx = i % count;
                return imgSrcs[idx]
                  ? <img key={i} className="pl-bcard-img" src={imgSrcs[idx]} alt="" style={{ objectPosition: 'center 30%' }} />
                  : <div key={i} className="pl-bcard-placeholder" />;
              })}
            </div>
          </div>
        ) : (
          <div className="pl-bcard-imgs">
            {Array.from({ length: 2 }, (_, i) => (
              imgSrcs[i]
                ? <img key={i} className="pl-bcard-img" src={imgSrcs[i]} alt="" style={{ objectPosition: 'center 30%' }} onError={() => setImgSrcs(p => { const n = [...p]; n[i] = null; return n; })} />
                : <div key={i} className="pl-bcard-placeholder" />
            ))}
          </div>
        )}
        <div className="pl-bcard-info">
          {group.version && <span className="pl-bcard-version">{group.version}</span>}
        </div>
      </button>

      {/* Portal tooltip — renders at body level to escape the overflow:auto container */}
      <BannerTooltip
        text={hintText ?? 'Sync your pull history to enable filtering.'}
        cardRect={disabled ? cardRect : null}
      />
    </>
  );
}

// ─── Selected group badge (filter bar) ───────────────────────────────────────

function SelectedGroupBadge({ group, gameId, color, onClear }) {
  const featuredIds = group.featuredIds.slice(0, gameId === 'hsr' ? 4 : 2);
  const count = featuredIds.length;
  const shouldScroll = count > 2;
  const idsKey = featuredIds.join(',');
  const [imgSrcs, setImgSrcs] = useState(() =>
    featuredIds.map(id => bannerImageCache.get(`${gameId}:${id}`) ?? null)
  );

  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : [];
    const missing = ids.some((_, i) => imgSrcs[i] == null);
    if (!missing) return;
    Promise.all(ids.map(id => {
      const c = bannerImageCache.get(`${gameId}:${id}`);
      return c ? Promise.resolve(c) : loadBannerImage(gameId, id);
    })).then(srcs => setImgSrcs(srcs.map(s => s ?? null)));
  }, [idsKey, gameId]); // idsKey is a stable string; imgSrcs intentionally omitted

  const borderColor = color ?? 'var(--accent)';

  return (
    <div
      className={`pl-selected-badge pl-selected-badge--${group.type}`}
      style={{ border: `1.5px solid ${borderColor}` }}
    >
      {shouldScroll ? (
        <div className="pl-bcard-imgs pl-bcard-imgs--scroll">
          <div
            className="pl-bcard-imgs-strip"
            style={{ '--pl-scroll-dist': `-${count * 28}px`, '--pl-scroll-dur': `${count * 1.2}s` }}
          >
            {Array.from({ length: count * 2 }, (_, i) => {
              const idx = i % count;
              return imgSrcs[idx]
                ? <img key={i} className="pl-bcard-img" src={imgSrcs[idx]} alt="" style={{ objectPosition: 'center 30%' }} />
                : <div key={i} className="pl-bcard-placeholder" />;
            })}
          </div>
        </div>
      ) : (
        <div className="pl-bcard-imgs">
          {Array.from({ length: 2 }, (_, i) => (
            imgSrcs[i]
              ? <img key={i} className="pl-bcard-img" src={imgSrcs[i]} alt="" style={{ objectPosition: 'center 30%' }} />
              : <div key={i} className="pl-bcard-placeholder" />
          ))}
        </div>
      )}
      <div className="pl-bcard-info">
        {group.version && <span className="pl-bcard-version">{group.version}</span>}
      </div>
      <button className="pl-selected-badge-close" onClick={onClear}>✕</button>
    </div>
  );
}

// ─── Pull log view ─────────────────────────────────────────────────────────────

function PullLogView({ game, onUpdate, color, bannerPanelWidths, prefetchedSchedule, onSettingsHintEnter, onSettingsHintLeave }) {
  const t = useT();
  const pullLog      = game.state.pullLog ?? [];
  const serverOffset = game.state.serverOffset ?? 8;

  // Per-game banner key/label tables derived from the linked database
  const isHsr              = game.linkedDatabase === 'hsr';
  const isZzz              = game.linkedDatabase === 'zzz';
  const activeBannerKeys   = isHsr ? HSR_ALL_BANNERS   : isZzz ? ZZZ_ALL_BANNERS   : ALL_BANNERS;
  const activeBannerLabels = isHsr ? HSR_BANNER_LABELS : isZzz ? ZZZ_BANNER_LABELS : BANNER_LABELS;

  // Feature flags derived from the actual stored data rather than upload-session flags.
  // hasBannerData: at least one pull has a bannerName (came from an Excel import).
  // has5050Data:   at least one 5-star has a won5050 value (came from a JSON import).
  // Both remain true after a sync because the existing pulls keep their enriched fields.
  const hasBannerData = useMemo(() => pullLog.length > 0, [pullLog]);
  const has5050Data   = useMemo(() => pullLog.some(p => p.rarity === 5 && p.won5050 != null), [pullLog]);

  const [rarityFilter, setRarityFilter] = useState({ 3: true, 4: true, 5: true });
  const [sortOrder, setSortOrder] = useState('desc'); // 'desc' = newest first, 'asc' = oldest first
  const [page,  setPage]  = useState(1);
  const [bannerFilter, setBannerFilter] = useState(
    () => Object.fromEntries(activeBannerKeys.map(b => [b, true]))
  );

  const RENDER_CHUNK = 8;
  const [renderLimit, setRenderLimit]     = useState(RENDER_CHUNK);
  const [selectedGroup, setSelectedGroup] = useState(null);
  // Fallback schedule fetched via IPC when prefetchedSchedule isn't available.
  const [fetchedSchedule, setFetchedSchedule] = useState(null);

  // Reset all filters and selections when the game changes (without remounting)
  const prevGameIdRef = useRef(game.id);
  useEffect(() => {
    if (prevGameIdRef.current === game.id) return;
    prevGameIdRef.current = game.id;
    setRarityFilter({ 3: true, 4: true, 5: true });
    setSortOrder('desc');
    setPage(1);
    setSelectedGroup(null);
    setRenderLimit(RENDER_CHUNK);
    setBannerFilter(Object.fromEntries(activeBannerKeys.map(b => [b, true])));
  }, [game.id]); // activeBannerKeys intentionally omitted — derived from game, changes with it

  // Derive the schedule from the prop directly (useMemo = same render, no effect lag).
  // Falls back to IPC-fetched schedule only when App.js hasn't provided one.
  const bannerSchedule = useMemo(() => {
    const source = prefetchedSchedule ?? fetchedSchedule;
    if (!source) return null;
    return source.filter(b => b.type === 'character' || b.type === 'weapon');
  }, [prefetchedSchedule, fetchedSchedule]);

  // IPC fallback — only runs when App.js hasn't supplied a schedule (e.g. offline at startup).
  useEffect(() => {
    if (prefetchedSchedule) return;
    const fetchFn = isHsr ? window.api?.fetchHsrBanners
                  : isZzz ? window.api?.fetchZzzBanners
                  : window.api?.fetchGenshinBanners;
    if (!fetchFn) return;
    fetchFn().then(result => {
      if (!result.ok) return;
      startTransition(() => setFetchedSchedule(result.bannerSchedule ?? []));
    }).catch(() => {});
  }, [isHsr, isZzz, prefetchedSchedule]);

  // All three games: banner panel entries sorted newest-first.
  // Source is the repo schedule filtered to character + weapon (set in the fetch effect).
  // Tie-break: character before weapon, then alphabetical by name for stable dual-banner order.
  const allBanners = useMemo(() => {
    if (!bannerSchedule) return [];
    const TYPE_ORDER = { character: 0, weapon: 1 };
    return [...bannerSchedule].sort((a, b) => {
      const dateCmp = (b.start ?? '').localeCompare(a.start ?? '');
      if (dateCmp !== 0) return dateCmp;
      const typeCmp = (TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99);
      if (typeCmp !== 0) return typeCmp;
      return (a.name ?? '').localeCompare(b.name ?? '');
    });
  }, [bannerSchedule]);

  // Group individual schedule entries into phase pairs: same type + same start = one card.
  const pairedBanners = useMemo(() => {
    const groups = new Map();
    for (const b of allBanners) {
      const key = `${b.type}|${b.start ?? ''}`;
      if (!groups.has(key)) {
        groups.set(key, { type: b.type, version: b.version, start: b.start, end: b.end, banners: [], featuredIds: [], featured: [] });
      }
      const g = groups.get(key);
      g.banners.push(b);
      if (b.featuredId) g.featuredIds.push(b.featuredId);
      const feats = Array.isArray(b.featured) ? b.featured : b.featured ? [b.featured] : [];
      g.featured.push(...feats);
    }
    return [...groups.values()]; // insertion order = allBanners sort order (newest-first)
  }, [allBanners]);

  const visiblePairedBanners = useMemo(
    () => pairedBanners.filter(g => bannerFilter[g.type] === true),
    [pairedBanners, bannerFilter],
  );

  // Progressive render: reveal RENDER_CHUNK more cards per frame until all shown.
  useEffect(() => {
    if (renderLimit >= visiblePairedBanners.length) return;
    const id = requestAnimationFrame(() =>
      startTransition(() => setRenderLimit(l => l + RENDER_CHUNK))
    );
    return () => cancelAnimationFrame(id);
  }, [renderLimit, visiblePairedBanners.length]);

  useEffect(() => {
    if (selectedGroup && bannerFilter[selectedGroup.type] === false) {
      setSelectedGroup(null);
    }
  }, [bannerFilter, selectedGroup]);

  function toggleBanner(key) {
    setBannerFilter(prev => {
      const activeKeys = activeBannerKeys.filter(b => prev[b]);
      if (activeKeys.length === activeBannerKeys.length) {
        return Object.fromEntries(activeBannerKeys.map(b => [b, b === key]));
      }
      if (activeKeys.length === 1 && prev[key]) {
        return Object.fromEntries(activeBannerKeys.map(b => [b, true]));
      }
      return { ...prev, [key]: !prev[key] };
    });
  }

  function toggleRarity(r) {
    setRarityFilter(prev => {
      const activeRarities = [3, 4, 5].filter(x => prev[x]);
      if (activeRarities.length === 3) {
        return { 3: r === 3, 4: r === 4, 5: r === 5 };
      }
      if (activeRarities.length === 1 && prev[r]) {
        return { 3: true, 4: true, 5: true };
      }
      return { ...prev, [r]: !prev[r] };
    });
  }

  function handleBannerGroupClick(group) {
    if (!hasBannerData) return;
    setSelectedGroup(prev => {
      if (prev && prev.type === group.type && prev.start === group.start) return null;
      return group;
    });
  }

  // Clear selectedGroup when pull log is emptied (e.g. via Game Settings)
  useEffect(() => {
    if (pullLog.length === 0 && selectedGroup !== null) setSelectedGroup(null);
  }, [pullLog.length]); // selectedGroup intentionally omitted — only react to log going empty

  useEffect(() => { setPage(1); }, [rarityFilter, bannerFilter, selectedGroup, sortOrder]);

  const bannerCounts = useMemo(() => {
    const counts = {};
    for (const b of activeBannerKeys) counts[b] = 0;
    for (const p of pullLog) {
      if (p.banner in counts) counts[p.banner]++;
    }
    return counts;
  }, [pullLog, activeBannerKeys]);

  // Apply all filters; sort newest-first by timestamp, then by roll descending so the
  // highest-numbered pull within the same second (= most recently acquired) appears first.
  // Without the secondary sort, a stable descending time-sort would leave the lowest-roll
  // item at the top of each multi-pull group, making the "latest roll" appear 9 short of
  // the total count whenever the most recent session ends with a 10-pull.
  const filtered = useMemo(() => {
    const base = [...pullLog]
      .sort((a, b) => {
        const tc = sortOrder === 'desc'
          ? (b.time ?? '').localeCompare(a.time ?? '')
          : (a.time ?? '').localeCompare(b.time ?? '');
        if (tc !== 0) return tc;
        return sortOrder === 'desc'
          ? (b.roll ?? 0) - (a.roll ?? 0)
          : (a.roll ?? 0) - (b.roll ?? 0);
      })
      .filter(p => rarityFilter[p.rarity] !== false && bannerFilter[p.banner] === true);
    if (!selectedGroup) return base;

    const { type, start, end, version } = selectedGroup;
    return base.filter(p => {
      if (p.banner !== type) return false;
      const t8 = toUTC8(p.time, serverOffset);
      if (!(t8 >= start && t8 <= end)) return false;
      if (p.version && version && p.version !== version) return false;
      return true;
    });
  }, [pullLog, rarityFilter, bannerFilter, selectedGroup, serverOffset, sortOrder]);

  const displayed = filtered.slice(0, page * PAGE_SIZE);
  const remaining = filtered.length - displayed.length;

  const count5 = useMemo(() => filtered.filter(p => p.rarity === 5).length, [filtered]);
  const count4 = useMemo(() => filtered.filter(p => p.rarity === 4).length, [filtered]);
  const count3 = useMemo(() => filtered.filter(p => p.rarity === 3).length, [filtered]);

  const gameId = isHsr ? 'hsr' : isZzz ? 'zzz' : 'genshin';

  return (
    <div className="pull-log">

      {/* ── Row 1: banner type filters + Clear history ── */}
      <div className="pl-banner-bar">
        {activeBannerKeys.map(key => {
          const on    = bannerFilter[key] === true;
          const count = bannerCounts[key] ?? 0;
          return (
            <button
              key={key}
              className={`pl-banner-btn${on ? ' pl-banner-btn--on' : ''}`}
              style={on ? { borderColor: color, color } : {}}
              onClick={() => toggleBanner(key)}
            >
              {activeBannerLabels[key]}
              {count > 0 && <span className="pl-banner-count">{count.toLocaleString()}</span>}
            </button>
          );
        })}

        <div className="pl-banner-bar-right">
          {selectedGroup ? (
            <SelectedGroupBadge
              group={selectedGroup}
              gameId={gameId}
              color={color}
              onClear={() => setSelectedGroup(null)}
            />
          ) : (
            <div className="pl-no-banner">{t('No banner')}</div>
          )}
        </div>
      </div>


      {/* ── Two-column layout: left (filters + rows) + right (banner panel) ── */}
      <div className="pl-lower">

        <div className="pl-left">
          {/* Rarity toggles + stats */}
          <div className="pl-filter-bar">
            <div className="pl-filter-left">
              <RarityToggle rarity={5} active={rarityFilter[5]} onToggle={() => toggleRarity(5)} />
              <RarityToggle rarity={4} active={rarityFilter[4]} onToggle={() => toggleRarity(4)} />
              <RarityToggle rarity={3} active={rarityFilter[3]} onToggle={() => toggleRarity(3)} />
            </div>
            <div className="pl-filter-right">
              <span className="pl-stat"><span className="pl-stat-n" style={{ color: RARITY_COLORS[5] }}>{count5}</span> ★5</span>
              <span className="pl-stat-sep" />
              <span className="pl-stat"><span className="pl-stat-n" style={{ color: RARITY_COLORS[4] }}>{count4}</span> ★4</span>
              <span className="pl-stat-sep" />
              <span className="pl-stat"><span className="pl-stat-n" style={{ color: RARITY_COLORS[3] }}>{count3}</span> ★3</span>
              <span className="pl-stat-sep" />
              <span className="pl-stat">
                <span className="pl-stat-n">{filtered.length.toLocaleString()}</span>
                {filtered.length !== pullLog.length && (
                  <span style={{ color: 'var(--text-muted)', fontFamily: 'inherit' }}>
                    /{pullLog.length.toLocaleString()}
                  </span>
                )}
                {' '}{t('shown')}
              </span>
            </div>
          </div>

          {/* Column header labels */}
          {displayed.length > 0 && (
            <div className="pl-header-row">
              <span>{t('Rarity')}</span>
              <span>{t('Name')}</span>
              <span>{t('Banner')}</span>
              <span style={{ textAlign: 'center' }}>{t('Type')}</span>
              <span style={{ textAlign: 'right' }}>{t('Roll')}</span>
              <span style={{ textAlign: 'center' }}>50/50</span>
              <span style={{ textAlign: 'right' }}>{t('Pity')}</span>
              <span className="pl-date-header">
                <button
                  className="pl-sort-btn"
                  onClick={() => setSortOrder(o => o === 'desc' ? 'asc' : 'desc')}
                  title={sortOrder === 'desc' ? 'Showing newest first' : 'Showing oldest first'}
                >
                  {sortOrder === 'desc' ? '↓' : '↑'}
                </button>
                {t('Date')}
              </span>
            </div>
          )}

          {/* Scrollable rows */}
          <ScrollArea
            className="pl-scroll-area"
            viewportStyle={{ paddingRight: '10px' }}
            thumbWidth={6}
            thumbColor="rgba(255,255,255,0.18)"
            thumbHoverColor="rgba(255,255,255,0.30)"
          >
            {displayed.length === 0 ? (
              <p className="history-empty">{t('No pulls match the selected filters.')}</p>
            ) : (
              <div className="pl-list">
                {displayed.map((pull, i) => (
                  <PullRow key={`${pull.time}|${pull.name}|${pull.banner}|${i}`} pull={pull} weaponLabel={isHsr ? 'LC' : isZzz ? 'W-Eng' : 'Wpn'} bannerLabels={isHsr ? HSR_BANNER_LABELS : isZzz ? ZZZ_BANNER_LABELS : BANNER_LABELS} />
                ))}
              </div>
            )}

            {remaining > 0 && (
              <button className="pl-load-more" onClick={() => setPage(p => p + 1)}>
                {t('Load more')} ({remaining.toLocaleString()} {t('remaining')})
              </button>
            )}
          </ScrollArea>
        </div>

        {/* Banner panel — width from canvas measurement (loading screen), falling back to static estimates */}
        <ScrollArea
          className="pl-banner-panel"
          style={{ padding: 0 }}
          viewportStyle={{
            paddingTop: '4px', paddingLeft: '14px', paddingRight: '8px', paddingBottom: '4px',
            display: 'flex', flexDirection: 'column', gap: '5px',
          }}
          thumbWidth={4}
          thumbColor="rgba(255,255,255,0.15)"
          thumbHoverColor="rgba(255,255,255,0.28)"
        >
          {bannerSchedule !== null ? (
            visiblePairedBanners.length === 0 ? (
              <p className="pl-banner-panel-empty">{t('No banners')}</p>
            ) : (
              visiblePairedBanners.slice(0, renderLimit).map((group) => (
                <PairedBannerCard
                  key={`${group.type}|${group.start ?? ''}`}
                  group={group}
                  gameId={gameId}
                  color={color}
                  disabled={!hasBannerData}
                  selected={
                    hasBannerData &&
                    selectedGroup !== null &&
                    selectedGroup.type  === group.type  &&
                    selectedGroup.start === group.start
                  }
                  onClick={() => handleBannerGroupClick(group)}
                  onHintEnter={onSettingsHintEnter}
                  onHintLeave={onSettingsHintLeave}
                />
              ))
            )
          ) : null}
        </ScrollArea>
      </div>
    </div>
  );
}

// ─── Income history view (existing) ──────────────────────────────────────────

function fillGaps(entries, startDate, endDate) {
  if (entries.length === 0) return [];
  const byDate = {};
  for (const e of entries) byDate[e.date] = e;

  let lastTotal = 0;
  for (const e of entries) {
    if (e.date < startDate) lastTotal = e.total ?? lastTotal;
  }

  const result = [];
  const cur = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);

  while (cur <= end) {
    const key = localDateKey(cur);
    if (byDate[key]) {
      lastTotal = byDate[key].total ?? lastTotal;
      result.push(byDate[key]);
    } else {
      result.push({ date: key, income: 0, pulls: 0, total: lastTotal });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

function availableYears(history, today) {
  const seen = new Set();
  for (const e of history) seen.add(e.date.slice(0, 4));
  seen.add(today.slice(0, 4));
  return [...seen].sort();
}

function IncomeHistoryView({ game, onUpdate, color }) {
  const t = useT();
  const { state } = game;
  const history = state.history ?? [];
  const today = getToday();
  const nowYear = Number(today.slice(0, 4));
  const nowMonth = Number(today.slice(5, 7));

  const years = useMemo(() => availableYears(history, today), [history, today]);

  const [filter, setFilter] = useState('latest');
  const [selMonth, setSelMonth] = useState(nowMonth);
  const [selYear, setSelYear] = useState(nowYear);

  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState({});

  const displayedRows = useMemo(() => {
    if (history.length === 0) return [];

    if (filter === 'latest') {
      return [...history].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
    }
    if (filter === 'month') {
      const mm = String(selMonth).padStart(2, '0');
      const startDate = `${selYear}-${mm}-01`;
      const lastDay = new Date(selYear, selMonth, 0).getDate();
      const endDate = `${selYear}-${mm}-${String(lastDay).padStart(2, '0')}`;
      const clampedEnd = endDate > today ? today : endDate;
      if (startDate > today) return [];
      return fillGaps(history, startDate, clampedEnd).reverse();
    }
    if (filter === 'year') {
      const startDate = `${selYear}-01-01`;
      const endDate = `${selYear}-12-31`;
      const clampedEnd = endDate > today ? today : endDate;
      if (startDate > today) return [];
      return fillGaps(history, startDate, clampedEnd).reverse();
    }
    return [];
  }, [filter, history, selMonth, selYear, today]);

  const summary = useMemo(() => {
    if (filter === 'latest') return null;
    const income = displayedRows.reduce((s, r) => s + (r.income ?? 0), 0);
    const pulls = displayedRows.reduce((s, r) => s + (r.pulls ?? 0), 0);
    return { income, pulls };
  }, [filter, displayedRows]);

  function enterEdit() {
    const initial = {};
    for (const row of displayedRows) {
      initial[row.date] = { income: String(row.income ?? 0), pulls: String(row.pulls ?? 0) };
    }
    setDrafts(initial);
    setEditing(true);
  }

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDrafts({});
  }, []);

  function saveEdit() {
    const updatedHistory = history.map(entry => {
      const d = drafts[entry.date];
      if (!d) return entry;
      return { ...entry, income: Number(d.income) || 0, pulls: Number(d.pulls) || 0 };
    });
    onUpdate({ ...game, state: { ...state, history: updatedHistory } });
    setEditing(false);
    setDrafts({});
  }

  function patchDraft(date, field, value) {
    setDrafts(prev => ({ ...prev, [date]: { ...prev[date], [field]: value } }));
  }

  useEffect(() => {
    if (!editing) return;
    function onKey(e) { if (e.key === 'Escape') cancelEdit(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, cancelEdit]);

  return (
    <ScrollArea style={{ flex: 1, minHeight: 0, maxWidth: '700px' }} viewportClassName="history-tab">
      <div className="history-filter-bar">
        <div className="history-filter-row">
          <div className="history-filter-toggles">
            {[['latest', t('Latest')], ['month', t('By Month')], ['year', t('By Year')]].map(([key, label]) => (
              <button key={key}
                className={`history-filter-btn ${filter === key ? 'history-filter-btn--active' : ''}`}
                style={filter === key ? { borderBottomColor: color, color } : {}}
                onClick={() => { setFilter(key); if (editing) cancelEdit(); }}>
                {label}
              </button>
            ))}
          </div>
          <div className="history-edit-controls">
            {editing ? (
              <>
                <button className="history-action-btn history-action-btn--ghost" onClick={cancelEdit}>{t('Cancel')}</button>
                <button className="history-action-btn history-action-btn--primary"
                  style={{ background: color }} onClick={saveEdit}>{t('Save')}</button>
              </>
            ) : (
              <button className="history-action-btn history-action-btn--ghost"
                onClick={enterEdit} disabled={displayedRows.length === 0}>{t('Edit')}</button>
            )}
          </div>
        </div>

        {filter === 'month' && (
          <div className="history-dropdowns">
            <select className="history-select" value={selMonth}
              onChange={e => { setSelMonth(Number(e.target.value)); if (editing) cancelEdit(); }}>
              {MONTH_NAMES.map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
            </select>
            <select className="history-select" value={selYear}
              onChange={e => { setSelYear(Number(e.target.value)); if (editing) cancelEdit(); }}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}
        {filter === 'year' && (
          <div className="history-dropdowns">
            <select className="history-select" value={selYear}
              onChange={e => { setSelYear(Number(e.target.value)); if (editing) cancelEdit(); }}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}
      </div>

      {summary && (
        <div className="history-summary">
          <span className="history-summary-item">
            <span className="history-summary-label">{t('Total income')}</span>
            <span className="history-summary-value" style={{ color }}>{summary.income.toLocaleString()}</span>
          </span>
          <span className="history-summary-sep" />
          <span className="history-summary-item">
            <span className="history-summary-label">{game.pullItemName || t('Pull items')}</span>
            <span className="history-summary-value" style={{ color }}>{summary.pulls.toLocaleString()}</span>
          </span>
        </div>
      )}

      {displayedRows.length === 0 ? (
        <p className="history-empty">{t('No history recorded yet.')}</p>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th className="history-th-date">{t('Date')}</th>
                <th className="history-th-center">{t('Income')}</th>
                <th className="history-th-center">{game.pullItemName || t('Pull Items')}</th>
                <th className="history-th-right">{t('Total')}</th>
              </tr>
            </thead>
            <tbody>
              {displayedRows.map(row => {
                const isToday = row.date === today;
                const draft = drafts[row.date];
                return (
                  <tr key={row.date} className={isToday ? 'history-row--today' : ''}>
                    <td className="history-date">
                      {formatDate(row.date)}
                      {isToday && <span className="history-today-badge">{t('today')}</span>}
                    </td>
                    <td className="history-td-center">
                      {editing && draft
                        ? <input className="history-edit-input" type="number"
                            value={draft.income}
                            onChange={e => patchDraft(row.date, 'income', e.target.value)} />
                        : row.income > 0 ? row.income.toLocaleString() : <span className="history-zero">—</span>}
                    </td>
                    <td className="history-td-center">
                      {editing && draft
                        ? <input className="history-edit-input" type="number"
                            value={draft.pulls}
                            onChange={e => patchDraft(row.date, 'pulls', e.target.value)} />
                        : row.pulls > 0 ? row.pulls.toLocaleString() : <span className="history-zero">—</span>}
                    </td>
                    <td className="history-td-right history-total" style={{ color }}>{row.total.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ScrollArea>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────

export default function HistoryTab({ game, onUpdate, color, bannerPanelWidths, prefetchedSchedule, onSettingsHintEnter, onSettingsHintLeave }) {
  const hasPullLog = !!game.linkedDatabase;

  if (hasPullLog) {
    return (
      <div className="history-tab history-tab--pulls">
        <PullLogView
          key={game.id}
          game={game}
          onUpdate={onUpdate}
          color={color ?? 'var(--accent)'}
          bannerPanelWidths={bannerPanelWidths}
          prefetchedSchedule={prefetchedSchedule}
          onSettingsHintEnter={onSettingsHintEnter}
          onSettingsHintLeave={onSettingsHintLeave}
        />
      </div>
    );
  }

  return <IncomeHistoryView game={game} onUpdate={onUpdate} color={color} />;
}
