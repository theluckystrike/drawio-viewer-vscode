'use strict';
// Extension tests with the vscode stub: listing, activation, the custom editor's messages (pages in, rendered and
// failed out), the four Pro tools with 1 free try each (the 2nd use opens the Pro panel, on another file, and after a
// reload), toolbar and Explorer entries, README, walkthrough and support links, webview CSP, vendored library.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { loadExtension, tmpDir, cleanup } = require('./support/vscode-stub');
const { editorHtml } = require('../src/html');
const D = require('../src/core/drawio');

const ROOT = path.join(__dirname, '..');
const SAMPLES = path.join(ROOT, 'samples');
const FIX = path.join(__dirname, 'fixtures');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = f(); if (v) return v; await tick(10); } return f(); };
test.after(() => cleanup());

const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/** A webview stand-in that answers like media/viewer.js: rendered or failed after init, the state, and exports with
 *  one SVG (and PNG) per page asked for. */
function fakePanel(behaviour = {}) {
  let onMsg;
  const posted = [];
  const panel = {
    posted, viewColumn: 1, active: true, jobs: [], pages: null, page: behaviour.page || 0,
    webview: {
      options: {}, html: '', cspSource: 'vscode-resource:', asWebviewUri: (u) => u,
      postMessage: async (m) => { posted.push(m); setTimeout(() => answer(m), 0); return true; },
      onDidReceiveMessage: (f) => { onMsg = f; return { dispose() {} }; },
    },
    onDidChangeViewState: () => ({ dispose() {} }), onDidDispose: () => ({ dispose() {} }), reveal() {},
    send: (m) => onMsg(m),
  };
  function answer(m) {
    if (m.type === 'init') {
      if (m.ok) { panel.pages = m.pages; panel.send({ type: 'page', page: panel.page }); panel.send({ type: 'rendered', stats: { pages: m.pages.length } }); } else panel.send({ type: 'failed', reason: m.code, message: m.error });
      return;
    }
    if (m.type === 'state') { panel.send({ type: 'stateResult', req: m.req, ok: true, state: { page: panel.page } }); return; }
    if (m.type === 'export') {
      panel.jobs.push(m);
      if (behaviour.exportFails) { panel.send({ type: 'exportResult', req: m.req, ok: false, error: 'boom' }); return; }
      const pages = m.pages || panel.pages;
      const list = m.pages || m.scope === 'all' ? pages.map((p, i) => i) : [panel.page];
      const items = list.map((i) => ({ page: i, name: pages[i].name, width: 100, height: 50, ...(m.formats.includes('svg') ? { svg: `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"><text>${pages[i].name}</text></svg>` } : {}), ...(m.formats.includes('png') ? { png: PNG1 } : {}) }));
      panel.send({ type: 'exportResult', req: m.req, ok: true, items });
    }
  }
  return panel;
}

const activated = [];
function activate(folder, state, behaviour) {
  const s = loadExtension();
  if (folder) s.vscode.workspace.workspaceFolders = [{ uri: s.vscode.Uri.file(folder), name: 'ws' }];
  if (state) for (const [k, v] of state) s.state.set(k, v);
  s.api = s.ext.activate(s.context);
  activated.push(s);
  s.opened = [];
  s.behaviour = behaviour || {};
  s.commands.set('vscode.openWith', async (uri, viewType) => {
    s.opened.push([uri.fsPath, viewType]);
    if (viewType !== 'drawioViewer.editor') return undefined;
    const prov = s.api.provider;
    for (const d of prov.docs) if (d.uri.toString() === uri.toString() && d.panels.size) { prov.active = d; prov.activePanel = [...d.panels][0]; return undefined; }
    const e = await openEditor(s, uri.fsPath, s.behaviour);
    prov.active = e.doc; prov.activePanel = e.panel;
    return undefined;
  });
  return s;
}
test.after(() => { for (const s of activated) s.api.provider.dispose(); });

