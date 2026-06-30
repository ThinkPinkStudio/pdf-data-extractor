// ─── Shim "electron" per l'app web ───────────────────────────────────────────
//
// I servizi condivisi in src/main/services/*.js fanno `import { app } from
// 'electron'` a livello di modulo. Nell'app web (Next.js, lato server) non esiste
// un runtime Electron, ma quei moduli servono comunque per estrazione, OCR,
// Excel, ecc. Questo pacchetto viene risolto come `electron` (via
// "electron": "file:shims/electron" in web/package.json) ed espone la superficie
// MINIMA realmente usata dai servizi quando girano fuori da Electron.
//
// Punti d'uso reali coperti:
//   • app.getAppPath() / app.isPackaged  → polizzaService.tessLangOptions()
//     (per trovare ita.traineddata e fare OCR offline)
//   • net.fetch                          → netFetch.resilientFetch() (fallback)
// Tutto il resto è uno stub inerte per non rompere eventuali import.

import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Cerca la cartella che contiene ita.traineddata (per l'OCR Tesseract offline).
// Candidati: variabile d'ambiente esplicita, cwd del processo, e la root del repo
// risalendo da web/shims/electron. Se non la trova, ripiega su cwd (Tesseract
// userà la CDN, comportamento di default non peggiore).
function resolveAppPath() {
  const candidates = [
    process.env.TESSERACT_DATA_DIR,
    process.cwd(),
    join(process.cwd(), '..'),
    join(__dirname, '..', '..', '..'),       // web/shims/electron → repo root
    join(__dirname, '..', '..', '..', '..'),  // /app/web/... → /app
  ].filter(Boolean)
  for (const dir of candidates) {
    try {
      if (existsSync(join(dir, 'ita.traineddata'))) return dir
    } catch { /* ignora */ }
  }
  return process.cwd()
}

const APP_PATH = resolveAppPath()

export const app = {
  isPackaged: false,
  getAppPath: () => APP_PATH,
  getPath: () => tmpdir(),
  getVersion: () => process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0',
  getName: () => 'pdf-data-extractor-web',
  on: () => {},
  whenReady: () => Promise.resolve(),
  quit: () => {},
}

// net.fetch: nell'app web il fallback "stack di rete di Chromium" non esiste,
// ma netFetch.js lo invoca solo dopo un errore di rete/TLS e protegge con
// `typeof net.fetch === 'function'`. Deleghiamo al fetch globale: innocuo.
export const net = {
  fetch: (...args) => globalThis.fetch(...args),
}

// Stub inerti per il resto della superficie Electron (non usati lato web).
export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
}
export const shell = {
  openExternal: async () => {},
  openPath: async () => '',
  showItemInFolder: () => {},
}
export const ipcMain = { handle: () => {}, on: () => {}, removeHandler: () => {} }
export const ipcRenderer = { invoke: async () => undefined, on: () => {}, send: () => {} }
export class BrowserWindow {}
export class Notification { show() {} }
export const nativeImage = { createFromPath: () => ({}) }
export const contextBridge = { exposeInMainWorld: () => {} }
export const Menu = { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) }
export const screen = {}
export const session = {}
export const protocol = {}
export const globalShortcut = { register: () => {}, unregisterAll: () => {} }

export default {
  app, net, dialog, shell, ipcMain, ipcRenderer,
  BrowserWindow, Notification, nativeImage, contextBridge,
  Menu, screen, session, protocol, globalShortcut,
}
