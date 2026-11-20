'use strict';
// Output names for the batch export to SVG. No two outputs of one run may get the same path: plan.drawio and plan.dio
// in one folder, two names that differ only in letter case (macOS and Windows disks), or a diagram named like the
// page file of another diagram (shop-01-Architecture.drawio next to the 3-page shop.drawio).

const dirOf = (rel) => { const i = rel.lastIndexOf('/'); return i < 0 ? '.' : rel.slice(0, i); };
const fileOf = (rel) => rel.slice(rel.lastIndexOf('/') + 1);
const stemOf = (name) => name.replace(/\.(drawio|dio)$/i, '');

/**
 * The base name of the output files of each source (relative paths with "/"). It is the file name without .drawio or
 * .dio. When two sources in the same folder have the same base name (letter case ignored), each keeps its full file
 * name: plan.drawio.svg and plan.dio.svg.
 */
function sourceStems(rels) {
  const count = new Map();
  const key = (rel) => `${dirOf(rel)}/${stemOf(fileOf(rel))}`.toLowerCase();
  for (const r of rels) count.set(key(r), (count.get(key(r)) || 0) + 1);
  return rels.map((r) => (count.get(key(r)) > 1 ? fileOf(r) : stemOf(fileOf(r))));
}

/** Gives out file names per output folder. A name that is taken (letter case ignored) gets -2, -3 and so on. */
class NameAlloc {
  constructor() { this.used = new Set(['./export-errors.md']); }
  take(relDir, file) {
    const dot = file.lastIndexOf('.');
    const base = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot) : '';
    let name = file;
    for (let k = 2; this.used.has(`${relDir}/${name}`.toLowerCase()); k++) name = `${base}-${k}${ext}`;
    this.used.add(`${relDir}/${name}`.toLowerCase());
    return name;
  }
}

module.exports = { sourceStems, NameAlloc };