async function openEditor(s, file, behaviour) {
  const prov = s.api.provider;
  const doc = prov.openCustomDocument(s.vscode.Uri.file(file));
  const panel = fakePanel(behaviour);
  await prov.resolveCustomEditor(doc, panel);
  await panel.send({ type: 'ready' });
  await until(() => doc.rendered || doc.failed, 3000);
  const init = panel.posted.find((m) => m.type === 'init');
  return { prov, doc, panel, init };
}
function ws() {
  const dir = tmpDir('drawio-ws-');
  for (const f of fs.readdirSync(SAMPLES)) fs.copyFileSync(path.join(SAMPLES, f), path.join(dir, f));
  for (const f of fs.readdirSync(FIX)) fs.copyFileSync(path.join(FIX, f), path.join(dir, f));
  fs.copyFileSync(path.join(FIX, 'plain.drawio'), path.join(dir, 'UPPER.DRAWIO'));
  fs.mkdirSync(path.join(dir, 'set-a', 'sub'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'set-b'), { recursive: true });
  fs.copyFileSync(path.join(SAMPLES, 'web-shop-architecture.drawio'), path.join(dir, 'set-a', 'shop.drawio'));
  fs.copyFileSync(path.join(FIX, 'compressed.dio'), path.join(dir, 'set-a', 'sub', 'packed.dio'));
  fs.copyFileSync(path.join(FIX, 'broken.drawio'), path.join(dir, 'set-a', 'sub', 'broken.drawio'));
  fs.copyFileSync(path.join(FIX, 'plain.drawio'), path.join(dir, 'set-b', 'one.drawio'));
  return dir;
}
const U = (s, dir, f) => s.vscode.Uri.file(path.join(dir, f));
const proPanels = (s, title) => s.log.info.filter((m) => m.text === `${title} is part of Zovo Pro.`);

// ---------- package.json and listing ----------
test('listing: display name, description with the phrase first, 5 keywords, engines, repository, icon 128 x 128', () => {
  assert.equal(pkg.displayName, 'Drawio Viewer & Preview');
  assert.ok(pkg.displayName.length <= 30);
  assert.equal(pkg.name, 'zovo-drawio-viewer');
  assert.equal(pkg.publisher, 'zovo');
  assert.match(pkg.description, /^Drawio viewer /);
  assert.deepEqual(pkg.keywords, ['drawio', 'draw.io', 'diagram', 'dio', 'flowchart']);
  assert.equal(pkg.engines.vscode, '^1.75.0');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.repository.url, 'https://github.com/theluckystrike/drawio-viewer-vscode');
  const png = fs.readFileSync(path.join(ROOT, pkg.icon));
  assert.equal(png.readUInt32BE(16), 128);
  assert.equal(png.readUInt32BE(20), 128);
  assert.deepEqual(pkg.activationEvents, ['onUri']);
  assert.ok(!JSON.stringify(pkg).includes('onStartupFinished'));
});
test('editors: *.drawio and *.dio by default; never .drawio.svg, .drawio.png, .svg, .png or .xml', () => {
  const ed = pkg.contributes.customEditors;
  assert.equal(ed.length, 1);
  assert.equal(ed[0].priority, 'default');
  assert.deepEqual(ed[0].selector.map((x) => x.filenamePattern), ['*.drawio', '*.dio']);
  const raw = JSON.stringify(pkg.contributes.customEditors);
  for (const e of ['drawio.svg', 'drawio.png', '*.svg', '*.png', '*.xml']) assert.ok(!raw.includes(e), e);
});
test('menus: one backslash in the final package.json; the right-click regex matches upper case; no title on menu items', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
  assert.ok(raw.includes('resourceFilename =~ /\\\\.(drawio|dio)$/i'));
  assert.ok(!raw.includes('\\\\\\\\.'));
  const when = pkg.contributes.menus['explorer/context'][0].when;
  const re = new RegExp(/\/(.*)\/i/.exec(when)[1], 'i');
  for (const f of ['UPPER.DRAWIO', 'a.drawio', 'flow.dio', 'X.DIO']) assert.ok(re.test(f), f);
  for (const f of ['a.drawio.svg', 'a.drawio.png', 'a.xml', 'a.svg', 'a.drawio.bak']) assert.ok(!re.test(f), f);
  for (const [, items] of Object.entries(pkg.contributes.menus)) for (const m of items) assert.ok(!('title' in m), m.command);
  const wrappers = pkg.contributes.commands.filter((c) => /\.zovoPro\./.test(c.command));
  assert.equal(wrappers.length, 4);
  for (const w of wrappers) assert.match(w.title, /^Zovo Pro: /);
  const hidden = new Set(pkg.contributes.menus.commandPalette.filter((m) => m.when === 'false').map((m) => m.command));
  for (const w of wrappers) assert.ok(hidden.has(w.command));
  for (const id of ['exportImages', 'compare', 'extract', 'batchExport']) assert.ok(!hidden.has(`drawioViewer.${id}`), id);
  assert.ok(pkg.contributes.menus['explorer/context'].some((m) => m.command === 'drawioViewer.zovoPro.batchExport' && /explorerResourceIsFolder/.test(m.when)));
});
test('every contributed command is registered, and every registered drawioViewer command is contributed', () => {
  const s = activate();
  const contributed = new Set(pkg.contributes.commands.map((c) => c.command));
  for (const c of contributed) assert.ok(s.commands.has(c), `not registered: ${c}`);
  for (const c of s.commands.keys()) if (c.startsWith('drawioViewer.')) assert.ok(contributed.has(c), `not contributed: ${c}`);
});
test('the trial kill switch setting is there, default on', () => {
  const p = pkg.contributes.configuration.properties['zovo.drawio.trial.enabled'];
  assert.equal(p.type, 'boolean');
  assert.equal(p.default, true);
  assert.equal(p.description, 'Show the 7-day Zovo Pro trial button in the Pro panel.');
});
test('activation shows nothing: no message, no panel, no editor, no status text', () => {
  const s = activate();
  assert.equal(s.log.info.length + s.log.warn.length + s.log.error.length, 0);
  assert.equal(s.log.panel, undefined);
  assert.equal(s.opened.length, 0);
  assert.equal(s.log.status.length, 0);
});

