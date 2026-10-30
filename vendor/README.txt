Vendored code, copied so the server needs no npm install.

qrcode/      node-qrcode 1.5.4 (MIT, Ryan Day): lib/core and the SVG renderer only.
             One line changed in core/segments.js so it loads the vendored dijkstrajs.
dijkstrajs/  dijkstrajs 1.0.3 (MIT), used by node-qrcode to pick the shortest encoding.
