'use strict';
// Writes our own sample diagram (samples/) and the unit-test fixtures (test/fixtures/). Every diagram here is made by
// this script, for this extension. node scripts/make-samples.js
const fs = require('fs');
const path = require('path');
const { deflatePage } = require('../src/core/drawio');

const ROOT = path.join(__dirname, '..');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '&#xa;');
const v = (id, value, style, x, y, w, h, parent = '1', extra = '') => `<mxCell id="${id}" value="${esc(value)}" style="${esc(style)}" vertex="1" parent="${parent}"${extra}><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
const e = (id, value, style, s, t, pts = [], parent = '1') => `<mxCell id="${id}" value="${esc(value)}" style="${esc(style)}" edge="1" parent="${parent}" source="${s}" target="${t}"><mxGeometry relative="1" as="geometry">${pts.length ? `<Array as="points">${pts.map(([x, y]) => `<mxPoint x="${x}" y="${y}"/>`).join('')}</Array>` : ''}</mxGeometry></mxCell>`;
const obj = (id, attrs, cell) => `<UserObject id="${id}" ${Object.entries(attrs).map(([k, val]) => `${k}="${esc(val)}"`).join(' ')}>${cell}</UserObject>`;
const ocell = (style, x, y, w, h, parent = '1') => `<mxCell style="${esc(style)}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
const model = (cells, layers = [['1', '']], attrs = '') => `<mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0"${attrs}><root><mxCell id="0"/>${layers.map(([id, name, vis]) => `<mxCell id="${id}" ${name ? `value="${esc(name)}" ` : ''}parent="0"${vis === false ? ' visible="0"' : ''}/>`).join('')}${cells.join('')}</root></mxGraphModel>`;
const file = (pages, compressed = []) => `<mxfile host="Zovo samples" version="24.0.0">\n${pages.map(([id, name, m], i) => `  <diagram id="${id}" name="${esc(name)}">${compressed.includes(i) ? deflatePage(m) : `\n    ${m}\n  `}</diagram>`).join('\n')}\n</mxfile>\n`;

const BOX = 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;';
const DB = 'shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=12;fillColor=#fff2cc;strokeColor=#d6b656;';
const EDGE = 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;';

