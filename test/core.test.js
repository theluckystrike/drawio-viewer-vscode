'use strict';
// Core tests: the .drawio / .dio reader (plain, compressed, bare model, broken files), labels, styles, layers, find,
// the offline cleaner, the compare report and the label and data extract.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const D = require('../src/core/drawio');
const R = require('../src/core/report');
const Z = require('../src/core/sanitize');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
const sample = () => D.parseDiagramFile(fs.readFileSync(path.join(ROOT, 'samples', 'web-shop-architecture.drawio'), 'utf8'));

test('sample: 3 pages (one compressed), names, layers with one hidden, shapes and connectors', () => {
  const f = sample();
  assert.equal(f.pages.length, 3);
  assert.deepEqual(f.pages.map((p) => p.name), ['Architecture', 'Order flow', 'Deployment']);
  assert.deepEqual(f.pages.map((p) => p.compressed), [false, true, false]);
  assert.equal(f.compressed, true);
  assert.deepEqual(f.pages[2].layers.map((l) => [l.name, l.visible]), [['Background', true], ['Network', true], ['Notes', true], ['Legacy', false]]);
  assert.deepEqual(D.summary(f), { pages: 3, shapes: 22, edges: 15, compressed: true });
  assert.match(f.pages[1].xml, /^<mxGraphModel /);
  assert.match(f.pages[1].xml, /Stock available\?/);
});
test('cells: UserObject label, tooltip, link and custom data; HTML label as plain text; geometry; edge ends and waypoints', () => {
  const f = sample();
  const c = (p, id) => f.pages[p].cells.find((x) => x.id === id);
  const web = c(0, 'web');
  assert.equal(web.text, 'Web app');
  assert.equal(web.tooltip, 'Next.js storefront, 3 instances behind the load balancer');
  assert.equal(web.link, 'https://example.com/runbooks/web-app');
  assert.deepEqual(web.data, { owner: 'Team Storefront', cost_per_month: '420 USD', tier: 'frontend' });
  assert.equal(web.parent, 'lane');
  assert.equal(web.layer, 'Background');
  assert.deepEqual(web.geometry, { x: 60, y: 60, width: 140, height: 60, relative: false });
  assert.equal(c(0, 'note').text, 'Note\nNumbers are monthly estimates.');
  assert.equal(c(0, 'db').text, 'Orders DB\n(PostgreSQL)');
  const e4 = c(0, 'e4');
  assert.equal(e4.kind, 'edge');
  assert.equal(e4.source, 'api');
  assert.equal(e4.target, 'queue');
  assert.deepEqual(e4.geometry.points, [{ x: 370, y: 180 }, { x: 620, y: 180 }]);
  assert.equal(c(2, 'old').layer, 'Legacy');
  assert.equal(c(2, 'n1').layer, 'Notes');
});
test('shape names: shape=, base style, text, rounded rectangle, edge style', () => {
  const f = sample();
  const n = (p, id) => D.shapeName(f.pages[p].cells.find((x) => x.id === id));
  assert.equal(n(0, 'db'), 'cylinder3');
  assert.equal(n(1, 'check'), 'rhombus');
  assert.equal(n(1, 'start'), 'ellipse');
  assert.equal(n(0, 'web'), 'rounded rectangle');
  assert.equal(n(0, 'lane'), 'swimlane');
  assert.equal(n(2, 'n1'), 'text');
  assert.equal(n(0, 'e1'), 'edge (orthogonalEdgeStyle)');
});
test('compressed pages: inflate and deflate round trip, with non-ASCII text', () => {
  const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="Größe ≥ 3 €" vertex="1" parent="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell></root></mxGraphModel>';
  assert.equal(D.inflatePage(D.deflatePage(xml)), xml);
  const f = D.parseDiagramFile(`<mxfile><diagram id="x" name="P">${D.deflatePage(xml)}</diagram></mxfile>`);
  assert.equal(f.pages[0].cells.find((c) => c.id === 'a').text, 'Größe ≥ 3 €');
});
test('a bare <mxGraphModel> file (.dio) opens as one page', () => {
  const f = D.parseDiagramFile(read('bare-model.dio'));
  assert.equal(f.pages.length, 1);
  assert.equal(f.pages[0].name, 'Page-1');
  assert.deepEqual(D.summary(f), { pages: 1, shapes: 2, edges: 1, compressed: false });
});
test('broken files: a clear message and a code, never a crash', () => {
  const cases = { 'broken.drawio': 'xml', 'damaged-compressed.drawio': 'compressed', 'empty.dio': 'empty', 'not-a-diagram.drawio': 'notdiagram', 'text.drawio': 'notxml', 'no-pages.drawio': 'nopages' };
  for (const [f, code] of Object.entries(cases)) {
    assert.throws(() => D.parseDiagramFile(read(f)), (e) => e instanceof D.DiagramError && e.code === code && e.message.length > 10, f);
  }
  assert.throws(() => D.parseDiagramFile('<mxfile><diagram>%%%not base64%%%</diagram></mxfile>'), /not valid base64/);
  assert.throws(() => D.parseDiagramFile('<mxfile><diagram id="a">'), /ends before/);
});
test('XML reader: entities, CDATA, comments, single quotes; writer round trip', () => {
  const doc = D.parseXml('<?xml version="1.0"?><!-- c --><a x=\'1 &amp; 2\' y="&#x41;&#66;&lt;"><b>t&gt;<![CDATA[<raw>]]></b></a>');
  const a = doc.children[0];
  assert.deepEqual(a.attrs, { x: '1 & 2', y: 'AB<' });
  assert.equal(a.children[0].text, 't><raw>');
  assert.equal(D.toXml(D.parseXml('<a x="1&quot;&#xa;2"><b/></a>')), '<a x="1&quot;&#xa;2"><b/></a>');
});
test('labelText: tags out, <br> and divs to lines, entities decoded', () => {
  assert.equal(D.labelText('<div>A&nbsp;&amp; B</div><div>C<br/>D</div>', true), 'A & B\nC\nD');
  assert.equal(D.labelText('plain < text', false), 'plain < text');
});
test('find: label, tooltip, link and data on every page, case-insensitive', () => {
  const f = sample();
  const h = D.findText(f, 'CHECKOUT');
  assert.deepEqual(h.map((x) => [x.pageName, x.id, x.field]), [['Architecture', 'api', 'owner'], ['Architecture', 'pay', 'owner']]);
  assert.equal(D.findText(f, 'runbooks')[0].field, 'link');
  assert.equal(D.findText(f, '6 hours')[0].pageName, 'Deployment');
  assert.deepEqual(D.findText(f, '  '), []);
});
test('real third-party files from the jgraph repositories parse (when the gate download folder is present)', (t) => {
  const dir = path.join(process.env.HOME || '', 'plugin-market-intel-work', 'newb16-work', 'drawio', 'dl', 'jgraph-drawio-diagrams');
  if (!fs.existsSync(dir)) { t.skip('no download folder on this computer'); return; }
  const files = fs.readdirSync(dir).filter((f) => /\.(drawio|xml)$/.test(f));
  assert.ok(files.length >= 10);
  for (const f of files) { const r = D.parseDiagramFile(fs.readFileSync(path.join(dir, f), 'utf8')); assert.ok(r.pages.length >= 1 && r.pages.every((p) => p.cells.length >= 2), f); }
});

