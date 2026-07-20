const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ticker window (main routes by sender window → lane)
  getConfig: () => ipcRenderer.invoke('get-config'),
  getNews: () => ipcRenderer.invoke('get-news'),
  onNews: (cb) => ipcRenderer.on('news', (_e, data) => cb(data)),
  onConfig: (cb) => ipcRenderer.on('config', (_e, data) => cb(data)),
  openLink: (url) => ipcRenderer.send('open-link', url),
  hideTicker: () => ipcRenderer.send('hide-ticker'),
  openSettings: () => ipcRenderer.send('open-settings'),
  setIgnore: (ignore) => ipcRenderer.send('set-ignore', ignore),
  dragStart: () => ipcRenderer.send('drag:start'),
  dragEnd: () => ipcRenderer.send('drag:end'),

  // settings window
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  connectGoogle: () => ipcRenderer.invoke('google:connect'),
  disconnectGoogle: () => ipcRenderer.invoke('google:disconnect'),
  googleCalendars: () => ipcRenderer.invoke('google:calendars'),
  slackTest: () => ipcRenderer.invoke('slack:test'),
  exportNotes: (lines) => ipcRenderer.invoke('notes:export', lines),
  importNotes: () => ipcRenderer.invoke('notes:import')
});
