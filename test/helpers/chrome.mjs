// Drives headless Chrome over the DevTools protocol (no extra packages: Node's global fetch + WebSocket).
// Used by the UI tests, which run the real app UI through the web demo (docs/demo).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
export const chromePath = CANDIDATES.find((p) => p && fs.existsSync(p));
export const DEMO_URL = pathToFileURL(path.join(import.meta.dirname, '..', '..', 'docs', 'demo', 'index.html')).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { sleep };

// Opens the demo in a fresh profile (fresh sample data) in Korean, 1200×780.
export async function openDemo(url = DEMO_URL) {
  const port = 9300 + Math.floor(Math.random() * 600);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-test-'));
  const args = ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--allow-file-access-from-files', '--lang=ko', 'about:blank'];
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  const proc = spawn(chromePath, args, { stdio: 'ignore' });
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page')?.webSocketDebuggerUrl; } catch {}
    if (!wsUrl) await sleep(250);
  }
  if (!wsUrl) { proc.kill(); throw new Error('Chrome did not start'); }
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'page error');
    return r.result.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 780, deviceScaleFactor: 1, mobile: false });
  const ua = (await send('Browser.getVersion')).result.userAgent;
  await send('Emulation.setUserAgentOverride', { userAgent: ua, acceptLanguage: 'ko-KR,ko' });
  await send('Page.navigate', { url }); await sleep(2500);
  const key = async (k) => {
    const code = { Enter: 13, Escape: 27 }[k];
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k });
  };
  const close = () => { try { ws.close(); } catch {} proc.kill(); setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }, 1000); };
  return { send, ev, key, close };
}

// Page helpers (strings evaluated in the demo page)
export const pickDay = (dayExpr) => `(()=>{const c=[...document.querySelectorAll('#grid .cell')].find(c=>c.dataset.k===${dayExpr}); c.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0})); document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); return true})()`;
export const row = (name) => `[...document.querySelectorAll('#mpList .ev')].find(x=>x.textContent.includes(${JSON.stringify(name)}))`;
