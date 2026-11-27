// Google Calendar sign-in (OAuth 2.0 for desktop apps: system browser + loopback redirect + PKCE)
// event fetching, and adding / deleting events the user enters in the planner. Tokens never leave
// this PC; the refresh token is encrypted with Windows DPAPI via Electron safeStorage.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { shell, safeStorage, net } = require('electron');

// calendar.readonly: list calendars + read events. calendar.events: add / delete events from the planner.
const SCOPES = 'openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events';
const WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const canWrite = (account) => !!(account && account.scope && account.scope.split(' ').includes(WRITE_SCOPE));
const DAY_MS = 86400000;

// Developers supply their own OAuth client (Desktop app type) in google-client.json, which is git-ignored.
function loadClient() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'google-client.json'), 'utf8'));
    const c = j.installed || j.web || j;
    return c.client_id ? { id: c.client_id, secret: c.client_secret || '' } : null;
  } catch { return null; }
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function encrypt(s) {
  return safeStorage.isEncryptionAvailable() ? 'dpapi:' + safeStorage.encryptString(s).toString('base64') : 'plain:' + s;
}
// A token encrypted under another Windows profile / app copy can't be decrypted here: treat it as
// signed out (the UI then asks to sign in again) instead of surfacing a crypto error.
function decrypt(s) {
  if (!s) return null;
  try {
    if (s.startsWith('dpapi:')) return safeStorage.decryptString(Buffer.from(s.slice(6), 'base64'));
    if (s.startsWith('plain:')) return s.slice(6);
  } catch (e) { console.warn('stored Google token unreadable; sign-in needed', e.message); }
  return null;
}

async function postForm(url, params) {
  const res = await net.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(body.error_description || body.error || `HTTP ${res.status}`); e.code = body.error; throw e; }
  return body;
}

// Opens the browser, waits for Google to redirect back to a one-shot local server, exchanges the code.
async function signIn(pages, opts = {}) {
  const client = loadClient();
  if (!client) { const e = new Error('no-client'); e.code = 'no-client'; throw e; }
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  let server;
  const codePromise = new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
      const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Desktop Planner</title><body style="font-family:sans-serif;display:grid;place-items:center;height:90vh;color:#333"><div style="text-align:center"><h2>${ok ? pages.ok : pages.fail}</h2><p>${pages.close}</p></div>`);
      if (ok) resolve(u.searchParams.get('code'));
      else reject(new Error(u.searchParams.get('error') || 'cancelled'));
    });
    server.on('error', reject);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const redirect = `http://127.0.0.1:${server.address().port}`;
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  Object.entries({
    client_id: client.id, redirect_uri: redirect, response_type: 'code', scope: SCOPES,
    code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent',
  }).forEach(([k, v]) => auth.searchParams.set(k, v));
  if (opts.onUrl) opts.onUrl(auth.toString());
  if (opts.openBrowser !== false) await shell.openExternal(auth.toString());

  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5 * 60 * 1000));
  try {
    const code = await Promise.race([codePromise, timeout]);
    const tok = await postForm('https://oauth2.googleapis.com/token', {
      code, client_id: client.id, client_secret: client.secret, redirect_uri: redirect,
      grant_type: 'authorization_code', code_verifier: verifier,
    });
    if (!tok.refresh_token) throw new Error('no refresh token');
    let email = '';
    try { email = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64').toString('utf8')).email || ''; } catch { /* optional */ }
    return { email, scope: tok.scope || '', refresh: encrypt(tok.refresh_token), access: tok.access_token, expires: Date.now() + (tok.expires_in - 60) * 1000 };
  } finally {
    server.close();
  }
}

let accessCache = null; // { token, expires }
async function accessToken(account) {
  if (accessCache && accessCache.expires > Date.now()) return accessCache.token;
  const client = loadClient();
  if (!client) { const e = new Error('no-client'); e.code = 'no-client'; throw e; }
  const refresh = decrypt(account.refresh);
  if (!refresh) { const e = new Error('signed-out'); e.code = 'invalid_grant'; throw e; }
  const tok = await postForm('https://oauth2.googleapis.com/token', {
    client_id: client.id, client_secret: client.secret, refresh_token: refresh, grant_type: 'refresh_token',
  });
  accessCache = { token: tok.access_token, expires: Date.now() + (tok.expires_in - 60) * 1000 };
  return accessCache.token;
}
function primeAccess(token, expires) { accessCache = token ? { token, expires } : null; }

async function api(account, url, opts = {}) {
  const headers = { Authorization: `Bearer ${await accessToken(account)}` };
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await net.fetch(url, {
    method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: AbortSignal.timeout(20000),
  });
  const body = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error((body.error && body.error.message) || `HTTP ${res.status}`);
    e.code = res.status;
    e.reason = body.error && body.error.errors && body.error.errors[0] && body.error.errors[0].reason;
    e.rateLimited = res.status === 429 || (res.status === 403 && /rateLimit|quota|userRateLimit/i.test(e.reason || ''));
    throw e;
  }
  apiCalls++;
  return body;
}
let apiCalls = 0; // successful Calendar API requests in this session (for diagnostics)
const callCount = () => apiCalls;

