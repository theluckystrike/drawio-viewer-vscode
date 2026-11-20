'use strict';
// Reads .drawio and .dio files on the extension host: the mxfile wrapper with one <diagram> per page, each page plain
// (<mxGraphModel> inside) or compressed (base64 of raw deflate of the URI-encoded XML), or a bare <mxGraphModel>.
// Returns every page as plain mxGraphModel XML plus a flat list of its cells (id, kind, label text, tooltip, link,
// custom data, style, geometry, layer). A small XML reader of our own, no DOM. No network, no file access here.
const zlib = require('zlib');

class DiagramError extends Error {
  constructor(message, code) { super(message); this.code = code || 'invalid'; }
}

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m; } catch (err) { return m; }
    }
    return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
  });
}
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '&#xa;').replace(/\r/g, '&#xd;').replace(/\t/g, '&#x9;');
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Parses XML text into { name, attrs, children, text } nodes. Throws DiagramError on broken markup. */
function parseXml(src) {
  const s = String(src);
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = s.length;
  const fail = (msg) => { const line = s.slice(0, i).split('\n').length; throw new DiagramError(`${msg} (line ${line})`, 'xml'); };
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { stack[stack.length - 1].text += decodeEntities(s.slice(i)); break; }
    if (lt > i) stack[stack.length - 1].text += decodeEntities(s.slice(i, lt));
    i = lt;
    if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i + 4); if (e < 0) fail('A comment is not closed'); i = e + 3; continue; }
    if (s.startsWith('<![CDATA[', i)) { const e = s.indexOf(']]>', i + 9); if (e < 0) fail('A CDATA section is not closed'); stack[stack.length - 1].text += s.slice(i + 9, e); i = e + 3; continue; }
    if (s.startsWith('<?', i)) { const e = s.indexOf('?>', i + 2); if (e < 0) fail('A processing instruction is not closed'); i = e + 2; continue; }
    if (s.startsWith('<!', i)) { const e = s.indexOf('>', i + 2); if (e < 0) fail('A declaration is not closed'); i = e + 1; continue; }
    if (s[i + 1] === '/') {
      const e = s.indexOf('>', i + 2);
      if (e < 0) fail('A closing tag is not finished');
      const name = s.slice(i + 2, e).trim();
      const top = stack[stack.length - 1];
      if (stack.length < 2 || top.name !== name) fail(`Unexpected </${name}>${stack.length > 1 ? `, expected </${top.name}>` : ''}`);
      stack.pop();
      i = e + 1;
      continue;
    }
    // start tag
    let j = i + 1;
    while (j < n && !/[\s/>]/.test(s[j])) j++;
    const name = s.slice(i + 1, j);
    if (!name || !/^[A-Za-z_:][\w:.-]*$/.test(name)) fail('A tag has no valid name');
    const node = { name, attrs: {}, children: [], text: '' };
    for (;;) {
      while (j < n && /\s/.test(s[j])) j++;
      if (j >= n) fail(`The tag <${name}> is not finished`);
      if (s[j] === '>') { j++; stack[stack.length - 1].children.push(node); stack.push(node); break; }
      if (s[j] === '/' && s[j + 1] === '>') { j += 2; stack[stack.length - 1].children.push(node); break; }
      let k = j;
      while (k < n && !/[\s=/>]/.test(s[k])) k++;
      const an = s.slice(j, k);
      if (!an) fail(`The tag <${name}> has a broken attribute`);
      while (k < n && /\s/.test(s[k])) k++;
      if (s[k] !== '=') fail(`The attribute ${an} of <${name}> has no value`);
      k++;
      while (k < n && /\s/.test(s[k])) k++;
      const q = s[k];
      if (q !== '"' && q !== "'") fail(`The attribute ${an} of <${name}> is not quoted`);
      const e = s.indexOf(q, k + 1);
      if (e < 0) fail(`The attribute ${an} of <${name}> is not closed`);
      node.attrs[an] = decodeEntities(s.slice(k + 1, e));
      j = e + 1;
    }
    i = j;
  }
  if (stack.length > 1) throw new DiagramError(`The file ends before </${stack[stack.length - 1].name}>`, 'xml');
  return root;
}

/** Writes a node tree back to XML text. */
function toXml(node) {
  if (node.name === '#document') return node.children.map(toXml).join('');
  const a = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  const inner = node.children.map(toXml).join('') + (node.text && node.text.trim() ? escText(node.text) : '');
  return inner ? `<${node.name}${a}>${inner}</${node.name}>` : `<${node.name}${a}/>`;
}

const child = (node, name) => node.children.find((c) => c.name === name);

