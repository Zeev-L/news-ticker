const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, shell, screen, nativeImage } = require('electron');
const path = require('path');
const settingsStore = require('./settings');
const rss = require('./providers/rss');
const calendar = require('./providers/calendar');
const slack = require('./providers/slack');

let settings = settingsStore.DEFAULTS;
let settingsWin = null;
let tray = null;

// Per-lane runtime state: id -> { win, items, timer, dragOffset, dragTimer }
const laneState = {};

function providerFor(lane) {
  if (lane.kind === 'calendar') return calendar;
  if (lane.kind === 'slack') return slack;
  return rss;
}
function laneById(id) { return settings.lanes.find(l => l.id === id); }
function enabledLanes() { return settings.lanes.filter(l => l.enabled); }
function stOf(id) { return (laneState[id] = laneState[id] || {}); }

function laneIdForSender(sender) {
  for (const id in laneState) {
    if (laneState[id].win && !laneState[id].win.isDestroyed() && laneState[id].win.webContents === sender) return id;
  }
  return null;
}

// A calendar lane that isn't connected yet shows a connect hint instead of "no meetings".
function laneConfigForRenderer(lane) {
  const cfg = { ...lane };
  if (lane.kind === 'calendar' && !calendar.isConnected(settings)) {
    cfg.emptyText = 'התחבר ליומן Google בהגדרות ⚙';
  }
  if (lane.kind === 'slack' && !(settings.slack && settings.slack.token)) {
    cfg.emptyText = 'הזן Slack token בהגדרות ⚙';
  }
  return cfg;
}

// ---------- Bounds / stacking ----------
function laneBounds(lane) {
  const fb = screen.getPrimaryDisplay().bounds;
  const h = lane.height;
  if (lane.customPos && typeof lane.customPos.y === 'number') {
    return { x: lane.customPos.x, y: lane.customPos.y, width: fb.width, height: h };
  }
  // Stack lanes that share a side and haven't been individually dragged.
  const side = lane.position || 'top';
  const stack = enabledLanes().filter(l => (l.position || 'top') === side && !l.customPos);
  const idx = stack.findIndex(l => l.id === lane.id);
  const offset = stack.slice(0, idx).reduce((s, l) => s + l.height, 0);
  const y = side === 'bottom' ? fb.y + fb.height - h - offset : fb.y + offset;
  return { x: fb.x, y, width: fb.width, height: h };
}

function createLaneWindow(lane) {
  const win = new BrowserWindow({
    ...laneBounds(lane),
    frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, skipTaskbar: true, hasShadow: false,
    alwaysOnTop: true, fullscreenable: false, focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'ticker.html'), { query: { lane: lane.id } });
  const st = stOf(lane.id);
  st.win = win;
  win.on('closed', () => { if (laneState[lane.id]) laneState[lane.id].win = null; });
}

// Reconcile windows/timers/hotkeys/tray with the current settings.
function applyLanes() {
  // Tear down lanes that are gone or disabled.
  for (const id in laneState) {
    const lane = laneById(id);
    const st = laneState[id];
    if (!lane || !lane.enabled) {
      if (st.win && !st.win.isDestroyed()) st.win.destroy();
      st.win = null;
      if (st.timer) { clearInterval(st.timer); st.timer = null; }
    }
  }
  // Create or update enabled lanes.
  enabledLanes().forEach(lane => {
    const st = stOf(lane.id);
    if (!st.win || st.win.isDestroyed()) {
      createLaneWindow(lane);
    } else {
      st.win.setBounds(laneBounds(lane));
      st.win.webContents.send('config', laneConfigForRenderer(lane));
    }
  });
  registerHotkeys();
  startLoops();
  updateTrayMenu();
}

// ---------- Data refresh ----------
async function refreshLane(lane) {
  try {
    const items = await providerFor(lane).fetch(lane, settings);
    const st = stOf(lane.id);
    st.items = items;
    if (st.win && !st.win.isDestroyed()) st.win.webContents.send('news', items);
  } catch (e) {
    console.error('refresh [' + lane.id + ']:', e.message);
  }
}

function startLoops() {
  for (const id in laneState) {
    if (laneState[id].timer) { clearInterval(laneState[id].timer); laneState[id].timer = null; }
  }
  enabledLanes().forEach(lane => {
    refreshLane(lane);
    stOf(lane.id).timer = setInterval(() => refreshLane(lane), Math.max(30, lane.refreshSeconds || 90) * 1000);
  });
}

// ---------- Visibility / hotkeys ----------
function toggleLane(id) {
  const st = laneState[id];
  if (!st || !st.win || st.win.isDestroyed()) return;
  if (st.win.isVisible()) st.win.hide(); else st.win.showInactive();
  updateTrayMenu();
}
function hideLane(id) {
  const st = laneState[id];
  if (st && st.win && !st.win.isDestroyed()) { st.win.hide(); updateTrayMenu(); }
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  enabledLanes().forEach(lane => {
    if (!lane.hotkey) return;
    try { globalShortcut.register(lane.hotkey, () => toggleLane(lane.id)); }
    catch (e) { console.error('Bad hotkey [' + lane.id + ']:', lane.hotkey, e.message); }
  });
}

