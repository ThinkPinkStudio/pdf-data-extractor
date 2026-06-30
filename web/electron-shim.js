// Shim di 'electron' per far girare il meccanismo Polizze lato server (Node).
// Stesso principio dello stub `canvas` già usato nel progetto: il codice del
// processo main importa `electron`, ma server-side non c'è — forniamo solo ciò
// che il grafo realmente usa: `app` (per il path di ita.traineddata in
// tessLangOptions) e `net` (netFetch usa il fetch di Node se net è assente).
const os = require('os')

const app = {
  isPackaged: false,
  getPath: () => os.tmpdir(),
  // tessLangOptions cerca ita.traineddata qui: imposta APP_ROOT alla cartella
  // che contiene ita.traineddata (es. la root del repo) per OCR 100% offline.
  getAppPath: () => process.env.APP_ROOT || process.cwd(),
}

module.exports = { app, net: undefined }