// ---------- the viewer ----------
test('viewer: every page arrives as plain XML with its cells; rating success once after it rendered', async () => {
  const dir = ws();
  const s = activate(dir);
  let ok = 0;
  s.api.provider.hooks.onSuccess = () => { ok++; };
  const e = await openEditor(s, path.join(dir, 'web-shop-architecture.drawio'));
  assert.equal(e.init.ok, true);
  assert.equal(e.init.name, 'web-shop-architecture.drawio');
  assert.equal(e.init.compressed, true);
  assert.deepEqual(e.init.pages.map((p) => p.name), ['Architecture', 'Order flow', 'Deployment']);
  for (const p of e.init.pages) assert.match(p.xml, /^<mxGraphModel/);
  const web = e.init.pages[0].cells.find((c) => c.id === 'web');
  assert.deepEqual([web.text, web.link, web.shape, web.data.owner], ['Web app', 'https://example.com/runbooks/web-app', 'rounded rectangle', 'Team Storefront']);
  assert.deepEqual(Object.keys(e.init.settings).sort(), ['canvas', 'maxFileMB']);
  assert.ok(e.doc.rendered);
  assert.equal(ok, 1);
  assert.match(e.panel.webview.html, /viewer-static\.min\.js/);
  assert.match(e.panel.webview.html, /stencils\.min\.js/);
  const order = ['config.js', 'viewer-static.min.js', 'guard.js', 'stencils.min.js', 'sanitize.js', 'viewer.js'].map((f) => e.panel.webview.html.indexOf(f));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});
