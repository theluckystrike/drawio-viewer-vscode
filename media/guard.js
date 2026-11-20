// Drawio Viewer & Preview by Zovo: runs after lib/drawio/viewer-static.min.js and before lib/drawio/stencils.min.js.
// The stencil pack (stencils.min.js) answers stencil requests from its own packed copy and falls back to the loader
// that is in place when it loads. This file puts a loader without network in that place: a stencil that is not in the
// pack draws as a plain box. Script shape files are never fetched or evaluated (they are in the library already).
(function () {
  'use strict';
  if (typeof mxStencilRegistry === 'undefined') return;
  window.__zvMissingStencils = {};
  mxStencilRegistry.allowEval = false;
  mxStencilRegistry.loadStencil = function (name, fn) {
    window.__zvMissingStencils[String(name).split('/').pop()] = 1;
    if (fn != null) { window.setTimeout(function () { fn(null); }, 0); return undefined; }
    return null;
  };
  if (typeof mxStyleRegistry !== 'undefined') mxStyleRegistry.dynamicLoading = false;
  if (typeof Editor !== 'undefined') {
    Editor.enableMath = false;
    Editor.prototype.loadFonts = function (fn) { if (fn) fn(); };
    if (Editor.initMath) Editor.initMath = function () {};
  }
  if (typeof Graph !== 'undefined') {
    Graph.prototype.openLink = function () { return null; };
  }
  if (typeof mxUtils !== 'undefined') {
    mxUtils.load = function () { return { getStatus: function () { return 0; }, getText: function () { return ''; }, getXml: function () { return null; }, getDocumentElement: function () { return null; } }; };
    mxUtils.get = function (url, onload, onerror) { if (onerror) window.setTimeout(function () { onerror({ getStatus: function () { return 0; } }); }, 0); };
    mxUtils.post = function (url, params, onload, onerror) { if (onerror) window.setTimeout(function () { onerror({ getStatus: function () { return 0; } }); }, 0); };
  }
})();