/** A compressed page: base64 -> raw inflate -> URI-decoded XML text. */
function inflatePage(text) {
  const t = String(text).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=_-]+$/.test(t)) throw new DiagramError('A compressed page is not valid base64', 'compressed');
  let raw;
  try { raw = zlib.inflateRawSync(Buffer.from(t, 'base64')).toString('latin1'); } catch (e) {
    throw new DiagramError('A compressed page could not be inflated (the data is damaged)', 'compressed');
  }
  try { return decodeURIComponent(raw); } catch (e) { return Buffer.from(raw, 'latin1').toString('utf8'); }
}
/** The inverse of inflatePage (for tests and fixtures). */
function deflatePage(xml) {
  return zlib.deflateRawSync(Buffer.from(encodeURIComponent(xml), 'latin1')).toString('base64');
}

/** Plain text of an HTML label: tags out, <br> and blocks to new lines, entities decoded, spaces tidied. */
function labelText(value, html) {
  let s = String(value == null ? '' : value);
  if (html || /<[a-zA-Z/][^>]*>/.test(s)) {
    s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li|tr|h[1-6])>/gi, '\n').replace(/<[^>]*>/g, '');
    s = decodeEntities(s);
  }
  return s.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
}

/** "a=1;b=2;rounded" -> { _: ['rounded'], a: '1', b: '2' } (bare names in _; the first one is the base style). */
function styleMap(style) {
  const m = { _: [] };
  for (const part of String(style || '').split(';')) {
    const p = part.trim();
    if (!p) continue;
    const eq = p.indexOf('=');
    if (eq < 0) m._.push(p); else m[p.slice(0, eq).trim()] = p.slice(eq + 1);
  }
  return m;
}
/** A short shape name for tables: the shape= value, else the first bare style name, else rectangle/edge/text. */
function shapeName(cell) {
  const m = styleMap(cell.style);
  if (m.shape) return m.shape;
  if (cell.kind === 'edge') return m.edgeStyle ? `edge (${m.edgeStyle})` : 'edge';
  const base = m._.find((x) => !/^(html|whiteSpace|rounded|dashed|shadow|glass|labelBackgroundColor)$/.test(x));
  if (base) return base;
  if (m.text !== undefined || /(^|;)text(;|$)/.test(cell.style || '')) return 'text';
  if (m.rounded === '1') return 'rounded rectangle';
  return 'rectangle';
}

const SKIP_DATA = new Set(['id', 'label', 'tooltip', 'link', 'placeholders', 'tags', 'linkTarget']);

function readCells(model) {
  const root = child(model, 'root');
  if (!root) return [];
  const out = [];
  for (const el of root.children) {
    let cellEl = el;
    let wrap = null;
    if (el.name === 'UserObject' || el.name === 'object') { wrap = el; cellEl = child(el, 'mxCell') || { name: 'mxCell', attrs: {}, children: [] }; } else if (el.name !== 'mxCell') continue;
    const a = cellEl.attrs;
    const id = (wrap ? wrap.attrs.id : a.id) || '';
    const style = a.style || '';
    const sm = styleMap(style);
    const value = wrap ? (wrap.attrs.label || '') : (a.value || '');
    const data = {};
    if (wrap) for (const [k, v] of Object.entries(wrap.attrs)) if (!SKIP_DATA.has(k)) data[k] = v;
    const geoEl = child(cellEl, 'mxGeometry');
    let geometry = null;
    if (geoEl) {
      const g = geoEl.attrs;
      const num = (v) => (v === undefined || v === '' ? 0 : Number(v));
      geometry = { x: num(g.x), y: num(g.y), width: num(g.width), height: num(g.height), relative: g.relative === '1' };
      const pts = (geoEl.children.find((c) => c.name === 'Array' && c.attrs.as === 'points') || { children: [] }).children.filter((c) => c.name === 'mxPoint');
      if (pts.length) geometry.points = pts.map((p) => ({ x: num(p.attrs.x), y: num(p.attrs.y) }));
    }
    const kind = a.edge === '1' ? 'edge' : a.vertex === '1' ? 'vertex' : (a.parent === undefined ? 'root' : 'layer?');
    out.push({
      id, parent: a.parent || '', kind, value, text: labelText(value, sm.html === '1'), style,
      tooltip: wrap ? (wrap.attrs.tooltip || '') : (a.tooltip || ''), link: wrap ? (wrap.attrs.link || '') : '',
      tags: wrap ? (wrap.attrs.tags || '') : '', data, source: a.source || '', target: a.target || '', geometry,
      visible: a.visible !== '0',
    });
  }
  // layers are the children of the root cell; a "layer?" cell deeper down is a group container (a plain cell)
  const rootIds = new Set(out.filter((c) => c.kind === 'root').map((c) => c.id));
  const byId = new Map(out.map((c) => [c.id, c]));
  for (const c of out) if (c.kind === 'layer?') c.kind = rootIds.has(c.parent) ? 'layer' : 'group';
  const layerOf = (c) => { let x = c; const seen = new Set(); while (x && !seen.has(x.id)) { seen.add(x.id); if (x.kind === 'layer') return x; x = byId.get(x.parent); } return null; };
  const names = new Map(out.filter((c) => c.kind === 'layer').map((c, k) => [c.id, c.text || (k === 0 ? 'Background' : `Layer ${k + 1}`)]));
  for (const c of out) {
    const l = c.kind === 'layer' || c.kind === 'root' ? null : layerOf(c);
    c.layer = l ? names.get(l.id) : '';
    c.layerId = l ? l.id : '';
  }
  return out;
}

