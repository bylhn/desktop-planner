const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('planner', {
  load: () => ipcRenderer.invoke('load'),
  saveTodos: (todos) => ipcRenderer.send('save-todos', todos),
  saveSettings: (s) => ipcRenderer.send('save-settings', s),
  onSettings: (cb) => ipcRenderer.on('settings-changed', (_e, s) => cb(s)),
  onWallpaper: (cb) => ipcRenderer.on('wallpaper', (_e, url) => cb(url)),
  onGeometry: (cb) => ipcRenderer.on('geometry', (_e, g) => cb(g)),
  calendarGet: () => ipcRenderer.invoke('calendar-get'),
  calendarRefresh: () => ipcRenderer.invoke('calendar-refresh'),
  onCalendar: (cb) => ipcRenderer.on('calendar-updated', (_e, p) => cb(p)),
});
