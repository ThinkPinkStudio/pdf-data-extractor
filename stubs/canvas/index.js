// Stub: pdfjs-dist lists `canvas` as an optional dep for Node.js canvas rendering.
// This Electron app uses the browser's built-in Canvas API, so the native
// canvas npm package is not needed. Replacing it with this stub prevents
// electron-builder from trying to compile GTK-dependent native code on CI.
module.exports = {};
