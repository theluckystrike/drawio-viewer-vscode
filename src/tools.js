'use strict';
// The four Zovo Pro tools: Export pages to SVG and PNG, Compare two diagrams, Extract labels and data, Batch export a
// folder to SVG. Each asks pro.allowed() on every click, whatever the file, and calls pro.produced() only after its
// result exists (the files written), so Escape, Cancel or an error never uses the free try. Everything runs on this
// computer; files are read and written through VS Code's file system API. The diagram files are never written.
const vscode = require('vscode');
const path = require('path');
const D = require('./core/drawio');
const Names = require('./core/names');
const R = require('./core/report');
const { VIEW_TYPE, readDiagram } = require('./editor');

const base = (uri) => path.posix.basename(uri.path);
const stem = (uri) => base(uri).replace(/\.[^.]+$/, '');
const sibling = (uri, name) => vscode.Uri.joinPath(uri, '..', name);
const shown = (uri) => (uri.scheme === 'file' ? uri.fsPath : uri.toString());
const isDiagram = (uri) => /\.(drawio|dio)$/i.test(uri.path);
const slug = (s) => String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'page';
const pad = (n, w) => String(n).padStart(w, '0');
const GLOB = '**/*.{drawio,dio,DRAWIO,DIO,Drawio,Dio}';

const SCOPES = [
  { id: 'current', label: 'Current page', description: 'the page shown in the viewer, layers as shown' },
  { id: 'all', label: 'All pages', description: 'one file per page' },
];
const FORMATS = [
  { id: 'svg+png', label: 'SVG and PNG', formats: ['svg', 'png'], description: 'PNG at 2x size, white background' },
  { id: 'svg', label: 'SVG', formats: ['svg'], description: 'vector, images inlined' },
  { id: 'png', label: 'PNG', formats: ['png'], description: '2x size, white background' },
];
const TABLES = [
  { id: 'csv', label: 'CSV', description: 'one row per shape and connector, data fields as columns', ext: 'csv', filter: 'CSV' },
  { id: 'md', label: 'Markdown', description: 'one table per page', ext: 'md', filter: 'Markdown' },
];

