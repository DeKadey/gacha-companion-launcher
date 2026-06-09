const { app, BrowserWindow, ipcMain, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const { parsePaimonMoe, parseExcelMoe, detectMismatch, mergeJsonIntoExcel } = require('./engine/genshin/genshinParse');
const { fetchGenshinBanners } = require('./engine/genshin/bannerFetch');
const { parseHsrExcel } = require('./engine/hsr/hsrParse');
const { fetchRepoFile, fetchRepoBuffer, fetchRepoFileConditional } = require('./engine/dataRepo');

Menu.setApplicationMenu(null);

// Cap the compositor frame rate to 60fps on all displays.
// Fixes a 1px vertical background shift that only appears on 240Hz monitors,
// caused by subpixel rounding differences at high vsync rates.
app.commandLine.appendSwitch('max-fps', '60');

let mainWindow    = null;

const WINDOW_SIZES = {
  XS: [960, 540], S: [1120, 630], M: [1280, 720], L: [1600, 900], XL: [1920, 1080],
};

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.whenReady().then(showAlreadyRunningPopup);
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const storagePath = getStoragePath();
    ensureStorage(storagePath);
    app.storagePath = storagePath;
    const dataRoot = path.dirname(storagePath);
    const bgDir = path.join(dataRoot, 'backgrounds');
    if (!fs.existsSync(bgDir)) fs.mkdirSync(bgDir, { recursive: true });
    app.backgroundsDir = bgDir;
    app.genshinDataDir = path.join(dataRoot, 'data', 'genshin');
    app.hsrDataDir     = path.join(dataRoot, 'data', 'hsr');
    app.zzzDataDir     = path.join(dataRoot, 'data', 'zzz');
    app.iconsDir       = path.join(dataRoot, 'icons');

    // Start the local background file server and store the port so the renderer
    // can fetch it via IPC. The server must be ready before createWindow() so
    // the renderer never calls background:server-port before it exists.
    const { server: bgSrv, port: bgPort } = await startBgServer(bgDir);
    app.bgServer     = bgSrv;
    app.bgServerPort = bgPort;
    app.on('before-quit', () => bgSrv.close());

    // One-time cleanup: remove deprecated files left over from older versions.
    const deprecated = [
      path.join(app.hsrDataDir, 'banner-schedule.json'),
      path.join(app.hsrDataDir, 'name-id-map.json'),
    ];
    for (const f of deprecated) {
      try { fs.unlinkSync(f); } catch (_) {}
    }

    createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

// ─── Background HTTP server ───────────────────────────────────────────────────
// Serves files from app.backgroundsDir over a local-only HTTP server.
// Using a real HTTP server instead of a custom Electron protocol gives <video>
// elements proper range-request (206 Partial Content) support, which is required
// for buffering, seeking, and hardware decode. Bound to 127.0.0.1 only — not
// reachable from outside the machine. Port 0 lets the OS pick a free port.
function startBgServer(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const filename = decodeURIComponent(
          new URL(req.url, 'http://localhost').pathname.slice(1)
        );
        // Prevent path traversal: resolved path must stay inside dir.
        const filePath = path.resolve(dir, filename);
        if (!filePath.startsWith(dir + path.sep) && filePath !== dir) {
          res.writeHead(403); res.end(); return;
        }
        if (!fs.existsSync(filePath)) {
          res.writeHead(404); res.end(); return;
        }
        const stat  = fs.statSync(filePath);
        const total = stat.size;
        const ext   = path.extname(filename).toLowerCase().slice(1);
        const mime  = ({
          mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
          jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
          webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
        })[ext] ?? 'application/octet-stream';

        // Allow canvas.toDataURL() on video frames drawn from this server.
        // Without this header the canvas is "tainted" (cross-origin) and toDataURL throws.
        const cors = { 'Access-Control-Allow-Origin': '*' };

        const rangeHeader = req.headers['range'];
        if (rangeHeader) {
          // Parse "bytes=start-end" — end is optional (means last byte).
          const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
          const start = parseInt(startStr, 10);
          const end   = endStr ? parseInt(endStr, 10) : total - 1;
          res.writeHead(206, {
            ...cors,
            'Content-Range':  `bytes ${start}-${end}/${total}`,
            'Accept-Ranges':  'bytes',
            'Content-Length': end - start + 1,
            'Content-Type':   mime,
          });
          fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
          res.writeHead(200, {
            ...cors,
            'Content-Length': total,
            'Content-Type':   mime,
            'Accept-Ranges':  'bytes',
          });
          fs.createReadStream(filePath).pipe(res);
        }
      } catch (_) {
        try { res.writeHead(500); res.end(); } catch (__) {}
      }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ─── Window helpers ───────────────────────────────────────────────────────────

// Ask Windows 11 DWM to round this window's corners.
// thickFrame:false removes WS_THICKFRAME — the style Windows 11 uses as a signal to auto-round.
// The opt-in API (DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWCP_ROUND = 2) explicitly requests
// rounding even without WS_THICKFRAME.
// Uses koffi (N-API based FFI — ABI-stable, no electron-rebuild needed) for a synchronous
// in-process DLL call. Silently no-ops on Windows 10 (DWM returns an error, we ignore it).
// Intercept WM_NCHITTEST and return HTCLIENT for every position.
// Without this, Windows claims the right and bottom edge pixels as non-client
// resize/border areas even with resizable:false + thickFrame:false.
// Window dragging is unaffected — it is handled by JS in TitleBar.js.
let _originalWndProc  = null;
let _wndProcCallback  = null;

function hookNchittest(win) {
  if (process.platform !== 'win32') return;
  try {
    const koffi   = require('koffi');
    const user32  = koffi.load('user32.dll');
    const gdi32   = koffi.load('gdi32.dll');

    const GetWindowLongPtrW = user32.func('intptr __stdcall GetWindowLongPtrW(intptr hwnd, int index)');
    const SetWindowLongPtrW = user32.func('intptr __stdcall SetWindowLongPtrW(intptr hwnd, int index, intptr newLong)');
    const CallWindowProcW   = user32.func('intptr __stdcall CallWindowProcW(intptr prev, intptr hwnd, uint32 msg, uintptr wParam, intptr lParam)');
    const GetClientRect     = user32.func('bool __stdcall GetClientRect(intptr hwnd, void* lpRect)');
    const FillRect          = user32.func('int __stdcall FillRect(intptr hDC, void* lprc, intptr hbr)');
    const CreateSolidBrush  = gdi32.func('intptr __stdcall CreateSolidBrush(uint32 crColor)');
    const SetCursorFn_p     = user32.func('intptr __stdcall SetCursor(intptr hCursor)');

    const WndProcType = koffi.proto('intptr __stdcall WndProc(intptr hwnd, uint32 msg, uintptr wParam, intptr lParam)');

    const GWLP_WNDPROC  = -4;
    const WM_ERASEBKGND = 0x0014;
    const WM_NCCALCSIZE = 0x0083;
    const WM_NCHITTEST  = 0x0084;
    const WM_SETCURSOR  = 0x0020;
    const HTCLIENT      = 1;

    const hwndBuf = win.getNativeWindowHandle();
    const hwnd    = Number(hwndBuf.length >= 8 ? hwndBuf.readBigInt64LE(0) : hwndBuf.readInt32LE(0));

    // Create a persistent dark brush (#0f0f13 as Win32 COLORREF = 0x00BBGGRR).
    // Used to fill the window background before Chromium's first paint, preventing
    // the default white WM_ERASEBKGND fill that causes a white flash on window show.
    const DARK_BG = 0x00130F0F; // #0f0f13 in BGR order
    const _darkBrush = CreateSolidBrush(DARK_BG);

    _originalWndProc = GetWindowLongPtrW(hwnd, GWLP_WNDPROC);

    _wndProcCallback = koffi.register((h, msg, wp, lp) => {
      // Returning 0 when wParam=1 tells Windows the entire window rectangle is
      // client area — no implicit DWM frame inset on right/bottom edges.
      if (msg === WM_NCCALCSIZE && wp !== 0) return 0;
      if (msg === WM_NCHITTEST) return HTCLIENT;
      // Hide the OS cursor on the main HWND (including DWM-managed edge strip).
      // SetCursor(NULL) actively removes the cursor from screen; returning TRUE
      // tells Windows the message is handled so DefWindowProc doesn't restore it.
      if (msg === WM_SETCURSOR) { SetCursorFn_p(0); return 1; }
      // Fill with dark color on erase so the window is never white before Chromium paints.
      if (msg === WM_ERASEBKGND) {
        const rectBuf = Buffer.alloc(16);
        GetClientRect(h, rectBuf);
        FillRect(Number(wp), rectBuf, _darkBrush);
        return 1;
      }
      return CallWindowProcW(_originalWndProc, h, msg, wp, lp);
    }, koffi.pointer(WndProcType));

    SetWindowLongPtrW(hwnd, GWLP_WNDPROC, koffi.address(_wndProcCallback));
  } catch (e) {
    console.error('[hookNchittest] failed:', e);
  }
}


let _dwmSetWindowAttribute = null;
function applyDwmRoundedCorners(win) {
  if (process.platform !== 'win32') return;
  try {
    if (!_dwmSetWindowAttribute) {
      const koffi = require('koffi');
      const dwmapi = koffi.load('dwmapi.dll');
      // hwnd is declared as intptr (pointer-sized integer) — NOT void*.
      // Passing a Buffer as void* gives koffi the JS heap address of the buffer,
      // not the HWND value stored inside it. intptr lets us pass the raw integer.
      _dwmSetWindowAttribute = dwmapi.func('int DwmSetWindowAttribute(intptr hwnd, uint32 attr, void* pvAttr, uint32 cbAttr)');
    }
    const hwndBuf = win.getNativeWindowHandle();
    // Extract the actual HWND integer from the Buffer (8-byte LE on 64-bit Windows).
    const hwnd = Number(hwndBuf.length >= 8 ? hwndBuf.readBigInt64LE(0) : hwndBuf.readInt32LE(0));
    const pref = Buffer.alloc(4);
    pref.writeInt32LE(2, 0); // DWMWCP_ROUND = 2
    _dwmSetWindowAttribute(hwnd, 33, pref, 4); // 33 = DWMWA_WINDOW_CORNER_PREFERENCE
  } catch (_) {
    // Silently ignore — corners stay square but nothing breaks.
  }
}

// Reads a JSON file, stripping a leading UTF-8 BOM if present.
// PowerShell -Encoding UTF8 on Windows adds a BOM that JSON.parse rejects.
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^﻿/, ''));
}

