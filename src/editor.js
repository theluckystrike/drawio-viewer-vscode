'use strict';
// The read-only custom editor for .drawio and .dio files. The extension host reads the file through VS Code's file
// system API (so remote folders work the same), unpacks every page (plain or compressed XML) with src/core/drawio.js
// and sends the pages to the webview, which draws them with the vendored diagram library. No network, no telemetry.
// It never writes the diagram and never reopens a tab in another editor by itself.
const vscode = require('vscode');
const path = require('path');
const D = require('./core/drawio');
const { editorHtml } = require('./html');
const support = require('./support');

const VIEW_TYPE = 'drawioViewer.editor';
const PREFIX = 'drawioViewer';
const setting = (k, d) => vscode.workspace.getConfiguration(PREFIX).get(k, d);
const MIME = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };

/** The page list the webview gets: the page XML and a light list of its cells. */
function forWebview(file) {
  return file.pages.map((p) => ({
    id: p.id, name: p.name, xml: p.xml, compressed: p.compressed, layers: p.layers,
    cells: p.cells.filter((c) => c.kind !== 'root').map((c) => ({ id: c.id, kind: c.kind, text: c.text, tooltip: c.tooltip, link: c.link, data: c.data, tags: c.tags, layer: c.layer, shape: D.shapeName(c), source: c.source, target: c.target, geometry: c.geometry })),
  }));
}

/** Reads and parses a diagram file; { file } or { error, code }. */
async function readDiagram(uri, maxMB) {
  let bytes;
  try {
    const st = await vscode.workspace.fs.stat(uri);
    if (maxMB && st.size > maxMB * 1024 * 1024) return { error: `The file is ${(st.size / 1048576).toFixed(1)} MB, above the limit of ${maxMB} MB (setting drawioViewer.maxFileMB).`, code: 'size' };
    bytes = await vscode.workspace.fs.readFile(uri);
  } catch (e) { return { error: `The file could not be read: ${(e && e.message) || e}`, code: 'read' }; }
  try {
    const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8');
    return { file: D.parseDiagramFile(text), size: bytes.length };
  } catch (e) {
    return { error: (e && e.message) || String(e), code: (e && e.code) || 'invalid' };
  }
}

class DrawioEditorProvider {
  constructor(context, hooks = {}) {
    this.context = context;
    this.hooks = hooks;
    this.docs = new Set();
    this.active = null;
    this.activePanel = null;
    this.pending = new Map();
    this.reqN = 0;
    this._success = new WeakSet();
  }
  dispose() { this.docs.clear(); for (const p of this.pending.values()) p.resolve({ ok: false, error: 'The viewer was closed.' }); this.pending.clear(); }

  openCustomDocument(uri) {
    const doc = { uri, name: path.posix.basename(uri.path), panels: new Set(), rendered: null, failed: null, dispose: () => { this.docs.delete(doc); if (this.active === doc) this.active = null; } };
    this.docs.add(doc);
    return doc;
  }

  settings() { return { canvas: setting('canvas', 'auto'), maxFileMB: setting('maxFileMB', 100) }; }

  async resolveCustomEditor(doc, panel) {
    doc.panels.add(panel);
    const ext = this.context.extensionUri;
    const media = vscode.Uri.joinPath(ext, 'media');
    const lib = vscode.Uri.joinPath(ext, 'lib', 'drawio');
    const core = vscode.Uri.joinPath(ext, 'src', 'core');
    const reach = this.hooks.reach ? this.hooks.reach() : null;
    panel.webview.options = {
      enableScripts: true, localResourceRoots: [media, lib, core],
      enableCommandUris: (reach ? reach.commandIds() : []).concat(support.commandUris(PREFIX)),
    };
    const u = (b, f) => panel.webview.asWebviewUri(vscode.Uri.joinPath(b, f)).toString();
    panel.webview.html = editorHtml({
      cspSource: panel.webview.cspSource,
      scripts: [u(media, 'config.js'), u(lib, 'viewer-static.min.js'), u(media, 'guard.js'), u(lib, 'stencils.min.js'), u(core, 'sanitize.js'), u(media, 'viewer.js')],
      styleUri: u(media, 'viewer.css'),
      base: panel.webview.asWebviewUri(lib).toString().replace(/\/$/, ''),
      title: doc.name,
      head: reach ? (n) => reach.headHtml(n) : undefined,
      showSupportLinks: setting('showSupportLinks', true) !== false,
    });
    if (reach) reach.attach(panel.webview, panel);
    const setActive = () => { if (panel.active) { this.active = doc; this.activePanel = panel; } };
    setActive();
    panel.onDidChangeViewState(setActive);
    panel.onDidDispose(() => { doc.panels.delete(panel); panel.disposed = true; if (this.activePanel === panel) { this.activePanel = null; if (this.active === doc) this.active = null; } });
    panel.webview.onDidReceiveMessage(async (m) => {
      if (reach && reach.onMessage(m)) return;
      if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
      try { await this.onMessage(doc, panel, m); } catch (e) { this.send(panel.webview, { type: 'hint', text: String((e && e.message) || e) }); }
    });
  }

