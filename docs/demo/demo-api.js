/* Desktop Planner web demo: stands in for the Electron preload bridge (window.planner).
   Everything lives in this browser's localStorage; nothing is sent anywhere. */
(function () {
  var KEY = 'dp-demo-v2'; // bump when the sample data changes
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var dayKey = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var shift = function (n) { var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return dayKey(d); };
  var parse = function (k) { var p = k.split('-'); return new Date(+p[0], p[1] - 1, +p[2], 12); };
  var uid = function () { return Math.random().toString(36).slice(2, 10); };
  var ko = (navigator.language || '').toLowerCase().indexOf('ko') === 0;
  var L = function (k, e) { return ko ? k : e; };

  function seed() {
    var start = shift(-45);
    var routines = [
      { id: 'r1', text: L('기상', 'Wake up'), time: '07:00', days: [], createdAt: start },
      { id: 'r2', text: L('운동 30분', 'Workout 30 min'), time: '18:00', days: [1, 3, 5], createdAt: start },
      { id: 'r3', text: L('영단어 50개', '50 vocab words'), time: '', days: [], createdAt: start },
      { id: 'r4', text: L('물 2L 마시기', 'Drink 2L of water'), time: '', days: [], createdAt: start }
    ];
    // A believable 45-day history so the dashboard and month view have something to show.
    var routineDone = {}, todos = {}, rnd = 7;
    var rand = function () { rnd = (rnd * 9301 + 49297) % 233280; return rnd / 233280; };
    for (var i = 45; i >= 1; i--) {
      var k = shift(-i), dow = parse(k).getDay(), done = [];
      routines.forEach(function (r) { if ((!r.days.length || r.days.indexOf(dow) >= 0) && rand() < 0.78) done.push(r.id); });
      if (done.length) routineDone[k] = done;
      if (rand() < 0.6) {
        var n = 1 + Math.floor(rand() * 3), list = [];
        for (var j = 0; j < n; j++) list.push({ id: uid(), text: L('과제 ', 'Task ') + (j + 1), time: '', done: rand() < 0.75 });
        todos[k] = list;
      }
    }
    routineDone[shift(0)] = ['r1'];
    todos[shift(0)] = [
      { id: uid(), text: L('알고리즘 과제', 'Algorithms homework'), time: '10:00', done: true },
      { id: uid(), text: L('논문 리뷰 정리', 'Write up paper review'), time: '14:00', done: false },
      { id: uid(), text: L('CTF 문제 2개', 'Solve 2 CTF problems'), time: '', done: false }
    ];
    todos[shift(1)] = [{ id: uid(), text: L('도서관 책 반납', 'Return library books'), time: '', done: false }];
    var ev = function (n, time, endTime, title) { return { id: uid(), date: shift(n), time: time, endTime: endTime, title: title, allDay: !time }; };
    var events = [
      ev(0, '09:00', '10:30', L('자료구조 수업', 'Data structures class')),
      ev(0, '16:00', '17:00', L('팀 미팅', 'Team meeting')),
      ev(2, '13:00', '14:00', L('중간 발표', 'Midterm presentation')),
      ev(3, '', '', L('학회 출장', 'Conference trip')),
      ev(4, '', '', L('학회 출장', 'Conference trip')),
      ev(6, '19:00', '21:00', L('스터디 모임', 'Study group')),
      ev(-3, '09:00', '10:30', L('자료구조 수업', 'Data structures class')),
      ev(9, '', '', L('엄마 생일', "Mom's birthday")),
      ev(1, '10:00', '11:00', L('교수님 면담 (초대받음)', 'Advisor meeting (invited)')),
      ev(1, '23:00', '', L('야간 서버 점검', 'Night server check'))
    ];
    events[3].id = events[4].id = 'trip';
    events[8].ro = true; // invited: only the organizer could change it
    events[9].dur = 150; // 23:00 → 01:30 the next day
    return {
      todos: todos,
      settings: { startDate: start, routines: routines, routineDone: routineDone, onboarded: true, evReminders: ['g:demo|' + events[2].id + '|' + events[2].date] },
      events: events,
      connected: true
    };
  }

  var db;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
  if (!db || !db.settings) db = seed();
  var save = function () { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} };
  save();

  var CAL = { id: 'demo', name: L('내 캘린더 (체험)', 'My calendar (demo)'), color: '#4f7dff', enabled: true, primary: true, writable: true };
  function payload() {
    var on = db.connected, show = on && CAL.enabled;
    return {
      events: show ? db.events.map(function (e) { return Object.assign({}, e, { cal: 'g:demo' }); }) : [],
      status: {},
      meta: on ? { 'g:demo': { color: CAL.color, name: CAL.name } } : {},
      google: { hasClient: true, connected: on, canWrite: on, email: on ? 'demo@example.com' : '', calendars: on ? [CAL] : [], error: '' }
    };
  }
  var calCbs = [];
  var later = function (v, ms) { return new Promise(function (r) { setTimeout(function () { r(v); }, ms || 250); }); };

  function addEvent(calId, ev, keepId) {
    var out = [], id = keepId || uid();
    var last = ev.endDate && ev.endDate > ev.date ? ev.endDate : ev.date;
    for (var k = ev.date; k <= last; k = dayKey(new Date(parse(k).getTime() + 86400000))) {
      if (ev.time) {
        var mins = function (t) { return +t.slice(0, 2) * 60 + +t.slice(3, 5); };
        var dur = ev.endTime ? (mins(ev.endTime) - mins(ev.time) + 1440) % 1440 || 60 : (+ev.dur > 0 ? +ev.dur : 60);
        var endM = mins(ev.time) + dur, row = { id: keepId || uid(), date: k, time: ev.time, endTime: '', title: ev.title, allDay: false };
        if (endM < 1440) row.endTime = pad(Math.floor(endM / 60)) + ':' + pad(endM % 60); else row.dur = dur;
        out.push(row);
      } else {
        out.push({ id: id, date: k, time: '', endTime: '', title: ev.title, allDay: true });
      }
    }
    db.events = db.events.concat(out); save();
    return { ok: true, count: ev.time ? out.length : 1, payload: payload(), created: out.map(function (e) { return Object.assign({}, e, { cal: 'g:demo' }); }) };
  }

  var view = { w: innerWidth, h: innerHeight };
  var geoCbs = [];
  addEventListener('resize', function () {
    var g = { win: { x: 0, y: 0, width: innerWidth, height: innerHeight }, display: { x: 0, y: 0, width: innerWidth, height: innerHeight } };
    geoCbs.forEach(function (cb) { cb(g); });
  });

  var LINKS = {
    repo: 'https://github.com/bylhn/desktop-planner',
    privacy: 'https://bylhn.github.io/desktop-planner/privacy.html',
    guideKo: 'https://github.com/bylhn/desktop-planner/blob/main/GUIDE.md',
    guideEn: 'https://github.com/bylhn/desktop-planner/blob/main/GUIDE.en.md'
  };

  window.planner = {
    load: function () { return Promise.resolve(JSON.parse(JSON.stringify({ todos: db.todos, settings: db.settings }))); },
    saveTodos: function (t) { db.todos = t; save(); },
    saveSettings: function (s) { db.settings = Object.assign(db.settings, s); save(); },
    onSettings: function () {},
    onWallpaper: function (cb) { setTimeout(function () { cb('wallpaper.svg'); }, 0); },
    onGeometry: function (cb) { geoCbs.push(cb); setTimeout(function () { cb({ win: { x: 0, y: 0, width: view.w, height: view.h }, display: { x: 0, y: 0, width: innerWidth, height: innerHeight } }); }, 0); },
    calendarGet: function () { return Promise.resolve(payload()); },
    calendarRefresh: function () { return later(payload(), 400); },
    onCalendar: function (cb) { calCbs.push(cb); },
    appInfo: function () { return Promise.resolve({ version: L('체험판', 'demo') }); },
    updateGet: function () { return Promise.resolve({ status: 'idle', current: 'demo', packaged: false }); },
    updateCheck: function () {},
    updateInstall: function () {},
    updateDownload: function () {},
    onUpdate: function () {},
    onGotoDay: function () {}, // reminders are shown by the desktop app only
    openLink: function (key) { if (LINKS[key]) window.open(LINKS[key], '_blank', 'noopener'); },
    googleLogin: function () { db.connected = true; save(); return later(payload(), 500); },
    googleLogout: function () { db.connected = false; save(); return later(payload(), 300); },
    googleToggle: function (id, on) { CAL.enabled = !!on; return later(payload()); },
    googleAddEvent: function (calId, ev) { return later(addEvent(calId, ev), 350); },
    googleUpdateEvent: function (cal, id, ev) {
      var old = db.events.filter(function (e) { return e.id === id; });
      if (!old.length) return later({ ok: false, error: 'bad-input', payload: payload() });
      var span = 0;
      if (!ev.time && old.length > 1) { var ds = old.map(function (e) { return e.date; }).sort(); span = Math.round((parse(ds[ds.length - 1]) - parse(ds[0])) / 86400000); }
      db.events = db.events.filter(function (e) { return e.id !== id; });
      var r = addEvent('demo', { date: ev.date, endDate: span ? dayKey(new Date(parse(ev.date).getTime() + span * 86400000)) : '', time: ev.time, endTime: ev.endTime, dur: ev.dur, title: ev.title }, id);
            return later({ ok: true, payload: payload(), updated: r.created }, 350);
    },
    googleDeleteEvent: function (cal, id) { db.events = db.events.filter(function (e) { return e.id !== id; }); save(); return later({ ok: true, payload: payload() }, 250); }
  };

  // The demo can't pop real Windows notifications, so turning a bell on shows a look-alike for a few seconds.
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.bell');
    if (!b || b.id) return; // the adders' bells only arm the next entry
    var row = b.closest('.ev, .item'), name = row && (row.querySelector('.en, .txt') || {}).textContent;
    if (!name || b.classList.contains('on')) return; // it was on: this click turns it off
    setTimeout(function () {
      var box = document.getElementById('demoToast');
      if (!box) {
        box = document.createElement('div'); box.id = 'demoToast';
        box.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:99;width:300px;padding:12px 14px;border-radius:10px;background:rgba(32,32,40,.96);color:#fff;font-size:12.5px;line-height:1.5;box-shadow:0 10px 30px rgba(0,0,0,.35);transition:opacity .3s';
        document.body.appendChild(box);
      }
      var lead = (db.settings.remindLead === undefined ? 5 : db.settings.remindLead);
      box.innerHTML = '<div style="opacity:.7;font-size:11px">Desktop Planner · ' + L('미리보기', 'preview') + '</div><b style="display:block;margin:2px 0">🔔 ' + name.replace(/[<&>]/g, '') + '</b>' +
        L('실제 앱에서는 시작 ' + lead + '분 전에 이렇게 소리 없이 알려 줘요.', 'The real app shows this silently ' + lead + ' minutes before it starts.');
      box.style.opacity = '1';
      clearTimeout(box._t); box._t = setTimeout(function () { box.style.opacity = '0'; }, 4000);
    }, 0);
  }, true);

  // lets the homepage reset the demo
  addEventListener('message', function (e) {
    if (e.origin === location.origin && e.data === 'dp-demo-reset') { try { localStorage.removeItem(KEY); } catch (x) {} location.reload(); }
  });
})();