function getInitialWindowSize(storagePath) {
  try {
    const data = readJson(storagePath);
    const size = data?.settings?.windowSize ?? 'M';
    return WINDOW_SIZES[size] ?? WINDOW_SIZES.M;
  } catch {
    return WINDOW_SIZES.M;
  }
}

function createWindow() {
  const [w, h] = getInitialWindowSize(app.storagePath);
  mainWindow = new BrowserWindow({
    width: w,
    height: h,
    frame: false,
    resizable: false,
    thickFrame: false,       // removes WS_THICKFRAME non-client border strips
    // transparent: true is intentionally omitted. With transparent:true, the DWM surface starts
    // fully transparent and there is a 1-2 frame gap before Chromium's compositor delivers the
    // first painted frame, causing an intermittent transparent flash on startup that cannot be
    // eliminated by any CSS or ready-to-show trick. With transparent:false, backgroundColor fills
    // the DWM surface buffer immediately and synchronously — the window is never transparent.
    // DWM rounded corners (DWMWCP_ROUND, set via applyDwmRoundedCorners below) still make the
    // corner pixels transparent to the desktop — no visual difference from the user's perspective.
    backgroundColor: '#0f0f13', // pre-paint buffer fill — window shows this dark color from frame 0
    hasShadow: false,        // without this Windows adds a rectangular drop shadow that fills the
                             // transparent corners and makes them visually opaque
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Apply DWM rounded corners immediately — window is still hidden (show:false) so there is
  // no visible flash. koffi makes this a synchronous in-process call (~microseconds), so the
  // corners are set before the window is ever shown. Must be called AFTER Electron's internal
  // window setup (which erroneously sets DWMWCP_DONOTROUND when resizable:false — bug #32981),
  // and new BrowserWindow() completes that setup synchronously, so calling here is correct.
  applyDwmRoundedCorners(mainWindow);
  hookNchittest(mainWindow);

  // Show the window only once React has rendered — prevents any white flash.
  mainWindow.once('ready-to-show', () => {
    // Start invisible so the Win32 window exists (Chromium needs it) but the user
    // sees nothing. Opacity 1 is set only when the renderer explicitly signals that
    // React has mounted and painted — at that point Chromium's frame has already
    // been in DWM's buffer for at least one vsync, so there is nothing to flash.
    mainWindow.setOpacity(0);
    mainWindow.show();
  });

  // Renderer sends 'app:ready' from its first useEffect (after first DOM paint).
  // Only then do we make the window visible — the renderer handshake guarantees
  // DWM already has the correct frame, eliminating the white-flash race entirely.
  ipcMain.once('app:ready', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setOpacity(1);
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'build', 'index.html'));
  } else {
    mainWindow.loadURL('http://localhost:3000');
  }
}