// ---------- offline cleaner ----------
test('sanitize: remote images in styles become a local placeholder, data and relative images stay, fontSource goes', () => {
  const r = Z.cleanStyle('shape=image;image=https://example.com/a.png;fontSource=https%3A%2F%2Ffonts.googleapis.com;fontFamily=Lobster;');
  assert.equal(r.remote, 1);
  assert.match(r.style, /image=data:image\/svg\+xml,[A-Za-z0-9+/=]+;/);
  assert.doesNotMatch(r.style, /fontSource|https?:/);
  assert.match(r.style, /fontFamily=Lobster/);
  for (const s of ['image=data:image/png,iVBORw0KGgo=;', 'image=img/lib/azure2/compute/VM.svg;', 'aspect=fixed;']) assert.equal(Z.cleanStyle(s).style, s);
  assert.equal(Z.cleanStyle('indicatorImage=//cdn.example.com/x.svg').remote, 1);
});
test('sanitize: HTML labels lose remote <img> sources, CSS url()s, scripts and frames', () => {
  const r = Z.cleanHtml('<img src="http://x.test/a.png"> <img src=\'data:image/png;base64,AA\'> <span style="background:url(https://x.test/b.png)">t</span><script>alert(1)</script><iframe src="https://x.test"></iframe>');
  assert.equal(r.remote, 2);
  assert.doesNotMatch(r.html, /https?:|<script|<iframe/);
  assert.match(r.html, /data:image\/png;base64,AA/);
  assert.match(r.html, /data:image\/svg\+xml;base64,/);
});
test('sanitize: a background image on the web is dropped', () => {
  assert.deepEqual(Z.cleanBackgroundImage('{"src":"https://x.test/bg.png"}'), { value: null, remote: 1 });
  assert.deepEqual(Z.cleanBackgroundImage('{"src":"data:image/png;base64,AA"}'), { value: '{"src":"data:image/png;base64,AA"}', remote: 0 });
});

