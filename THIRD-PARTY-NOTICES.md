# Third-party notices

Drawio Viewer & Preview (MIT, Zovo) ships these files from other projects. They are vendored unmodified as separate
files in `lib/drawio/` and run only inside the viewer webview.

## Diagram viewer library, stencils and shape images

- Source: https://github.com/jgraph/drawio, commit f411a11f4f6b8994d869bdbc45f4d4d9e2284f34 (17 Nov 2026)
- License: Apache License 2.0, copy in `lib/drawio/LICENSE`
- Copyright (c) JGraph Ltd and contributors

| File in this extension | From the repository | sha256 |
| --- | --- | --- |
| lib/drawio/viewer-static.min.js | src/main/webapp/js/viewer-static.min.js | c294fab9bc4bccb1790709ffa00f2d237863877f4c14d90147ef08da6d3ddd3a |
| lib/drawio/stencils.min.js | src/main/webapp/js/stencils.min.js | 989d72d18bbf02e61c74937d7f51f048d198bb559c3ede4ae66c08e52544b983 |
| lib/drawio/img/lib/ (1910 files) | src/main/webapp/img/lib/ | (folder copied as is) |

The repository adds a notice for its icon sets and stencil libraries, copied in `lib/drawio/LICENSE-stencils`: they
may not be used in Atlassian products or products distributed through the Atlassian marketplace without written
permission. This extension is a Visual Studio Code extension and is not such a product. The notice does not apply to
diagram output such as exported images.

The viewer library bundles further open source code; its license comments inside `viewer-static.min.js` name
DOMPurify 3.4.18 (Apache-2.0 and MPL-2.0, Cure53 and contributors), pako 2.2.0 (MIT and Zlib), regenerator-runtime
(MIT, Facebook, Inc.) and spin.js 2.0.0 (MIT).

Our own code (`src/`, `media/`) loads these files only from the extension folder. It turns off every network
load the library could try (stencil downloads, web fonts, math typesetting, logging) and never changes the files.
