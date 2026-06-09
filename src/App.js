import React, { useState, useEffect, useRef } from 'react';
import { Settings, Minus, X } from 'lucide-react';
import { MotionConfig } from 'motion/react';
import { useStorage } from './hooks/useStorage';
import { useSoftwareCursor } from './hooks/useSoftwareCursor';
import { AccentContext } from './shared/contexts/AccentContext';
import { ThemeContext } from './shared/contexts/ThemeContext';
import { LangContext } from './shared/i18n';
import { clampColorForTheme } from './shared/utils/color';
import { bannerImageCache } from './shared/utils/bannerImageCache';
import GachaTracker from './features/gacha-tracker/GachaTracker';
import HomePage from './shell/HomePage';
import SettingsModal from './shell/SettingsModal';
import './App.css';

const DEFAULT_SETTINGS = {
  accentColor: '#5A82D1',
  theme: 'dark',
  textSize: 115,
  windowSize: 'M',
  language: 'en',
  minimizeOnClose: false,
};

// ─── Banner panel width measurement ──────────────────────────────────────────
function measureBannerPanelWidths(schedules) {
  const canvas = document.createElement('canvas');
  const ctx    = canvas.getContext('2d');
  ctx.font     = '11px Syne, sans-serif';
  const IMAGE_W        = 25;
  const INFO_PAD       = 16;
  const NAME_VER_GAP   = 16;
  const PANEL_OVERHEAD = 22;
  const SAFETY         = 10;
  const result = {};
  for (const [game, schedule] of Object.entries(schedules)) {
    let maxText = 0;
    for (const entry of (schedule ?? [])) {
      const nameW = ctx.measureText(entry.name ?? '').width;
      const verW  = entry.version ? ctx.measureText(entry.version).width + NAME_VER_GAP : 0;
      const w = nameW + verW;
      if (w > maxText) maxText = w;
    }
    result[game] = Math.ceil(IMAGE_W * 2 + INFO_PAD + maxText + PANEL_OVERHEAD + SAFETY);
  }
  return result;
}

// ─── CSS application ──────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function applyAccent(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.15)`);
  document.documentElement.style.setProperty('--accent-dim', `rgb(${Math.round(r * 0.5)},${Math.round(g * 0.5)},${Math.round(b * 0.5)})`);
}

function applyAccentForTheme(rawHex, activeTheme) {
  applyAccent(clampColorForTheme(rawHex, activeTheme === 'dark'));
}

