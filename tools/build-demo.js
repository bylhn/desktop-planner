// Builds the homepage's try-it demo (docs/demo/index.html) from the real app UI (index.html).
// The Electron bridge is replaced by docs/demo/demo-api.js, which keeps data in localStorage.
// Run after changing index.html:  npm run demo
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const marker = '<script>\n/* ---------- i18n';
const at = html.replace(/\r\n/g, '\n').indexOf(marker);
if (at < 0) throw new Error('could not find the main <script> in index.html');
html = html.replace(/\r\n/g, '\n');
const version = require(path.join(root, 'package.json')).version;
html = html.slice(0, at) + `<script src="demo-api.js?v=${version}"></script>\n` + html.slice(at);

// The app's CSP stays (it allows same-origin scripts and images, which is all the demo needs).
// Keep search engines from indexing the bare demo page on its own.
html = html.replace('<head>', '<head>\n<meta name="robots" content="noindex">');

fs.writeFileSync(path.join(root, 'docs', 'demo', 'index.html'), html);
console.log('docs/demo/index.html written');

// so browsers that kept an old copy load the new demo
const home = path.join(root, 'docs', 'index.html');
const page = fs.readFileSync(home, 'utf8').replace(/demo\/index\.html(\?v=[\d.]+)?"/g, `demo/index.html?v=${version}"`);
fs.writeFileSync(home, page);
console.log(`docs/index.html demo links → v${version}`);