function pageFromModel(modelNode, meta, index) {
  const cells = readCells(modelNode);
  const layers = cells.filter((c) => c.kind === 'layer').map((c, k) => ({ id: c.id, name: c.text || (k === 0 ? 'Background' : `Layer ${k + 1}`), visible: c.visible }));
  return {
    index, id: meta.id || `page-${index + 1}`, name: meta.name || `Page-${index + 1}`, compressed: !!meta.compressed,
    xml: toXml(modelNode), model: modelNode.attrs, cells, layers,
  };
}

/**
 * Parses the text of a .drawio or .dio file. Returns { pages, compressed, attrs, warnings }.
 * Throws DiagramError with a plain message for anything that is not a diagram.
 */
function parseDiagramFile(text) {
  let s = String(text == null ? '' : text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  if (!s.trim()) throw new DiagramError('The file is empty.', 'empty');
  if (!/^\s*</.test(s)) throw new DiagramError('The file is not XML: a .drawio or .dio file starts with <mxfile> or <mxGraphModel>.', 'notxml');
  const doc = parseXml(s);
  const top = doc.children.find((c) => c.name);
  if (!top) throw new DiagramError('The file has no XML element.', 'notxml');
  const warnings = [];
  const pages = [];
  let compressed = false;
  if (top.name === 'mxGraphModel') {
    pages.push(pageFromModel(top, { name: 'Page-1' }, 0));
  } else if (top.name === 'mxfile') {
    const diagrams = top.children.filter((c) => c.name === 'diagram');
    if (!diagrams.length) throw new DiagramError('The <mxfile> has no <diagram> page.', 'nopages');
    diagrams.forEach((d, k) => {
      const meta = { id: d.attrs.id, name: d.attrs.name };
      let model = child(d, 'mxGraphModel');
      if (!model) {
        const t = (d.text || '').trim();
        if (!t) { model = { name: 'mxGraphModel', attrs: {}, children: [{ name: 'root', attrs: {}, children: [], text: '' }], text: '' }; warnings.push(`Page ${k + 1} is empty.`); } else {
          meta.compressed = true;
          compressed = true;
          const xml = inflatePage(t);
          const inner = parseXml(xml).children.find((c) => c.name === 'mxGraphModel');
          if (!inner) throw new DiagramError(`Page ${k + 1} (${meta.name || 'no name'}) does not hold an <mxGraphModel>.`, 'nomodel');
          model = inner;
        }
      }
      pages.push(pageFromModel(model, meta, k));
    });
  } else {
    throw new DiagramError(`The file starts with <${top.name}>, not <mxfile> or <mxGraphModel>, so it is not a .drawio diagram.`, 'notdiagram');
  }
  return { pages, compressed, attrs: top.name === 'mxfile' ? top.attrs : {}, warnings };
}

/** Text search over every page: case-insensitive match in label, tooltip, link and custom data. */
function findText(file, query, max = 500) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  for (const p of file.pages) {
    for (const c of p.cells) {
      if (c.kind === 'root' || c.kind === 'layer') continue;
      const fields = [['label', c.text], ['tooltip', c.tooltip], ['link', c.link], ...Object.entries(c.data).map(([k, v]) => [k, v])];
      const f = fields.find(([, v]) => v && String(v).toLowerCase().includes(q));
      if (f) { hits.push({ page: p.index, pageName: p.name, id: c.id, field: f[0], text: String(f[1]).slice(0, 160), label: c.text.slice(0, 80) }); if (hits.length >= max) return hits; }
    }
  }
  return hits;
}

/** Counts for the status line. */
function summary(file) {
  let shapes = 0, edges = 0;
  for (const p of file.pages) for (const c of p.cells) { if (c.kind === 'vertex' || c.kind === 'group') shapes++; else if (c.kind === 'edge') edges++; }
  return { pages: file.pages.length, shapes, edges, compressed: file.compressed };
}

module.exports = { parseDiagramFile, parseXml, toXml, inflatePage, deflatePage, labelText, styleMap, shapeName, findText, summary, decodeEntities, DiagramError };
