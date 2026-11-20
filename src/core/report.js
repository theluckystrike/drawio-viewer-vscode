'use strict';
// The two Pro tools that work on the parsed file alone (no drawing): Compare two diagrams (a Markdown report) and
// Extract labels and data (CSV or Markdown). Pure functions over the result of drawio.parseDiagramFile.
const { styleMap, shapeName } = require('./drawio');

const md = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' <br> ').replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;')).replace(/&lt;br&gt;/g, '<br>').trim();
const short = (s, n = 60) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const kindName = (c) => (c.kind === 'edge' ? 'connector' : c.kind === 'group' ? 'group' : c.kind === 'layer' ? 'layer' : 'shape');
const visibleCells = (p) => p.cells.filter((c) => c.kind !== 'root');
const nameOf = (c) => (c.text ? `"${short(c.text, 50)}"` : `${kindName(c)} ${c.id}`);

// ---------------------------------------------------------------- compare
function styleDiff(a, b) {
  const ma = styleMap(a), mb = styleMap(b);
  const out = [];
  const keys = new Set([...Object.keys(ma), ...Object.keys(mb)]);
  keys.delete('_');
  for (const k of [...keys].sort()) if ((ma[k] || '') !== (mb[k] || '')) out.push(`${k}: ${ma[k] === undefined ? '(none)' : short(ma[k], 30)} → ${mb[k] === undefined ? '(none)' : short(mb[k], 30)}`);
  const ba = ma._.join(';'), bb = mb._.join(';');
  if (ba !== bb) out.push(`base style: ${ba || '(none)'} → ${bb || '(none)'}`);
  return out;
}
const num = (v) => Math.round(Number(v || 0) * 100) / 100;

/** What changed between two versions of one cell: a list of short lines (empty = same). */
function cellChanges(a, b, lookA, lookB) {
  const ch = [];
  if (a.kind !== b.kind) ch.push(`type: ${kindName(a)} → ${kindName(b)}`);
  if (a.text !== b.text) ch.push(`label: "${short(a.text)}" → "${short(b.text)}"`);
  if (a.tooltip !== b.tooltip) ch.push(`tooltip: "${short(a.tooltip)}" → "${short(b.tooltip)}"`);
  if (a.link !== b.link) ch.push(`link: ${a.link || '(none)'} → ${b.link || '(none)'}`);
  if (a.tags !== b.tags) ch.push(`tags: ${a.tags || '(none)'} → ${b.tags || '(none)'}`);
  const dk = new Set([...Object.keys(a.data), ...Object.keys(b.data)]);
  for (const k of [...dk].sort()) if ((a.data[k] || '') !== (b.data[k] || '')) ch.push(`data ${k}: ${a.data[k] === undefined ? '(none)' : `"${short(a.data[k])}"`} → ${b.data[k] === undefined ? '(none)' : `"${short(b.data[k])}"`}`);
  if (a.style !== b.style) for (const s of styleDiff(a.style, b.style)) ch.push(`style ${s}`);
  const ga = a.geometry, gb = b.geometry;
  if (ga && gb && a.kind !== 'edge') {
    if (num(ga.x) !== num(gb.x) || num(ga.y) !== num(gb.y)) ch.push(`moved: (${num(ga.x)}, ${num(ga.y)}) → (${num(gb.x)}, ${num(gb.y)})`);
    if (num(ga.width) !== num(gb.width) || num(ga.height) !== num(gb.height)) ch.push(`resized: ${num(ga.width)} × ${num(ga.height)} → ${num(gb.width)} × ${num(gb.height)}`);
  }
  if (a.kind === 'edge' || b.kind === 'edge') {
    const end = (id, look) => { if (!id) return '(loose end)'; const c = look.get(id); return c ? nameOf(c) : id; };
    if (a.source !== b.source) ch.push(`from: ${end(a.source, lookA)} → ${end(b.source, lookB)}`);
    if (a.target !== b.target) ch.push(`to: ${end(a.target, lookA)} → ${end(b.target, lookB)}`);
    const pa = JSON.stringify((ga && ga.points) || []), pb = JSON.stringify((gb && gb.points) || []);
    if (pa !== pb) ch.push(`waypoints: ${((ga && ga.points) || []).length} → ${((gb && gb.points) || []).length}`);
  }
  if (a.parent !== b.parent) { const p = (id, look) => { const c = look.get(id); return c ? (c.kind === 'layer' ? `layer ${c.text || c.id}` : nameOf(c)) : id; }; ch.push(`parent: ${p(a.parent, lookA)} → ${p(b.parent, lookB)}`); }
  if (a.visible !== b.visible) ch.push(`visible: ${a.visible ? 'yes' : 'no'} → ${b.visible ? 'yes' : 'no'}`);
  return ch;
}