// ------------------------------------------------------------------ the sample: a small web shop, 3 pages
const arch = model([
  v('lane', 'Web shop', 'swimlane;whiteSpace=wrap;html=1;startSize=30;fillColor=#f5f5f5;strokeColor=#666666;', 40, 40, 760, 420),
  obj('web', { label: 'Web app', tooltip: 'Next.js storefront, 3 instances behind the load balancer', link: 'https://example.com/runbooks/web-app', owner: 'Team Storefront', cost_per_month: '420 USD', tier: 'frontend' }, ocell(BOX, 60, 60, 140, 60, 'lane')),
  obj('api', { label: 'Orders API', tooltip: 'REST API for carts, orders and payments', owner: 'Team Checkout', cost_per_month: '610 USD', tier: 'backend' }, ocell(BOX, 300, 60, 140, 60, 'lane')),
  obj('pay', { label: 'Payment adapter', tooltip: 'Talks to the card processor; no card data is stored', owner: 'Team Checkout', tier: 'backend' }, ocell(BOX, 540, 60, 160, 60, 'lane')),
  v('db', 'Orders DB\n(PostgreSQL)', DB, 300, 220, 140, 90, 'lane'),
  v('queue', 'Order events', 'shape=process;whiteSpace=wrap;html=1;backgroundOutline=1;fillColor=#e1d5e7;strokeColor=#9673a6;', 540, 230, 160, 60, 'lane'),
  v('mail', 'Mailer', 'ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;', 560, 340, 120, 60, 'lane'),
  e('e1', 'HTTPS', EDGE, 'web', 'api', [], 'lane'),
  e('e2', 'charge', EDGE, 'api', 'pay', [], 'lane'),
  e('e3', 'SQL', EDGE, 'api', 'db', [], 'lane'),
  e('e4', 'publish', EDGE, 'api', 'queue', [[370, 180], [620, 180]], 'lane'),
  e('e5', 'order shipped', EDGE, 'queue', 'mail', [], 'lane'),
  v('note', '<b>Note</b><br>Numbers are monthly estimates.', 'shape=note;whiteSpace=wrap;html=1;size=14;fillColor=#fff9db;strokeColor=#d6b656;align=left;spacingLeft=6;', 840, 60, 200, 70),
]);
const flow = model([
  v('start', 'Cart checked out', 'ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;', 80, 60, 140, 60),
  v('check', 'Stock available?', 'rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;', 80, 170, 140, 100),
  v('charge', 'Charge the card', BOX, 330, 190, 140, 60),
  v('backorder', 'Back-order and tell the buyer', BOX, 80, 330, 140, 60),
  v('ship', 'Pack and ship', BOX, 580, 190, 140, 60),
  v('done', 'Done', 'ellipse;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;', 580, 330, 140, 60),
  e('f1', '', EDGE, 'start', 'check'),
  e('f2', 'yes', EDGE, 'check', 'charge'),
  e('f3', 'no', EDGE, 'check', 'backorder'),
  e('f4', 'paid', EDGE, 'charge', 'ship'),
  e('f5', '', EDGE, 'ship', 'done'),
  e('f6', 'stock arrives', 'edgeStyle=orthogonalEdgeStyle;dashed=1;html=1;endArrow=open;', 'backorder', 'charge', [[400, 360]]),
]);
const deploy = model([
  v('vpc', 'VPC 10.0.0.0/16', 'rounded=0;whiteSpace=wrap;html=1;dashed=1;fillColor=none;strokeColor=#3b6bb5;verticalAlign=top;align=left;spacingLeft=8;', 40, 40, 620, 360, 'net'),
  v('lb', 'Load balancer', 'shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;fillColor=#dae8fc;strokeColor=#6c8ebf;', 80, 90, 140, 60, 'net'),
  v('app1', 'app-1', BOX, 300, 80, 120, 50, 'net'),
  v('app2', 'app-2', BOX, 300, 160, 120, 50, 'net'),
  v('rds', 'Database (primary)', DB, 480, 100, 140, 90, 'net'),
  e('d1', '', EDGE, 'lb', 'app1', [], 'net'),
  e('d2', '', EDGE, 'lb', 'app2', [], 'net'),
  e('d3', '', EDGE, 'app1', 'rds', [], 'net'),
  e('d4', '', EDGE, 'app2', 'rds', [], 'net'),
  v('n1', 'Backups every 6 hours', 'text;html=1;align=left;verticalAlign=middle;fontStyle=2;', 480, 210, 180, 30, 'notes'),
  v('n2', 'Scale out at 70 % CPU', 'text;html=1;align=left;verticalAlign=middle;fontStyle=2;', 300, 230, 180, 30, 'notes'),
  v('old', 'Old server (retired)', 'rounded=1;whiteSpace=wrap;html=1;fillColor=#eeeeee;strokeColor=#999999;dashed=1;', 80, 280, 160, 50, 'legacy'),
], [['1', 'Background'], ['net', 'Network'], ['notes', 'Notes'], ['legacy', 'Legacy', false]]);
fs.mkdirSync(path.join(ROOT, 'samples'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'samples', 'web-shop-architecture.drawio'), file([['arch', 'Architecture', arch], ['flow', 'Order flow', flow], ['deploy', 'Deployment', deploy]], [1]));