// ---------- compare ----------
test('compare: added, removed and changed shapes and connectors, page only in A and only in B', () => {
  const res = R.compareFiles(D.parseDiagramFile(read('flow-v1.drawio')), D.parseDiagramFile(read('flow-v2.drawio')));
  const p = res.pages[0];
  assert.equal(p.status, 'both');
  assert.deepEqual(p.added.map((c) => c.id), ['d', 'cd']);
  assert.deepEqual(p.removed.map((c) => c.id), ['x']);
  const ch = Object.fromEntries(p.changed.map((x) => [x.a.id, x.changes]));
  assert.deepEqual(Object.keys(ch).sort(), ['b', 'bc', 'c']);
  assert.ok(ch.b.includes('label: "Review" → "Peer review"'));
  assert.ok(ch.b.includes('data owner: "Ana" → "Ben"'));
  assert.ok(ch.c.includes('style fillColor: #dae8fc → #d5e8d4'));
  assert.ok(ch.c.includes('moved: (400, 40) → (420, 60)'));
  assert.ok(ch.bc.includes('label: "ok" → "approved"'));
  assert.deepEqual(res.pages.map((x) => x.status), ['both', 'removed', 'added']);
  assert.deepEqual(res.totals, { added: 3, removed: 2, changed: 3, same: 3, pagesAdded: 1, pagesRemoved: 1, labelChanges: 2 });
  assert.equal(res.identical, false);
});
test('compare: Markdown report with the summary table and a section per page', () => {
  const res = R.compareFiles(D.parseDiagramFile(read('flow-v1.drawio')), D.parseDiagramFile(read('flow-v2.drawio')));
  const md = R.compareMarkdown('flow-v1.drawio', 'flow-v2.drawio', res);
  assert.match(md, /^# Diagram compare: flow-v1\.drawio and flow-v2\.drawio/);
  assert.match(md, /\| Process \| Process \| 2 \| 1 \| 3 \| 3 \|/);
  assert.match(md, /\| \*\*All pages\*\* \| \| \*\*3\*\* \| \*\*2\*\* \| \*\*3\*\* \| \*\*3\*\* \|/);
  assert.match(md, /## Page only in A: Notes/);
  assert.match(md, /## Page only in B: Glossary/);
  assert.match(md, /\| b \| shape \| Peer review \| label: "Review" → "Peer review"<br>data owner: "Ana" → "Ben" \|/);
});
test('compare: a file with itself (plain against compressed copy) is identical', () => {
  const a = D.parseDiagramFile(read('flow-v1.drawio'));
  const b = D.parseDiagramFile(read('flow-v1.drawio').replace(/<diagram id="p1" name="Process">([\s\S]*?)<\/diagram>/, (m, x) => `<diagram id="p1" name="Process">${D.deflatePage(x.trim())}</diagram>`));
  assert.equal(b.pages[0].compressed, true);
  const res = R.compareFiles(a, b);
  assert.equal(res.identical, true);
  assert.match(R.compareMarkdown('a', 'b', res), /have the same pages, shapes, connectors/);
});
test('compare: pipes and new lines in labels do not break the Markdown table', () => {
  const mk = (label) => D.parseDiagramFile(`<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="${label}" vertex="1" parent="1"><mxGeometry width="1" height="1" as="geometry"/></mxCell></root></mxGraphModel>`);
  const md = R.compareMarkdown('a', 'b', R.compareFiles(mk('x'), mk('a|b&#xa;c')));
  const row = md.split('\n').find((l) => l.startsWith('| a |'));
  assert.equal(row.split(/(?<!\\)\|/).length, 6);
});

// ---------- extract ----------
test('extract: one row per shape and connector with page, layer, parent, shape, geometry, ends and data columns', () => {
  const ex = R.extractRows(sample());
  assert.equal(ex.rows.length, 37);
  assert.deepEqual(ex.columns.slice(-3), ['data:owner', 'data:cost_per_month', 'data:tier']);
  const web = ex.rows.find((r) => r.id === 'web');
  assert.deepEqual([web.page, web.type, web.label, web.layer, web.parent, web.shape, web.x, web.y, web.width, web.height], ['Architecture', 'shape', 'Web app', 'Background', 'Web shop', 'rounded rectangle', 60, 60, 140, 60]);
  const e2 = ex.rows.find((r) => r.id === 'e2');
  assert.deepEqual([e2.type, e2.label, e2.from, e2.to, e2.x], ['connector', 'charge', 'Orders API', 'Payment adapter', '']);
});
test('extract: CSV quotes commas, quotes and new lines, starts with a BOM and uses CRLF', () => {
  const csv = R.toCsv(R.extractRows(sample()));
  assert.ok(csv.startsWith('﻿page,id,type,label,tooltip,link,tags,layer,parent,shape,x,y,width,height,from,to,data:owner,data:cost_per_month,data:tier\r\n'));
  assert.match(csv, /\r\nArchitecture,web,shape,Web app,"Next\.js storefront, 3 instances behind the load balancer",https:\/\/example\.com\/runbooks\/web-app,,Background,Web shop,rounded rectangle,60,60,140,60,,,Team Storefront,420 USD,frontend\r\n/);
  assert.match(csv, /,db,shape,"Orders DB\n\(PostgreSQL\)",/);
  assert.equal(R.csvCell('a "b"'), '"a ""b"""');
});
test('extract: Markdown has one table per page with the data column', () => {
  const f = sample();
  const md = R.toMarkdown(R.extractRows(f), 'web-shop-architecture.drawio', f);
  assert.match(md, /^# Labels and data: web-shop-architecture\.drawio\n\n37 shapes and connectors on 3 pages\./);
  assert.match(md, /## Architecture \(13\)/);
  assert.match(md, /## Order flow \(12\)/);
  assert.match(md, /\| web \| shape \| Web app \| Background \| rounded rectangle \| Next\.js storefront, 3 instances behind the load balancer \| https:\/\/example\.com\/runbooks\/web-app \| owner: Team Storefront; cost_per_month: 420 USD; tier: frontend \|/);
  assert.match(md, /\| e2 \| connector \| charge \(Orders API → Payment adapter\) \|/);
});