test('viewer: a broken, empty or foreign file gets a clear message and counts as a failure for the rating', async () => {
  const dir = ws();
  const s = activate(dir);
  let bad = 0;
  s.api.provider.hooks.onFailure = () => { bad++; };
  for (const [f, re] of [['broken.drawio', /attribute .* (has no value|is not closed)|is not finished|ends before/], ['empty.dio', /The file is empty/], ['not-a-diagram.drawio', /starts with <svg>/], ['damaged-compressed.drawio', /could not be inflated/]]) {
    const e = await openEditor(s, path.join(dir, f));
    assert.equal(e.init.ok, false, f);
    assert.match(e.init.error, re, f);
    assert.ok(e.doc.failed, f);
  }
  assert.equal(bad, 4);
  assert.equal(s.log.error.length, 0);
});
test('viewer: a file over the size limit is not read', async () => {
  const dir = ws();
  const s = activate(dir);
  s.config.maxFileMB = 0.0005;
  const e = await openEditor(s, path.join(dir, 'web-shop-architecture.drawio'));
  assert.equal(e.init.ok, false);
  assert.match(e.init.error, /above the limit of 0\.0005 MB/);
});
test('viewer: export images may only come from lib/drawio/img (no path tricks)', async () => {
  const s = activate();
  const files = await s.api.provider.assets(['img/lib/azure2/compute/Virtual_Machine.svg', '../../package.json', 'img/../../package.json', 'viewer-static.min.js', '/etc/passwd']);
  assert.deepEqual(Object.keys(files), ['img/lib/azure2/compute/Virtual_Machine.svg']);
  assert.match(files['img/lib/azure2/compute/Virtual_Machine.svg'], /^data:image\/svg\+xml;base64,/);
});
test('webview HTML: strict CSP, nonce scripts, no remote URLs, no connect, worker or frame sources', () => {
  const html = editorHtml({ cspSource: 'vscode-resource:', scripts: ['a.js', 'b.js'], styleUri: 's.css', title: 'x<y', nonce: 'N', base: 'vscode-resource:/lib/drawio' });
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /^default-src 'none'; /);
  assert.match(csp, /script-src 'nonce-N'(;|$)/);
  assert.doesNotMatch(csp, /connect-src|worker-src|frame-src|unsafe-eval|https?:/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  assert.equal((html.match(/<script /g) || []).length, (html.match(/<script nonce="N"/g) || []).length);
  assert.doesNotMatch(html.replace(/https:\/\/marketplace\.visualstudio\.com[^"]*/g, ''), /https?:\/\//);
  assert.match(html, /x&lt;y/);
  assert.match(html, /data-base="vscode-resource:\/lib\/drawio"/);
});
test('no source or media file of ours opens a network connection or uses eval; the page script stubs out XHR and fetch', () => {
  const files = ['media/viewer.js', 'media/guard.js', ...fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')).map((f) => 'src/' + f), ...fs.readdirSync(path.join(ROOT, 'src/core')).map((f) => 'src/core/' + f)];
  for (const f of files) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(t, /\bfetch\(|XMLHttpRequest|new WebSocket|require\(['"](https?|net|http2|tls)['"]\)|\beval\(/, f);
  }
  const cfg = fs.readFileSync(path.join(ROOT, 'media/config.js'), 'utf8');
  assert.match(cfg, /window\.XMLHttpRequest = NoXhr;/);
  assert.match(cfg, /window\.fetch = function \(\) \{ return Promise\.reject/);
  assert.match(cfg, /window\.open = function \(\) \{ return null; \};/);
  assert.doesNotMatch(cfg, /new XMLHttpRequest|\bfetch\(|https?:\/\//);
  const guard = fs.readFileSync(path.join(ROOT, 'media/guard.js'), 'utf8');
  assert.match(guard, /mxStencilRegistry\.allowEval = false;/);
  assert.match(guard, /Graph\.prototype\.openLink = function \(\) \{ return null; \};/);
});
test('vendored diagram library: unmodified files with the Apache-2.0 license and the stencil notice next to them, listed in the notices', () => {
  const lib = path.join(ROOT, 'lib', 'drawio');
  assert.match(fs.readFileSync(path.join(lib, 'LICENSE'), 'utf8'), /Apache License\s+Version 2\.0/);
  assert.match(fs.readFileSync(path.join(lib, 'LICENSE-stencils'), 'utf8'), /icon sets and stencil libraries/);
  const crypto = require('crypto');
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(lib, f))).digest('hex');
  const notices = fs.readFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8');
  for (const f of ['viewer-static.min.js', 'stencils.min.js']) assert.ok(notices.includes(sha(f)), `${f} sha256 in the notices`);
  assert.match(notices, /Apache License 2\.0/);
  assert.ok(fs.existsSync(path.join(lib, 'img', 'lib', 'azure2')));
});

// ---------- Pro: Export pages to SVG and PNG ----------
test('Pro Export: all pages as SVG and PNG, one pair per page with number and name; the try counts once', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.quick.push((items) => items.find((i) => /^All 3 pages/.test(i.label)), (items) => items.find((i) => i.label === 'SVG and PNG'));
  s.ui.save.push(U(s, dir, 'shop.svg'));
  const r = await s.api.tools.exportImages(U(s, dir, 'web-shop-architecture.drawio'));
  assert.equal(r.pages, 3);
  assert.deepEqual(r.files.map((u) => path.basename(u.fsPath)), ['shop-01-Architecture.svg', 'shop-01-Architecture.png', 'shop-02-Order-flow.svg', 'shop-02-Order-flow.png', 'shop-03-Deployment.svg', 'shop-03-Deployment.png']);
  assert.match(fs.readFileSync(path.join(dir, 'shop-02-Order-flow.svg'), 'utf8'), /<text>Order flow<\/text>/);
  assert.deepEqual([...fs.readFileSync(path.join(dir, 'shop-01-Architecture.png')).subarray(1, 4)], [80, 78, 71]);
  assert.equal(s.api.pro.left('exportImages'), 0);
  assert.equal(s.log.status.filter((t) => /free try 1 of 1 of "Export SVG and PNG" used/.test(t)).length, 1);
});
test('Pro Export A then B: used on file A, the click on file B opens the Pro panel and nothing is asked or written', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.save.push(U(s, dir, 'a.svg'));
  await s.api.tools.exportImages(U(s, dir, 'plain.drawio'), { format: 'svg' });
  assert.ok(fs.existsSync(path.join(dir, 'a.svg')));
  s.log.lastPick = undefined;
  s.ui.save.push(U(s, dir, 'b.svg'));
  const r = await s.api.tools.exportImages(U(s, dir, 'compressed.dio'), { format: 'svg' });
  assert.equal(r, undefined);
  assert.equal(proPanels(s, 'Export SVG and PNG').length, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'b.svg')));
  assert.equal(s.log.lastPick, undefined);
});
test('Pro Export: Escape in a pick, a cancelled save, a broken file or a failed drawing uses no try', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.quick.push(undefined);
  assert.equal(await s.api.tools.exportImages(U(s, dir, 'web-shop-architecture.drawio')), undefined);
  assert.equal(await s.api.tools.exportImages(U(s, dir, 'plain.drawio'), { format: 'png' }), undefined);
  assert.equal(await s.api.tools.exportImages(U(s, dir, 'broken.drawio'), { format: 'svg' }), undefined);
  assert.ok(s.log.error.some((m) => /broken\.drawio could not be drawn/.test(m.text)));
  const s2 = activate(dir, null, { exportFails: true });
  s2.ui.save.push(U(s2, dir, 'x.svg'));
  assert.equal(await s2.api.tools.exportImages(U(s2, dir, 'plain.drawio'), { format: 'svg' }), undefined);
  assert.ok(s2.log.error.some((m) => /Export failed: boom/.test(m.text)));
  assert.equal(s.api.pro.left('exportImages'), 1);
  assert.equal(s2.api.pro.left('exportImages'), 1);
});
test('Pro Export: the current page only, as shown in the viewer', async () => {
  const dir = ws();
  const s = activate(dir, null, { page: 2 });
  s.ui.quick.push((items) => { assert.match(items[0].description, /"Deployment"/); return items[0]; });
  s.ui.save.push(U(s, dir, 'deploy.png'));
  const r = await s.api.tools.exportImages(U(s, dir, 'web-shop-architecture.drawio'), { format: 'png' });
  assert.deepEqual(r.files.map((u) => path.basename(u.fsPath)), ['deploy.png']);
});

// ---------- Pro: Compare ----------
test('Pro Compare: picks B from the workspace, writes the Markdown report, shows it, then counts the try', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.quick.push((items) => { assert.ok(!items.some((i) => i.label === 'flow-v1.drawio')); assert.ok(items.some((i) => i.label === 'UPPER.DRAWIO')); return items.find((i) => i.label === 'flow-v2.drawio'); });
  s.ui.save.push(U(s, dir, 'report.md'));
  const r = await s.api.tools.compare(U(s, dir, 'flow-v1.drawio'));
  assert.deepEqual(r.totals, { added: 3, removed: 2, changed: 3, same: 3, pagesAdded: 1, pagesRemoved: 1, labelChanges: 2 });
  const md = fs.readFileSync(path.join(dir, 'report.md'), 'utf8');
  assert.match(md, /^# Diagram compare: flow-v1\.drawio and flow-v2\.drawio/);
  assert.match(md, /label: "Review" → "Peer review"/);
  assert.equal(s.log.opened.length, 1);
  assert.equal(s.api.pro.left('compare'), 0);
});
test('Pro Compare A then B: after one compare, comparing another file opens the Pro panel and writes nothing', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.save.push(U(s, dir, 'one.md'));
  await s.api.tools.compare(U(s, dir, 'flow-v1.drawio'), { other: U(s, dir, 'flow-v2.drawio') });
  s.log.lastPick = undefined;
  s.ui.save.push(U(s, dir, 'two.md'));
  assert.equal(await s.api.tools.compare(U(s, dir, 'plain.drawio'), { other: U(s, dir, 'compressed.dio') }), undefined);
  assert.equal(proPanels(s, 'Compare diagrams').length, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'two.md')));
  assert.equal(s.log.lastPick, undefined);
});
test('Pro Compare: Escape in the file pick, a cancelled save, a broken B or overwriting a diagram uses no try', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.quick.push(undefined);
  assert.equal(await s.api.tools.compare(U(s, dir, 'flow-v1.drawio')), undefined);
  assert.equal(await s.api.tools.compare(U(s, dir, 'flow-v1.drawio'), { other: U(s, dir, 'flow-v2.drawio') }), undefined);
  assert.equal(await s.api.tools.compare(U(s, dir, 'flow-v1.drawio'), { other: U(s, dir, 'broken.drawio') }), undefined);
  assert.ok(s.log.error.some((m) => /broken\.drawio could not be read as a diagram/.test(m.text)));
  s.ui.save.push(U(s, dir, 'flow-v2.drawio'));
  assert.equal(await s.api.tools.compare(U(s, dir, 'flow-v1.drawio'), { other: U(s, dir, 'flow-v2.drawio') }), undefined);
  assert.ok(s.log.error.some((m) => /never overwritten/.test(m.text)));
  assert.equal(s.api.pro.left('compare'), 1);
});

