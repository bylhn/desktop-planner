const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { expandICS } = require('./ics');
const google = require('./google');

// ---------- Win32: keep the window at the bottom of the z-order (desktop widget) ----------
let SetWindowPos = null;
let SetWindowCompositionAttribute = null;
let koffi = null;
try {
  koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  SetWindowPos = user32.func('bool __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)');
  koffi.struct('ACCENT_POLICY', { AccentState: 'int', AccentFlags: 'int', GradientColor: 'uint32_t', AnimationId: 'int' });
  koffi.struct('WINCOMPATTRDATA', { Attrib: 'int', pvData: 'ACCENT_POLICY *', cbData: 'size_t' });
  SetWindowCompositionAttribute = user32.func('bool __stdcall SetWindowCompositionAttribute(intptr_t hWnd, WINCOMPATTRDATA *data)');
} catch (e) {
  console.error('koffi load failed, bottom pinning disabled', e);
}
const HWND_BOTTOM = 1;
const SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOACTIVATE = 0x10;
const WM_WINDOWPOSCHANGED = 0x0047;

// ---------- Storage ----------
// Keep data in %APPDATA%\desktop-planner no matter how the app is named or packaged.
app.setPath('userData', path.join(app.getPath('appData'), 'desktop-planner'));

// PLANNER_DATA lets you point at a separate data file (used for testing without touching real records).
const dataFile = process.env.PLANNER_DATA || path.join(app.getPath('userData'), 'planner-data.json');
function loadData() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch { return {}; }
}
let data = Object.assign({ todos: {}, settings: {} }, loadData());
data.settings = Object.assign({ locked: true, opacity: 0.45, dark: false, blur: true, bounds: null }, data.settings);

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}
function saveNow() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    const tmp = dataFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, dataFile);
  } catch (e) { console.error('save failed', e); }
}

let win = null;
let tray = null;
let pinning = false;

function hwndOf(w) {
  const buf = w.getNativeWindowHandle();
  return buf.length === 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}
function pinBottom() {
  if (!win || !SetWindowPos || pinning) return;
  pinning = true;
  try { SetWindowPos(hwndOf(win), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE); }
  finally { pinning = false; }
}

// Frosted-glass look: the widget lives on the desktop, so we draw a blurred copy of the wallpaper
// region behind it (Windows' own blur backdrops go gray/black for inactive transparent windows).
const wallFile = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
let wallMtime = 0;
function sendWallpaper(force) {
  if (!win) return;
  try {
    const st = fs.statSync(wallFile);
    if (!force && st.mtimeMs === wallMtime) return;
    wallMtime = st.mtimeMs;
    const url = 'data:image/jpeg;base64,' + fs.readFileSync(wallFile).toString('base64');
    win.webContents.send('wallpaper', url);
  } catch { win.webContents.send('wallpaper', null); }
}
function sendGeometry() {
  if (!win) return;
  const wb = win.getBounds();
  const d = screen.getDisplayMatching(wb).bounds;
  win.webContents.send('geometry', { win: wb, display: d });
}
function applyBlur() {}

function defaultBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.round(wa.width * 0.62), height = Math.round(wa.height * 0.72);
  return { x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2), width, height };
}

function applyLock() {
  const locked = data.settings.locked;
  win.setMovable(!locked);
  win.setResizable(!locked);
}

function createWindow() {
  const b = data.settings.bounds || defaultBounds();
  win = new BrowserWindow({
    ...b,
    minWidth: 520,
    minHeight: 360,
    frame: false,
    skipTaskbar: true,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  // PLANNER_OPEN=dash|settings opens a panel on start (used for screenshots/testing)
  win.loadFile('index.html', process.env.PLANNER_OPEN ? { query: { open: process.env.PLANNER_OPEN } } : undefined);
  applyLock();
  win.webContents.on('did-finish-load', () => { sendGeometry(); sendWallpaper(true); });
  win.on('move', sendGeometry);
  win.on('resize', sendGeometry);
  setInterval(() => sendWallpaper(false), 30 * 1000);
  screen.on('display-metrics-changed', sendGeometry);

  win.once('ready-to-show', () => { applyBlur(); win.showInactive(); pinBottom(); });

  // Whenever the window's z-order changes (clicked, activated), push it back to the bottom.
  win.hookWindowMessage(WM_WINDOWPOSCHANGED, () => setImmediate(pinBottom));
  win.on('focus', () => setImmediate(pinBottom));

  // "Show desktop" (Win+D) minimizes normal windows; bring the widget back onto the desktop.
  win.on('minimize', () => setTimeout(() => { win.restore(); pinBottom(); }, 150));

  const remember = () => { data.settings.bounds = win.getBounds(); saveSoon(); };
  win.on('moved', remember);
  win.on('resized', remember);
}

function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  if (!img.isEmpty()) return img.resize({ width: 16, height: 16, quality: 'best' });
  const s = 16, buf = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = (y * s + x) * 4;
    const corner = (x < 2 || x > 13) && (y < 2 || y > 13);
    const header = y < 5;
    const dot = y >= 8 && y <= 11 && x >= 9 && x <= 12;
    // BGRA
    const [r, g, b, a] = corner ? [0, 0, 0, 0] : header ? [124, 92, 255, 255] : dot ? [124, 92, 255, 255] : [245, 245, 250, 255];
    buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = a;
  }
  return nativeImage.createFromBitmap(buf, { width: s, height: s });
}

