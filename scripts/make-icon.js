'use strict';
// Draws icon.png (128 x 128): three connected boxes (a small flow diagram) and a magnifier ring on a dark slate tile.
// Our own design.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const W = 128, H = 128;
const px = Buffer.alloc(W * H * 4);
const set = (x, y, [r, g, b], a = 255) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; const k = a / 255; px[i] = Math.round(px[i] * (1 - k) + r * k); px[i + 1] = Math.round(px[i + 1] * (1 - k) + g * k); px[i + 2] = Math.round(px[i + 2] * (1 - k) + b * k); px[i + 3] = Math.max(px[i + 3], a); };
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const R = 22;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const dx = Math.max(R - x, 0, x - (W - 1 - R)), dy = Math.max(R - y, 0, y - (H - 1 - R));
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= R) set(x, y, mix(hex('#222B3D'), hex('#11151F'), y / H), d > R - 1 ? Math.round(255 * (R - d)) : 255);
}
function rect(x0, y0, w, h, r, col, a = 255) {
  for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++) for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
    const dx = Math.max(x0 + r - (x + 0.5), 0, (x + 0.5) - (x0 + w - r)), dy = Math.max(y0 + r - (y + 0.5), 0, (y + 0.5) - (y0 + h - r));
    const d = Math.hypot(dx, dy);
    if (d <= r + 0.5) set(x, y, col, Math.round(a * Math.min(1, r + 0.5 - d)));
  }
}
function line(x1, y1, x2, y2, wdt, col) {
  const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2);
  for (let k = 0; k <= n; k++) { const t = k / n; disc(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, wdt / 2, col); }
}
function disc(cx, cy, r, col, a = 255) { for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) { const d = Math.hypot(x - cx, y - cy); if (d <= r + 0.5) set(x, y, col, Math.round(a * Math.min(1, r + 0.5 - d))); } }
function arrow(x, y, dir, col) { // a filled triangle pointing right (dir 0) or down (dir 1)
  for (let i = 0; i <= 7; i++) for (let j = -i * 0.75; j <= i * 0.75; j += 0.5) { if (dir === 0) set(Math.round(x - 7 + i), Math.round(y + j), col); else set(Math.round(x + j), Math.round(y - 7 + i), col); }
}
const ink = hex('#C9D4E5');
// connectors first
line(46, 38, 74, 38, 3, ink); arrow(80, 38, 0, ink);
line(30, 50, 30, 76, 3, ink); arrow(30, 82, 1, ink);
line(98, 50, 98, 64, 3, ink); line(98, 64, 64, 64, 3, ink); line(64, 64, 64, 76, 3, ink); arrow(64, 82, 1, ink);
// boxes
rect(14, 26, 32, 24, 5, hex('#4C8DF6'));
rect(82, 26, 32, 24, 5, hex('#F5A623'));
rect(14, 82, 32, 24, 12, hex('#3DBE7A'));
// a diamond for the decision
for (let y = 82; y <= 106; y++) for (let x = 50; x <= 78; x++) { const d = Math.abs(x - 64) / 14 + Math.abs(y - 94) / 12; if (d <= 1) set(x, y, hex('#E0548E'), d > 0.93 ? Math.round(255 * (1 - d) / 0.07) : 255); }
// a magnifier ring in the corner: viewing
for (let y = 74; y < 124; y++) for (let x = 74; x < 124; x++) { const d = Math.hypot(x - 99, y - 96); if (d >= 13 && d <= 18) set(x, y, hex('#FFFFFF'), Math.round(255 * Math.min(1, Math.min(d - 12.5, 18.5 - d)))); }
line(111, 108, 121, 118, 6, hex('#FFFFFF'));
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.writeFileSync(path.join(__dirname, '..', 'icon.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('icon.png written');