// ---------- Pro: Extract ----------
test('Pro Extract: CSV with every shape and connector of every page and the data columns; the try counts after the write', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.quick.push((items) => items.find((i) => i.label === 'CSV'));
  s.ui.save.push(U(s, dir, 'labels.csv'));
  const r = await s.api.tools.extract(U(s, dir, 'web-shop-architecture.drawio'));
  assert.equal(r.rows, 37);
  const csv = fs.readFileSync(path.join(dir, 'labels.csv'), 'utf8');
  assert.equal(csv.split('\r\n').length, 39);
  assert.match(csv, /Architecture,web,shape,Web app,"Next\.js storefront, 3 instances behind the load balancer",https:\/\/example\.com\/runbooks\/web-app,/);
  assert.equal(s.api.pro.left('extract'), 0);
});
test('Pro Extract A then B: after one extract, the tool on another file opens the Pro panel', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.save.push(U(s, dir, 'a.md'));
  await s.api.tools.extract(U(s, dir, 'flow-v1.drawio'), { format: 'md' });
  assert.match(fs.readFileSync(path.join(dir, 'a.md'), 'utf8'), /^# Labels and data: flow-v1\.drawio/);
  s.ui.save.push(U(s, dir, 'b.md'));
  assert.equal(await s.api.tools.extract(U(s, dir, 'UPPER.DRAWIO'), { format: 'md' }), undefined);
  assert.equal(proPanels(s, 'Extract labels and data').length, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'b.md')));
});
test('Pro Extract: Escape, a cancelled save or a broken file uses no try', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.quick.push(undefined);
  assert.equal(await s.api.tools.extract(U(s, dir, 'plain.drawio')), undefined);
  assert.equal(await s.api.tools.extract(U(s, dir, 'plain.drawio'), { format: 'csv' }), undefined);
  assert.equal(await s.api.tools.extract(U(s, dir, 'empty.dio'), { format: 'csv' }), undefined);
  assert.equal(s.api.pro.left('extract'), 1);
});

