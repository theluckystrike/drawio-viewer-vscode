// Drawio Viewer & Preview by Zovo: runs before the vendored diagram library (lib/drawio/viewer-static.min.js). Points
// every path the library would load from at this extension's own folder, and turns off what would need the network:
// style sheets, language files, math typesetting, logging and remote stencil downloads. The page CSP (default-src
// 'none', no connect-src) blocks any request that is left; this file makes sure none is tried.
(function () {
  'use strict';
  var base = (document.body && document.body.getAttribute('data-base')) || '.';
  window.DRAWIO_BASE_URL = base;
  window.DRAWIO_LIGHTBOX_URL = base;
  window.DRAWIO_LOG_URL = '';
  window.PROXY_URL = '';
  window.STYLE_PATH = base + '/styles';
  window.SHAPES_PATH = base + '/shapes';
  window.STENCIL_PATH = base + '/stencils';
  window.GRAPH_IMAGE_PATH = base + '/img';
  window.mxImageBasePath = base + '/mxgraph/images';
  window.mxBasePath = base + '/mxgraph/';
  window.DRAW_MATH_URL = '';
  window.mxLoadResources = false;
  window.mxLoadStylesheets = false;
  window.mxForceIncludes = false;
  window.mxscript = function () { /* no script loading */ };
  window.urlParams = window.urlParams || {};
  window.urlParams.math = '0';
  window.urlParams.lang = 'en';

  // No request leaves this page: XHR, fetch and beacons fail at once and quietly (no CSP report, no console error).
  function NoXhr() { this.readyState = 0; this.status = 0; this.responseText = ''; this.response = null; this.responseXML = null; }
  NoXhr.prototype.open = function () { this.readyState = 1; };
  NoXhr.prototype.setRequestHeader = function () {};
  NoXhr.prototype.overrideMimeType = function () {};
  NoXhr.prototype.getResponseHeader = function () { return null; };
  NoXhr.prototype.getAllResponseHeaders = function () { return ''; };
  NoXhr.prototype.abort = function () {};
  NoXhr.prototype.addEventListener = function () {};
  NoXhr.prototype.send = function () {
    this.readyState = 4; this.status = 0;
    var self = this;
    setTimeout(function () { if (typeof self.onreadystatechange === 'function') self.onreadystatechange(); if (typeof self.onerror === 'function') self.onerror(new Error('offline')); }, 0);
  };
  window.XMLHttpRequest = NoXhr;
  window.fetch = function () { return Promise.reject(new Error('This viewer makes no network requests.')); };
  try { navigator.sendBeacon = function () { return false; }; } catch (e) { /* read-only in some builds */ }
  // Links in a diagram are shown as text in the side panel, never opened.
  window.open = function () { return null; };
})();