// ------------------------------------------------------------------ test fixtures
const FIX = path.join(ROOT, 'test', 'fixtures');
fs.mkdirSync(FIX, { recursive: true });
const w = (n, t) => fs.writeFileSync(path.join(FIX, n), t);
// compare pair: v2 renames a label, moves and recolors a shape, adds a shape and an edge, removes one, changes data
const v1 = model([
  v('a', 'Start', 'ellipse;whiteSpace=wrap;html=1;', 40, 40, 120, 60),
  obj('b', { label: 'Review', owner: 'Ana', sla: '2 days' }, ocell(BOX, 220, 40, 120, 60)),
  v('c', 'Publish', BOX, 400, 40, 120, 60),
  v('x', 'Archive', BOX, 400, 160, 120, 60),
  e('ab', '', EDGE, 'a', 'b'), e('bc', 'ok', EDGE, 'b', 'c'),
]);
const v2 = model([
  v('a', 'Start', 'ellipse;whiteSpace=wrap;html=1;', 40, 40, 120, 60),
  obj('b', { label: 'Peer review', owner: 'Ben', sla: '2 days' }, ocell(BOX, 220, 40, 120, 60)),
  v('c', 'Publish', BOX.replace('#dae8fc', '#d5e8d4'), 420, 60, 120, 60),
  v('d', 'Notify readers', BOX, 600, 40, 140, 60),
  e('ab', '', EDGE, 'a', 'b'), e('bc', 'approved', EDGE, 'b', 'c'), e('cd', '', EDGE, 'c', 'd'),
]);
w('flow-v1.drawio', file([['p1', 'Process', v1], ['p2', 'Notes', model([v('t', 'Old note', 'text;html=1;', 10, 10, 100, 30)])]]));
w('flow-v2.drawio', file([['p1', 'Process', v2], ['p3', 'Glossary', model([v('g', 'SLA: service level', 'text;html=1;', 10, 10, 140, 30)])]], [0]));
w('plain.drawio', file([['p1', 'Only page', model([v('a', 'Hello', BOX, 10, 10, 100, 40)])]]));
w('compressed.dio', file([['p1', 'Packed', flow]], [0]));
w('bare-model.dio', model([v('a', 'Bare model', BOX, 10, 10, 100, 40), v('b', 'Second', BOX, 200, 10, 100, 40), e('ab', '', EDGE, 'a', 'b')]));
w('broken.drawio', file([['p1', 'Page', arch]]).slice(0, 900));
w('not-a-diagram.drawio', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>\n');
w('empty.dio', '');
w('text.drawio', 'This is a plain text note, not a diagram.\n');
w('damaged-compressed.drawio', '<mxfile><diagram id="p" name="Page-1">7VhNb6MwEP01HFsZG5Jw3KTp9tJVpRx2ezTgBK8MRmA3pL9+bTAEO2natGlXqhRFsj3MjN+8N2MrnrJMqvxE0SqZ7+9VEtHpjGkbX+NVq9n4ozW</diagram></mxfile>\n');
w('no-pages.drawio', '<mxfile host="x"></mxfile>\n');
// remote image, web font, math and an HTML label with a remote image: the viewer draws placeholders and no request
w('offline-check.drawio', file([['p1', 'Remote things', model([
  v('img', '', 'shape=image;html=1;image=https://example.com/logo.png;', 10, 10, 80, 80),
  v('font', 'Web font label', 'text;html=1;fontFamily=Lobster;fontSource=https%3A%2F%2Ffonts.googleapis.com%2Fcss%3Ffamily%3DLobster;', 120, 10, 160, 40),
  v('html', '<img src="http://example.com/a.png" width="20"> Logo', 'text;html=1;', 120, 60, 160, 40),
  v('m', '`a^2 + b^2 = c^2`', 'text;html=1;', 10, 110, 200, 40),
  v('anchor', '<a href="https://example.com/docs">Docs link</a>', 'text;html=1;', 10, 170, 200, 40),
], [['1', '']], ' backgroundImage="{&quot;src&quot;:&quot;https://example.com/bg.png&quot;,&quot;width&quot;:10,&quot;height&quot;:10}"').replace('math="0"', 'math="1"')]]));
console.log('samples and fixtures written');
