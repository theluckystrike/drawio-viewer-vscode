// Drawio Viewer & Preview by Zovo: the read-only diagram view in the webview. The extension host reads the file,
// unpacks every page (plain or compressed) and sends the page XML plus a list of shapes. The vendored diagram library
// (lib/drawio/viewer-static.min.js, global GraphViewer) draws each page. No network: media/config.js and media/guard.js
// stop every load the library could try, and the page CSP has default-src 'none' and no connect-src.
(function () {
  'use strict';
  const vscode = window.acquireVsCodeApi();
  const Z = window.ZvSanitize;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const base = document.body.getAttribute('data-base') || '.';

  const S = {
    name: '', pages: [], current: 0, viewer: null, settings: {}, theme: 'auto', hidden: {}, selected: null, hits: [], hit: -1,
    remote: 0, math: false, rendered: false, layersOpen: false, file: null, highlight: null,
  };

  // ---------------------------------------------------------------- page
  const app = $('app');
  app.textContent = '';
  const toolbar = el('div', 'toolbar'); toolbar.id = 'toolbar';
  const nameEl = el('span', 'fname'); nameEl.id = 'fname';
  const tabs = el('div', 'tabs'); tabs.id = 'pageTabs'; tabs.setAttribute('role', 'tablist');
  const btn = (id, text, title) => { const b = el('button', '', text); b.id = id; b.title = title; b.type = 'button'; return b; };
  const bOut = btn('zoomOut', '−', 'Zoom out (-)');
  const zoomVal = el('span', 'num'); zoomVal.id = 'zoomVal';
  const bIn = btn('zoomIn', '+', 'Zoom in (+)');
  const bFit = btn('fit', 'Fit', 'Fit the page to the window (F)');
  const b100 = btn('actual', '100%', 'Actual size (0)');
  const bLayers = btn('layersBtn', 'Layers', 'Show or hide layers');
  const themeSel = el('select'); themeSel.id = 'canvasTheme'; themeSel.title = 'Canvas: follow the editor theme, light or dark';
  for (const [v, t] of [['auto', 'Canvas: theme'], ['light', 'Canvas: light'], ['dark', 'Canvas: dark']]) { const o = el('option', '', t); o.value = v; themeSel.append(o); }
  const findIn = el('input'); findIn.id = 'find'; findIn.type = 'search'; findIn.placeholder = 'Find text in all pages'; findIn.title = 'Find text in labels, tooltips, links and data on every page (Ctrl+F or Cmd+F)';
  const findCount = el('span', 'num'); findCount.id = 'findCount';
  const bPrev = btn('findPrev', '↑', 'Previous match (Shift+Enter)');
  const bNext = btn('findNext', '↓', 'Next match (Enter)');
  const grow = el('span', 'grow');
  toolbar.append(nameEl, el('span', 'sep'), bOut, zoomVal, bIn, bFit, b100, el('span', 'sep'), bLayers, themeSel, el('span', 'sep'), findIn, findCount, bPrev, bNext, grow);
  const tabRow = el('div', 'tabrow'); tabRow.append(tabs);
  const main = el('div', 'main');
  const stage = el('div', 'stage'); stage.id = 'stage';
  const canvas = el('div', 'canvas'); canvas.id = 'canvas'; canvas.tabIndex = 0;
  const layersPop = el('div', 'layers'); layersPop.id = 'layers'; layersPop.hidden = true;
  const notice = el('div', 'notice'); notice.id = 'notice'; notice.hidden = true;
  stage.append(canvas, layersPop, notice);
  const side = el('div', 'side'); side.id = 'side';
  const info = el('div', 'info'); info.id = 'info';
  const results = el('div', 'results'); results.id = 'results';
  side.append(info, results);
  main.append(stage, side);
  const status = el('div', 'status');
  const statusText = el('span', 'st'); statusText.id = 'status';
  const hintEl = el('span', 'hint'); hintEl.id = 'hint';
  status.append(statusText, hintEl, el('span', 'grow'));
  const supportLine = document.getElementById('zovo-support');
  if (supportLine) { supportLine.classList.remove('zovo-support-fixed'); status.append(supportLine); }
  app.append(toolbar, tabRow, main, status);
  const offscreen = el('div', 'offscreen'); offscreen.id = 'offscreen'; document.body.append(offscreen);

  function showNotice(text, kind) { notice.textContent = text; notice.className = 'notice ' + (kind || 'info'); notice.hidden = false; }
  function hint(text) { hintEl.textContent = text || ''; }
  function infoEmpty() {
    info.textContent = '';
    info.append(el('div', 'ih', 'Shape details'), el('p', 'muted', 'Click a shape to see its label, tooltip, link and data. Links are shown as text and are never opened.'));
  }

  // ---------------------------------------------------------------- links never open
  // VS Code opens a clicked <a href> of a webview in the browser; a diagram link must stay text, so every click on a
  // link inside the canvas stops here, before VS Code or the diagram library sees it.
  const stopLinks = (ev) => {
    const path = ev.composedPath ? ev.composedPath() : [];
    if (!path.includes(canvas) && !path.includes(offscreen)) return; // toolbar, footer and Pro row links work as usual
    for (const n of path) {
      if (n === canvas || n === offscreen) break;
      if (n && n.tagName && String(n.tagName).toLowerCase() === 'a') { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
    }
  };
  for (const t of ['click', 'auxclick', 'dblclick']) window.addEventListener(t, stopLinks, true);

  // ---------------------------------------------------------------- diagram
  function themeIsDark() {
    if (S.theme === 'dark') return true;
    if (S.theme === 'light') return false;
    const c = document.body.classList;
    return c.contains('vscode-dark') || (c.contains('vscode-high-contrast') && !c.contains('vscode-high-contrast-light'));
  }
  function applyTheme() {
    const dark = themeIsDark();
    canvas.classList.toggle('dark', dark);
    canvas.classList.toggle('light', !dark);
    if (S.viewer) { S.viewer.darkMode = dark ? 'dark' : 'light'; try { S.viewer.darkModeChanged(); } catch (e) { /* older library */ } }
  }

  /** Builds an <mxfile> DOM with every page cleaned for offline drawing. */
  function buildFile(pages) {
    const doc = mxUtils.createXmlDocument();
    const file = doc.createElement('mxfile');
    doc.appendChild(file);
    let remote = 0, math = false;
    pages.forEach((p, i) => {
      const d = doc.createElement('diagram');
      d.setAttribute('id', p.id || 'page-' + (i + 1));
      d.setAttribute('name', p.name || 'Page-' + (i + 1));
      const m = mxUtils.parseXml(p.xml).documentElement;
      const r = Z.cleanModel(m);
      remote += r.remote; math = math || r.math;
      d.appendChild(doc.importNode(m, true));
      file.appendChild(d);
    });
    return { node: file, remote, math };
  }

  function makeViewer(container, fileNode, page, dark) {
    // our own click handling only: links are never followed, no lightbox
    GraphViewer.prototype.addClickHandler = function () {};
    // the container keeps its own size (100 % of the canvas area) and scrolls; the library must not resize it
    container.style.width = '100%';
    container.style.height = '100%';
    const v = new GraphViewer(container, fileNode, {
      toolbar: null, nav: false, lightbox: false, 'check-visible-state': false, 'auto-fit': false, 'auto-crop': false,
      resize: false, center: false, border: 24, page: page || 0, 'dark-mode': dark ? 'dark' : 'light', highlight: '#3794ff',
      'browser-translate': false,
    });
    return v;
  }

  function layerCells() {
    const g = S.viewer && S.viewer.graph;
    if (!g) return [];
    const m = g.getModel();
    return m.getChildren(m.getRoot()) || [];
  }
  function layerName(cell, k) {
    let n = '';
    try { n = S.viewer.graph.convertValueToString(cell) || ''; } catch (e) { n = ''; }
    n = String(n).replace(/<[^>]*>/g, '').trim();
    return n || (k === 0 ? 'Background' : 'Layer ' + (k + 1));
  }
  function applyLayerState() {
    const g = S.viewer.graph;
    const hid = S.hidden[S.current];
    if (!hid) return;
    g.getModel().beginUpdate();
    try { for (const c of layerCells()) if (Object.prototype.hasOwnProperty.call(hid, c.id)) g.getModel().setVisible(c, !hid[c.id]); } finally { g.getModel().endUpdate(); }
  }
  function renderLayers() {
    layersPop.textContent = '';
    const cells = layerCells();
    layersPop.append(el('div', 'ih', `Layers on ${S.pages[S.current] ? S.pages[S.current].name : 'this page'}`));
    cells.forEach((c, k) => {
      const row = el('label', 'layer');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = S.viewer.graph.getModel().isVisible(c); cb.dataset.layer = c.id;
      cb.addEventListener('change', () => {
        (S.hidden[S.current] = S.hidden[S.current] || {})[c.id] = !cb.checked;
        S.viewer.graph.getModel().setVisible(c, cb.checked);
        updateStatus();
      });
      row.append(cb, el('span', '', layerName(c, k)));
      layersPop.append(row);
    });
    bLayers.textContent = `Layers (${cells.length})`;
  }

  function renderTabs() {
    tabs.textContent = '';
    S.pages.forEach((p, i) => {
      const t = el('button', 'tab', p.name || 'Page-' + (i + 1));
      t.type = 'button'; t.dataset.page = String(i); t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', i === S.current ? 'true' : 'false');
      t.addEventListener('click', () => selectPage(i));
      tabs.append(t);
    });
    tabRow.hidden = false;
  }

  function zoomText() { zoomVal.textContent = S.viewer ? Math.round(S.viewer.graph.view.scale * 100) + '%' : ''; }

  function fit() {
    const g = S.viewer && S.viewer.graph;
    if (!g) return;
    const b = g.getGraphBounds();
    const s = g.view.scale;
    if (!b || b.width <= 0 || b.height <= 0) { zoomText(); return; }
    const w = canvas.clientWidth - 48, h = canvas.clientHeight - 48;
    const ns = Math.max(0.05, Math.min(4, Math.min(w / (b.width / s), h / (b.height / s))));
    zoomTo(ns);
    const b2 = g.getGraphBounds();
    canvas.scrollLeft = Math.max(0, b2.x - Math.max(24, (canvas.clientWidth - b2.width) / 2));
    canvas.scrollTop = Math.max(0, b2.y - Math.max(24, (canvas.clientHeight - b2.height) / 2));
  }
  function zoomTo(scale, cx, cy) {
    const g = S.viewer && S.viewer.graph;
    if (!g) return;
    const old = g.view.scale;
    const ns = Math.max(0.05, Math.min(8, scale));
    // keep the point under (cx, cy) in place
    const px = cx == null ? canvas.clientWidth / 2 : cx, py = cy == null ? canvas.clientHeight / 2 : cy;
    const mx = (canvas.scrollLeft + px) / old, my = (canvas.scrollTop + py) / old;
    g.zoomTo(ns, false);
    sizeCanvas();
    canvas.scrollLeft = mx * ns - px;
    canvas.scrollTop = my * ns - py;
    zoomText();
    if (S.highlight) S.highlight.repaint && S.highlight.repaint();
  }
  // The drawing gets a margin on all sides so a fitted or zoomed page can always be scrolled.
  function sizeCanvas() {
    const g = S.viewer && S.viewer.graph;
    if (!g) return;
    const svg = g.view.getDrawPane() && g.view.getDrawPane().ownerSVGElement;
    const b = g.getGraphBounds();
    if (svg && b) {
      const w = Math.ceil(Math.max(canvas.clientWidth, b.x + b.width + 48));
      const h = Math.ceil(Math.max(canvas.clientHeight, b.y + b.height + 48));
      svg.style.minWidth = w + 'px'; svg.style.minHeight = h + 'px';
      svg.style.width = w + 'px'; svg.style.height = h + 'px';
    }
  }

  function selectPage(i, keepView) {
    if (!S.viewer || i < 0 || i >= S.pages.length) return;
    clearHighlight();
    S.current = i;
    S.viewer.selectPage(i);
    applyLayerState();
    for (const t of tabs.children) t.setAttribute('aria-selected', t.dataset.page === String(i) ? 'true' : 'false');
    renderLayers();
    if (!keepView) fit(); else sizeCanvas();
    showInfo(null);
    updateStatus();
    vscode.setState && vscode.setState({ page: i, theme: S.theme });
    vscode.postMessage({ type: 'page', page: i });
  }

  function updateStatus() {
    const p = S.pages[S.current];
    if (!p) return;
    const shapes = p.cells.filter((c) => c.kind === 'vertex' || c.kind === 'group').length;
    const edges = p.cells.filter((c) => c.kind === 'edge').length;
    const hiddenLayers = layerCells().filter((c) => !S.viewer.graph.getModel().isVisible(c)).length;
    const bits = [`Page ${S.current + 1} of ${S.pages.length}`, `${shapes} shapes, ${edges} connectors`];
    if (hiddenLayers) bits.push(`${hiddenLayers} layer${hiddenLayers > 1 ? 's' : ''} hidden`);
    if (S.compressed) bits.push('compressed XML');
    if (S.remote) bits.push(`${S.remote} web image${S.remote > 1 ? 's' : ''} in this file shown as a placeholder (no network)`);
    if (S.math) bits.push('math shown as source text');
    statusText.textContent = bits.join(' · ');
  }

  // ---------------------------------------------------------------- shape details
  function cellInfo(id, page) {
    const p = S.pages[page == null ? S.current : page];
    return p ? p.cells.find((c) => c.id === id) : null;
  }
  function kv(table, k, v, cls) {
    const tr = el('tr'); const th = el('th', '', k); const td = el('td', cls || '', v); tr.append(th, td); table.append(tr);
  }
  function showInfo(cell) {
    S.selected = cell ? cell.id : null;
    info.textContent = '';
    if (!cell) { infoEmpty(); return; }
    const c = cellInfo(cell.id);
    info.append(el('div', 'ih', c && c.kind === 'edge' ? 'Connector' : 'Shape'));
    const t = el('table', 'kv'); t.id = 'infoTable';
    kv(t, 'Label', (c && c.text) || '(no label)', 'label');
    if (c && c.tooltip) kv(t, 'Tooltip', c.tooltip, 'tooltip');
    if (c && c.link) kv(t, 'Link', c.link, 'link');
    if (c) {
      kv(t, 'Shape', c.shape || '');
      if (c.layer) kv(t, 'Layer', c.layer);
      if (c.geometry && c.kind !== 'edge') kv(t, 'Position', `x ${c.geometry.x}, y ${c.geometry.y}, ${c.geometry.width} × ${c.geometry.height}`);
      if (c.kind === 'edge') {
        const a = c.source ? cellInfo(c.source) : null, b = c.target ? cellInfo(c.target) : null;
        kv(t, 'From', a ? (a.text || a.id) : '(loose end)');
        kv(t, 'To', b ? (b.text || b.id) : '(loose end)');
      }
      if (c.tags) kv(t, 'Tags', c.tags);
      kv(t, 'ID', c.id);
    }
    info.append(t);
    const keys = c ? Object.keys(c.data) : [];
    if (keys.length) {
      info.append(el('div', 'ih', 'Data'));
      const d = el('table', 'kv'); d.id = 'dataTable';
      for (const k of keys) kv(d, k, c.data[k]);
      info.append(d);
    }
    if (c && c.link) info.append(el('p', 'muted', 'The link is shown as text. This viewer never opens it.'));
  }

  function clearHighlight() { if (S.highlight) { try { S.highlight.destroy(); } catch (e) { /* gone */ } S.highlight = null; } }
  function highlightCell(cell, noScroll) {
    clearHighlight();
    const g = S.viewer.graph;
    const st = g.view.getState(cell);
    if (!st) return;
    const h = new mxCellHighlight(g, '#f5a623', 3);
    h.highlight(st);
    S.highlight = h;
    if (noScroll) return;
    // scroll the shape into the middle of the canvas
    canvas.scrollLeft = Math.max(0, st.x + st.width / 2 - canvas.clientWidth / 2);
    canvas.scrollTop = Math.max(0, st.y + st.height / 2 - canvas.clientHeight / 2);
  }

  // ---------------------------------------------------------------- find
  function runFind() {
    const q = findIn.value.trim().toLowerCase();
    S.hits = []; S.hit = -1;
    results.textContent = '';
    if (!q) { findCount.textContent = ''; return; }
    S.pages.forEach((p, pi) => {
      for (const c of p.cells) {
        if (c.kind === 'root' || c.kind === 'layer') continue;
        const fields = [['label', c.text], ['tooltip', c.tooltip], ['link', c.link]].concat(Object.entries(c.data));
        const f = fields.find((x) => x[1] && String(x[1]).toLowerCase().indexOf(q) >= 0);
        if (f) S.hits.push({ page: pi, id: c.id, field: f[0], text: String(f[1]), label: c.text });
      }
    });
    findCount.textContent = S.hits.length ? `${S.hits.length} found` : 'none found';
    results.append(el('div', 'ih', `Find "${findIn.value.trim()}": ${S.hits.length} match${S.hits.length === 1 ? '' : 'es'} on ${new Set(S.hits.map((h) => h.page)).size} page(s)`));
    S.hits.slice(0, 300).forEach((h, k) => {
      const r = el('button', 'hit'); r.type = 'button'; r.dataset.k = String(k);
      r.append(el('span', 'hp', S.pages[h.page].name), el('span', 'ht', (h.label || h.text).slice(0, 80)), el('span', 'hf', h.field === 'label' ? '' : h.field));
      r.addEventListener('click', () => goHit(k));
      results.append(r);
    });
  }
  function goHit(k) {
    if (!S.hits.length) return;
    S.hit = (k + S.hits.length) % S.hits.length;
    const h = S.hits[S.hit];
    if (h.page !== S.current) selectPage(h.page, true);
    const cell = S.viewer.graph.getModel().getCell(h.id);
    for (const r of results.querySelectorAll('.hit')) r.classList.toggle('on', r.dataset.k === String(S.hit));
    findCount.textContent = `${S.hit + 1} of ${S.hits.length}`;
    if (cell) { highlightCell(cell); showInfo(cell); }
  }

  // ---------------------------------------------------------------- input: pan, zoom, click
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    drag = { x: e.clientX, y: e.clientY, sl: canvas.scrollLeft, st: canvas.scrollTop, moved: false };
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; S.panned = true; canvas.classList.add('panning'); }
    if (drag.moved) { canvas.scrollLeft = drag.sl - dx; canvas.scrollTop = drag.st - dy; }
  });
  window.addEventListener('pointerup', () => { if (drag) { canvas.classList.remove('panning'); drag = null; setTimeout(() => { S.panned = false; }, 50); } }, true);
  canvas.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !S.viewer) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomTo(S.viewer.graph.view.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  bIn.addEventListener('click', () => S.viewer && zoomTo(S.viewer.graph.view.scale * 1.25));
  bOut.addEventListener('click', () => S.viewer && zoomTo(S.viewer.graph.view.scale / 1.25));
  bFit.addEventListener('click', fit);
  b100.addEventListener('click', () => zoomTo(1));
  bLayers.addEventListener('click', () => { layersPop.hidden = !layersPop.hidden; bLayers.setAttribute('aria-pressed', layersPop.hidden ? 'false' : 'true'); });
  themeSel.addEventListener('change', () => { S.theme = themeSel.value; applyTheme(); vscode.setState && vscode.setState({ page: S.current, theme: S.theme }); });
  let findT = null;
  findIn.addEventListener('input', () => { clearTimeout(findT); findT = setTimeout(() => { findT = null; runFind(); }, 150); });
  findIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!S.hits.length || findT) { clearTimeout(findT); findT = null; runFind(); } goHit(S.hit + (e.shiftKey ? -1 : 1)); } if (e.key === 'Escape') { findIn.value = ''; runFind(); clearHighlight(); } });
  bNext.addEventListener('click', () => goHit(S.hit + 1));
  bPrev.addEventListener('click', () => goHit(S.hit - 1));
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); findIn.focus(); findIn.select(); return; }
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    if (e.key === '+' || e.key === '=') bIn.click();
    else if (e.key === '-') bOut.click();
    else if (e.key === '0') b100.click();
    else if (e.key === 'f' || e.key === 'F') fit();
    else if (e.key === 'PageDown') selectPage(Math.min(S.pages.length - 1, S.current + 1));
    else if (e.key === 'PageUp') selectPage(Math.max(0, S.current - 1));
  });
  new ResizeObserver(() => sizeCanvas()).observe(canvas);
  const themeWatch = new MutationObserver(() => { if (S.theme === 'auto') applyTheme(); });
  themeWatch.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // ---------------------------------------------------------------- open
  function open(m) {
    S.name = m.name;
    nameEl.textContent = m.name;
    nameEl.title = m.name;
    infoEmpty();
    if (!m.ok) {
      tabRow.hidden = true;
      showNotice(`${m.name} could not be opened.\n\n${m.error}\n\nThe file is not changed. Open it with the text editor to look at its XML.`, 'error');
      statusText.textContent = 'Not a readable diagram';
      for (const b of [bIn, bOut, bFit, b100, bLayers, findIn, bPrev, bNext, themeSel]) b.disabled = true;
      vscode.postMessage({ type: 'failed', reason: m.code || 'invalid', message: m.error });
      return;
    }
    S.pages = m.pages;
    S.compressed = m.compressed;
    S.settings = m.settings || {};
    const st = (vscode.getState && vscode.getState()) || {};
    S.theme = st.theme || S.settings.canvas || 'auto';
    themeSel.value = S.theme;
    try {
      const f = buildFile(m.pages);
      S.file = f.node; S.remote = f.remote; S.math = f.math;
      const start = Math.min(Math.max(0, st.page || 0), m.pages.length - 1);
      S.current = start;
      S.viewer = makeViewer(canvas, f.node, start, themeIsDark());
      const g = S.viewer.graph;
      g.setTooltips(true);
      // a click (press and release without a drag) on a shape or connector shows its details; the graph is read-only
      // (disabled), so this listens to the raw mouse events, which a disabled graph still reports
      let down = null;
      g.addMouseListener({
        mouseDown: (sender, me) => { const e = me.getEvent(); down = { x: e.clientX, y: e.clientY, cell: me.getCell() }; },
        mouseMove: () => {},
        mouseUp: (sender, me) => {
          const d = down; down = null;
          const e = me.getEvent();
          if (!d || S.panned || Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) return;
          const cell = me.getCell() || d.cell;
          clearHighlight();
          const ok = cell && cell !== g.getModel().getRoot() && !g.getModel().isLayer(cell);
          showInfo(ok ? cell : null);
          if (ok) highlightCell(cell, true);
        },
      });
      applyTheme();
      renderTabs();
      renderLayers();
      fit();
      updateStatus();
      notice.hidden = true;
      S.rendered = true;
      const svg = g.view.getDrawPane().ownerSVGElement;
      vscode.postMessage({ type: 'page', page: S.current });
      vscode.postMessage({ type: 'rendered', stats: { pages: m.pages.length, page: S.current, nodes: svg ? svg.querySelectorAll('g > g').length : 0, remote: S.remote, math: S.math, missingStencils: Object.keys(window.__zvMissingStencils || {}) } });
    } catch (e) {
      showNotice(`${m.name} could not be drawn.\n\n${(e && e.message) || e}\n\nThe file is not changed.`, 'error');
      vscode.postMessage({ type: 'failed', reason: 'render', message: String((e && e.message) || e) });
    }
  }

  // ---------------------------------------------------------------- export (Pro tools ask for this)
  const pending = new Map();
  let reqN = 0;
  function askHost(msg) {
    const req = 'w' + (++reqN);
    return new Promise((resolve) => { pending.set(req, resolve); vscode.postMessage(Object.assign({}, msg, { req })); });
  }

  /** SVG text of page i of fileNode, drawn light with the layers as given (hidden: { layerId: true }). */
  async function pageSvg(fileNode, i, hidden, plainText) {
    offscreen.textContent = '';
    const box = el('div', 'offbox'); offscreen.append(box);
    const v = makeViewer(box, fileNode, i, false);
    try {
      const g = v.graph;
      if (hidden) {
        const m = g.getModel();
        for (const c of m.getChildren(m.getRoot()) || []) if (hidden[c.id]) m.setVisible(c, false);
      }
      const bgAttr = v.xmlNode && v.diagrams && v.diagrams[i] ? null : null; // background comes from the model below
      void bgAttr;
      const bg = g.background && g.background !== mxConstants.NONE ? g.background : null;
      // plainText: labels as SVG text instead of HTML (foreignObject), for a PNG when the browser will not paint HTML
      // labels to a canvas
      const fo = mxSvgCanvas2D.prototype.foEnabled;
      let root;
      try { if (plainText) mxSvgCanvas2D.prototype.foEnabled = false; root = g.getSvg(bg, 1, 10, false, null, true); } finally { mxSvgCanvas2D.prototype.foEnabled = fo; }
      // images from this extension's folder go inline, so the file works anywhere
      const imgs = [...root.querySelectorAll('image')];
      const want = [];
      for (const im of imgs) {
        const href = im.getAttribute('xlink:href') || im.getAttribute('href') || '';
        if (href.startsWith(base + '/')) want.push(href.slice(base.length + 1));
      }
      if (want.length) {
        const got = await askHost({ type: 'assets', paths: [...new Set(want)] });
        for (const im of imgs) {
          const href = im.getAttribute('xlink:href') || im.getAttribute('href') || '';
          const rel = href.startsWith(base + '/') ? href.slice(base.length + 1) : null;
          if (rel && got.files && got.files[rel]) { im.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', got.files[rel]); im.removeAttribute('href'); }
        }
      }
      const w = parseFloat(root.getAttribute('width')) || 0, h = parseFloat(root.getAttribute('height')) || 0;
      return { svg: '<?xml version="1.0" encoding="UTF-8"?>\n' + mxUtils.getXml(root), width: w, height: h, background: bg };
    } finally {
      try { v.graph.destroy(); } catch (e) { /* gone */ }
      offscreen.textContent = '';
    }
  }
  function svgToPng(svgText, width, height, scale, background) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const blob = new Blob([svgText], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(width * scale)); c.height = Math.max(1, Math.round(height * scale));
          const ctx = c.getContext('2d');
          ctx.fillStyle = background || '#ffffff';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.scale(scale, scale);
          ctx.drawImage(img, 0, 0, width, height);
          URL.revokeObjectURL(url);
          resolve(c.toDataURL('image/png').split(',')[1]);
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The SVG could not be drawn to PNG.')); };
      img.src = url;
    });
  }
  async function exportPages(m) {
    // a fresh copy: the open view keeps its own file node (sharing it with the export viewer stalled multi-page exports)
    const fileNode = buildFile(m.pages || S.pages).node;
    const count = m.pages ? m.pages.length : S.pages.length;
    const list = m.scope === 'all' || m.pages ? [...Array(count).keys()] : [S.current];
    const out = [];
    for (const i of list) {
      const hidden = m.pages ? null : S.hidden[i];
      const r = await pageSvg(fileNode, i, hidden);
      const item = { page: i, name: m.pages ? m.pages[i].name : S.pages[i].name, width: r.width, height: r.height };
      if (m.formats.includes('svg')) item.svg = r.svg;
      if (m.formats.includes('png')) {
        try { item.png = await svgToPng(r.svg, r.width, r.height, m.scale || 2, r.background || '#ffffff'); } catch (e) {
          const t = await pageSvg(fileNode, i, hidden, true);
          item.png = await svgToPng(t.svg, t.width, t.height, m.scale || 2, t.background || '#ffffff');
          item.pngPlainText = true;
        }
      }
      out.push(item);
    }
    return out;
  }

  window.addEventListener('message', async (ev) => {
    const m = ev.data;
    if (!m || typeof m !== 'object') return;
    try {
      switch (m.type) {
        case 'init': open(m); break;
        case 'hint': hint(m.text); break;
        case 'assetsResult': if (pending.has(m.req)) { pending.get(m.req)(m); pending.delete(m.req); } break;
        case 'export': {
          if (!S.rendered && !m.pages) throw new Error('The diagram is not drawn.');
          const items = await exportPages(m);
          vscode.postMessage({ type: 'exportResult', req: m.req, ok: true, items });
          break;
        }
        case 'state':
          vscode.postMessage({ type: 'stateResult', req: m.req, ok: true, state: { page: S.current, pages: S.pages.length, scale: S.viewer ? S.viewer.graph.view.scale : 0, theme: S.theme, selected: S.selected, hits: S.hits.length } });
          break;
        default: break;
      }
    } catch (e) {
      if (m && m.req) vscode.postMessage({ type: (m.type || 'job') + 'Result', req: m.req, ok: false, error: String((e && e.message) || e) });
    }
  });

  infoEmpty();
  vscode.postMessage({ type: 'ready' });
})();