function showAlreadyRunningPopup() {
  const popup = new BrowserWindow({
    width: 380,
    height: 180,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#0f0f13',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  popup.loadFile(path.join(__dirname, 'already-running.html'));
  popup.once('closed', () => app.quit());
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function getStoragePath() {
  const userDataDir = path.join(app.getPath('userData'), 'storage');
  return path.join(userDataDir, 'user.json');
}

function ensureStorage(storagePath) {
  const dir = path.dirname(storagePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(storagePath)) {
    fs.writeFileSync(storagePath, JSON.stringify({ games: [] }, null, 2));
  }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('theme:get-system', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

nativeTheme.on('updated', () => {
  mainWindow?.webContents.send('theme:system-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
});

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.on('window:move-by', (_, dx, dy) => {
  if (!mainWindow) return;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(x + Math.round(dx), y + Math.round(dy));
});

ipcMain.handle('loginItem:get', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('loginItem:set', (_, enabled) => app.setLoginItemSettings({ openAtLogin: enabled }));

ipcMain.handle('window:resize', (_, size) => {
  const dims = WINDOW_SIZES[size] ?? WINDOW_SIZES.M;
  if (mainWindow) {
    mainWindow.setResizable(true);
    mainWindow.setSize(dims[0], dims[1]);
    mainWindow.setResizable(false);
    mainWindow.center();
  }
});

// ─── UID folder helpers ───────────────────────────────────────────────────────

const UID_STATE_FIELDS = new Set([
  'pullLog', 'charPity', 'charGuaranteed', 'weaponPity', 'weaponGuaranteed',
  'chronicledPity', 'chronicledGuaranteed', 'fatePoints', 'currency', 'currentCurrency',
  'pullItems', 'goals', 'wishList', 'history', 'hsrBannerList', 'lastSynced',
  'excelImported', 'jsonImported', 'apiBackup',
]);

function getGameDataDir(linkedDatabase, uid) {
  const typeDir = linkedDatabase === 'hsr'
    ? app.hsrDataDir
    : linkedDatabase === 'zzz'
      ? app.zzzDataDir
      : app.genshinDataDir;
  return path.join(typeDir, uid || 'default');
}

ipcMain.handle('storage:read', () => {
  try {
    const raw = readJson(app.storagePath);
    let dirty = false;

    const games = (raw.games ?? []).map(game => {
      // ── Icon migration: inline base64 → file ─────────────────────────────
      if (game.iconPath?.startsWith('data:')) {
        try {
          const ext     = (game.iconPath.match(/data:image\/(\w+);/) ?? [])[1] ?? 'png';
          const safeExt = ext === 'jpeg' ? 'jpg' : ext;
          const filename = `${game.id}.${safeExt}`;
          const base64   = game.iconPath.replace(/^data:image\/\w+;base64,/, '');
          fs.mkdirSync(app.iconsDir, { recursive: true });
          fs.writeFileSync(path.join(app.iconsDir, filename), Buffer.from(base64, 'base64'));
          const { iconPath: _ip, ...gameNoIcon } = game;
          game = { ...gameNoIcon, iconFilename: filename };
        } catch (_) {}
        dirty = true;
      }

      // ── Icon load: file → runtime iconPath ───────────────────────────────
      if (game.iconFilename) {
        try {
          const filePath = path.join(app.iconsDir, game.iconFilename);
          if (fs.existsSync(filePath)) {
            const ext  = path.extname(game.iconFilename).slice(1);
            const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
            game = { ...game, iconPath: `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}` };
          }
        } catch (_) {}
      }

      const db = game.linkedDatabase;
      if (!db) return game;

      let uid   = game.uid;
      let state = { ...(game.state ?? {}) };

      // Auto-migrate games without uid that have inline UID-scoped state
      if (!uid && !state._migrated) {
        uid = 'default';
        const { apiBackup, ...rest } = state;
        const uidState    = {};
        const configState = {};
        for (const [k, v] of Object.entries(rest)) {
          if (UID_STATE_FIELDS.has(k)) uidState[k] = v;
          else configState[k] = v;
        }
        const dir = getGameDataDir(db, uid);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(uidState, null, 2));
        if (apiBackup?.length) {
          const backupDir = path.join(dir, 'backups');
          fs.mkdirSync(backupDir, { recursive: true });
          fs.writeFileSync(path.join(backupDir, 'pull_backup.json'), JSON.stringify(apiBackup, null, 2));
        }
        state = { ...configState, _migrated: true };
        dirty = true;
      }

      if (!uid) return game;

      // Load UID-specific state from file
      const dir      = getGameDataDir(db, uid);
      const dataFile = path.join(dir, 'data.json');
      const uidState = fs.existsSync(dataFile) ? readJson(dataFile) : {};
      const backupFile = path.join(dir, 'backups', 'pull_backup.json');
      const apiBackup  = fs.existsSync(backupFile) ? readJson(backupFile) : [];

      return { ...game, uid, state: { ...state, ...uidState, apiBackup } };
    });

    if (dirty) {
      const leanGames = games.map(g => {
        const { iconPath: _ip, ...gNoIcon } = g;          // always strip runtime iconPath
        if (!gNoIcon.uid || !gNoIcon.linkedDatabase) return gNoIcon;
        const configState = {};
        for (const [k, v] of Object.entries(gNoIcon.state ?? {})) {
          if (!UID_STATE_FIELDS.has(k)) configState[k] = v;
        }
        return { ...gNoIcon, state: configState };
      });
      fs.writeFileSync(app.storagePath, JSON.stringify({ ...raw, games: leanGames }, null, 2));
    }

    return { ...raw, games };
  } catch {
    return { games: [] };
  }
});

ipcMain.handle('storage:write', (_, data) => {
  try {
    fs.writeFileSync(app.storagePath, JSON.stringify(data, null, 2));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ─── Icon IPC handlers ────────────────────────────────────────────────────────

ipcMain.handle('icon:save', (_, { gameId, dataUrl }) => {
  try {
    const ext      = (dataUrl.match(/data:image\/(\w+);/) ?? [])[1] ?? 'png';
    const safeExt  = ext === 'jpeg' ? 'jpg' : ext;
    const filename = `${gameId}.${safeExt}`;
    const base64   = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    fs.mkdirSync(app.iconsDir, { recursive: true });
    fs.writeFileSync(path.join(app.iconsDir, filename), Buffer.from(base64, 'base64'));
    return { ok: true, filename };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('icon:read', (_, filename) => {
  try {
    const filePath = path.join(app.iconsDir, filename);
    if (!fs.existsSync(filePath)) return null;
    const ext  = path.extname(filename).slice(1);
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
  } catch { return null; }
});

ipcMain.handle('game:uidExists', (_, { linkedDatabase, uid }) => {
  const file = path.join(getGameDataDir(linkedDatabase, uid), 'data.json');
  return fs.existsSync(file);
});

ipcMain.handle('game:readState', (_, { linkedDatabase, uid }) => {
  try {
    const file = path.join(getGameDataDir(linkedDatabase, uid), 'data.json');
    if (!fs.existsSync(file)) return {};
    return readJson(file);
  } catch { return {}; }
});

ipcMain.handle('game:writeState', (_, { linkedDatabase, uid, state }) => {
  try {
    const dir = getGameDataDir(linkedDatabase, uid);
    if (!fs.existsSync(dir)) {
      if (!(state.pullLog?.length > 0)) return { ok: true };
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(state, null, 2));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('game:readBackup', (_, { linkedDatabase, uid }) => {
  try {
    const file = path.join(getGameDataDir(linkedDatabase, uid), 'backups', 'pull_backup.json');
    if (!fs.existsSync(file)) return [];
    return readJson(file);
  } catch { return []; }
});

ipcMain.handle('game:writeBackup', (_, { linkedDatabase, uid, backup }) => {
  try {
    if (!backup?.length) return { ok: true };
    const dir = getGameDataDir(linkedDatabase, uid);
    if (!fs.existsSync(dir)) return { ok: true };
    const backupDir = path.join(dir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'pull_backup.json'), JSON.stringify(backup, null, 2));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('game:clearUidState', (_, { linkedDatabase, uid }) => {
  try {
    const dir = getGameDataDir(linkedDatabase, uid);
    const dataFile   = path.join(dir, 'data.json');
    const backupFile = path.join(dir, 'backups', 'pull_backup.json');
    if (fs.existsSync(dataFile))   fs.writeFileSync(dataFile,   JSON.stringify({}, null, 2));
    if (fs.existsSync(backupFile)) fs.writeFileSync(backupFile, JSON.stringify([], null, 2));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ─── Background IPC handlers ──────────────────────────────────────────────────

// Hashes the first 64 KB of a file + its total size.
// Fast for any file size; reliable enough that two different user video files
// will never collide in practice.
const BG_HASH_SAMPLE = 65536;
function sampleHash(buf, totalSize) {
  const sample = buf.length <= BG_HASH_SAMPLE ? buf : buf.subarray(0, BG_HASH_SAMPLE);
  return crypto.createHash('sha256').update(sample).update(String(totalSize)).digest('hex');
}

ipcMain.handle('background:save', (_, { filename, buffer }) => {
  try {
    const filePath = path.join(app.backgroundsDir, filename);
    const buf = Buffer.from(buffer);
    fs.writeFileSync(filePath, buf);
    return { ok: true, hash: sampleHash(buf, buf.length) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Reads only the first 64 KB from an existing file to compute its hash.
// Used for lazy migration of backgrounds saved before hash tracking was added.
// Completes in < 1 ms for any file size.
ipcMain.handle('background:hash', (_, filename) => {
  try {
    const filePath = path.join(app.backgroundsDir, filename);
    if (!fs.existsSync(filePath)) return null;
    const stat    = fs.statSync(filePath);
    const readLen = Math.min(BG_HASH_SAMPLE, stat.size);
    const sample  = Buffer.alloc(readLen);
    const fd      = fs.openSync(filePath, 'r');
    fs.readSync(fd, sample, 0, readLen, 0);
    fs.closeSync(fd);
    return sampleHash(sample, stat.size);
  } catch {
    return null;
  }
});

ipcMain.handle('background:read', (_, filename) => {
  try {
    const filePath = path.join(app.backgroundsDir, filename);
    if (!fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filename).toLowerCase().slice(1);
    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', mp4: 'video/mp4' };
    const mime = mimeMap[ext] ?? 'image/jpeg';
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
});

ipcMain.handle('background:list', () => {
  try {
    const files = fs.readdirSync(app.backgroundsDir);
    return files.map(filename => {
      const filePath = path.join(app.backgroundsDir, filename);
      const stats = fs.statSync(filePath);
      return { filename, sizeBytes: stats.size };
    });
  } catch {
    return [];
  }
});

// Lightweight existence + type check — returns { isVideo } or null if file not found.
// Used by the renderer before building a bg server URL so it knows whether to render
// an <img> or a <video> element without transferring any file data over IPC.
ipcMain.handle('background:info', (_, filename) => {
  try {
    const filePath = path.join(app.backgroundsDir, filename);
    if (!fs.existsSync(filePath)) return null;
    const ext = path.extname(filename).toLowerCase().slice(1);
    return { isVideo: ['mp4', 'webm', 'mov'].includes(ext) };
  } catch {
    return null;
  }
});

ipcMain.handle('background:server-port', () => app.bgServerPort);

ipcMain.handle('background:delete', (_, filename) => {
  try {
    const filePath = path.join(app.backgroundsDir, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ─── Genshin data IPC handlers ────────────────────────────────────────────────

ipcMain.handle('genshin:fetchBanners', async () => {
  try {
    return await fetchGenshinBanners(app.genshinDataDir);
  } catch (e) {
    return { ok: false, banners: null, fromCache: false, offline: true, error: e.message };
  }
});

// Detect whether a buffer is WebP (RIFF....WEBP) so we can return the correct
// MIME type in the data URI — paimon.moe now serves newer banner images as WebP
// even though the URL still ends in .png.
function detectImageMime(buf) {
  if (buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) { // WEBP
    return 'image/webp';
  }
  return 'image/png';
}


// ─── Gacha import IPC handlers ────────────────────────────────────────────────

ipcMain.handle('gacha:parsePaimonMoe', (_, { jsonText, existingLog }) => {
  try {
    return { ok: true, ...parsePaimonMoe(jsonText, existingLog) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('gacha:parseExcelMoe', (_, { buffer, existingLog }) => {
  try {
    return { ok: true, ...parseExcelMoe(Buffer.from(buffer), existingLog) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('gacha:detectMismatch', (_, { jsonLog, excelLog }) => {
  try {
    return { ok: true, diffs: detectMismatch(jsonLog, excelLog) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('gacha:mergeJsonIntoExcel', (_, { jsonLog, excelLog }) => {
  try {
    return { ok: true, merged: mergeJsonIntoExcel(jsonLog, excelLog) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ─── HSR warp-log URL extraction ─────────────────────────────────────────────

// Downloads and runs the StarRailStation warp-link script (same pattern as
// paimon.moe's getlink.ps1 for Genshin). The script reads HSR's web cache,
// extracts the getGachaLog URL, and writes it to stdout.
ipcMain.handle('hsr:readLog', () => {
  return new Promise((resolve) => {
    const psScript = [
      '[Net.ServicePointManager]::SecurityProtocol =',
      '  [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12;',
      'Invoke-Expression (New-Object Net.WebClient).DownloadString(',
      "  'https://gist.githubusercontent.com/Star-Rail-Station/2512df54c4f35d399cc9abbde665e8f0/raw/get_warp_link_os.ps1?cachebust=srs'",
      ')',
    ].join(' ');

    const ps = spawn('powershell.exe', [
      '-NonInteractive',
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-Command', psScript,
    ], { windowsHide: true });

    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', d => { stdout += d.toString(); });
    ps.stderr.on('data', d => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      ps.kill();
      resolve({ ok: false, error: 'Timed out retrieving warp URL. Make sure Star Rail is open and you have visited your Warp History in-game.' });
    }, 30000);

    ps.on('close', () => {
      clearTimeout(timer);
      const matches = [...stdout.matchAll(/https:\/\/\S+(?:getGachaLog|getLdGachaLog)\S+/g)];
      if (matches.length) {
        resolve({ ok: true, url: matches[matches.length - 1][0].trim() });
      } else {
        resolve({ ok: false, error: 'Could not find warp URL. Open Star Rail, visit your Warp History (any banner), then try again.' });
      }
    });

    ps.on('error', err => {
      clearTimeout(timer);
      resolve({ ok: false, error: `PowerShell unavailable: ${err.message}` });
    });
  });
});

// ─── ZZZ signal-log URL extraction ───────────────────────────────────────────
// Inline script — reads ZZZ's web cache directly without any network calls.
// The original rng.moe script validated the URL via Invoke-WebRequest (no
// timeout), which caused the 30 s hang when the cached key was expired.
// Our fetchWishHistory handler already handles expired keys, so we skip that.

ipcMain.handle('zzz:readLog', () => {
  return new Promise((resolve) => {
    const os = require('os');
    const tmpFile = path.join(os.tmpdir(), `zzz-link-${Date.now()}.ps1`);

    const scriptLines = [
      '$ErrorActionPreference = "SilentlyContinue"',
      '$ProgressPreference = "SilentlyContinue"',
      '[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12',
      '',
      '$locallow = [IO.Path]::Combine([Environment]::GetFolderPath("ApplicationData"), "..", "LocalLow", "miHoYo", "ZenlessZoneZero")',
      '$logPath = Join-Path $locallow "Player.log"',
      'if (-not [IO.File]::Exists($logPath)) { $logPath = Join-Path $locallow "Player-prev.log" }',
      'if (-not [IO.File]::Exists($logPath)) { Write-Output "ERR:no_log"; exit 1 }',
      '',
      '$gamePath = ""',
      'foreach ($line in (Get-Content $logPath -First 16)) {',
      '  if ($line.StartsWith("[Subsystems] Discovering subsystems at path ")) {',
      '    $gamePath = $line.Replace("[Subsystems] Discovering subsystems at path ", "").Replace("UnitySubsystems", "")',
      '    break',
      '  }',
      '}',
      'if ([string]::IsNullOrEmpty($gamePath)) { Write-Output "ERR:no_game_path"; exit 1 }',
      '',
      '$cacheFolders = Get-ChildItem (Join-Path $gamePath "webCaches") -Directory -ErrorAction SilentlyContinue',
      '$maxVer = [long]0',
      '$cachePath = ""',
      'foreach ($f in $cacheFolders) {',
      '  if ($f.Name -match "^\\d+\\.\\d+\\.\\d+\\.\\d+$") {',
      '    $ver = [long](-join ($f.Name.Split(".") | ForEach-Object { $_.PadLeft(3, "0") }))',
      '    if ($ver -ge $maxVer) { $maxVer = $ver; $cachePath = Join-Path $f.FullName "Cache\\Cache_Data\\data_2" }',
      '  }',
      '}',
      'if ([string]::IsNullOrEmpty($cachePath) -or -not [IO.File]::Exists($cachePath)) { Write-Output "ERR:no_cache"; exit 1 }',
      '',
      '$tmp = [IO.Path]::GetTempFileName()',
      'Copy-Item $cachePath $tmp -Force',
      '$data = [IO.File]::ReadAllText($tmp, [Text.Encoding]::UTF8)',
      'Remove-Item $tmp -Force',
      '',
      '$parts = $data -split "1/0/"',
      'for ($i = $parts.Length - 1; $i -ge 0; $i--) {',
      '  $p = $parts[$i]',
      '  if ($p.StartsWith("http") -and $p.Contains("getGachaLog")) {',
      '    $url = ($p -split [char]0)[0]',
      '    Write-Output $url',
      '    exit 0',
      '  }',
      '}',
      'Write-Output "ERR:no_url"',
      'exit 1',
    ];

    try {
      fs.writeFileSync(tmpFile, scriptLines.join('\n'), 'utf8');
    } catch (e) {
      resolve({ ok: false, error: `Failed to write temp script: ${e.message}` });
      return;
    }

    const ps = spawn('powershell.exe', [
      '-NonInteractive',
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-File', tmpFile,
    ], { windowsHide: true });

    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', d => { stdout += d.toString(); });
    ps.stderr.on('data', d => { stderr += d.toString(); });

    const cleanup = () => { try { fs.unlinkSync(tmpFile); } catch (_) {} };

    const timer = setTimeout(() => {
      ps.kill();
      cleanup();
      resolve({ ok: false, error: 'Timed out retrieving signal URL. Make sure Zenless Zone Zero is open and you have visited your Signal Search in-game.' });
    }, 30000);

    ps.on('close', () => {
      clearTimeout(timer);
      cleanup();
      const matches = [...stdout.matchAll(/https:\/\/\S+getGachaLog\S+/g)];
      if (matches.length) {
        // Strip the raw URL down to the 8 auth/identity params the API needs.
        // Keeping extra params like gacha_id, init_log_gacha_type, begin_id causes
        // the API to hang when gacha_type doesn't match them — confirmed by testing.
        const raw  = new URL(matches[matches.length - 1][0].trim());
        const keep = ['authkey_ver', 'sign_type', 'auth_appid', 'authkey', 'lang', 'region', 'game_biz', 'plat_type'];
        const clean = new URL(`${raw.protocol}//${raw.host}${raw.pathname}`);
        for (const k of keep) {
          if (raw.searchParams.has(k)) clean.searchParams.set(k, raw.searchParams.get(k));
        }
        resolve({ ok: true, url: clean.toString() });
      } else {
        let errMsg = 'Could not find signal URL. Open Zenless Zone Zero, visit your Signal Search (any banner), then try again.';
        if (stdout.includes('ERR:no_log'))       errMsg = 'Could not find ZZZ log file. Make sure Zenless Zone Zero has been launched at least once.';
        else if (stdout.includes('ERR:no_game_path')) errMsg = 'Could not find ZZZ install path. Make sure Zenless Zone Zero has been launched recently.';
        else if (stdout.includes('ERR:no_cache')) errMsg = 'Could not find ZZZ web cache. Open Zenless Zone Zero, visit your Signal Search (any banner), then try again.';
        resolve({ ok: false, error: errMsg });
      }
    });

    ps.on('error', err => {
      clearTimeout(timer);
      cleanup();
      resolve({ ok: false, error: `PowerShell unavailable: ${err.message}` });
    });
  });
});

// ─── HSR import IPC handlers ──────────────────────────────────────────────────

ipcMain.handle('hsr:parseExcel', async (_, { buffer }) => {
  try {
    return { ok: true, ...parseHsrExcel(Buffer.from(buffer), null) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('hsr:fetchBanners', async () => {
  try {
    const { bannerSchedule } = await fetchHsrBannerData().catch(() => ({ bannerSchedule: [] }));
    return { ok: true, bannerSchedule };
  } catch (e) {
    return { ok: false, bannerSchedule: [], error: e.message };
  }
});

ipcMain.handle('hsr:getBannerImage', async (_, { id }) => {
  try {
    const cacheDir  = path.join(app.hsrDataDir, 'banner-images');
    fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, `${id}.png`);
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile);
      return `data:${detectImageMime(data)};base64,${data.toString('base64')}`;
    }
    const data = await fetchRepoBuffer(`hsr/images/${id}.png`);
    fs.writeFileSync(cacheFile, data);
    return `data:${detectImageMime(data)};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
});

// ─── Pull DB IPC handlers ─────────────────────────────────────────────────────

ipcMain.handle('gacha:readPullDb', (_, gameId) => {
  try {
    const dbPath = path.join(app.genshinDataDir, `${gameId}-pull-db.json`);
    if (!fs.existsSync(dbPath)) return { ok: true, db: null };
    const db = readJson(dbPath);
    return { ok: true, db };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('gacha:writePullDb', (_, { gameId, db }) => {
  try {
    fs.mkdirSync(app.genshinDataDir, { recursive: true });
    const dbPath = path.join(app.genshinDataDir, `${gameId}-pull-db.json`);
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Retrieve the Genshin wish-history URL via the Paimon.moe PowerShell script.
// Runs entirely hidden — no terminal window is ever shown to the user.
ipcMain.handle('gacha:readGenshinLog', () => {
  return new Promise((resolve) => {
    const psScript = [
      'Set-ExecutionPolicy Bypass -Scope Process -Force;',
      '[System.Net.ServicePointManager]::SecurityProtocol =',
      '  [System.Net.ServicePointManager]::SecurityProtocol -bor 3072;',
      'iex "&{$((New-Object System.Net.WebClient).DownloadString(',
      "  'https://gist.github.com/MadeBaruna/1d75c1d37d19eca71591ec8a31178235/raw/getlink.ps1'",
      '))} global"',
    ].join(' ');

    const ps = spawn('powershell.exe', [
      '-NonInteractive',
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-Command', psScript,
    ], { windowsHide: true });

    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', d => { stdout += d.toString(); });
    ps.stderr.on('data', d => { stderr += d.toString(); });

    // 30-second timeout in case the script hangs
    const timer = setTimeout(() => {
      ps.kill();
      resolve({ ok: false, error: 'Timed out retrieving wish URL. Make sure Genshin Impact is open and you have visited your wish history.' });
    }, 30000);

    ps.on('close', () => {
      clearTimeout(timer);
      const matches = [...stdout.matchAll(/https:\/\/\S+getGachaLog\S+/g)];
      if (matches.length) {
        resolve({ ok: true, url: matches[matches.length - 1][0].trim() });
      } else {
        resolve({ ok: false, error: 'Could not find wish history URL. Open Genshin Impact, visit your wish history, then try again.' });
      }
    });

    ps.on('error', err => {
      clearTimeout(timer);
      resolve({ ok: false, error: `PowerShell unavailable: ${err.message}` });
    });
  });
});

// ─── HSR banner data ──────────────────────────────────────────────────────────

// Fetches HSR banner data. Builds two things:
// Fetches HSR banner schedule from private repo, falling back to local cache.
async function fetchHsrBannerData() {
  fs.mkdirSync(app.hsrDataDir, { recursive: true });
  const schedulePath = path.join(app.hsrDataDir, 'banner-schedule-hsr.json');
  const etagPath     = path.join(app.hsrDataDir, 'banner-schedule-hsr.etag');

  let storedSchedule = [];
  if (fs.existsSync(schedulePath)) {
    try { storedSchedule = readJson(schedulePath); } catch (_) {}
  }

  try {
    let storedEtag = null;
    try { storedEtag = fs.readFileSync(etagPath, 'utf-8').trim(); } catch (_) {}

    const result = await fetchRepoFileConditional('hsr/banner-schedule-hsr.json', storedEtag);

    if (result.notModified) return { bannerSchedule: storedSchedule };

    const repoSchedule = JSON.parse(result.body);
    const dedupKey     = b => `${b.featuredId ?? b.name}|${(b.start ?? '').slice(0, 10)}`;
    const existingIds  = new Set(repoSchedule.map(dedupKey));
    const localOnly    = storedSchedule.filter(b => !existingIds.has(dedupKey(b)));
    const merged       = [...repoSchedule, ...localOnly];
    fs.writeFileSync(schedulePath, JSON.stringify(merged));
    if (result.etag) fs.writeFileSync(etagPath, result.etag);
    return { bannerSchedule: merged };
  } catch (_) {}

  return { bannerSchedule: storedSchedule };
}

// ─── ZZZ banner data ──────────────────────────────────────────────────────────

// Fetches ZZZ banner schedule from private repo, falling back to local cache.
async function fetchZzzBannerData() {
  fs.mkdirSync(app.zzzDataDir, { recursive: true });
  const schedulePath = path.join(app.zzzDataDir, 'banner-schedule-zzz.json');
  const etagPath     = path.join(app.zzzDataDir, 'banner-schedule-zzz.etag');

  let storedSchedule = [];
  if (fs.existsSync(schedulePath)) {
    try { storedSchedule = readJson(schedulePath); } catch (_) {}
  }

  try {
    let storedEtag = null;
    try { storedEtag = fs.readFileSync(etagPath, 'utf-8').trim(); } catch (_) {}

    const result = await fetchRepoFileConditional('zzz/banner-schedule-zzz.json', storedEtag);

    if (result.notModified) return { bannerSchedule: storedSchedule };

    const repoSchedule = JSON.parse(result.body);
    const dedupKey     = b => `${b.featuredId ?? b.name}|${(b.start ?? '').slice(0, 10)}`;
    const existingIds  = new Set(repoSchedule.map(dedupKey));
    const localOnly    = storedSchedule.filter(b => !existingIds.has(dedupKey(b)));
    const merged       = [...repoSchedule, ...localOnly];
    fs.writeFileSync(schedulePath, JSON.stringify(merged));
    if (result.etag) fs.writeFileSync(etagPath, result.etag);
    return { bannerSchedule: merged };
  } catch (_) {}

  return { bannerSchedule: storedSchedule };
}

ipcMain.handle('zzz:fetchBanners', async () => {
  try {
    return { ok: true, ...(await fetchZzzBannerData()) };
  } catch (e) {
    return { ok: false, bannerSchedule: [], error: e.message };
  }
});

// ZZZ banner image — disk cache → private repo
ipcMain.handle('zzz:getBannerImage', async (_, { id }) => {
  try {
    const cacheDir  = path.join(app.zzzDataDir, 'banner-images');
    fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, `${id}.png`);
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile);
      return `data:${detectImageMime(data)};base64,${data.toString('base64')}`;
    }
    const data = await fetchRepoBuffer(`zzz/images/${id}.png`);
    fs.writeFileSync(cacheFile, data);
    return `data:${detectImageMime(data)};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
});

// ─── Genshin banner image by featuredId ───────────────────────────────────────

ipcMain.handle('genshin:getBannerImageById', async (_, { id }) => {
  try {
    const bannerImgDir = path.join(app.genshinDataDir, 'banner-images');
    fs.mkdirSync(bannerImgDir, { recursive: true });
    const cacheFile = path.join(bannerImgDir, `${id}.png`);
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile);
      return `data:${detectImageMime(data)};base64,${data.toString('base64')}`;
    }
    const data = await fetchRepoBuffer(`genshin/images/${id}.png`);
    fs.writeFileSync(cacheFile, data);
    return `data:${detectImageMime(data)};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
});

// On app launch: refresh banner data (name→ID map + schedule), then sweep all
// HSR bannerLists and the stored schedule to pre-cache any missing images.
// Runs fire-and-forget after createWindow() so it never delays startup.

// Make a single HTTPS GET request and return a raw Buffer
function httpsGetBuffer(urlStr) {
  return new Promise((resolve, reject) => {
    const lib = urlStr.startsWith('https') ? https : http;
    const req = lib.get(urlStr, { timeout: 20000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out.')); });
  });
}

// Make a single HTTPS GET request and parse the JSON response
function httpsGet(urlStr, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const lib = urlStr.startsWith('https') ? https : http;
    const options = {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://webstatic.hoyoverse.com/',
        ...extraHeaders,
      },
    };
    const req = lib.get(urlStr, options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
        catch (_) { reject(new Error('Invalid API response — try again.')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out.')); });
  });
}

// Fetch all pulls for one banner type from the HoYoverse API (handles pagination)
// cutoffTime: "YYYY-MM-DD HH:MM:SS" — stop once we hit pulls at or before this timestamp
ipcMain.handle('gacha:fetchWishHistory', async (event, { url, gachaType, cutoffTime, extraParams }) => {
  try {
    const base = new URL(url);
    base.searchParams.set('gacha_type', gachaType);
    base.searchParams.set('size', '20');
    const cutoffId = extraParams?.cutoffId ?? null;
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        if (k !== 'pageDelay' && k !== 'cutoffId') base.searchParams.set(k, v);
      }
    }

    const allPulls = [];
    let endId = '0';

    // HoYoverse uses cursor-based pagination: page is always 1, end_id advances.
    // Incrementing page alongside end_id causes the API to return overlapping results.
    base.searchParams.set('page', '1');

    for (let page = 1; page <= 250; page++) {
      base.searchParams.set('end_id', endId);

      const requestUrl = base.toString();

      // Retry up to 3 times on timeout — HoYoverse API slows down during long fetches.
      let data;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          data = await httpsGet(requestUrl);
          break;
        } catch (e) {
          if (attempt === 2) throw e;
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        }
      }

      if (data.retcode !== 0) {
        if (data.retcode === -101 || data.retcode === -100) {
          return { ok: false, error: 'Auth key expired. Open Genshin Impact, visit your wish history, then try again.' };
        }
        return { ok: false, error: `API error: ${data.message} (code ${data.retcode})` };
      }

      // ZZZ uses list_v2; Genshin and HSR use list
      const list = data.data?.list?.length ? data.data.list : (data.data?.list_v2 ?? []);
      if (!list.length) break;

      // ID-based cutoff (subsequent syncs): API returns newest-first.
      // Stop as soon as we hit a pull whose id <= the latest known pull id.
      if (cutoffId) {
        const newPulls = list.filter(p => p.id > cutoffId);
        allPulls.push(...newPulls);
        if (newPulls.length < list.length) break; // reached a known pull — done
      } else if (cutoffTime) {
        // Timestamp fallback — kept for safety but not reached in normal operation.
        const oldest = list[list.length - 1].time;
        if (oldest <= cutoffTime) {
          allPulls.push(...list.filter(p => p.time >= cutoffTime));
          break;
        }
        allPulls.push(...list);
      } else {
        allPulls.push(...list);
      }
      endId = list[list.length - 1].id;
      try { event.sender.send('gacha:fetchProgress', { count: allPulls.length }); } catch (_) {}

      const pageDelay = extraParams?.pageDelay ? parseInt(extraParams.pageDelay, 10) : 1000;
      await new Promise(r => setTimeout(r, pageDelay));
    }

    return { ok: true, pulls: allPulls };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
