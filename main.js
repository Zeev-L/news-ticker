const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, shell, screen, nativeImage } = require('electron');
const path = require('path');
const settingsStore = require('./settings');
const { fetchAll } = require('./feeds');

let tickerWin = null;
let settingsWin = null;
let tray = null;
let settings = settingsStore.DEFAULTS;
let refreshTimer = null;
let isVisible = true;

// ---------- Ticker window ----------
function tickerBounds() {
  const display = screen.getPrimaryDisplay();
  const fullBounds = display.bounds;
  const h = settings.height;
  // If the user dragged the bar, honour that exact spot; otherwise pin to top/bottom.
  if (settings.customPos && typeof settings.customPos.y === 'number') {
    return { x: settings.customPos.x, y: settings.customPos.y, width: fullBounds.width, height: h };
  }
  return {
    x: fullBounds.x,
    y: settings.position === 'bottom' ? fullBounds.y + fullBounds.height - h : fullBounds.y,
    width: fullBounds.width,
    height: h
  };
}

function createTickerWindow() {
  const b = tickerBounds();
  tickerWin = new BrowserWindow({
    ...b,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    fullscreenable: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  tickerWin.setAlwaysOnTop(true, 'screen-saver');
  tickerWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Start click-through: empty areas of the bar fall through to whatever is behind.
  // The renderer flips this off only while the cursor is over a headline/control.
  tickerWin.setIgnoreMouseEvents(true, { forward: true });
  tickerWin.loadFile(path.join(__dirname, 'renderer', 'ticker.html'));

  tickerWin.on('closed', () => { tickerWin = null; });
}

function applyTickerBounds() {
  if (tickerWin) tickerWin.setBounds(tickerBounds());
}

function setVisible(v) {
  isVisible = v;
  if (!tickerWin) return;
  if (v) { tickerWin.showInactive(); } else { tickerWin.hide(); }
  updateTrayMenu();
}

// ---------- Settings window ----------
function createSettingsWindow() {
  if (settingsWin) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 520,
    height: 640,
    title: 'הגדרות פס מבזקים',
    resizable: true,
    minimizable: true,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ---------- Tray ----------
function updateTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: isVisible ? 'הסתר פס' : 'הצג פס', click: () => setVisible(!isVisible) },
    { label: 'רענן עכשיו', click: () => pushNews() },
    { type: 'separator' },
    { label: 'הגדרות…', click: () => createSettingsWindow() },
    { type: 'separator' },
    { label: 'יציאה', click: () => { app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('📰');
  tray.setToolTip('פס מבזקים');
  updateTrayMenu();
}

// ---------- News flow ----------
let latestNews = [];

async function pushNews() {
  try {
    latestNews = await fetchAll(settings.sources, settings.maxItems);
    if (tickerWin) tickerWin.webContents.send('news', latestNews);
  } catch (e) {
    console.error('pushNews failed:', e.message);
  }
}

function startRefreshLoop() {
  if (refreshTimer) clearInterval(refreshTimer);
  pushNews();
  refreshTimer = setInterval(pushNews, Math.max(30, settings.refreshSeconds) * 1000);
}

// ---------- Hotkey ----------
function registerHotkey() {
  globalShortcut.unregisterAll();
  if (settings.hotkey) {
    try {
      globalShortcut.register(settings.hotkey, () => setVisible(!isVisible));
    } catch (e) {
      console.error('Bad hotkey:', settings.hotkey, e.message);
    }
  }
}

function pushConfig() {
  if (tickerWin) tickerWin.webContents.send('config', settings);
}

// ---------- Launch at login ----------
function applyLoginItem() {
  // Only meaningful in a packaged .app; harmless (no-op-ish) in dev.
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!settings.openAtLogin, openAsHidden: false });
  } catch (e) {
    console.error('setLoginItemSettings failed:', e.message);
  }
}

// ---------- IPC ----------
ipcMain.handle('get-config', () => settings);
ipcMain.handle('get-news', () => latestNews);
ipcMain.handle('get-settings', () => settings);

ipcMain.handle('save-settings', (_e, incoming) => {
  // Changing the top/bottom choice re-pins the bar (drops any dragged position).
  if (incoming && incoming.position !== settings.position) {
    incoming.customPos = null;
  }
  settings = settingsStore.save(incoming);
  applyTickerBounds();
  pushConfig();
  registerHotkey();
  startRefreshLoop();
  applyLoginItem();
  updateTrayMenu();
  return settings;
});

ipcMain.on('open-link', (_e, url) => {
  if (url && /^https?:\/\//.test(url)) shell.openExternal(url);
});

ipcMain.on('hide-ticker', () => setVisible(false));

ipcMain.on('open-settings', () => createSettingsWindow());

ipcMain.on('set-ignore', (_e, ignore) => {
  if (tickerWin) tickerWin.setIgnoreMouseEvents(!!ignore, { forward: true });
});

// ---------- Manual window drag (grab the red handle) ----------
let dragOffset = null;
let dragTimer = null;
ipcMain.on('drag:start', () => {
  if (!tickerWin) return;
  const cursor = screen.getCursorScreenPoint();
  const [wx, wy] = tickerWin.getPosition();
  dragOffset = { dx: cursor.x - wx, dy: cursor.y - wy };
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (!dragOffset || !tickerWin) return;
    const p = screen.getCursorScreenPoint();
    tickerWin.setPosition(p.x - dragOffset.dx, p.y - dragOffset.dy);
  }, 16);
});
ipcMain.on('drag:end', () => {
  dragOffset = null;
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null; }
  // Persist where the user left the bar.
  if (tickerWin) {
    const [x, y] = tickerWin.getPosition();
    settings.customPos = { x, y };
    settings = settingsStore.save(settings);
  }
});

// ---------- App lifecycle ----------
// Prevent a second copy from opening a duplicate bar.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => setVisible(true));
}

app.whenReady().then(() => {
  settings = settingsStore.load();
  isVisible = settings.visible !== false;
  if (app.dock) app.dock.hide(); // menu-bar style: keep out of the Dock
  createTickerWindow();
  createTray();
  registerHotkey();
  startRefreshLoop();
  applyLoginItem();
  if (!isVisible) setVisible(false);
});

app.on('window-all-closed', (e) => {
  // Keep running in the tray even with no windows.
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (refreshTimer) clearInterval(refreshTimer);
});