// ---------- Pro: Batch export ----------
test('Pro Batch export: every page of every diagram in the folder and subfolders to SVG; a broken file is listed, not fatal', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.quick.push((items) => items[0]);
  const r = await s.api.tools.batchExport(U(s, dir, 'set-a'));
  const out = path.join(dir, 'set-a', 'svg-export');
  const list = (d) => fs.readdirSync(d, { recursive: true }).filter((f) => /\.(svg|md)$/.test(f)).sort();
  assert.deepEqual(list(out), ['export-errors.md', 'shop-01-Architecture.svg', 'shop-02-Order-flow.svg', 'shop-03-Deployment.svg', path.join('sub', 'packed.svg')].sort());
  assert.match(fs.readFileSync(path.join(out, 'export-errors.md'), 'utf8'), /sub\/broken\.drawio: /);
  assert.equal(r.written.length, 4);
  assert.equal(r.failed.length, 1);
  assert.equal(s.api.pro.left('batchExport'), 0);
  assert.ok(s.log.status.some((t) => /free try 1 of 1 of "Batch export to SVG" used/.test(t)));
  assert.ok(s.log.status.every((t) => !/^Batch export:/.test(t)));
});
test('Pro Batch export: plan.drawio and plan.dio, and a file named like a page output, each get their own SVG files', async () => {
  const dir = ws();
  const s = activate(dir);
  const set = path.join(dir, 'set-c');
  fs.mkdirSync(path.join(set, 'sub'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'plain.drawio'), path.join(set, 'plan.drawio'));
  fs.copyFileSync(path.join(FIX, 'compressed.dio'), path.join(set, 'plan.dio'));
  fs.copyFileSync(path.join(SAMPLES, 'web-shop-architecture.drawio'), path.join(set, 'shop.drawio'));
  fs.copyFileSync(path.join(FIX, 'plain.drawio'), path.join(set, 'shop-01-Architecture.drawio'));
  fs.copyFileSync(path.join(FIX, 'plain.drawio'), path.join(set, 'sub', 'x.drawio'));
  fs.copyFileSync(path.join(FIX, 'compressed.dio'), path.join(set, 'sub', 'X.DIO'));
  const r = await s.api.tools.batchExport(U(s, dir, 'set-c'), { out: U(s, dir, 'out-c') });
  const out = path.join(dir, 'out-c');
  const onDisk = fs.readdirSync(out, { recursive: true }).filter((f) => /\.svg$/.test(f));
  assert.equal(r.failed.length, 0);
  assert.equal(r.written.length, 1 + 1 + 3 + 1 + 1 + 1);
  assert.equal(new Set(r.written.map((u) => u.path.toLowerCase())).size, r.written.length);
  assert.equal(onDisk.length, r.written.length);
  assert.ok(onDisk.includes('plan.drawio.svg') && onDisk.includes('plan.dio.svg'), onDisk.join(' '));
  assert.ok(onDisk.includes('shop-01-Architecture.svg'));
  assert.ok(onDisk.some((f) => /^shop-01-Architecture-2\.svg$/.test(f)), onDisk.join(' '));
  // each source is in the summary map, one entry per written file
  assert.equal(r.map.length, r.written.length);
  assert.deepEqual([...new Set(r.map.map((m) => m.source))].sort(), ['plan.dio', 'plan.drawio', 'shop-01-Architecture.drawio', 'shop.drawio', 'sub/X.DIO', 'sub/x.drawio']);
});
test('Pro Batch export A then B: after one folder, another folder opens the Pro panel and nothing is written', async () => {
  const dir = ws();
  const s = activate(dir);
  await s.api.tools.batchExport(U(s, dir, 'set-a'), { out: U(s, dir, 'out-a') });
  assert.ok(fs.existsSync(path.join(dir, 'out-a', 'shop-01-Architecture.svg')));
  assert.equal(await s.api.tools.batchExport(U(s, dir, 'set-b'), { out: U(s, dir, 'out-b') }), undefined);
  assert.equal(proPanels(s, 'Batch export to SVG').length, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'out-b')));
});
test('Pro Batch export: a folder without diagrams, Escape at the output pick or a right-click on a file inside uses its folder', async () => {
  const dir = ws();
  const s = activate(dir);
  fs.mkdirSync(path.join(dir, 'empty'));
  assert.equal(await s.api.tools.batchExport(U(s, dir, 'empty')), undefined);
  assert.ok(s.log.error.some((m) => /No \.drawio or \.dio file/.test(m.text)));
  s.ui.quick.push(undefined);
  assert.equal(await s.api.tools.batchExport(U(s, dir, 'set-b')), undefined);
  assert.equal(s.api.pro.left('batchExport'), 1);
  const r = await s.api.tools.batchExport(U(s, dir, path.join('set-b', 'one.drawio')), { out: U(s, dir, 'out-c') });
  assert.equal(r.written.length, 1);
  assert.ok(fs.existsSync(path.join(dir, 'out-c', 'one.svg')));
});