function applyTextSize(size) {
  document.documentElement.style.setProperty('--text-zoom', size / 100);
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  useSoftwareCursor();
  const { data, save, ready } = useStorage();
  const [showSettings, setShowSettings] = useState(false);
  const [activeTheme, setActiveTheme] = useState(DEFAULT_SETTINGS.theme);
  const [gameBgUrl, setGameBgUrl] = useState(null);
  const [appBgUrl, setAppBgUrl] = useState(null);
  const [bgList, setBgList] = useState([]);
  const [displayedFilename, setDisplayedFilename] = useState(null);
  const bgCache = useRef({});
  const bgPortRef = useRef(0);
  useEffect(() => {
    window.api?.getBgServerPort().then(p => { bgPortRef.current = p ?? 0; });
    // Two rAFs ensure Chromium has composited the dark first frame into DWM before
    // we make the window visible — one rAF fires before paint, two fires after.
    requestAnimationFrame(() => requestAnimationFrame(() => window.api?.notifyReady()));
  }, []);
  const [videoPosters, setVideoPosters] = useState({});
  const [videoReady, setVideoReady] = useState({});
  const [showHomepage, setShowHomepage] = useState(true);
  const [bgOnHomepage, setBgOnHomepage] = useState(true);
  const [gameBgPending, setGameBgPending] = useState(true);
  const [appBgPending, setAppBgPending] = useState(true);

  const [trackerRevealed, setTrackerRevealed] = useState(false);
  const [trackerMounted, setTrackerMounted] = useState(false);

  const bannerDataRef   = useRef({ banners: null, bannersDual: null });
  const [bannerDataReady, setBannerDataReady] = useState(false);
  const [bannerPanelWidths, setBannerPanelWidths] = useState(null);
  const [bannerSchedules, setBannerSchedules]     = useState({ genshin: null, hsr: null, zzz: null });

  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);

  // ─── Pre-bar calculation phase ────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    const videoFilenames = new Set();
    const appBg = dataRef.current.settings?.backgroundFilename;
    if (appBg && /\.(mp4|webm|mov)$/i.test(appBg)) videoFilenames.add(appBg);
    dataRef.current.games
      .filter(g => !g.deleted && g.backgroundFilename)
      .forEach(g => {
        if (/\.(mp4|webm|mov)$/i.test(g.backgroundFilename)) videoFilenames.add(g.backgroundFilename);
      });
    videoTaskFilenamesRef.current = [...videoFilenames];
    setCalculationDone(true);
  }, [ready]); // eslint-disable-line

  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingDone, setLoadingDone]         = useState(false);
  const [offlineError, setOfflineError]       = useState(false);
  const [loadingUnlocked, setLoadingUnlocked] = useState(false);
  const [calculationDone, setCalculationDone] = useState(false);
  const [bgHidden, setBgHidden] = useState(true);
  const tasksRef               = useRef(null);
  const totalWeightRef         = useRef(0);
  const timerStartedRef        = useRef(false);
  const timerIntervalRef       = useRef(null);
  const loadingStartedRef      = useRef(false);
  const videoTaskFilenamesRef  = useRef([]);
  const hashingRef             = useRef(new Set());
  const prevBgOnHomeRef        = useRef(true);
  const taskFnsRef             = useRef(null);
  const pendingCompletionsRef  = useRef(new Set());
  const taskStartTimesRef      = useRef({});
  const loadingFiredRef        = useRef(false);
  const offlineTimeRef         = useRef(null);
  const isInitialLoadRef       = useRef(true);

  const settings    = data.settings ?? DEFAULT_SETTINGS;
  const accentColor = settings.accentColor ?? DEFAULT_SETTINGS.accentColor;
  const themeSetting  = settings.theme ?? DEFAULT_SETTINGS.theme;
  const textSize      = settings.textSize ?? DEFAULT_SETTINGS.textSize;
  const windowSize    = settings.windowSize ?? DEFAULT_SETTINGS.windowSize;
  const language      = settings.language ?? DEFAULT_SETTINGS.language;

  // Resolve and apply theme on load / when setting changes
  useEffect(() => {
    if (!ready) return;
    async function init() {
      let resolved = themeSetting;
      if (themeSetting === 'system') {
        resolved = await window.api?.getSystemTheme() ?? 'dark';
      }
      setActiveTheme(resolved);
      applyTheme(resolved);
      applyAccentForTheme(accentColor, resolved);
    }
    init();
  }, [themeSetting, ready]); // eslint-disable-line

  useEffect(() => {
    if (!ready) return;
    applyAccentForTheme(accentColor, activeTheme);
  }, [accentColor, activeTheme, ready]);

  useEffect(() => {
    if (themeSetting !== 'system') return;
    const unsub = window.api?.onSystemThemeChange((sysTheme) => {
      setActiveTheme(sysTheme);
      applyTheme(sysTheme);
      applyAccentForTheme(accentColor, sysTheme);
    });
    return () => unsub?.();
  }, [themeSetting, accentColor]);

  useEffect(() => {
    if (!ready) return;
    applyTextSize(textSize);
  }, [textSize, ready]);

  const initialWindowSizeDoneRef = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (!initialWindowSizeDoneRef.current) {
      initialWindowSizeDoneRef.current = true;
      return;
    }
    window.api?.resizeWindow(windowSize);
  }, [windowSize, ready]); // eslint-disable-line

  // ─── Background: selected game ────────────────────────────────────────────
  // selectedId is now owned by GachaTracker, so we track which game is displayed
  // via data.games and the first non-deleted game as the initial selection.
  // App only needs to know the currently displayed game's background filename,
  // which it receives implicitly via the background useEffects watching data.games.
  //
  // To keep background switching working, App tracks its own selectedId mirror
  // that updates whenever the displayed game changes. GachaTracker calls
  // onGameSelect to keep App in sync.
  const [displayedGameId, setDisplayedGameId] = useState(null);

  useEffect(() => {
    if (!ready) return;
    const first = data.games.find(g => !g.deleted);
    if (first) setDisplayedGameId(first.id);
  }, [ready]); // eslint-disable-line

  useEffect(() => {
    const comingFromHome = prevBgOnHomeRef.current === true && bgOnHomepage === false;
    prevBgOnHomeRef.current = bgOnHomepage;

    if (!ready) return;
    if (!displayedGameId && data.games.some(g => !g.deleted)) return;
    if (bgOnHomepage) {
      setGameBgUrl(null);
      setGameBgPending(false);
      const appFilename = data.settings?.backgroundFilename ?? null;
      const game = data.games.find(g => g.id === displayedGameId);
      if (game?.backgroundFilename) lazyEnsureHash(game.backgroundFilename, 'game', game.id);
      if (appFilename) lazyEnsureHash(appFilename, 'app');
      const gameHash = game?.bgHash ?? null;
      const appHash  = data.settings?.bgHash ?? null;
      if (gameHash && appHash && gameHash === appHash) return;
      if (!appFilename) setDisplayedFilename(null);
      else if (bgCache.current[appFilename]) setDisplayedFilename(appFilename);
      return;
    }
    const game = data.games.find(g => g.id === displayedGameId);
    const filename = game?.backgroundFilename;
    if (!filename) {
      setGameBgUrl(null);
      setGameBgPending(false);
      const appFilename = data.settings?.backgroundFilename ?? null;
      if (!appFilename) setDisplayedFilename(null);
      else if (bgCache.current[appFilename]) setDisplayedFilename(appFilename);
      return;
    }
    if (bgCache.current[filename]) {
      setGameBgUrl(bgCache.current[filename].url);
      setGameBgPending(false);
      const gameHash = game?.bgHash ?? null;
      const appHash  = data.settings?.bgHash ?? null;
      if (comingFromHome && gameHash && appHash && gameHash === appHash) return;
      setDisplayedFilename(filename);
      return;
    }
    window.api?.getBackgroundInfo(filename).then(info => {
      if (!info) {
        setGameBgUrl(null);
        setGameBgPending(false);
        return;
      }
      const url = `http://localhost:${bgPortRef.current}/${encodeURIComponent(filename)}`;
      bgCache.current[filename] = { url, isVideo: info.isVideo };
      setBgList(prev => prev.find(b => b.filename === filename) ? prev : [...prev, { filename, url, isVideo: info.isVideo }]);
      setGameBgUrl(url);
      setGameBgPending(false);
      const freshGame  = dataRef.current.games.find(g => g.id === displayedGameId);
      const gameHash   = freshGame?.bgHash ?? null;
      const appHash    = dataRef.current.settings?.bgHash ?? null;
      if (comingFromHome && gameHash && appHash && gameHash === appHash) return;
      setDisplayedFilename(filename);
    });
  }, [displayedGameId, ready, data.games, bgOnHomepage]); // eslint-disable-line

  // ─── Background: app-wide ─────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    const filename = settings.backgroundFilename;
    const currentGame = data.games.find(g => g.id === displayedGameId);
    const gameHasBg   = !!currentGame?.backgroundFilename;
    const appBgActive = !gameHasBg || bgOnHomepage;
    const gameHash = currentGame?.bgHash ?? null;
    const appHash  = data.settings?.bgHash ?? null;
    const sameContent = !!(gameHash && appHash && gameHash === appHash);
    if (!filename) {
      setAppBgUrl(null);
      setAppBgPending(false);
      if (appBgActive) setDisplayedFilename(null);
      return;
    }
    if (bgCache.current[filename]) {
      setAppBgUrl(bgCache.current[filename].url);
      setAppBgPending(false);
      lazyEnsureHash(filename, 'app');
      if (appBgActive && !sameContent) setDisplayedFilename(filename);
      return;
    }
    window.api?.getBackgroundInfo(filename).then(info => {
      if (!info) {
        setAppBgUrl(null);
        setAppBgPending(false);
        return;
      }
      const url = `http://localhost:${bgPortRef.current}/${encodeURIComponent(filename)}`;
      bgCache.current[filename] = { url, isVideo: info.isVideo };
      setBgList(prev => prev.find(b => b.filename === filename) ? prev : [...prev, { filename, url, isVideo: info.isVideo }]);
      const freshGame_    = dataRef.current.games.find(g => g.id === displayedGameId);
      const freshGameHash = freshGame_?.bgHash ?? null;
      const freshAppHash  = dataRef.current.settings?.bgHash ?? null;
      const freshSame     = !!(freshGameHash && freshAppHash && freshGameHash === freshAppHash);
      if (appBgActive && !freshSame) setDisplayedFilename(filename);
      setAppBgUrl(url);
      setAppBgPending(false);
    });
  }, [settings.backgroundFilename, ready, displayedGameId, data.games, bgOnHomepage]); // eslint-disable-line

  // ─── Background: eager preload all game backgrounds ───────────────────────
  useEffect(() => {
    if (!ready) return;
    data.games.filter(g => !g.deleted && g.backgroundFilename).forEach(game => {
      const filename = game.backgroundFilename;
      lazyEnsureHash(filename, 'game', game.id);
      if (bgCache.current[filename]) return;
      window.api?.getBackgroundInfo(filename).then(info => {
        if (!info) return;
        const url = `http://localhost:${bgPortRef.current}/${encodeURIComponent(filename)}`;
        bgCache.current[filename] = { url, isVideo: info.isVideo };
        setBgList(prev => prev.find(b => b.filename === filename) ? prev : [...prev, { filename, url, isVideo: info.isVideo }]);
      });
    });
    const appFilename = data.settings?.backgroundFilename;
    if (appFilename) lazyEnsureHash(appFilename, 'app');
  }, [ready, data.games]); // eslint-disable-line

  // Toggle html.has-bg class
  const activeBgUrl = gameBgUrl ?? appBgUrl;
  useEffect(() => {
    if (activeBgUrl && !bgHidden) {
      document.documentElement.classList.add('has-bg');
    } else {
      document.documentElement.classList.remove('has-bg');
    }
  }, [activeBgUrl, bgHidden]);

  // ─── Task-based loading ────────────────────────────────────────────────────
  const MIN_TASK_MS = 400;
  useEffect(() => {
    if (!ready || !loadingUnlocked || !calculationDone) return;
    if (loadingStartedRef.current) return;
    loadingStartedRef.current = true;

    const taskDefs = [
      { id: 'genshin_banners', weight: 10 },
      { id: 'hsr_banners',     weight: 10 },
      { id: 'zzz_banners',     weight: 10 },
      { id: 'genshin_images',  weight: 12 },
      { id: 'hsr_images',      weight:  8 },
      { id: 'zzz_images',      weight:  8 },
      ...videoTaskFilenamesRef.current.map(f => ({ id: `video_${f}`, weight: 8 })),
      { id: 'timer',           weight: 30 },
    ];
    const tasks = {};
    let totalW = 0;
    const now = Date.now();
    for (const { id, weight } of taskDefs) {
      tasks[id] = { weight, progress: 0 };
      totalW += weight;
      taskStartTimesRef.current[id] = now;
    }
    for (const id of pendingCompletionsRef.current) {
      if (tasks[id]) tasks[id].progress = 1;
    }
    pendingCompletionsRef.current.clear();
    tasksRef.current     = tasks;
    totalWeightRef.current = totalW;

    function recompute() {
      const t = tasksRef.current;
      if (!t) return;
      let completed = 0;
      for (const task of Object.values(t)) completed += task.weight * task.progress;
      setLoadingProgress((completed / totalWeightRef.current) * 100);
    }

    function startTimer() {
      if (timerStartedRef.current) return;
      timerStartedRef.current = true;
      const start = Date.now();
      timerIntervalRef.current = setInterval(() => {
        const p = Math.min((Date.now() - start) / 3000, 1);
        tasksRef.current.timer.progress = p;
        recompute();
        if (p >= 1) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
      }, 50);
    }

    function checkTimer() {
      if (timerStartedRef.current) return;
      const allDone = Object.entries(tasksRef.current)
        .filter(([id]) => id !== 'timer')
        .every(([, task]) => task.progress >= 1);
      if (allDone) startTimer();
    }

    function updateTask(id, progress) {
      if (!tasksRef.current?.[id]) return;
      tasksRef.current[id].progress = Math.min(1, Math.max(0, progress));
      recompute();
      checkTimer();
    }

    function completeTask(id) { updateTask(id, 1); }

    function smoothComplete(id) {
      const task = tasksRef.current?.[id];
      if (!task) return;
      const elapsed   = Date.now() - (taskStartTimesRef.current[id] ?? Date.now());
      const remaining = Math.max(0, MIN_TASK_MS - elapsed);
      if (remaining < 16) { completeTask(id); return; }
      const fromProgress = task.progress;
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (!tasksRef.current?.[id]) { clearInterval(iv); return; }
        const p = Math.min(1, (Date.now() - t0) / remaining);
        updateTask(id, fromProgress + (1 - fromProgress) * p);
        if (p >= 1) clearInterval(iv);
      }, 16);
      smoothIntervals.push(iv);
    }

    taskFnsRef.current = { completeTask, updateTask, smoothComplete };
    checkTimer();

    let cancelled = false;
    const smoothIntervals = [];

    async function fetchImagesForGame(images, taskId, fetchFn, cachePrefix) {
      if (images.length === 0) { smoothComplete(taskId); return; }
      const BATCH = 20;
      let done = 0;
      for (let i = 0; i < images.length; i += BATCH) {
        if (cancelled) return;
        const batch = images.slice(i, i + BATCH);
        const urls  = await Promise.all(batch.map(({ id }) => fetchFn(id).catch(() => null)));
        urls.forEach((url, j) => { if (url) bannerImageCache.set(`${cachePrefix}:${batch[j].id}`, url); });
        done += batch.length;
        updateTask(taskId, done / images.length);
      }
    }

    async function runLoading() {
      const [genshinResult, hsrResult, zzzResult] = await Promise.all([
        window.api?.fetchGenshinBanners?.() ?? Promise.resolve({ ok: false, offline: true }),
        window.api?.fetchHsrBanners?.()     ?? Promise.resolve({ ok: false, bannerSchedule: [] }),
        window.api?.fetchZzzBanners?.()     ?? Promise.resolve({ ok: false, bannerSchedule: [] }),
      ]);
      if (cancelled) return;

      smoothComplete('genshin_banners');
      smoothComplete('hsr_banners');
      smoothComplete('zzz_banners');

      if (genshinResult.offline || !genshinResult.ok) {
        offlineTimeRef.current = Date.now();
        setOfflineError(true);
      }
      if (!cancelled && genshinResult.ok && genshinResult.banners) {
        bannerDataRef.current = { banners: genshinResult.banners, bannersDual: genshinResult.bannersDual ?? null };
        setBannerDataReady(true);
      }
      if (!cancelled) {
        setBannerSchedules({
          genshin: genshinResult.bannerSchedule ?? [],
          hsr:     hsrResult.bannerSchedule     ?? [],
          zzz:     zzzResult.bannerSchedule     ?? [],
        });
        setBannerPanelWidths(measureBannerPanelWidths({
          genshin: genshinResult.bannerSchedule ?? [],
          hsr:     hsrResult.ok  ? (hsrResult.bannerSchedule  ?? []) : [],
          zzz:     zzzResult.ok  ? (zzzResult.bannerSchedule  ?? []) : [],
        }));
      }

      if (cancelled) return;

      const genshinImages = [];
      if (genshinResult.ok && genshinResult.banners && window.api?.getGenshinBannerImageById) {
        const seen = new Set();
        const addImg = (b) => {
          if (!b.featuredId || seen.has(b.featuredId)) return;
          seen.add(b.featuredId);
          genshinImages.push({ id: b.featuredId });
        };
        for (const b of (genshinResult.banners.characters ?? [])) addImg(b);
        for (const b of (genshinResult.banners.weapons    ?? [])) addImg(b);
        if (genshinResult.bannersDual) {
          for (const pairs of Object.values(genshinResult.bannersDual)) {
            for (const b of pairs) addImg(b);
          }
        }
      }

      const hsrImages = [...new Set(
        (hsrResult.ok ? (hsrResult.bannerSchedule ?? []) : [])
          .filter(b => b.featuredId).map(b => b.featuredId)
      )].map(id => ({ id }));

      const zzzImages = [...new Set(
        (zzzResult.ok ? (zzzResult.bannerSchedule ?? []) : [])
          .filter(b => b.featuredId).map(b => b.featuredId)
      )].map(id => ({ id }));

      if (cancelled) return;

      const imgStart = Date.now();
      taskStartTimesRef.current['genshin_images'] = imgStart;
      taskStartTimesRef.current['hsr_images']     = imgStart;
      taskStartTimesRef.current['zzz_images']     = imgStart;

      await Promise.all([
        fetchImagesForGame(genshinImages, 'genshin_images',
          id => window.api.getGenshinBannerImageById(id), 'genshin'),
        fetchImagesForGame(hsrImages,     'hsr_images',
          id => window.api.getHsrBannerImage(id),         'hsr'),
        fetchImagesForGame(zzzImages,     'zzz_images',
          id => window.api.getZzzBannerImage(id),          'zzz'),
      ]);
    }

    runLoading();
    return () => {
      cancelled = true;
      smoothIntervals.forEach(clearInterval);
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [ready, loadingUnlocked, calculationDone]); // eslint-disable-line

  useEffect(() => {
    if (loadingProgress < 100 || loadingFiredRef.current) return;
    loadingFiredRef.current = true;
    setLoadingDone(true);
  }, [loadingProgress]);

  useEffect(() => {
    if (!loadingDone) return;
    const t = setTimeout(() => setBgHidden(false), 550);
    return () => clearTimeout(t);
  }, [loadingDone]);

  useEffect(() => {
    if (!loadingDone) return;
    const t = setTimeout(() => setTrackerMounted(true), 1000);
    return () => clearTimeout(t);
  }, [loadingDone]);

  // ─── Settings handlers ────────────────────────────────────────────────────

  function updateSettings(patch) {
    save({ ...data, settings: { ...settings, ...patch } });
  }

  function handleResetDefaults() {
    save({ ...data, settings: DEFAULT_SETTINGS });
  }

  function handleAccentChange(color)      { updateSettings({ accentColor: color }); }
  function handleThemeChange(theme)       { updateSettings({ theme }); }
  function handleTextSizeChange(size)     { updateSettings({ textSize: size }); }
  function handleWindowSizeChange(size)   { updateSettings({ windowSize: size }); }
  function handleLanguageChange(lang)     { updateSettings({ language: lang }); }
  function handleMinimizeOnCloseChange(v) { updateSettings({ minimizeOnClose: v }); }

  // ─── App background handlers ──────────────────────────────────────────────

  function lazyEnsureHash(filename, type, gameId) {
    if (!filename || hashingRef.current.has(filename)) return;
    const d = dataRef.current;
    if (type === 'app'  && d.settings?.bgHash) return;
    if (type === 'game' && d.games.find(g => g.id === gameId)?.bgHash) return;
    hashingRef.current.add(filename);
    window.api?.hashBackground(filename).then(hash => {
      if (!hash) return;
      const fresh = dataRef.current;
      if (type === 'app') {
        save({ ...fresh, settings: { ...fresh.settings, bgHash: hash } });
      } else {
        save({ ...fresh, games: fresh.games.map(g => g.id === gameId ? { ...g, bgHash: hash } : g) });
      }
    });
  }

  async function handleAppBgUpload({ filename, buffer }) {
    const result = await window.api?.saveBackground({ filename, buffer });
    const hash = result?.hash ?? null;
    const oldFilename = settings.backgroundFilename;
    if (oldFilename && oldFilename !== filename) {
      await window.api?.deleteBackground(oldFilename);
    }
    updateSettings({ backgroundFilename: filename, bgHash: hash });
  }

  async function handleAppBgRemove() {
    const filename = settings.backgroundFilename;
    if (filename) await window.api?.deleteBackground(filename);
    updateSettings({ backgroundFilename: null, bgHash: null });
  }

  async function handleRemoveAnyGameBackground(gameId) {
    const game = data.games.find(g => g.id === gameId);
    if (!game?.backgroundFilename) return;
    await window.api?.deleteBackground(game.backgroundFilename);
    save({ ...data, games: data.games.map(g => g.id === gameId ? { ...g, backgroundFilename: null } : g) });
  }

  const activeGames  = data.games.filter(g => !g.deleted);
  const deletedGames = data.games.filter(g => g.deleted);

  return (
    <MotionConfig reducedMotion="user">
    <LangContext.Provider value={language}>
    <ThemeContext.Provider value={activeTheme}>
    <AccentContext.Provider value={accentColor}>
      {/* ── Shared background layer ── */}
      <div className={`app-bg-layer${bgHidden ? ' app-bg-layer--loading' : ''}`}>
        {bgList.map(({ filename, url, isVideo }) => {
          const isActive = filename === displayedFilename;
          if (isVideo) {
            const poster = videoPosters[filename];
            const ready  = videoReady[filename];
            return (
              <React.Fragment key={filename}>
                {poster && (
                  <div
                    className="app-bg"
                    style={{ backgroundImage: `url(${poster})`, opacity: isActive && !ready ? 1 : 0 }}
                  />
                )}
                <video
                  className="app-bg app-bg--video"
                  src={url}
                  style={{ opacity: isActive && ready ? 1 : 0.001 }}
                  autoPlay loop muted playsInline preload="auto" crossOrigin="anonymous"
                  onLoadedData={e => {
                    const v = e.target;
                    const capture = () => {
                      try {
                        const canvas = document.createElement('canvas');
                        canvas.width  = v.videoWidth  || 1920;
                        canvas.height = v.videoHeight || 1080;
                        canvas.getContext('2d').drawImage(v, 0, 0);
                        setVideoPosters(prev => ({ ...prev, [filename]: canvas.toDataURL('image/jpeg', 0.85) }));
                      } catch (_) {}
                    };
                    if (typeof requestIdleCallback === 'function') {
                      requestIdleCallback(capture, { timeout: 3000 });
                    } else {
                      setTimeout(capture, 200);
                    }
                  }}
                  onCanPlay={() => {
                    setVideoReady(prev => ({ ...prev, [filename]: true }));
                    const taskId = `video_${filename}`;
                    if (taskFnsRef.current) {
                      taskFnsRef.current.smoothComplete(taskId);
                    } else {
                      pendingCompletionsRef.current.add(taskId);
                    }
                  }}
                />
              </React.Fragment>
            );
          }
          return (
            <div key={filename} className="app-bg"
              style={{ backgroundImage: `url(${url})`, opacity: isActive ? 1 : 0 }} />
          );
        })}
      </div>

      <div className="app">
        {trackerMounted && (
          <GachaTracker
            revealed={trackerRevealed}
            data={data}
            save={save}
            ready={ready}
            bannerDataRef={bannerDataRef}
            bannerDataReady={bannerDataReady}
            bannerSchedules={bannerSchedules}
            bannerPanelWidths={bannerPanelWidths}
            gameBgUrl={gameBgUrl}
            onGoHome={() => {
              isInitialLoadRef.current = false;
              setTrackerRevealed(false);
              setBgOnHomepage(true);
              setTimeout(() => setShowHomepage(true), 200);
            }}
            onGameSelect={setDisplayedGameId}
          />
        )}
      </div>

      {/* ── Always-visible window controls ── */}
      <div className="title-bar-controls--fixed">
        <button className="title-bar-btn" onClick={() => setShowSettings(true)} title="Settings">
          <Settings size={16} />
        </button>
        <button className="title-bar-btn" onClick={() => window.api?.minimizeWindow()} title="Minimize">
          <Minus size={16} />
        </button>
        <button
          className="title-bar-btn title-bar-btn--close"
          onClick={() => (settings.minimizeOnClose ?? false) ? window.api?.minimizeWindow() : window.api?.closeWindow()}
          title={(settings.minimizeOnClose ?? false) ? 'Minimize' : 'Close'}
        >
          <X size={16} />
        </button>
      </div>

      {showHomepage && (
        <HomePage
          appBgUrl={activeBgUrl}
          isReady={!gameBgPending && !appBgPending && ready}
          onBeforeEnterTracker={() => { setTrackerRevealed(true); setBgOnHomepage(false); }}
          onEnterTracker={() => setShowHomepage(false)}
          loadingProgress={loadingProgress}
          loadingDone={loadingDone}
          offlineError={offlineError}
          skipLoadingPhase={!isInitialLoadRef.current}
          calculationDone={calculationDone}
          onLoadingUnlock={() => setLoadingUnlocked(true)}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onAccentChange={handleAccentChange}
          onThemeChange={handleThemeChange}
          onTextSizeChange={handleTextSizeChange}
          onWindowSizeChange={handleWindowSizeChange}
          onLanguageChange={handleLanguageChange}
          onMinimizeOnCloseChange={handleMinimizeOnCloseChange}
          onResetDefaults={handleResetDefaults}
          deletedGames={deletedGames}
          onRestoreGame={(id) => save({ ...data, games: data.games.map(g => g.id === id ? { ...g, deleted: false } : g) })}
          onPermanentDelete={(id) => save({ ...data, games: data.games.filter(g => g.id !== id) })}
          appBgUrl={appBgUrl}
          onAppBgUpload={handleAppBgUpload}
          onAppBgRemove={handleAppBgRemove}
          activeGames={activeGames}
          onRemoveGameBackground={handleRemoveAnyGameBackground}
          onClose={() => setShowSettings(false)}
        />
      )}
    </AccentContext.Provider>
    </ThemeContext.Provider>
    </LangContext.Provider>
    </MotionConfig>
  );
}
