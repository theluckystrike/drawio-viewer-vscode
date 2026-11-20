'use strict';
// Webview HTML for the diagram view. No vscode import, so tests can check the CSP: no remote origin, no connect-src,
// scripts only with the page nonce. Styles allow inline style attributes because the diagram renderer writes them on
// its SVG and HTML label elements (style-src has no nonce on purpose: a nonce would switch 'unsafe-inline' off).
const crypto = require('crypto');
const { footerHtml, FOOTER_CSS } = require('./support');

const PREFIX = 'drawioViewer';
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function csp(cspSource, n) {
  return ["default-src 'none'", `style-src ${cspSource} 'unsafe-inline'`, `script-src 'nonce-${n}'`, `img-src ${cspSource} data: blob:`, `font-src ${cspSource} data:`].join('; ');
}

/** p: { cspSource, scripts: [uri], styleUri, title, showSupportLinks, head?(nonce), nonce?, base } */
function editorHtml(p) {
  const n = p.nonce || crypto.randomBytes(18).toString('base64url');
  // The viewer script moves this line into its status bar.
  const footer = footerHtml(PREFIX, p.showSupportLinks !== false, 'zovo-support-fixed');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(p.cspSource, n)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${attr(p.styleUri)}">
${footer ? `<style>${FOOTER_CSS}</style>` : ''}
${typeof p.head === 'function' ? p.head(n) : ''}
<title>${attr(p.title)}</title>
</head>
<body data-base="${attr(p.base || '')}">
<div id="app"><p class="loading">Opening the diagram...</p></div>
${footer}
${(p.scripts || []).map((s) => `<script nonce="${n}" src="${attr(s)}"></script>`).join('\n')}
</body>
</html>`;
}

module.exports = { editorHtml, csp };