async function listCalendars(account) {
  const items = [];
  let page = '';
  do {
    const b = await api(account, `https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=250${page ? '&pageToken=' + encodeURIComponent(page) : ''}`);
    items.push(...(b.items || []));
    page = b.nextPageToken || '';
  } while (page);
  return items.map((c) => ({
    id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '#4285f4', primary: !!c.primary, selected: !!c.selected,
    writable: c.accessRole === 'owner' || c.accessRole === 'writer',
  }));
}

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

async function listEvents(account, calId, from, to) {
  const out = [];
  let page = '';
  do {
    const q = new URLSearchParams({
      timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: 'true',
      orderBy: 'startTime', maxResults: '2500', fields: 'items(id,summary,start,end,status),nextPageToken',
    });
    if (page) q.set('pageToken', page);
    const b = await api(account, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${q}`);
    for (const e of b.items || []) {
      if (e.status === 'cancelled' || !e.start) continue;
      const title = e.summary || '(no title)';
      if (e.start.date) {
        const s = parseDate(e.start.date), en = e.end && e.end.date ? parseDate(e.end.date) : new Date(s.getTime() + DAY_MS);
        const days = Math.min(62, Math.max(1, Math.round((en - s) / DAY_MS)));
        for (let i = 0; i < days; i++) {
          const d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i);
          if (d.getTime() >= from && d.getTime() < to) out.push({ id: e.id, date: dayKey(d), time: '', endTime: '', title, allDay: true });
        }
      } else if (e.start.dateTime) {
        out.push(timedEvent(e.id, title, new Date(e.start.dateTime), e.end && e.end.dateTime ? new Date(e.end.dateTime) : null));
      }
    }
    page = b.nextPageToken || '';
  } while (page);
  return out;
}
const timedEvent = (id, title, s, en) => ({ id, date: dayKey(s), time: hm(s), endTime: en && en > s && dayKey(en) === dayKey(s) ? hm(en) : '', title, allDay: false });

// ev = { date: 'YYYY-MM-DD', endDate?: 'YYYY-MM-DD', time: 'HH:MM' | '', endTime: 'HH:MM' | '', title }
// No time → all-day event (spanning date..endDate). Time without an end → one hour long.
function eventBody(ev) {
  const body = { summary: ev.title };
  if (!ev.time) {
    const last = parseDate(ev.endDate && ev.endDate > ev.date ? ev.endDate : ev.date);
    body.start = { date: ev.date };
    body.end = { date: dayKey(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1)) }; // exclusive
  } else {
    const [y, m, d] = ev.date.split('-').map(Number);
    const at = (t) => { const [h, mi] = t.split(':').map(Number); return new Date(y, m - 1, d, h, mi); };
    const s = at(ev.time);
    let en = ev.endTime ? at(ev.endTime) : new Date(s.getTime() + 3600000);
    if (en <= s) en = new Date(s.getTime() + 3600000);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    body.start = { dateTime: s.toISOString(), timeZone: tz };
    body.end = { dateTime: en.toISOString(), timeZone: tz };
  }
  return body;
}
// The saved event as listEvents-shaped entries (one per day for a multi-day all-day event).
function entriesFor(id, ev, body) {
  if (body.start.dateTime) return [timedEvent(id, ev.title, new Date(body.start.dateTime), new Date(body.end.dateTime))];
  const out = [], last = parseDate(ev.endDate && ev.endDate > ev.date ? ev.endDate : ev.date);
  for (let d = parseDate(ev.date); d <= last; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    out.push({ id, date: dayKey(d), time: '', endTime: '', title: ev.title, allDay: true });
  }
  return out;
}
async function createEvent(account, calId, ev) {
  const body = eventBody(ev);
  const r = await api(account, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?fields=id`, { method: 'POST', body });
  return entriesFor(r.id, ev, body);
}
// Changes the title / day / time of an existing event (one occurrence when it's part of a series).
// PATCH keeps everything else (description, guests, Google's own reminders) as it was.
async function updateEvent(account, calId, eventId, ev) {
  const body = eventBody(ev);
  // switching between all-day and timed: clear the other kind of start/end
  for (const k of ['start', 'end']) body[k] = body[k].date ? { date: body[k].date, dateTime: null, timeZone: null } : { ...body[k], date: null };
  const r = await api(account, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}?fields=id`, { method: 'PATCH', body });
  return entriesFor(r.id || eventId, ev, body);
}

async function deleteEvent(account, calId, eventId) {
  try {
    await api(account, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
  } catch (e) {
    if (e.code !== 404 && e.code !== 410) throw e; // already gone
  }
}

async function revoke(account) {
  const refresh = decrypt(account && account.refresh);
  accessCache = null;
  if (!refresh) return;
  try { await postForm('https://oauth2.googleapis.com/revoke', { token: refresh }); } catch { /* already revoked */ }
}

module.exports = { loadClient, signIn, listCalendars, listEvents, createEvent, updateEvent, deleteEvent, canWrite, revoke, primeAccess, callCount };
