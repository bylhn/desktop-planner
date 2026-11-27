// google.js against a fake electron.net: what is sent to Google and what lands in the local cache.
process.env.TZ = 'Asia/Seoul';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');

const calls = [];
let listReply = { items: [] };
const load = Module._load;
Module._load = function (req, ...a) {
  if (req === 'electron') return {
    net: { fetch: async (url, o) => {
      calls.push({ url, method: o.method, body: o.body && JSON.parse(o.body) });
      return { ok: true, status: 200, json: async () => (o.method === 'GET' ? listReply : { id: 'ev1' }) };
    } },
    safeStorage: { isEncryptionAvailable: () => false }, shell: {}, app: { getPath: () => '.', isPackaged: false },
  };
  return load.call(this, req, ...a);
};
const g = require(path.join(__dirname, '..', 'google.js'));
Module._load = load;
g.primeAccess('test-token', Date.now() + 3600e3);
const last = () => calls.pop();
const minutes = (b) => (new Date(b.end.dateTime) - new Date(b.start.dateTime)) / 60000;

test('update: PATCH to the event, timed body clears the all-day date', async () => {
  const r = await g.updateEvent({}, 'cal@x', 'ev1', { date: '2026-12-03', time: '14:00', endTime: '15:30', title: '회의' });
  const c = last();
  assert.equal(c.method, 'PATCH');
  assert.match(c.url, /calendars\/cal%40x\/events\/ev1\?/);
  assert.equal(c.body.summary, '회의');
  assert.equal(c.body.start.date, null);
  assert.ok(c.body.start.dateTime);
  assert.deepEqual(r, [{ id: 'ev1', date: '2026-12-03', time: '14:00', endTime: '15:30', title: '회의', allDay: false }]);
});

test('update: timed → all-day across New Year, end date exclusive', async () => {
  const r = await g.updateEvent({}, 'c', 'ev1', { date: '2026-12-30', endDate: '2026-12-31', time: '', endTime: '', title: '여행' });
  const c = last();
  assert.equal(c.body.start.date, '2026-12-30');
  assert.equal(c.body.end.date, '2027-01-01');
  assert.equal(c.body.start.dateTime, null);
  assert.equal(c.body.start.timeZone, null);
  assert.equal(r.length, 2);
  assert.ok(r.every((x) => x.allDay && x.id === 'ev1'));
});

test('times: no end = 1 hour, same start/end = 1 hour, end before start = next day', async () => {
  await g.updateEvent({}, 'c', 'x', { date: '2026-12-10', time: '09:00', endTime: '', title: 'x' });
  assert.equal(minutes(last().body), 60);
  await g.createEvent({}, 'c', { date: '2026-12-10', time: '09:00', endTime: '09:00', title: 'x' });
  assert.equal(minutes(last().body), 60);
  const r = await g.updateEvent({}, 'c', 'a', { date: '2026-12-03', time: '23:00', endTime: '01:30', title: '야간' });
  assert.equal(minutes(last().body), 150);
  assert.equal(r[0].dur, 150);
  await g.createEvent({}, 'c', { date: '2026-12-10', time: '14:00', endTime: '15:30', title: 'x' });
  assert.equal(minutes(last().body), 90);
});

test('update: a long event keeps its length (dur) when moved', async () => {
  await g.updateEvent({}, 'c', 'd', { date: '2026-12-10', time: '09:00', endTime: '', title: '워크숍', dur: 57 * 60 });
  assert.equal(minutes(last().body), 57 * 60);
});

test('create: all-day event is a POST and comes back as all-day', async () => {
  const r = await g.createEvent({}, 'c', { date: '2026-12-05', time: '', endTime: '', title: 'y' });
  assert.equal(last().method, 'POST');
  assert.ok(r[0].allDay);
});

test('list: overnight events get dur, invited events are read-only', async () => {
  listReply = { items: [
    { id: 'a', summary: '야간', start: { dateTime: '2026-12-03T23:00:00+09:00' }, end: { dateTime: '2026-12-04T01:30:00+09:00' }, organizer: { self: true } },
    { id: 'b', summary: '초대', start: { dateTime: '2026-12-03T10:00:00+09:00' }, end: { dateTime: '2026-12-03T11:00:00+09:00' }, organizer: { email: 'x@y' } },
    { id: 'c', summary: '초대-수정가능', start: { dateTime: '2026-12-03T12:00:00+09:00' }, end: { dateTime: '2026-12-03T13:00:00+09:00' }, organizer: { email: 'x@y' }, guestsCanModify: true },
    { id: 'd', summary: '워크숍', start: { dateTime: '2026-12-05T09:00:00+09:00' }, end: { dateTime: '2026-12-07T18:00:00+09:00' } },
    { id: 'e', summary: '취소됨', status: 'cancelled', start: { dateTime: '2026-12-05T09:00:00+09:00' } },
  ] };
  const evs = await g.listEvents({}, 'c', new Date(2026, 11, 1).getTime(), new Date(2026, 11, 31).getTime());
  assert.match(last().url, /organizer/);
  const by = Object.fromEntries(evs.map((e) => [e.id, e]));
  assert.equal(by.a.time, '23:00'); assert.equal(by.a.endTime, ''); assert.equal(by.a.dur, 150);
  assert.equal(by.b.ro, true);
  assert.ok(!by.c.ro && !by.a.ro);
  assert.equal(by.d.dur, 57 * 60);
  assert.equal(by.e, undefined);
});
