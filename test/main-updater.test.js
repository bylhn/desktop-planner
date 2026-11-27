// Runs the auto-update section of main.js against a fake electron-updater (opt-out policy).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), vm = require('vm'), path = require('path'), EventEmitter = require('events');

const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const block = src.slice(src.indexOf('let updateState ='), src.indexOf('app.whenReady().then(initUpdater);'));
class FakeUpdater extends EventEmitter {
  constructor() { super(); this.calls = []; }
  checkForUpdates() { this.calls.push('check'); return Promise.resolve(); }
  downloadUpdate() { this.calls.push('download'); return Promise.resolve(); }
  quitAndInstall() { this.calls.push('install'); }
  setFeedURL() {}
}
function make(autoUpdate) {
  const fake = new FakeUpdater();
  const ctx = {
    data: { settings: { autoUpdate } }, win: { webContents: { send() {} } }, tray: null,
    app: { isPackaged: true }, TEST_BUILD: false, process: { env: {} }, buildTrayMenu() {}, saveNow() {},
    require: (m) => (m === 'electron-updater' ? { autoUpdater: fake } : require(m)), console,
    setTimeout: () => 0, setInterval: () => 0, setImmediate: (f) => f(), ipcMain: { handle() {}, on() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(block + ';this.initUpdater=initUpdater;this.applyUpdatePolicy=applyUpdatePolicy;this.downloadUpdate=downloadUpdate;this.installUpdate=installUpdate;this.state=()=>updateState;', ctx);
  ctx.initUpdater();
  return { ctx, fake };
}

test('default: downloads by itself and installs on quit', () => {
  const { ctx, fake } = make(undefined);
  assert.equal(fake.autoDownload, true);
  assert.equal(fake.autoInstallOnAppQuit, true);
  fake.emit('update-available', { version: '9.9.9' });
  assert.equal(ctx.state().status, 'downloading');
});

test('off: only says a version is available, downloads/installs when asked', () => {
  const { ctx, fake } = make(false);
  assert.equal(fake.autoDownload, false);
  assert.equal(fake.autoInstallOnAppQuit, false);
  fake.emit('update-available', { version: '9.9.9' });
  assert.equal(ctx.state().status, 'available');
  assert.ok(!fake.calls.includes('download'));
  ctx.downloadUpdate();
  assert.ok(fake.calls.includes('download'));
  fake.emit('update-downloaded', { version: '9.9.9' });
  assert.equal(ctx.state().status, 'ready');
  assert.ok(!fake.calls.includes('install'));
  ctx.installUpdate();
  assert.ok(fake.calls.includes('install'));
});

test('turning it back on fetches the waiting update', () => {
  const { ctx, fake } = make(false);
  fake.emit('update-available', { version: '9.9.9' });
  ctx.data.settings.autoUpdate = true;
  ctx.applyUpdatePolicy();
  assert.ok(fake.calls.includes('download'));
  assert.equal(fake.autoInstallOnAppQuit, true);
});
