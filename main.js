const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, net, shell } = require('electron');
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
// Safety net: a dated copy is kept every day in "backups" (last 30 days). If the data file is missing
// or damaged on start, the newest good backup is loaded instead (the damaged file is kept aside).
const backupDir = path.join(path.dirname(dataFile), 'backups');
const KEEP_BACKUPS = 30;
const hasContent = (d) => d && ((d.todos && Object.keys(d.todos).length) || (d.settings && (d.settings.routines || []).length));
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; } } // tolerate a BOM from hand-edited files
function newestBackup() {
  try {
    const files = fs.readdirSync(backupDir).filter((f) => /^planner-data-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse();
    for (const f of files) { const d = readJson(path.join(backupDir, f)); if (hasContent(d)) return d; }
  } catch { /* no backups yet */ }
  return null;
}
function loadData() {
  const exists = fs.existsSync(dataFile);
  const d = exists ? readJson(dataFile) : null;
  if (d) return d; // a valid file always wins (even if the user emptied it on purpose)
  if (exists && !d) { try { fs.copyFileSync(dataFile, dataFile + '.damaged-' + Date.now()); } catch { /* ignore */ } }
  const b = newestBackup();
  if (b) { console.warn('data file missing or damaged: restored from backup'); return b; }
  return d || {};
}
function backupToday() {
  if (process.env.PLANNER_DATA || !hasContent(data)) return;
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const n = new Date(), p = (x) => String(x).padStart(2, '0');
    fs.writeFileSync(path.join(backupDir, `planner-data-${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}.json`), JSON.stringify(data), 'utf8');
    const old = fs.readdirSync(backupDir).filter((f) => /^planner-data-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse().slice(KEEP_BACKUPS);
    for (const f of old) fs.unlinkSync(path.join(backupDir, f));
  } catch (e) { console.error('backup failed', e); }
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
app.whenReady().then(() => { backupToday(); setInterval(backupToday, 60 * 60 * 1000); }); // refreshes today's copy hourly

let win = null;
let tray = null;
let trayMenu = null;
let pinning = false;

function hwndOf(w) {
  const buf = w.getNativeWindowHandle();
  return buf.length === 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}
let peeking = false; // true while the planner is brought in front (desktop icon / tray click)
function pinBottom() {
  if (!win || win.isDestroyed() || !SetWindowPos || pinning || peeking) return; // destroyed: app is quitting
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
  // PLANNER_SHOT=<file.png> saves a screenshot of the window a few seconds after start (testing)
  if (process.env.PLANNER_SHOT) win.webContents.once('did-finish-load', () => setTimeout(async () => {
    fs.writeFileSync(process.env.PLANNER_SHOT, (await win.webContents.capturePage()).toPNG());
  }, +(process.env.PLANNER_SHOT_DELAY || 4000)));
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
  win.on('minimize', () => setTimeout(() => { if (!win || win.isDestroyed()) return; win.restore(); ensureOnScreen(); pinBottom(); }, 150));
  // On quit the window is destroyed while z-order messages are still queued; drop the reference
  // so every later "if (win)" check is safe.
  win.on('closed', () => { win = null; });
  // Alt+F4 etc. only hides the widget; the app (and tray icon) keeps running until a real quit.
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); endPeek(); win.hide(); buildTrayMenu(); } });
  win.on('session-end', () => { quitting = true; saveNow(); }); // Windows sign-out / shutdown must not be blocked
  win.on('restore', () => setTimeout(ensureOnScreen, 200));
  setInterval(ensureOnScreen, 5000);

  // Clicking elsewhere after "bring to front" sends it back to the desktop layer.
  win.on('blur', () => endPeek());

  const remember = () => { if (onScreen(win.getBounds())) { data.settings.bounds = win.getBounds(); saveSoon(); } };
  win.on('moved', remember);
  win.on('resized', remember);
}

// Windows sometimes parks the window at (-32000, -32000) after "Show desktop"; put it back.
function onScreen(b) {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x + b.width - 80 > a.x && b.x + 80 < a.x + a.width && b.y + 40 > a.y && b.y + 20 < a.y + a.height;
  });
}
function ensureOnScreen() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  if (win.isMinimized()) { win.restore(); return; }
  if (onScreen(win.getBounds())) return;
  const saved = data.settings.bounds;
  win.setBounds(saved && onScreen(saved) ? saved : defaultBounds());
  if (!peeking) pinBottom();
}