// ---------- tries across tools, reloads and surfaces ----------
test('a window reload keeps the counts: after a reload every used tool opens the Pro panel', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.save.push(U(s, dir, 'a.svg'), U(s, dir, 'b.md'));
  await s.api.tools.exportImages(U(s, dir, 'plain.drawio'), { format: 'svg' });
  await s.api.tools.compare(U(s, dir, 'flow-v1.drawio'), { other: U(s, dir, 'flow-v2.drawio') });
  const s2 = activate(dir, s.state);
  assert.deepEqual(s2.api.pro.tries(), { exportImages: 0, compare: 0, extract: 1, batchExport: 1 });
  assert.equal(await s2.api.tools.exportImages(U(s2, dir, 'UPPER.DRAWIO'), { format: 'svg' }), undefined);
  assert.equal(await s2.api.tools.compare(U(s2, dir, 'UPPER.DRAWIO'), { other: U(s2, dir, 'plain.drawio') }), undefined);
  assert.equal(proPanels(s2, 'Export SVG and PNG').length, 1);
  assert.equal(proPanels(s2, 'Compare diagrams').length, 1);
  assert.match(s2.api.provider.hooks.reach().rowHtml(), /0 tries left/);
});
test('the Pro panel names the other tools with their tries and no URL is opened when it is dismissed', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.save.push(U(s, dir, 'x.csv'));
  await s.api.tools.extract(U(s, dir, 'plain.drawio'), { format: 'csv' });
  await s.api.tools.extract(U(s, dir, 'flow-v1.drawio'), { format: 'csv' });
  const p = proPanels(s, 'Extract labels and data')[0];
  assert.ok(p && p.opts.modal);
  assert.match(p.opts.detail, /You used the free try of Extract labels and data on this computer\./);
  assert.match(p.opts.detail, /Export SVG and PNG: 0 of 1 free try used/);
  assert.match(p.opts.detail, /Batch export to SVG: 0 of 1 free try used/);
  assert.equal(s.log.external.length, 0);
});
test('toolbar and Explorer entries run the tools: a toolbar link works on the viewer in front, the Explorer entry on the clicked file (upper case)', async () => {
  const dir = ws();
  const s = activate(dir);
  const e = await openEditor(s, path.join(dir, 'compressed.dio'));
  s.api.provider.active = e.doc; s.api.provider.activePanel = e.panel;
  s.ui.quick.push((items) => items.find((i) => i.label === 'Markdown'));
  s.ui.save.push(U(s, dir, 'from-toolbar.md'));
  await s.commands.get('drawioViewer.extract')({ surface: 'toolbar' });
  assert.match(fs.readFileSync(path.join(dir, 'from-toolbar.md'), 'utf8'), /^# Labels and data: compressed\.dio/);
  s.ui.quick.push((items) => items.find((i) => i.label === 'SVG'));
  s.ui.save.push(U(s, dir, 'upper.svg'));
  await s.commands.get('drawioViewer.zovoPro.exportImages')(U(s, dir, 'UPPER.DRAWIO'));
  assert.ok(fs.existsSync(path.join(dir, 'upper.svg')));
  s.ui.quick.push((items) => items[0]);
  await s.commands.get('drawioViewer.zovoPro.batchExport')(U(s, dir, 'set-b'));
  assert.ok(fs.existsSync(path.join(dir, 'set-b', 'svg-export', 'one.svg')));
});
test('Open in Drawio Viewer opens the clicked file; the sample command opens our sample', async () => {
  const dir = ws();
  const s = activate(dir);
  await s.commands.get('drawioViewer.openWith')(U(s, dir, 'UPPER.DRAWIO'));
  await s.commands.get('drawioViewer.openSample')();
  assert.deepEqual(s.opened.map((x) => [path.basename(x[0]), x[1]]), [['UPPER.DRAWIO', 'drawioViewer.editor'], ['web-shop-architecture.drawio', 'drawioViewer.editor']]);
});
void zlib; void D;