// Auto-start: an HKCU Run entry that launches start-planner.vbs (no console window).
const { execFileSync } = require('child_process');
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_NAME = 'DesktopPlanner';
// Installed app: launch the exe directly. Source checkout: launch through the console-less .vbs.
const runCommand = () => app.isPackaged
  ? `"${process.execPath}"`
  : `wscript.exe "${path.join(__dirname, 'start-planner.vbs')}"`;
function isAutoStart() {
  try { execFileSync('reg', ['query', RUN_KEY, '/v', RUN_NAME], { stdio: 'ignore', windowsHide: true }); return true; } catch { return false; }
}
function setAutoStart(on) {
  try {
    if (on) execFileSync('reg', ['add', RUN_KEY, '/v', RUN_NAME, '/t', 'REG_SZ', '/d', runCommand(), '/f'], { stdio: 'ignore', windowsHide: true });
    else execFileSync('reg', ['delete', RUN_KEY, '/v', RUN_NAME, '/f'], { stdio: 'ignore', windowsHide: true });
  } catch (e) { console.error('auto-start change failed', e); }
}

// ---------- i18n (tray menu + calendar errors; the window has its own strings) ----------
const TR = {
  ko: {
    tip: '데스크톱 플래너', hide: '플래너 숨기기', show: '플래너 보이기', unlock: '잠금 해제 (이동/크기 조절)', lock: '위치 잠그기',
    reset: '위치 초기화', autostart: '윈도우 시작 시 자동 실행', quit: '종료',
    errUrl: 'http(s)로 시작하는 주소가 아니에요', errHttp: (s) => `서버 응답 오류 (${s})`, errBig: '파일이 너무 커요',
    errFormat: 'iCal 형식이 아니에요. "iCal/ICS 주소"를 넣어 주세요', errTimeout: '응답이 없어요 (시간 초과)',
    gPageOk: '✅ Google 캘린더가 연결됐어요', gPageFail: '연결하지 못했어요', gPageClose: '이 창을 닫고 플래너로 돌아가세요.',
  },
  en: {
    tip: 'Desktop Planner', hide: 'Hide planner', show: 'Show planner', unlock: 'Unlock (move / resize)', lock: 'Lock position',
    reset: 'Reset position', autostart: 'Start with Windows', quit: 'Quit',
    errUrl: 'The link must start with http(s)', errHttp: (s) => `Server error (${s})`, errBig: 'The file is too large',
    errFormat: 'Not an iCal feed. Paste the calendar\'s iCal/ICS link', errTimeout: 'No response (timed out)',
    gPageOk: '✅ Google Calendar is connected', gPageFail: 'Could not connect', gPageClose: 'You can close this tab and go back to the planner.',
  },
};
function lang() {
  const l = data.settings.lang;
  if (l === 'ko' || l === 'en') return l;
  return (app.getLocale() || '').toLowerCase().startsWith('ko') ? 'ko' : 'en';
}
const tr = (k, ...a) => { const v = TR[lang()][k]; return typeof v === 'function' ? v(...a) : v; };