/** Pairs the pages of A and B: same page id first, then same name. A page with neither is only in A or only in B. */
function pairPages(A, B) {
  const usedB = new Set();
  const pairs = [];
  for (const pa of A.pages) {
    let pb = B.pages.find((p) => !usedB.has(p.index) && p.id === pa.id);
    if (!pb) pb = B.pages.find((p) => !usedB.has(p.index) && p.name === pa.name);
    if (pb) usedB.add(pb.index);
    pairs.push([pa, pb || null]);
  }
  for (const pb of B.pages) if (!usedB.has(pb.index)) pairs.push([null, pb]);
  return pairs;
}

function comparePages(pa, pb) {
  const ca = visibleCells(pa), cb = visibleCells(pb);
  const la = new Map(ca.map((c) => [c.id, c])), lb = new Map(cb.map((c) => [c.id, c]));
  const added = cb.filter((c) => !la.has(c.id));
  const removed = ca.filter((c) => !lb.has(c.id));
  const changed = [];
  for (const a of ca) { const b = lb.get(a.id); if (!b) continue; const ch = cellChanges(a, b, la, lb); if (ch.length) changed.push({ a, b, changes: ch }); }
  return { added, removed, changed, same: ca.length - removed.length - changed.length };
}

/** Compares two parsed files. Returns { pages: [...], totals }. */
function compareFiles(A, B) {
  const pages = pairPages(A, B).map(([pa, pb]) => {
    if (pa && pb) return { status: pa.name === pb.name ? 'both' : 'renamed', a: pa, b: pb, ...comparePages(pa, pb) };
    const shapes = (p) => visibleCells(p).filter((c) => c.kind !== 'layer');
    if (pa) return { status: 'removed', a: pa, b: null, added: [], removed: shapes(pa), changed: [], same: 0 };
    return { status: 'added', a: null, b: pb, added: shapes(pb), removed: [], changed: [], same: 0 };
  });
  const totals = { added: 0, removed: 0, changed: 0, same: 0, pagesAdded: 0, pagesRemoved: 0, labelChanges: 0 };
  for (const p of pages) {
    totals.added += p.added.length; totals.removed += p.removed.length; totals.changed += p.changed.length; totals.same += p.same;
    if (p.status === 'added') totals.pagesAdded++;
    if (p.status === 'removed') totals.pagesRemoved++;
    totals.labelChanges += p.changed.filter((x) => x.a.text !== x.b.text).length;
  }
  return { pages, totals, identical: !totals.added && !totals.removed && !totals.changed && !totals.pagesAdded && !totals.pagesRemoved };
}