// ---------- Tray ----------
function updateTrayMenu() {
  if (!tray) return;
  const laneItems = enabledLanes().map(lane => {
    const st = laneState[lane.id];
    const shown = st && st.win && !st.win.isDestroyed() && st.win.isVisible();
    return { label: (shown ? 'הסתר: ' : 'הצג: ') + lane.title, click: () => toggleLane(lane.id) };
  });
  tray.setContextMenu(Menu.buildFromTemplate([
    ...laneItems,
    { type: 'separator' },
    { label: 'רענן עכשיו', click: () => enabledLanes().forEach(refreshLane) },
    { label: 'הגדרות…', click: () => createSettingsWindow() },
    { type: 'separator' },
    { label: 'יציאה', click: () => app.quit() }
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('📰');
  tray.setToolTip('פס מבזקים ויומן');
  updateTrayMenu();
}

// ---------- Settings window ----------
function createSettingsWindow() {
  if (settingsWin) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 560, height: 720, title: 'הגדרות',
    resizable: true, minimizable: true, maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ---------- Launch at login ----------
function applyLoginItem() {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!settings.openAtLogin, openAsHidden: false });
  } catch (e) {
    console.error('setLoginItemSettings failed:', e.message);
  }
}

// ---------- IPC: ticker windows ----------
ipcMain.handle('get-config', (e) => {
  const id = laneIdForSender(e.sender);
  return id ? laneConfigForRenderer(laneById(id)) : null;
});
ipcMain.handle('get-news', (e) => {
  const id = laneIdForSender(e.sender);
  return id && laneState[id] ? (laneState[id].items || []) : [];
});
ipcMain.on('open-link', (_e, url) => {
  if (url && /^https?:\/\//.test(url)) shell.openExternal(url);
});
ipcMain.on('hide-ticker', (e) => { const id = laneIdForSender(e.sender); if (id) hideLane(id); });
ipcMain.on('open-settings', () => createSettingsWindow());
ipcMain.on('set-ignore', (e, ignore) => {
  const id = laneIdForSender(e.sender);
  const st = id && laneState[id];
  if (st && st.win && !st.win.isDestroyed()) st.win.setIgnoreMouseEvents(!!ignore, { forward: true });
});

// ---------- IPC: settings window ----------
ipcMain.handle('get-settings', () => settings);
ipcMain.handle('save-settings', (_e, incoming) => {
  // Flipping a lane's top/bottom choice re-pins it (drops any dragged position).
  if (incoming && Array.isArray(incoming.lanes)) {
    incoming.lanes.forEach(nl => {
      const old = laneById(nl.id);
      if (old && old.position !== nl.position) nl.customPos = null;
    });
  }
  settings = settingsStore.save(incoming);
  applyLanes();
  applyLoginItem();
  return settings;
});
ipcMain.handle('google:connect', async () => {
  try {
    const { refreshToken, email } = await calendar.connect(settings);
    if (!refreshToken) throw new Error('לא התקבל refresh token — ודא ש-prompt=consent ושהאפליקציה ב-Production');
    settings.google = { ...settings.google, refreshToken, email };
    settings = settingsStore.save(settings);
    const cal = laneById('calendar');
    if (cal) refreshLane(cal);
    applyLanes();
    return { ok: true, email };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('google:disconnect', () => {
  settings.google = { ...settings.google, refreshToken: '', email: '' };
  settings = settingsStore.save(settings);
  applyLanes();
  return { ok: true };
});
ipcMain.handle('google:calendars', async () => {
  try { return { ok: true, calendars: await calendar.listCalendars(settings) }; }
  catch (e) { return { ok: false, error: e.message, calendars: [] }; }
});
ipcMain.handle('slack:test', async () => {
  try { return await slack.test(settings); }
  catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Manual per-lane drag (grab the coloured handle) ----------
ipcMain.on('drag:start', (e) => {
  const id = laneIdForSender(e.sender);
  const st = id && laneState[id];
  if (!st || !st.win) return;
  const cursor = screen.getCursorScreenPoint();
  const [wx, wy] = st.win.getPosition();
  st.dragOffset = { dx: cursor.x - wx, dy: cursor.y - wy };
  if (st.dragTimer) clearInterval(st.dragTimer);
  st.dragTimer = setInterval(() => {
    if (!st.dragOffset || !st.win || st.win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    st.win.setPosition(p.x - st.dragOffset.dx, p.y - st.dragOffset.dy);
  }, 16);
});
ipcMain.on('drag:end', (e) => {
  const id = laneIdForSender(e.sender);
  const st = id && laneState[id];
  if (!st) return;
  st.dragOffset = null;
  if (st.dragTimer) { clearInterval(st.dragTimer); st.dragTimer = null; }
  if (st.win && !st.win.isDestroyed()) {
    const [x, y] = st.win.getPosition();
    const lane = laneById(id);
    if (lane) { lane.customPos = { x, y }; settings = settingsStore.save(settings); }
  }
});

// ---------- App lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => enabledLanes().forEach(l => {
    const st = laneState[l.id];
    if (st && st.win && !st.win.isDestroyed()) st.win.showInactive();
  }));
}

app.whenReady().then(() => {
  settings = settingsStore.load();
  if (app.dock) app.dock.hide();
  createTray();
  enabledLanes().forEach(createLaneWindow);
  registerHotkeys();
  startLoops();
  applyLoginItem();
});

app.on('window-all-closed', () => { /* stay alive in the tray */ });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  for (const id in laneState) if (laneState[id].timer) clearInterval(laneState[id].timer);
});