  send(webview, msg) { try { const r = webview.postMessage(msg); if (r && r.then) r.then(undefined, () => false); return r; } catch (e) { return undefined; } }

  async init(doc, panel) {
    const s = this.settings();
    const r = await readDiagram(doc.uri, s.maxFileMB);
    if (r.error) {
      // counted here once (the webview's "failed" answer to this message is not counted again)
      doc.failed = r.code;
      doc.failMessage = r.error;
      if (this.hooks.onFailure) this.hooks.onFailure(doc);
      this.send(panel.webview, { type: 'init', ok: false, name: doc.name, error: r.error, code: r.code, settings: s });
      return;
    }
    doc.file = r.file;
    this.send(panel.webview, { type: 'init', ok: true, name: doc.name, size: r.size, compressed: r.file.compressed, warnings: r.file.warnings, pages: forWebview(r.file), settings: s });
  }

  /** Files the webview may inline into an export: only images under lib/drawio/img. */
  async assets(paths) {
    const root = vscode.Uri.joinPath(this.context.extensionUri, 'lib', 'drawio');
    const files = {};
    for (const p of (Array.isArray(paths) ? paths : []).slice(0, 500)) {
      const rel = path.posix.normalize(String(p).split('?')[0]);
      if (!/^img\/[\w./ ()&+,-]+$/.test(rel) || rel.includes('..')) continue;
      const ext = (rel.split('.').pop() || '').toLowerCase();
      if (!MIME[ext]) continue;
      try {
        const b = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, ...rel.split('/')));
        files[p] = `data:${MIME[ext]};base64,${Buffer.from(b).toString('base64')}`;
      } catch (e) { /* missing: the export keeps the reference */ }
    }
    return files;
  }

  async onMessage(doc, panel, m) {
    switch (m.type) {
      case 'ready': await this.init(doc, panel); return;
      case 'rendered':
        doc.rendered = m.stats && typeof m.stats === 'object' ? m.stats : {};
        doc.failed = null;
        if (!this._success.has(doc)) { this._success.add(doc); if (this.hooks.onSuccess) this.hooks.onSuccess(doc); }
        return;
      case 'failed': {
        const counted = !!doc.failed;
        doc.failed = String(m.reason || 'error');
        doc.failMessage = String(m.message || '');
        if (!counted && this.hooks.onFailure) this.hooks.onFailure(doc);
        return;
      }
      case 'page':
        doc.page = Number(m.page) || 0;
        return;
      case 'assets':
        this.send(panel.webview, { type: 'assetsResult', req: m.req, files: await this.assets(m.paths) });
        return;
      default:
        if (/Result$/.test(m.type) && typeof m.req === 'string' && this.pending.has(m.req)) {
          const p = this.pending.get(m.req);
          this.pending.delete(m.req);
          p.resolve(m);
        }
    }
  }

  /** Asks the viewer of panel to do a job; resolves with its answer. */
  request(panel, msg, ms = 180000) {
    const req = 'h' + (++this.reqN);
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.pending.delete(req); resolve({ ok: false, error: 'The viewer did not answer in time.' }); }, ms);
      this.pending.set(req, { resolve: (v) => { clearTimeout(t); resolve(v); } });
      this.send(panel.webview, { ...msg, req });
    });
  }

  /** The viewer showing uri (the active one first), or null. */
  panelFor(uri) {
    const key = uri.toString();
    if (this.active && this.active.uri.toString() === key && this.activePanel && !this.activePanel.disposed) return { doc: this.active, panel: this.activePanel };
    for (const d of this.docs) if (d.uri.toString() === key) for (const p of d.panels) if (!p.disposed) return { doc: d, panel: p };
    return null;
  }
  /** Any open viewer that has drawn its diagram (for jobs that only need the renderer). */
  anyRendered() {
    if (this.active && this.active.rendered && this.activePanel && !this.activePanel.disposed) return { doc: this.active, panel: this.activePanel };
    for (const d of this.docs) if (d.rendered) for (const p of d.panels) if (!p.disposed) return { doc: d, panel: p };
    return null;
  }

  /** Opens uri in this viewer (or shows its tab) and waits until the diagram is drawn or failed. */
  async openAndWait(uri, ms = 60000) {
    const open = this.panelFor(uri);
    if (open && open.doc.rendered) return open;
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const f = this.panelFor(uri);
      if (f && (f.doc.rendered || f.doc.failed)) return f;
      await new Promise((r) => setTimeout(r, 100));
    }
    return this.panelFor(uri);
  }
}

module.exports = { DrawioEditorProvider, VIEW_TYPE, readDiagram, forWebview };
