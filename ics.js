// Minimal iCalendar (.ics) reader: enough for Google / Outlook / iCloud subscription feeds.
// Handles all-day and timed events, TZID / UTC times, common RRULEs (DAILY/WEEKLY/MONTHLY/YEARLY
// with INTERVAL, COUNT, UNTIL, BYDAY), EXDATE, and edited single occurrences (RECURRENCE-ID).

const DAY_MS = 86400000;
const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseLine(line) {
  const colon = findValueColon(line);
  if (colon < 0) return null;
  const head = line.slice(0, colon), value = line.slice(colon + 1);
  const parts = head.split(';');
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].toUpperCase(), params, value };
}
// The first colon that is not inside a quoted parameter value.
function findValueColon(line) {
  let q = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') q = !q;
    else if (line[i] === ':' && !q) return i;
  }
  return -1;
}

function unescapeText(s) {
  return s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}

// Offset (ms) of a time zone from UTC at a given instant, via Intl.
const dtfCache = new Map();
function tzOffset(utcMs, tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    dtfCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}

// Returns { ms, allDay }. All-day dates become local midnight.
function parseDate(value, params) {
  const v = value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (params.VALUE === 'DATE' || h === undefined) return { ms: new Date(+y, +mo - 1, +d).getTime(), allDay: true };
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0));
  if (z) return { ms: wall, allDay: false };
  const tz = params.TZID && normalizeTz(params.TZID);
  if (tz) {
    try {
      let utc = wall - tzOffset(wall, tz);
      utc = wall - tzOffset(utc, tz); // second pass fixes DST edges
      return { ms: utc, allDay: false };
    } catch { /* unknown zone: fall through to local time */ }
  }
  return { ms: new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0)).getTime(), allDay: false };
}
// Outlook sometimes uses Windows zone names; map the common ones.
const WIN_TZ = { 'Korea Standard Time': 'Asia/Seoul', 'Tokyo Standard Time': 'Asia/Tokyo', 'China Standard Time': 'Asia/Shanghai', 'UTC': 'UTC', 'GMT Standard Time': 'Europe/London', 'Pacific Standard Time': 'America/Los_Angeles', 'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago' };
function normalizeTz(tz) {
  if (WIN_TZ[tz]) return WIN_TZ[tz];
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return null; }
}

function parseDuration(v) {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const ms = ((+m[2] || 0) * 7 * DAY_MS) + ((+m[3] || 0) * DAY_MS) + ((+m[4] || 0) * 3600000) + ((+m[5] || 0) * 60000) + ((+m[6] || 0) * 1000);
  return m[1] === '-' ? -ms : ms;
}

function parseRRule(v) {
  const r = {};
  for (const part of v.split(';')) {
    const [k, val] = part.split('=');
    if (k && val) r[k.toUpperCase()] = val;
  }
  return r;
}

function parseICS(text) {
  const events = [];
  let cur = null, depth = 0;
  for (const raw of unfold(text)) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') { cur = { exdates: new Set() }; depth = 0; continue; }
    if (!cur) continue;
    if (line.startsWith('BEGIN:')) { depth++; continue; } // e.g. VALARM
    if (line.startsWith('END:') && depth > 0) { depth--; continue; }
    if (line === 'END:VEVENT') { if (cur.start) events.push(cur); cur = null; continue; }
    if (depth > 0) continue;
    const p = parseLine(line);
    if (!p) continue;
    switch (p.name) {
      case 'UID': cur.uid = p.value; break;
      case 'SUMMARY': cur.summary = unescapeText(p.value); break;
      case 'STATUS': cur.status = p.value.toUpperCase(); break;
      case 'DTSTART': cur.start = parseDate(p.value, p.params); break;
      case 'DTEND': cur.end = parseDate(p.value, p.params); break;
      case 'DURATION': cur.duration = parseDuration(p.value); break;
      case 'RRULE': cur.rrule = parseRRule(p.value); break;
      case 'EXDATE': p.value.split(',').forEach((v) => { const d = parseDate(v, p.params); if (d) cur.exdates.add(d.ms); }); break;
      case 'RECURRENCE-ID': cur.recurrenceId = parseDate(p.value, p.params); break;
    }
  }
  return events.filter((e) => e.status !== 'CANCELLED' || e.recurrenceId);
}

