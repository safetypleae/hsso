# QR encoder

Vendored `qrcode-generator` 1.4.4 by Kazuhiko Arase (MIT).
Source: https://github.com/kazuhikoarase/qrcode-generator
Package: https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js

Only modification: appended `export default qrcode` for local ES-module loading.
Loaded on demand by `assets/risk/qr.js`; no external QR requests or runtime CDN.
See `LICENSE-qrcode-generator.txt`.

The independent test-only decoder is jsQR 1.4.0 (Apache-2.0), from
https://github.com/cozmo/jsQR and
https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js.
It lives in `tests/helpers/vendor/jsqr.cjs` with its license, and is never loaded by the application.