function createTools({ provider, pro }) {
  /** The file a tool works on: the clicked or passed file, else the viewer in front. */
  function targetOf(uri) {
    if (uri && uri.scheme) return uri;
    try {
      const g = vscode.window.tabGroups && vscode.window.tabGroups.activeTabGroup;
      const input = g && g.activeTab && g.activeTab.input;
      if (input && input.viewType === VIEW_TYPE && input.uri) return input.uri;
    } catch (e) { /* older editor: fall back */ }
    if (provider.active) return provider.active.uri;
    return undefined;
  }
  const noFile = () => { vscode.window.showInformationMessage('Open a .drawio or .dio file in the Drawio Viewer first, or right-click one in the Explorer.'); };
  const busy = (title, fn) => vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title }, fn);
  async function load(uri) {
    const r = await readDiagram(uri, vscode.workspace.getConfiguration('drawioViewer').get('maxFileMB', 100));
    if (r.error) { vscode.window.showErrorMessage(`${base(uri)} could not be read as a diagram: ${r.error}`); return null; }
    return r.file;
  }
  function hint(uri, text) { const f = uri && provider.panelFor(uri); if (f) provider.send(f.panel.webview, { type: 'hint', text }); }
  const sameFile = (a, b) => a.toString() === b.toString();
  async function write(dest, data) { await vscode.workspace.fs.writeFile(dest, typeof data === 'string' ? Buffer.from(data, 'utf8') : data); }
  async function showDoc(uri) { try { const d = await vscode.workspace.openTextDocument(uri); await vscode.window.showTextDocument(d, { preview: true, viewColumn: vscode.ViewColumn.Beside }); } catch (e) { /* the file is written; showing it is a bonus */ } }

  // ---------- Export pages to SVG and PNG ----------
  async function exportImages(uri, extra = {}) {
    if (!(await pro.allowed('exportImages', extra))) return undefined;
    const target = targetOf(uri);
    if (!target) { noFile(); return undefined; }
    if (!isDiagram(target)) { vscode.window.showErrorMessage(`${base(target)} is not a .drawio or .dio file.`); return undefined; }
    const f = await busy(`Drawing ${base(target)}`, () => provider.openAndWait(target));
    if (!f || !f.doc.rendered) { vscode.window.showErrorMessage(`${base(target)} could not be drawn${f && f.doc.failMessage ? `: ${f.doc.failMessage}` : ''}. Nothing was exported.`); return undefined; }
    const pages = f.doc.file ? f.doc.file.pages : [];
    let scope = typeof extra.scope === 'string' ? SCOPES.find((s) => s.id === extra.scope) : null;
    if (!scope) {
      if (pages.length <= 1) scope = SCOPES[0];
      else {
        const cur = pages[f.doc.page || 0] || null;
        const items = [{ ...SCOPES[0], description: cur ? `"${cur.name}", layers as shown` : SCOPES[0].description, s: SCOPES[0] }, { ...SCOPES[1], label: `All ${pages.length} pages`, s: SCOPES[1] }];
        const pick = await vscode.window.showQuickPick(items, { ignoreFocusOut: true, title: `Export ${base(target)}`, placeHolder: 'Which pages' });
        if (!pick) return undefined;
        scope = pick.s;
      }
    }
    let fmt = typeof extra.format === 'string' ? FORMATS.find((x) => x.id === extra.format) : null;
    if (!fmt) {
      const pick = await vscode.window.showQuickPick(FORMATS.map((x) => ({ label: x.label, description: x.description, fmt: x })), { ignoreFocusOut: true, title: `Export ${base(target)}: ${scope.id === 'all' ? `all ${pages.length} pages` : 'current page'}`, placeHolder: 'File types' });
      if (!pick) return undefined;
      fmt = pick.fmt;
    }
    const first = fmt.formats[0];
    const dest = extra.dest || await vscode.window.showSaveDialog({ defaultUri: sibling(target, `${stem(target)}.${first}`), filters: { [first.toUpperCase()]: [first] }, title: scope.id === 'all' ? 'Save the export (each page gets its number and name added)' : `Save the page as ${fmt.label}`, saveLabel: 'Export' });
    if (!dest) return undefined;
    const r = await busy(`Exporting ${base(target)}`, () => provider.request(f.panel, { type: 'export', scope: scope.id, formats: fmt.formats, scale: 2 }));
    if (!r || !r.ok || !Array.isArray(r.items) || !r.items.length) { vscode.window.showErrorMessage(`Export failed: ${(r && r.error) || 'no page was drawn'}. Nothing was written.`); return undefined; }
    const dir = vscode.Uri.joinPath(dest, '..');
    const name = base(dest).replace(/\.(svg|png)$/i, '');
    const many = r.items.length > 1;
    const w = String(r.items.length).length;
    const files = [];
    try {
      for (const it of r.items) {
        const nm = many ? `${name}-${pad(it.page + 1, Math.max(2, w))}-${slug(it.name)}` : name;
        if (it.svg) { const u = vscode.Uri.joinPath(dir, `${nm}.svg`); await write(u, it.svg); files.push(u); }
        if (it.png) { const u = vscode.Uri.joinPath(dir, `${nm}.png`); await write(u, Buffer.from(it.png, 'base64')); files.push(u); }
      }
    } catch (e) { vscode.window.showErrorMessage(`Writing the export failed: ${(e && e.message) || e}`); return undefined; }
    await pro.produced('exportImages');
    hint(target, `Exported ${r.items.length} page${many ? 's' : ''} to ${files.length} file${files.length === 1 ? '' : 's'} in ${shown(dir)}.`);
    return { files, pages: r.items.length, scope: scope.id, formats: fmt.formats };
  }

  // ---------- Compare two diagrams ----------
  async function pickOther(target) {
    let files = [];
    try { files = (await vscode.workspace.findFiles(GLOB, '**/node_modules/**', 500)).filter((u) => !sameFile(u, target)); } catch (e) { files = []; }
    const items = files.map((u) => ({ label: base(u), description: vscode.workspace.asRelativePath(u, false), uri: u }));
    items.push({ label: 'Browse...', description: 'pick a .drawio or .dio file anywhere', browse: true });
    const pick = await vscode.window.showQuickPick(items, { ignoreFocusOut: true, title: `Compare ${base(target)} with`, placeHolder: 'The other version (B). The report lists what B adds, removes and changes.', matchOnDescription: true });
    if (!pick) return undefined;
    if (!pick.browse) return pick.uri;
    const got = await vscode.window.showOpenDialog({ canSelectMany: false, defaultUri: vscode.Uri.joinPath(target, '..'), filters: { Diagrams: ['drawio', 'dio'] }, title: 'The other version (B)', openLabel: 'Compare' });
    return got && got[0];
  }
  async function compare(uri, extra = {}) {
    if (!(await pro.allowed('compare', extra))) return undefined;
    const target = targetOf(uri);
    if (!target) { noFile(); return undefined; }
    const other = extra.other || await pickOther(target);
    if (!other) return undefined;
    if (!isDiagram(other)) { vscode.window.showErrorMessage(`${base(other)} is not a .drawio or .dio file.`); return undefined; }
    const a = await busy(`Reading ${base(target)}`, () => load(target));
    if (!a) return undefined;
    const b = await busy(`Reading ${base(other)}`, () => load(other));
    if (!b) return undefined;
    const res = R.compareFiles(a, b);
    const text = R.compareMarkdown(base(target), base(other), res, new Date().toISOString().slice(0, 16).replace('T', ' '));
    const dest = extra.dest || await vscode.window.showSaveDialog({ defaultUri: sibling(target, `${stem(target)}-vs-${stem(other)}.compare.md`), filters: { Markdown: ['md'] }, title: 'Save the compare report', saveLabel: 'Save' });
    if (!dest) return undefined;
    if (sameFile(dest, target) || sameFile(dest, other)) { vscode.window.showErrorMessage('Choose another file name: the diagrams are never overwritten.'); return undefined; }
    try { await write(dest, text); } catch (e) { vscode.window.showErrorMessage(`Saving the report failed: ${(e && e.message) || e}`); return undefined; }
    await pro.produced('compare');
    const t = res.totals;
    hint(target, `Compared with ${base(other)}: ${t.added} added, ${t.removed} removed, ${t.changed} changed. Report saved: ${shown(dest)}.`);
    if (extra.show !== false) await showDoc(dest);
    return { dest, totals: t, identical: res.identical, other };
  }

  // ---------- Extract labels and data ----------
  async function extract(uri, extra = {}) {
    if (!(await pro.allowed('extract', extra))) return undefined;
    const target = targetOf(uri);
    if (!target) { noFile(); return undefined; }
    if (!isDiagram(target)) { vscode.window.showErrorMessage(`${base(target)} is not a .drawio or .dio file.`); return undefined; }
    const file = await busy(`Reading ${base(target)}`, () => load(target));
    if (!file) return undefined;
    const ex = R.extractRows(file);
    let fmt = typeof extra.format === 'string' ? TABLES.find((x) => x.id === extra.format) : null;
    if (!fmt) {
      const pick = await vscode.window.showQuickPick(TABLES.map((x) => ({ label: x.label, description: x.description, fmt: x })), { ignoreFocusOut: true, title: `Extract ${ex.rows.length} shapes and connectors from ${base(target)}`, placeHolder: 'Save as' });
      if (!pick) return undefined;
      fmt = pick.fmt;
    }
    const dest = extra.dest || await vscode.window.showSaveDialog({ defaultUri: sibling(target, `${stem(target)}.labels.${fmt.ext}`), filters: { [fmt.filter]: [fmt.ext] }, title: `Save the labels and data as ${fmt.label}`, saveLabel: 'Save' });
    if (!dest) return undefined;
    if (sameFile(dest, target)) { vscode.window.showErrorMessage('Choose another file name: the diagram is never overwritten.'); return undefined; }
    const text = fmt.id === 'csv' ? R.toCsv(ex) : R.toMarkdown(ex, base(target), file);
    try { await write(dest, text); } catch (e) { vscode.window.showErrorMessage(`Saving the table failed: ${(e && e.message) || e}`); return undefined; }
    await pro.produced('extract');
    hint(target, `Saved ${shown(dest)}: ${ex.rows.length} rows${ex.dataKeys.length ? `, data fields ${ex.dataKeys.join(', ')}` : ''}.`);
    if (extra.show !== false) await showDoc(dest);
    return { dest, rows: ex.rows.length, columns: ex.columns, format: fmt.id };
  }

  // ---------- Batch export a folder to SVG ----------
  async function listDiagrams(folder) {
    const out = [];
    const walk = async (dir, depth) => {
      let entries = [];
      try { entries = await vscode.workspace.fs.readDirectory(dir); } catch (e) { return; }
      for (const [name, type] of entries.sort((x, y) => x[0].localeCompare(y[0]))) {
        if (type === vscode.FileType.Directory || type === 2) { if (depth < 8 && !/^(node_modules|\.git|svg-export)$/.test(name)) await walk(vscode.Uri.joinPath(dir, name), depth + 1); } else if (/\.(drawio|dio)$/i.test(name)) out.push(vscode.Uri.joinPath(dir, name));
        if (out.length >= 2000) return;
      }
    };
    await walk(folder, 0);
    return out;
  }
  async function pickFolder() {
    let files = [];
    try { files = await vscode.workspace.findFiles(GLOB, '**/node_modules/**', 2000); } catch (e) { files = []; }
    const dirs = new Map();
    for (const u of files) { const d = vscode.Uri.joinPath(u, '..'); const k = d.toString(); dirs.set(k, { uri: d, n: (dirs.get(k) || { n: 0 }).n + 1 }); }
    const items = [...dirs.values()].map((d) => ({ label: vscode.workspace.asRelativePath(d.uri, false) || base(d.uri), description: `${d.n} diagram${d.n === 1 ? '' : 's'}`, uri: d.uri }));
    if (vscode.workspace.workspaceFolders) for (const w of vscode.workspace.workspaceFolders) items.unshift({ label: w.name, description: 'the whole workspace folder and its subfolders', uri: w.uri });
    items.push({ label: 'Browse...', description: 'pick a folder anywhere', browse: true });
    const pick = await vscode.window.showQuickPick(items, { ignoreFocusOut: true, title: 'Batch export to SVG: which folder', placeHolder: 'Every .drawio and .dio file in it and its subfolders' });
    if (!pick) return undefined;
    if (!pick.browse) return pick.uri;
    const got = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFiles: false, canSelectFolders: true, title: 'Folder with diagrams', openLabel: 'Export' });
    return got && got[0];
  }
  async function batchExport(uri, extra = {}) {
    if (!(await pro.allowed('batchExport', extra))) return undefined;
    let folder = uri && uri.scheme ? uri : null;
    if (folder) { try { const st = await vscode.workspace.fs.stat(folder); if (!(st.type & 2)) folder = vscode.Uri.joinPath(folder, '..'); } catch (e) { folder = null; } }
    if (!folder) folder = await pickFolder();
    if (!folder) return undefined;
    const files = await busy(`Looking for diagrams in ${base(folder)}`, () => listDiagrams(folder));
    if (!files.length) { vscode.window.showErrorMessage(`No .drawio or .dio file in ${shown(folder)} or its subfolders. Nothing was exported.`); return undefined; }
    let out = extra.out || null;
    if (!out) {
      const def = vscode.Uri.joinPath(folder, 'svg-export');
      const pick = await vscode.window.showQuickPick([
        { label: `Export ${files.length} diagram${files.length === 1 ? '' : 's'} to svg-export`, description: shown(def), out: def },
        { label: 'Choose another output folder...', browse: true },
      ], { ignoreFocusOut: true, title: `Batch export ${files.length} diagram${files.length === 1 ? '' : 's'} from ${base(folder)} to SVG`, placeHolder: 'Output folder (subfolders are kept)' });
      if (!pick) return undefined;
      if (pick.browse) { const got = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFiles: false, canSelectFolders: true, defaultUri: folder, title: 'Output folder for the SVG files', openLabel: 'Export here' }); if (!got || !got[0]) return undefined; out = got[0]; } else out = pick.out;
    }
    // the renderer: any open viewer, else the first diagram of the folder opened in the viewer
    let f = provider.anyRendered();
    if (!f) {
      for (const u of files.slice(0, 5)) { const g = await busy(`Opening ${base(u)}`, () => provider.openAndWait(u)); if (g && g.doc.rendered) { f = g; break; } }
    }
    if (!f) { vscode.window.showErrorMessage('The diagram renderer could not start: no diagram in the folder could be drawn. Nothing was exported.'); return undefined; }
    const written = [], failed = [], map = [];
    const rootPath = folder.path.replace(/\/$/, '');
    const rels = files.map((u) => u.path.slice(rootPath.length + 1));
    const stems = Names.sourceStems(rels);
    const names = new Names.NameAlloc();
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Batch export to SVG' }, async (progress, token) => {
      for (let i = 0; i < files.length; i++) {
        if (token && token.isCancellationRequested) break;
        const u = files[i];
        const rel = rels[i];
        progress.report({ message: `${i + 1} of ${files.length}: ${rel}`, increment: 100 / files.length });
        const r = await readDiagram(u, vscode.workspace.getConfiguration('drawioViewer').get('maxFileMB', 100));
        if (r.error) { failed.push({ file: rel, error: r.error }); continue; }
        const res = await provider.request(f.panel, { type: 'export', pages: r.file.pages.map((p) => ({ id: p.id, name: p.name, xml: p.xml })), formats: ['svg'] }, 120000);
        if (!res || !res.ok) { failed.push({ file: rel, error: (res && res.error) || 'not drawn' }); continue; }
        const relDir = path.posix.dirname(rel);
        const nm = stems[i];
        const many = res.items.length > 1;
        for (const it of res.items) {
          const file = names.take(relDir, many ? `${nm}-${pad(it.page + 1, 2)}-${slug(it.name)}.svg` : `${nm}.svg`);
          const dest = relDir === '.' ? vscode.Uri.joinPath(out, file) : vscode.Uri.joinPath(out, ...relDir.split('/'), file);
          try { await write(dest, it.svg); written.push(dest); map.push({ source: rel, page: it.page, file: relDir === '.' ? file : `${relDir}/${file}` }); } catch (e) { failed.push({ file: rel, error: (e && e.message) || String(e) }); }
        }
      }
    });
    if (!written.length) { vscode.window.showErrorMessage(`Batch export wrote no file${failed.length ? `: ${failed[0].file}: ${failed[0].error}` : ''}.`); return undefined; }
    if (failed.length) {
      const log = [`# Batch export: files not exported (${failed.length})`, '', ...failed.map((x) => `- ${x.file}: ${x.error}`), ''].join('\n');
      try { await write(vscode.Uri.joinPath(out, 'export-errors.md'), log); } catch (e) { /* the summary below names the count */ }
    }
    await pro.produced('batchExport');
    const msg = `Batch export: ${written.length} SVG file${written.length === 1 ? '' : 's'} from ${files.length - new Set(failed.map((x) => x.file)).size} of ${files.length} diagrams in ${shown(out)}${failed.length ? `; ${failed.length} not exported (see export-errors.md)` : ''}.`;
    hint(f.doc.uri, msg);
    return { out, written, failed, files: files.length, map };
  }

  return { exportImages, compare, extract, batchExport, SCOPES, FORMATS, TABLES, listDiagrams };
}

module.exports = { createTools, SCOPES, FORMATS, TABLES, slug };
