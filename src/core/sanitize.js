// Drawio Viewer & Preview by Zovo: keeps a diagram offline before it is drawn. Used by the webview (global
// ZvSanitize) and by the unit tests (require). A remote image (http, https or protocol-relative) in a style or an HTML
// label is swapped for a small local placeholder; web font sources and math typesetting are switched off. Nothing in
// the file on disk changes: this works on the copy the viewer draws.
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ZvSanitize = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PLACEHOLDER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60" viewBox="0 0 80 60">'
    + '<rect x="1" y="1" width="78" height="58" rx="4" fill="#eeeeee" stroke="#9e9e9e" stroke-dasharray="4 3"/>'
    + '<path d="M22 42 L34 28 L44 38 L50 32 L60 42 Z" fill="#bdbdbd"/><circle cx="54" cy="20" r="5" fill="#bdbdbd"/></svg>';
  const b64 = (s) => (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64'));
  // style values cannot hold ";", so the style form is "data:image/svg+xml,<base64>" (the renderer adds ;base64)
  const PLACEHOLDER_STYLE = 'data:image/svg+xml,' + b64(PLACEHOLDER_SVG);
  const PLACEHOLDER_HTML = 'data:image/svg+xml;base64,' + b64(PLACEHOLDER_SVG);

  const REMOTE = /^\s*(https?:)?\/\//i;
  const isRemote = (v) => REMOTE.test(String(v || ''));

  /** Returns { style, remote } with remote images replaced and fontSource removed. */
  function cleanStyle(style) {
    let remote = 0;
    if (!style) return { style: style || '', remote };
    const out = [];
    for (const part of String(style).split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) { out.push(part); continue; }
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1);
      if (k === 'fontSource') continue;
      if (/image$/i.test(k) && isRemote(v)) { remote++; out.push(`${k}=${PLACEHOLDER_STYLE}`); continue; }
      out.push(part);
    }
    return { style: out.join(';'), remote };
  }

  /** Returns { html, remote } with remote <img> sources, CSS url()s and active tags made local and inert. */
  function cleanHtml(html) {
    let remote = 0;
    if (!html || String(html).indexOf('<') < 0 && String(html).indexOf('url(') < 0) return { html: html || '', remote };
    let s = String(html);
    s = s.replace(/<\s*(script|iframe|object|embed|link|meta|base|frame|frameset)\b[^>]*>([\s\S]*?<\s*\/\s*\1\s*>)?/gi, () => '');
    s = s.replace(/(<img\b[^>]*?\bsrc\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (m, pre, all, d, q, u) => {
      const v = d !== undefined ? d : q !== undefined ? q : u;
      if (!isRemote(v)) return m;
      remote++;
      return `${pre}"${PLACEHOLDER_HTML}"`;
    });
    s = s.replace(/\bsrcset\s*=\s*("[^"]*"|'[^']*')/gi, (m, v) => (/(https?:)?\/\//i.test(v) ? (remote++, '') : m));
    s = s.replace(/url\(\s*(['"]?)((https?:)?\/\/[^'")]*)\1\s*\)/gi, () => { remote++; return 'none'; });
    s = s.replace(/@import[^;]*;?/gi, '');
    return { html: s, remote };
  }

  /** A backgroundImage attribute (JSON with src) pointing at the web is dropped. */
  function cleanBackgroundImage(v) {
    if (!v) return { value: v, remote: 0 };
    try { const o = JSON.parse(v); if (o && isRemote(o.src)) return { value: null, remote: 1 }; } catch (e) { if (isRemote(v)) return { value: null, remote: 1 }; }
    return { value: v, remote: 0 };
  }

  /**
   * Walks an mxGraphModel DOM element (browser DOM or any object with getAttribute/setAttribute/removeAttribute and
   * children) and cleans it in place. Returns { remote, math } counts.
   */
  function cleanModel(model) {
    let remote = 0, math = false;
    if (!model || !model.getAttribute) return { remote, math };
    if (model.getAttribute('math') === '1') { math = true; model.setAttribute('math', '0'); }
    const bg = cleanBackgroundImage(model.getAttribute('backgroundImage'));
    if (bg.remote) { remote += bg.remote; model.removeAttribute('backgroundImage'); }
    const walk = (el) => {
      for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
        if (c.hasAttribute('style')) { const r = cleanStyle(c.getAttribute('style')); if (r.remote || r.style !== c.getAttribute('style')) c.setAttribute('style', r.style); remote += r.remote; }
        for (const a of ['value', 'label', 'tooltip']) {
          if (c.hasAttribute(a)) { const r = cleanHtml(c.getAttribute(a)); if (r.html !== c.getAttribute(a)) c.setAttribute(a, r.html); remote += r.remote; }
        }
        walk(c);
      }
    };
    walk(model);
    return { remote, math };
  }

  return { cleanStyle, cleanHtml, cleanBackgroundImage, cleanModel, isRemote, PLACEHOLDER_STYLE, PLACEHOLDER_HTML };
});