function compareMarkdown(nameA, nameB, res, when) {
  const L = [];
  L.push(`# Diagram compare: ${md(nameA)} and ${md(nameB)}`, '');
  L.push(`A: \`${nameA}\`  `, `B: \`${nameB}\`  `);
  if (when) L.push(`Made: ${when}  `);
  L.push('Made with Drawio Viewer & Preview (Zovo). Shapes and connectors are matched by their ID on pages with the same ID or name.', '');
  const t = res.totals;
  L.push('## Summary', '');
  if (res.identical) L.push('The two diagrams have the same pages, shapes, connectors, labels, styles, data and positions.', '');
  L.push('| Page (A) | Page (B) | Added | Removed | Changed | Same |', '| --- | --- | ---: | ---: | ---: | ---: |');
  for (const p of res.pages) L.push(`| ${p.a ? md(p.a.name) : '(none)'} | ${p.b ? md(p.b.name) : '(none)'} | ${p.added.length} | ${p.removed.length} | ${p.changed.length} | ${p.same} |`);
  L.push(`| **All pages** | | **${t.added}** | **${t.removed}** | **${t.changed}** | **${t.same}** |`, '');
  if (t.pagesAdded || t.pagesRemoved) L.push(`Pages only in B: ${t.pagesAdded}. Pages only in A: ${t.pagesRemoved}.`, '');
  for (const p of res.pages) {
    if (!p.added.length && !p.removed.length && !p.changed.length) continue;
    const title = p.status === 'added' ? `Page only in B: ${md(p.b.name)}` : p.status === 'removed' ? `Page only in A: ${md(p.a.name)}` : p.status === 'renamed' ? `Page ${md(p.a.name)} (named ${md(p.b.name)} in B)` : `Page ${md(p.a.name)}`;
    L.push(`## ${title}`, '');
    if (p.added.length) {
      L.push(`### Added (${p.added.length})`, '', '| ID | Type | Label | Shape |', '| --- | --- | --- | --- |');
      for (const c of p.added) L.push(`| ${md(c.id)} | ${kindName(c)} | ${md(short(c.text, 80))} | ${md(shapeName(c))} |`);
      L.push('');
    }
    if (p.removed.length) {
      L.push(`### Removed (${p.removed.length})`, '', '| ID | Type | Label | Shape |', '| --- | --- | --- | --- |');
      for (const c of p.removed) L.push(`| ${md(c.id)} | ${kindName(c)} | ${md(short(c.text, 80))} | ${md(shapeName(c))} |`);
      L.push('');
    }
    if (p.changed.length) {
      L.push(`### Changed (${p.changed.length})`, '', '| ID | Type | Label (B) | What changed |', '| --- | --- | --- | --- |');
      for (const x of p.changed) L.push(`| ${md(x.b.id)} | ${kindName(x.b)} | ${md(short(x.b.text, 60))} | ${x.changes.map(md).join('<br>')} |`);
      L.push('');
    }
  }
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------- extract
const BASE_COLS = ['page', 'id', 'type', 'label', 'tooltip', 'link', 'tags', 'layer', 'parent', 'shape', 'x', 'y', 'width', 'height', 'from', 'to'];

/** One row per shape, group and connector of every page; custom data keys become extra columns. */
function extractRows(file) {
  const rows = [];
  const dataKeys = [];
  for (const p of file.pages) {
    const look = new Map(p.cells.map((c) => [c.id, c]));
    for (const c of p.cells) {
      if (c.kind === 'root' || c.kind === 'layer') continue;
      const g = c.geometry || {};
      const parent = look.get(c.parent);
      const end = (id) => { if (!id) return ''; const x = look.get(id); return x ? (x.text || x.id) : id; };
      const r = {
        page: p.name, id: c.id, type: kindName(c), label: c.text, tooltip: c.tooltip, link: c.link, tags: c.tags, layer: c.layer,
        parent: parent && parent.kind !== 'layer' && parent.kind !== 'root' ? (parent.text || parent.id) : '', shape: shapeName(c),
        x: c.kind === 'edge' ? '' : num(g.x), y: c.kind === 'edge' ? '' : num(g.y), width: c.kind === 'edge' ? '' : num(g.width), height: c.kind === 'edge' ? '' : num(g.height),
        from: c.kind === 'edge' ? end(c.source) : '', to: c.kind === 'edge' ? end(c.target) : '', data: c.data,
      };
      for (const k of Object.keys(c.data)) if (!dataKeys.includes(k)) dataKeys.push(k);
      rows.push(r);
    }
  }
  return { rows, dataKeys, columns: BASE_COLS.concat(dataKeys.map((k) => `data:${k}`)) };
}

const csvCell = (v) => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function toCsv(ex) {
  const lines = [ex.columns.map(csvCell).join(',')];
  for (const r of ex.rows) lines.push(ex.columns.map((c) => csvCell(c.startsWith('data:') ? r.data[c.slice(5)] : r[c])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
function toMarkdown(ex, name, file) {
  const L = [`# Labels and data: ${md(name)}`, '', `${ex.rows.length} shapes and connectors on ${file.pages.length} page${file.pages.length === 1 ? '' : 's'}. Made with Drawio Viewer & Preview (Zovo).`, ''];
  for (const p of file.pages) {
    const rows = ex.rows.filter((r) => r.page === p.name);
    L.push(`## ${md(p.name)} (${rows.length})`, '');
    if (!rows.length) { L.push('No shapes on this page.', ''); continue; }
    L.push('| ID | Type | Label | Layer | Shape | Tooltip | Link | Data |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rows) {
      const data = Object.entries(r.data).map(([k, v]) => `${k}: ${v}`).join('; ');
      const label = r.type === 'connector' && (r.from || r.to) ? `${r.label ? r.label + ' ' : ''}(${r.from || '?'} → ${r.to || '?'})` : r.label;
      L.push(`| ${md(r.id)} | ${r.type} | ${md(label)} | ${md(r.layer)} | ${md(r.shape)} | ${md(r.tooltip)} | ${md(r.link)} | ${md(data)} |`);
    }
    L.push('');
  }
  return L.join('\n') + '\n';
}

module.exports = { compareFiles, compareMarkdown, cellChanges, pairPages, extractRows, toCsv, toMarkdown, csvCell, BASE_COLS };