// Desktop icon / Start menu / tray click: bring the planner in front of other windows until the
// user clicks somewhere else, then it drops back onto the desktop.
function bringToFront() {
  if (!win) return;
  if (!win.isVisible()) win.showInactive();
  ensureOnScreen();
  peeking = true;
  win.setAlwaysOnTop(true);
  win.show();
  win.focus();
  // If Windows refused to give it focus there will be no blur event, so drop back after a while.
  setTimeout(() => { if (peeking && !win.isFocused()) setTimeout(endPeek, 8000); }, 600);
  buildTrayMenu();
}
function endPeek() {
  if (!peeking || !win || win.isDestroyed()) return;
  peeking = false;
  win.setAlwaysOnTop(false);
  pinBottom();
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
    reset: '위치 초기화', autostart: '윈도우 시작 시 자동 실행', quit: '종료 (아이콘은 여기 남아요)',
    more: '더 보기', dataFolder: '데이터·백업 폴더 열기', exitApp: '완전히 종료 (트레이 아이콘도 닫기)',
    updInstall: (v) => `🎉 업데이트 설치하고 다시 시작 (v${v})`, updCheck: '업데이트 확인', updDownloading: (v, p) => `업데이트 받는 중… v${v} (${p}%)`,
    errUrl: 'http(s)로 시작하는 주소가 아니에요', errHttp: (s) => `서버 응답 오류 (${s})`, errBig: '파일이 너무 커요',
    errFormat: 'iCal 형식이 아니에요. "iCal/ICS 주소"를 넣어 주세요', errTimeout: '응답이 없어요 (시간 초과)',
    gPageOk: '✅ Google 캘린더가 연결됐어요', gPageFail: '연결하지 못했어요', gPageClose: '이 창을 닫고 플래너로 돌아가세요.',
  },
  en: {
    tip: 'Desktop Planner', hide: 'Hide planner', show: 'Show planner', unlock: 'Unlock (move / resize)', lock: 'Lock position',
    reset: 'Reset position', autostart: 'Start with Windows', quit: 'Close (stays in the tray)',
    more: 'More', dataFolder: 'Open data & backup folder', exitApp: 'Exit completely (remove tray icon)',
    updInstall: (v) => `🎉 Install update and restart (v${v})`, updCheck: 'Check for updates', updDownloading: (v, p) => `Downloading update… v${v} (${p}%)`,
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
  const upd = typeof updateState !== 'undefined' ? updateState : { status: 'idle' };
  const updItems = upd.status === 'ready'
    ? [{ label: tr('updInstall', upd.version), click: () => installUpdate() }, { type: 'separator' }]
    : upd.status === 'downloading'
      ? [{ label: tr('updDownloading', upd.version, upd.progress || 0), enabled: false }, { type: 'separator' }]
      : [];
  tray.setContextMenu(trayMenu = Menu.buildFromTemplate([
    ...updItems,
    { label: win.isVisible() ? tr('hide') : tr('show'), click: () => { win.isVisible() ? win.hide() : bringToFront(); buildTrayMenu(); } },
    { label: data.settings.locked ? tr('unlock') : tr('lock'), click: () => setLocked(!data.settings.locked) },
    { label: tr('reset'), click: () => { win.setBounds(defaultBounds()); data.settings.bounds = win.getBounds(); saveSoon(); } },
    { type: 'separator' },
    { label: tr('autostart'), type: 'checkbox', checked: login, click: (item) => { setAutoStart(item.checked); buildTrayMenu(); } },
    ...(app.isPackaged ? [{ label: tr('updCheck'), click: () => checkForUpdates() }] : []),
    { type: 'separator' },
    // "Quit" only closes the widget; the tray icon stays so it's one click to bring it back.
    { label: tr('quit'), click: () => { saveNow(); endPeek(); win.hide(); buildTrayMenu(); } },
    { label: tr('more'), submenu: [
      { label: tr('dataFolder'), click: () => shell.openPath(path.dirname(dataFile)) },
      { type: 'separator' },
      // app.quit (not app.exit) so a downloaded update gets installed on the way out
      { label: tr('exitApp'), click: () => { saveNow(); app.quit(); } },
    ] },
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
  app.on('second-instance', () => bringToFront());
  app.whenReady().then(() => {
    createWindow();
    tray = new Tray(trayIcon());
    tray.on('click', () => bringToFront());
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
    canWrite: google.canWrite(g),
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

// ---- Keep Calendar API usage low so the free quota scales to many users ----
// * events: re-fetched only when older than EVENTS_TTL (holiday calendars: once a day)
// * calendar list: re-fetched at most every LIST_TTL (or on manual sync / sign-in)
// * automatic refreshes are skipped while the user is away (idle / locked) or the planner is hidden
// * rate-limit / quota errors back off exponentially instead of retrying every cycle
const MIN = 60 * 1000;
const EVENTS_TTL = 15 * MIN, HOLIDAY_TTL = 24 * 60 * MIN, LIST_TTL = 6 * 60 * MIN, ICS_TTL = 15 * MIN;
let googleBackoff = { until: 0, step: 0 };
const isHoliday = (id) => /#holiday@group\.v\.calendar\.google\.com$/.test(id);
const fresh = (entry, ttl) => entry && entry.at && Date.now() - entry.at < ttl;

async function refreshGoogle(from, to, force) {
  const g = data.google;
  if (!g || !g.refresh) return;
  if (!force && Date.now() < googleBackoff.until) return;
  try {
    if (force || !g.listAt || Date.now() - g.listAt > LIST_TTL || !(g.calendars || []).length) {
      const list = await google.listCalendars(g);
      const prev = new Map((g.calendars || []).map((c) => [c.id, c.enabled]));
      // first sync: show the calendars that are checked in Google Calendar itself
      g.calendars = list.map((c) => ({ id: c.id, name: c.name, color: c.color, primary: c.primary, writable: c.writable, enabled: prev.has(c.id) ? prev.get(c.id) : (c.selected || c.primary) }));
      g.listAt = Date.now();
    }
    await Promise.all(g.calendars.filter((c) => c.enabled).map(async (c) => {
      const key = 'g:' + c.id;
      if (!force && fresh(data.calCache[key], isHoliday(c.id) ? HOLIDAY_TTL : EVENTS_TTL)) return;
      data.calCache[key] = { events: await google.listEvents(g, c.id, from, to), at: Date.now() };
    }));
    googleError = null;
    googleBackoff = { until: 0, step: 0 };
  } catch (e) {
    if (e.code === 'invalid_grant') { // revoked in Google account settings, or unused for a long time
      g.refresh = null;
      googleError = 'expired';
    } else if (e.rateLimited) {
      googleBackoff.step = Math.min(googleBackoff.step + 1, 6); // 5, 10, 20, 40, 80, 120 min
      googleBackoff.until = Date.now() + Math.min(5 * MIN * 2 ** (googleBackoff.step - 1), 120 * MIN);
      googleError = null; // keep showing cached events quietly
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

function refreshCalendars(opts = {}) {
  const force = !!opts.force;
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
    const googleJob = refreshGoogle(from, to, force);
    await Promise.all(cals.map(async (c) => {
      if (!force && fresh(data.calCache[c.id], ICS_TTL) && calStatus[c.id] && calStatus[c.id].ok) return;
      try {
        const events = await fetchFeed(c, from, to);
        data.calCache[c.id] = { events, at: Date.now() };
        calStatus[c.id] = { ok: true, count: events.length, at: Date.now() };
      } catch (e) {
        calStatus[c.id] = { ok: false, error: e.name === 'TimeoutError' ? tr('errTimeout') : e.message, at: Date.now() };
      }
    }));
    await googleJob;
    if (process.env.PLANNER_DEBUG) console.log(`[calendar] refresh force=${force} googleApiCalls=${google.callCount()}`);
    saveSoon();
    const payload = calendarPayload();
    if (win) win.webContents.send('calendar-updated', payload);
    return payload;
  })().finally(() => { calRefreshing = null; });
  return calRefreshing;
}

// Automatic refresh: on start, every ~15 min (with jitter so users don't all hit Google at once),
// and when the user comes back to the PC. Skipped while the user is away or the planner is hidden.
function autoRefresh() {
  const { powerMonitor } = require('electron');
  const away = powerMonitor.getSystemIdleState(10 * 60) !== 'active';
  if (away || (win && !win.isVisible())) return;
  refreshCalendars();
}
app.whenReady().then(() => {
  const { powerMonitor } = require('electron');
  setTimeout(() => refreshCalendars(), 3000); // startup: uses cache if it's still fresh
  const tick = () => { autoRefresh(); setTimeout(tick, 15 * MIN + Math.floor(Math.random() * 2 * MIN)); };
  setTimeout(tick, 15 * MIN + Math.floor(Math.random() * 2 * MIN));
  for (const ev of ['resume', 'unlock-screen', 'user-did-become-active']) powerMonitor.on(ev, () => setTimeout(() => refreshCalendars(), 5000));
});
ipcMain.handle('calendar-get', () => calendarPayload());
ipcMain.handle('calendar-refresh', () => refreshCalendars({ force: true }));

async function googleLogin(opts) {
  try {
    const res = await google.signIn({ ok: tr('gPageOk'), fail: tr('gPageFail'), close: tr('gPageClose') }, opts);
    data.google = { email: res.email, scope: res.scope, refresh: res.refresh, calendars: (data.google && data.google.calendars) || [] };
    google.primeAccess(res.access, res.expires);
    googleError = null;
    saveSoon();
  } catch (e) {
    googleError = e.code === 'no-client' ? 'no-client' : e.message === 'timeout' ? 'timeout' : e.message;
  }
  return refreshCalendars({ force: true });
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
// Add / delete events in Google Calendar from the planner (needs the calendar.events scope).
// The local cache is updated right away so the event shows without waiting for the next sync.
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s), isHM = (s) => !s || /^\d{2}:\d{2}$/.test(s);
function googleWriteError(e) {
  if (e.code === 'invalid_grant') { if (data.google) data.google.refresh = null; googleError = 'expired'; return 'expired'; }
  if (e.code === 403 && /insufficient/i.test((e.reason || '') + e.message)) { if (data.google) data.google.scope = ''; return 'scope'; }
  return e.name === 'TimeoutError' ? tr('errTimeout') : e.message;
}
ipcMain.handle('google-add-event', async (_e, calId, ev) => {
  const g = data.google;
  if (!g || !g.refresh) return { ok: false, error: 'signed-out', payload: calendarPayload() };
  if (!google.canWrite(g)) return { ok: false, error: 'scope', payload: calendarPayload() };
  const cal = (g.calendars || []).find((c) => c.id === calId);
  const title = String((ev && ev.title) || '').trim().slice(0, 200);
  const endDate = ev.endDate && isDay(ev.endDate) && ev.endDate > ev.date ? ev.endDate : '';
  if (!cal || !title || !isDay(ev.date) || !isHM(ev.time) || !isHM(ev.endTime)) return { ok: false, error: 'bad-input', payload: calendarPayload() };
  // A dragged range: all-day → one event spanning the days; timed → the same event on each day (max 62).
  const dates = [ev.date];
  if (endDate && ev.time) {
    const [y, m, d] = ev.date.split('-').map(Number);
    for (let i = 1; i < 62; i++) {
      const x = new Date(y, m - 1, d + i);
      const k = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
      if (k > endDate) break;
      dates.push(k);
    }
  }
  const key = 'g:' + cal.id;
  data.calCache = data.calCache || {};
  let count = 0, error = null;
  for (const date of dates) {
    try {
      const created = await google.createEvent(g, cal.id, { date, endDate: ev.time ? '' : endDate, time: ev.time || '', endTime: ev.endTime || '', title });
      if (data.calCache[key]) data.calCache[key].events.push(...created);
      else data.calCache[key] = { events: created, at: 0 }; // at: 0 → full fetch on the next refresh
      count = ev.time ? count + 1 : created.length;
    } catch (e) { error = googleWriteError(e); break; }
  }
  if (count) { if (!cal.enabled) cal.enabled = true; saveSoon(); }
  const payload = calendarPayload();
  if (count && win) win.webContents.send('calendar-updated', payload);
  return error ? { ok: false, error, count, payload } : { ok: true, count, payload };
});
ipcMain.handle('google-delete-event', async (_e, cal, eventId) => {
  const g = data.google;
  if (!g || !g.refresh || typeof cal !== 'string' || !cal.startsWith('g:') || !eventId) return { ok: false, error: 'bad-input', payload: calendarPayload() };
  if (!google.canWrite(g)) return { ok: false, error: 'scope', payload: calendarPayload() };
  try {
    await google.deleteEvent(g, cal.slice(2), String(eventId));
    const entry = data.calCache && data.calCache[cal];
    if (entry) entry.events = entry.events.filter((x) => x.id !== eventId);
    saveSoon();
    const payload = calendarPayload();
    if (win) win.webContents.send('calendar-updated', payload);
    return { ok: true, payload };
  } catch (e) {
    return { ok: false, error: googleWriteError(e), payload: calendarPayload() };
  }
});

ipcMain.handle('google-toggle', async (_e, id, on) => {
  const c = data.google && (data.google.calendars || []).find((x) => x.id === id);
  if (c) c.enabled = !!on;
  saveSoon();
  return refreshCalendars();
});

// ---------- Auto-update (GitHub Releases via electron-updater) ----------
// Checks shortly after start and every 6 hours, downloads in the background, then asks the user to
// restart. If they don't, the update is applied automatically the next time the app quits.
let updateState = { status: 'idle', version: null, progress: 0, error: null };
let autoUpdater = null;
function sendUpdate(patch) {
  updateState = { ...updateState, ...patch };
  if (win) win.webContents.send('update-state', updateState);
  if (tray && win) buildTrayMenu();
}
function checkForUpdates() {
  if (!autoUpdater || updateState.status === 'downloading' || updateState.status === 'ready') return;
  autoUpdater.checkForUpdates().catch((e) => sendUpdate({ status: 'error', error: e.message }));
}
function initUpdater() {
  const testFeed = process.env.PLANNER_UPDATE_URL; // local test server (generic provider)
  if (!app.isPackaged && !testFeed) return;
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { console.error('updater unavailable', e); return; }
  if (testFeed) { autoUpdater.forceDevUpdateConfig = !app.isPackaged; autoUpdater.setFeedURL({ provider: 'generic', url: testFeed }); }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (i) => sendUpdate({ status: 'downloading', version: i.version, progress: 0 }));
  autoUpdater.on('update-not-available', () => sendUpdate({ status: 'latest' }));
  let lastPct = -10;
  autoUpdater.on('download-progress', (p) => { if (p.percent - lastPct >= 5) { lastPct = p.percent; sendUpdate({ progress: Math.round(p.percent) }); } });
  autoUpdater.on('update-downloaded', (i) => sendUpdate({ status: 'ready', version: i.version, progress: 100 }));
  autoUpdater.on('error', (e) => sendUpdate({ status: 'error', error: (e && e.message || String(e)).split('\n')[0] }));
  setTimeout(checkForUpdates, testFeed ? 3000 : 20000);
  setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
}
function installUpdate() {
  if (!autoUpdater || updateState.status !== 'ready') return;
  saveNow();
  setImmediate(() => autoUpdater.quitAndInstall(true, true)); // silent install, then relaunch
}
app.whenReady().then(initUpdater);
ipcMain.handle('update-get', () => ({ ...updateState, current: app.getVersion(), packaged: app.isPackaged || !!process.env.PLANNER_UPDATE_URL }));
// test hook: install as soon as the update is downloaded
if (process.env.PLANNER_UPDATE_AUTOINSTALL) setInterval(() => { if (updateState.status === 'ready') installUpdate(); }, 2000);
ipcMain.on('update-check', () => checkForUpdates());
ipcMain.on('update-install', () => installUpdate());

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

let quitting = false;
app.on('before-quit', () => { quitting = true; saveNow(); });
app.on('window-all-closed', () => {});