function buildTrayMenu() {
  const login = isAutoStart();
  tray.setToolTip(tr('tip'));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: win.isVisible() ? tr('hide') : tr('show'), click: () => { win.isVisible() ? win.hide() : (win.showInactive(), pinBottom()); buildTrayMenu(); } },
    { label: data.settings.locked ? tr('unlock') : tr('lock'), click: () => setLocked(!data.settings.locked) },
    { label: tr('reset'), click: () => { win.setBounds(defaultBounds()); data.settings.bounds = win.getBounds(); saveSoon(); } },
    { type: 'separator' },
    { label: tr('autostart'), type: 'checkbox', checked: login, click: (item) => { setAutoStart(item.checked); buildTrayMenu(); } },
    { type: 'separator' },
    { label: tr('quit'), click: () => { saveNow(); app.exit(0); } },
  ]));
}

function setLocked(locked) {
  data.settings.locked = locked;
  applyLock();
  saveSoon();
  win.webContents.send('settings-changed', data.settings);
  buildTrayMenu();
}

if (!process.env.PLANNER_DATA && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { win.showInactive(); pinBottom(); } });
  app.whenReady().then(() => {
    createWindow();
    tray = new Tray(trayIcon());
    tray.on('click', () => { win.showInactive(); pinBottom(); });
    buildTrayMenu();
  });
}

// ---------- Calendar subscriptions (iCal / ICS feeds, read-only) ----------
const calStatus = {}; // id -> { ok, count, error, at }
let calRefreshing = null;

// data.google = { email, refresh (encrypted), calendars: [{id, name, color, enabled}] }
let googleError = null; // last Google error code/message for the settings panel

function googleInfo() {
  const g = data.google;
  return {
    hasClient: !!google.loadClient(),
    connected: !!(g && g.refresh),
    email: g ? g.email : '',
    calendars: g && g.calendars ? g.calendars : [],
    error: googleError,
  };
}

function calendarPayload() {
  const events = [];
  const meta = {};
  for (const c of (data.settings.calendars || []).filter((x) => x.enabled !== false)) {
    meta[c.id] = { color: c.color, name: c.name };
    for (const e of (data.calCache?.[c.id]?.events || [])) events.push({ ...e, cal: c.id });
  }
  if (data.google && data.google.refresh) {
    for (const c of (data.google.calendars || []).filter((x) => x.enabled)) {
      const id = 'g:' + c.id;
      meta[id] = { color: c.color, name: c.name };
      for (const e of (data.calCache?.[id]?.events || [])) events.push({ ...e, cal: id });
    }
  }
  return { events, status: calStatus, meta, google: googleInfo() };
}

async function refreshGoogle(from, to) {
  const g = data.google;
  if (!g || !g.refresh) return;
  try {
    const list = await google.listCalendars(g);
    const prev = new Map((g.calendars || []).map((c) => [c.id, c.enabled]));
    // first sync: show the calendars that are checked in Google Calendar itself
    g.calendars = list.map((c) => ({ id: c.id, name: c.name, color: c.color, enabled: prev.has(c.id) ? prev.get(c.id) : (c.selected || c.primary) }));
    await Promise.all(g.calendars.filter((c) => c.enabled).map(async (c) => {
      data.calCache['g:' + c.id] = { events: await google.listEvents(g, c.id, from, to), at: Date.now() };
    }));
    googleError = null;
  } catch (e) {
    if (e.code === 'invalid_grant') { // revoked in Google account settings, or expired (test-mode apps expire weekly)
      g.refresh = null;
      googleError = 'expired';
    } else googleError = e.name === 'TimeoutError' ? tr('errTimeout') : e.message;
  }
}

async function fetchFeed(c, from, to) {
  const url = String(c.url || '').trim().replace(/^webcal:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(url)) throw new Error(tr('errUrl'));
  const res = await net.fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'text/calendar, */*' } });
  if (!res.ok) throw new Error(tr('errHttp', res.status));
  const text = await res.text();
  if (text.length > 15 * 1024 * 1024) throw new Error(tr('errBig'));
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error(tr('errFormat'));
  return expandICS(text, from, to);
}

