'use strict';
// REACH1: this listing's Pro tools for the viewer toolbar row and the Explorer entries (src/reach.js).
module.exports = {
  prefix: 'drawioViewer',
  triesKey: 'drawioViewer.proTrial',
  slot: '#toolbar',
  tools: [
    { id: 'exportImages', title: 'Export SVG and PNG', command: 'drawioViewer.exportImages' },
    { id: 'compare', title: 'Compare diagrams', command: 'drawioViewer.compare' },
    { id: 'extract', title: 'Extract labels and data', command: 'drawioViewer.extract' },
    { id: 'batchExport', title: 'Batch export to SVG', command: 'drawioViewer.batchExport' },
  ],
};
