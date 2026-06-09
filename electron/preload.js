const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readStorage: () => ipcRenderer.invoke('storage:read'),
  writeStorage: (data) => ipcRenderer.invoke('storage:write', data),

  getSystemTheme: () => ipcRenderer.invoke('theme:get-system'),
  onSystemThemeChange: (cb) => {
    const handler = (_, theme) => cb(theme);
    ipcRenderer.on('theme:system-changed', handler);
    return () => ipcRenderer.removeListener('theme:system-changed', handler);
  },

  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  resizeWindow: (size) => ipcRenderer.invoke('window:resize', size),
  moveWindowBy: (dx, dy) => ipcRenderer.send('window:move-by', dx, dy),

  getLoginItem: () => ipcRenderer.invoke('loginItem:get'),
  setLoginItem: (enabled) => ipcRenderer.invoke('loginItem:set', enabled),

  saveBackground: (data) => ipcRenderer.invoke('background:save', data),
  readBackground: (filename) => ipcRenderer.invoke('background:read', filename),
  getBackgroundInfo: (filename) => ipcRenderer.invoke('background:info', filename),
  hashBackground: (filename) => ipcRenderer.invoke('background:hash', filename),
  deleteBackground: (filename) => ipcRenderer.invoke('background:delete', filename),
  listBackgrounds: () => ipcRenderer.invoke('background:list'),
  getBgServerPort: () => ipcRenderer.invoke('background:server-port'),
  notifyReady: () => ipcRenderer.send('app:ready'),

  fetchGenshinBanners: () => ipcRenderer.invoke('genshin:fetchBanners'),
  getGenshinBannerImageById: (id) => ipcRenderer.invoke('genshin:getBannerImageById', { id }),

  readGenshinLog: () => ipcRenderer.invoke('gacha:readGenshinLog'),
  fetchWishHistory: (url, gachaType, cutoffTime, extraParams) => ipcRenderer.invoke('gacha:fetchWishHistory', { url, gachaType, cutoffTime, extraParams }),
  parsePaimonMoe: (jsonText, existingLog) => ipcRenderer.invoke('gacha:parsePaimonMoe', { jsonText, existingLog }),
  parseExcelMoe: (buffer, existingLog) => ipcRenderer.invoke('gacha:parseExcelMoe', { buffer, existingLog }),
  detectMismatch: (jsonLog, excelLog) => ipcRenderer.invoke('gacha:detectMismatch', { jsonLog, excelLog }),
  mergeJsonIntoExcel: (jsonLog, excelLog) => ipcRenderer.invoke('gacha:mergeJsonIntoExcel', { jsonLog, excelLog }),

  readPullDb: (gameId) => ipcRenderer.invoke('gacha:readPullDb', gameId),
  writePullDb: (gameId, db) => ipcRenderer.invoke('gacha:writePullDb', { gameId, db }),

  parseHsrExcel: (buffer) => ipcRenderer.invoke('hsr:parseExcel', { buffer }),
  fetchHsrBanners: () => ipcRenderer.invoke('hsr:fetchBanners'),
  getHsrBannerImage: (id) => ipcRenderer.invoke('hsr:getBannerImage', { id }),
  readHsrLog: () => ipcRenderer.invoke('hsr:readLog'),
  readZzzLog: () => ipcRenderer.invoke('zzz:readLog'),
  fetchZzzBanners: () => ipcRenderer.invoke('zzz:fetchBanners'),
  getZzzBannerImage: (id) => ipcRenderer.invoke('zzz:getBannerImage', { id }),

  saveIcon: (gameId, dataUrl) => ipcRenderer.invoke('icon:save', { gameId, dataUrl }),
  readIcon: (filename)       => ipcRenderer.invoke('icon:read', filename),

  uidExists:      (linkedDatabase, uid) => ipcRenderer.invoke('game:uidExists',  { linkedDatabase, uid }),
  readGameState:  (linkedDatabase, uid) => ipcRenderer.invoke('game:readState',  { linkedDatabase, uid }),
  writeGameState: (linkedDatabase, uid, state)  => ipcRenderer.invoke('game:writeState',  { linkedDatabase, uid, state }),
  readGameBackup: (linkedDatabase, uid) => ipcRenderer.invoke('game:readBackup', { linkedDatabase, uid }),
  writeGameBackup: (linkedDatabase, uid, backup) => ipcRenderer.invoke('game:writeBackup', { linkedDatabase, uid, backup }),
  clearUidState:   (linkedDatabase, uid) => ipcRenderer.invoke('game:clearUidState', { linkedDatabase, uid }),

  onFetchProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('gacha:fetchProgress', handler);
    return () => ipcRenderer.removeListener('gacha:fetchProgress', handler);
  },

});