function refreshCalendars() {
  if (calRefreshing) return calRefreshing;
  calRefreshing = (async () => {
    const cals = (data.settings.calendars || []).filter((c) => c.enabled !== false && c.url);
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 120).getTime();
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 240).getTime();
    data.calCache = data.calCache || {};
    // forget feeds that were removed (Google calendars are kept while they're enabled)
    const ids = new Set((data.settings.calendars || []).map((c) => c.id));
    if (data.google && data.google.refresh) for (const c of data.google.calendars || []) if (c.enabled) ids.add('g:' + c.id);
    for (const id of Object.keys(data.calCache)) if (!ids.has(id)) delete data.calCache[id];
    for (const id of Object.keys(calStatus)) if (!ids.has(id)) delete calStatus[id];
    const googleJob = refreshGoogle(from, to);
    await Promise.all(cals.map(async (c) => {
      try {
        const events = await fetchFeed(c, from, to);
        data.calCache[c.id] = { events, at: Date.now() };
        calStatus[c.id] = { ok: true, count: events.length, at: Date.now() };
      } catch (e) {
        calStatus[c.id] = { ok: false, error: e.name === 'TimeoutError' ? tr('errTimeout') : e.message, at: Date.now() };
      }
    }));
    await googleJob;
    saveSoon();
    const payload = calendarPayload();
    if (win) win.webContents.send('calendar-updated', payload);
    return payload;
  })().finally(() => { calRefreshing = null; });
  return calRefreshing;
}

app.whenReady().then(() => {
  setTimeout(refreshCalendars, 3000);
  setInterval(refreshCalendars, 15 * 60 * 1000);
});
ipcMain.handle('calendar-get', () => calendarPayload());
ipcMain.handle('calendar-refresh', () => refreshCalendars());

async function googleLogin(opts) {
  try {
    const res = await google.signIn({ ok: tr('gPageOk'), fail: tr('gPageFail'), close: tr('gPageClose') }, opts);
    data.google = { email: res.email, refresh: res.refresh, calendars: (data.google && data.google.calendars) || [] };
    google.primeAccess(res.access, res.expires);
    googleError = null;
    saveSoon();
  } catch (e) {
    googleError = e.code === 'no-client' ? 'no-client' : e.message === 'timeout' ? 'timeout' : e.message;
  }
  return refreshCalendars();
}
ipcMain.handle('google-login', () => googleLogin());
// Helper sign-in: PLANNER_AUTH_URL_FILE=<path> starts a sign-in on launch and writes the Google URL
// to that file instead of opening the default browser (handy when that browser isn't the signed-in one).
app.whenReady().then(() => {
  const file = process.env.PLANNER_AUTH_URL_FILE;
  if (!file) return;
  setTimeout(() => googleLogin({ openBrowser: false, onUrl: (u) => fs.writeFileSync(file, u, 'utf8') }).then(() => {
    fs.writeFileSync(file + '.done', googleError ? 'error: ' + googleError : 'ok', 'utf8');
  }), 2000);
});
ipcMain.handle('google-logout', async () => {
  await google.revoke(data.google);
  google.primeAccess(null);
  data.google = null;
  googleError = null;
  for (const id of Object.keys(data.calCache || {})) if (id.startsWith('g:')) delete data.calCache[id];
  saveSoon();
  return refreshCalendars();
});
ipcMain.handle('google-toggle', async (_e, id, on) => {
  const c = data.google && (data.google.calendars || []).find((x) => x.id === id);
  if (c) c.enabled = !!on;
  saveSoon();
  return refreshCalendars();
});

ipcMain.handle('load', () => data);
ipcMain.handle('app-info', () => ({ version: app.getVersion() }));
// Only these fixed links can be opened from the window.
const LINKS = {
  repo: 'https://github.com/bylhn/desktop-planner',
  privacy: 'https://github.com/bylhn/desktop-planner/blob/main/PRIVACY.md',
  guideKo: 'https://github.com/bylhn/desktop-planner/blob/main/GUIDE.md',
  guideEn: 'https://github.com/bylhn/desktop-planner/blob/main/GUIDE.en.md',
  issues: 'https://github.com/bylhn/desktop-planner/issues',
};
ipcMain.on('open-link', (_e, key) => { if (LINKS[key]) require('electron').shell.openExternal(LINKS[key]); });
ipcMain.on('save-todos', (_e, todos) => { data.todos = todos; saveSoon(); });
ipcMain.on('save-settings', (_e, s) => {
  delete s.bounds; // the main process owns window bounds
  const lockChanged = s.locked !== data.settings.locked || s.lang !== data.settings.lang;
  const blurChanged = s.blur !== undefined && s.blur !== data.settings.blur;
  data.settings = Object.assign(data.settings, s);
  if (lockChanged) { applyLock(); buildTrayMenu(); }
  if (blurChanged) applyBlur();
  saveSoon();
});
ipcMain.on('pin', () => pinBottom());

app.on('before-quit', saveNow);
app.on('window-all-closed', () => {});
