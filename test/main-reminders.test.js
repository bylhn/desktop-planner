// Runs the reminder block of main.js with stubbed Electron pieces and checks when it fires.
process.env.TZ = 'Asia/Seoul';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), vm = require('vm'), path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const block = src.slice(src.indexOf('const evKey ='), src.indexOf('app.whenReady().then(() => {\n  if (app.isPackaged) app.setAppUserModelId'));
const shown = [];
class Notification {
  static isSupported() { return true; }
  constructor(o) { this.o = o; } on() {} show() { shown.push(this.o); }
}
const ctx = {
  require: (m) => (m === 'electron' ? { Notification } : require(m)), path, MIN: 60000, __dirname: path.join(__dirname, '..'),
  data: null, tr: (k, m) => (k === 'remIn' ? `${m}분 후 시작` : '지금 시작'), bringToFront() {}, win: null,
  logLine() {}, saveSoon() {}, calendarPayload: () => ({ events: ctx.data.events }),
};
vm.createContext(ctx);
vm.runInContext(block + ';this.checkReminders = checkReminders;', ctx);

const D = '2026-11-27';
const at = (hm) => { const [h, m] = hm.split(':').map(Number); return new Date(2026, 10, 27, h, m).getTime(); };
const fresh = (lead) => ({
  settings: { remindLead: lead, evReminders: [`g:x|e1|${D}`] },
  todos: { [D]: [
    { id: 't1', text: '회의', time: '14:00', remind: true, done: false },
    { id: 't2', text: '벨 없음', time: '14:00', done: false },
    { id: 't3', text: '완료됨', time: '14:00', remind: true, done: true },
  ] },
  events: [
    { cal: 'g:x', id: 'e1', date: D, time: '15:00', title: '팀 미팅', allDay: false },
    { cal: 'g:x', id: 'e2', date: D, time: '15:00', title: '벨 안 누름', allDay: false },
  ],
});
const run = (lead, ...times) => { ctx.data = fresh(lead); shown.length = 0; times.forEach((t) => ctx.checkReminders(at(t))); return shown; };

test('default lead is 5 minutes, only rung items, silent, once', () => {
  assert.equal(run(undefined, '13:54').length, 0);
  const s = run(undefined, '13:54', '13:55', '13:57');
  assert.equal(s.length, 1);
  assert.equal(s[0].title, '14:00 회의');
  assert.equal(s[0].body, '5분 후 시작');
  assert.equal(s[0].silent, true);
});

test('rung calendar events fire, unrung ones do not, no repeat after restart', () => {
  const s = run(undefined, '13:55', '14:55', '14:56');
  assert.deepEqual(s.map((x) => x.title), ['14:00 회의', '15:00 팀 미팅']);
});

test('10-minute lead, off, "starting now", and no late alarms', () => {
  assert.equal(run(10, '13:50')[0].body, '10분 후 시작');
  assert.equal(run(-1, '13:58').length, 0);
  assert.equal(run(5, '14:00')[0].body, '지금 시작');
  assert.equal(run(5, '14:30').length, 0);
});