// Occurrence start times (ms) of one event that could overlap [from, to).
function occurrences(ev, from, to, span) {
  const start = ev.start.ms;
  if (!ev.rrule) return start < to && start + Math.max(span, 1) > from ? [start] : [];
  const r = ev.rrule;
  const freq = r.FREQ;
  const interval = Math.max(1, parseInt(r.INTERVAL || '1', 10));
  const count = r.COUNT ? parseInt(r.COUNT, 10) : Infinity;
  const until = r.UNTIL ? parseDate(r.UNTIL, {}).ms + (r.UNTIL.length === 8 ? DAY_MS - 1 : 0) : Infinity;
  const byDay = r.BYDAY ? r.BYDAY.split(',').map((x) => WD[x.slice(-2)]).filter((x) => x !== undefined) : null;
  const s = new Date(start);
  const out = [];
  let n = 0;
  const push = (ms) => {
    if (ms < start) return true;
    if (ms > until || n >= count) return false;
    n++;
    if (ms < to && ms + Math.max(span, 1) > from) out.push(ms);
    return ms < to;
  };
  const at = (y, mo, d) => new Date(y, mo, d, s.getHours(), s.getMinutes(), s.getSeconds()).getTime();
  for (let i = 0; i < 5000; i++) {
    let keep = true;
    if (freq === 'DAILY') {
      keep = push(at(s.getFullYear(), s.getMonth(), s.getDate() + i * interval));
    } else if (freq === 'WEEKLY') {
      const weekStart = new Date(s.getFullYear(), s.getMonth(), s.getDate() - s.getDay() + i * 7 * interval);
      const days = byDay && byDay.length ? [...byDay].sort((a, b) => a - b) : [s.getDay()];
      for (const wd of days) { keep = push(at(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + wd)); if (!keep) break; }
    } else if (freq === 'MONTHLY') {
      const d = new Date(s.getFullYear(), s.getMonth() + i * interval, 1);
      const nth = r.BYDAY && r.BYDAY.match(/^(-?\d)(SU|MO|TU|WE|TH|FR|SA)$/);
      if (nth) {
        const k = +nth[1], wd = WD[nth[2]];
        const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        const cands = [];
        for (let day = 1; day <= last; day++) if (new Date(d.getFullYear(), d.getMonth(), day).getDay() === wd) cands.push(day);
        const day = k > 0 ? cands[k - 1] : cands[cands.length + k];
        if (day) keep = push(at(d.getFullYear(), d.getMonth(), day));
      } else {
        const day = r.BYMONTHDAY ? parseInt(r.BYMONTHDAY, 10) : s.getDate();
        if (day <= new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()) keep = push(at(d.getFullYear(), d.getMonth(), day));
      }
    } else if (freq === 'YEARLY') {
      const y = s.getFullYear() + i * interval;
      if (s.getMonth() !== 1 || s.getDate() !== 29 || new Date(y, 1, 29).getMonth() === 1) keep = push(at(y, s.getMonth(), s.getDate()));
    } else {
      return start < to && start + span > from ? [start] : [];
    }
    if (!keep) break;
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Expands a feed into per-day entries: { date, time, endTime, title, allDay }.
function expandICS(text, from, to) {
  const events = parseICS(text);
  const overrides = new Map(); // uid -> Set(original start ms)
  for (const e of events) if (e.recurrenceId && e.uid) {
    if (!overrides.has(e.uid)) overrides.set(e.uid, new Set());
    overrides.get(e.uid).add(e.recurrenceId.ms);
  }
  const out = [];
  for (const e of events) {
    if (e.status === 'CANCELLED') continue;
    const allDay = e.start.allDay;
    let span = e.end ? e.end.ms - e.start.ms : (e.duration || (allDay ? DAY_MS : 0));
    if (allDay && span <= 0) span = DAY_MS;
    const skip = !e.recurrenceId && e.uid && overrides.get(e.uid);
    for (const ms of occurrences(e, from, to, span)) {
      if (e.exdates.has(ms) || (skip && skip.has(ms))) continue;
      const s = new Date(ms);
      if (allDay) {
        const days = Math.min(62, Math.max(1, Math.round(span / DAY_MS)));
        for (let i = 0; i < days; i++) {
          const d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i);
          if (d.getTime() >= from && d.getTime() < to) out.push({ date: dayKey(d), time: '', endTime: '', title: e.summary || '(제목 없음)', allDay: true });
        }
      } else {
        const end = new Date(ms + span);
        out.push({ date: dayKey(s), time: hm(s), endTime: span > 0 && dayKey(end) === dayKey(s) ? hm(end) : '', title: e.summary || '(제목 없음)', allDay: false });
      }
    }
  }
  return out;
}

module.exports = { parseICS, expandICS };
