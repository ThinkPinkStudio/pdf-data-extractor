import log from 'electron-log/main'
import { dirname } from 'node:path'

// ─── Traccia persistente su disco (electron-log) ─────────────────────────────
//
// Scopo forense: lasciare su disco, con timestamp, una traccia di OGNI
// diagnostica approfondita e di OGNI fallimento reale di rete durante
// un'estrazione — anche se l'utente non apre mai la pagina di diagnostica.
// È la prova che l'app ha rilevato e segnalato il problema dell'ambiente.
//
// File: app.getPath('userData')/logs/main.log (default electron-log), con
// rotazione automatica per dimensione.

let initialized = false

export function initDiagLogger() {
  if (initialized) return
  try {
    log.initialize()
    log.transports.file.maxSize = 5 * 1024 * 1024 // 5 MB, poi ruota in main.old.log
    log.transports.file.level = 'info'
    initialized = true
  } catch {
    // Non bloccare mai l'avvio dell'app per un problema di logging.
  }
}

// Snapshot completo di una diagnostica approfondita.
export function logDiagnostics(record) {
  try { log.info('[deep-diagnostics]', JSON.stringify(record)) } catch { /* noop */ }
}

// Fallimento di rete reale durante un'estrazione (auto-cattura).
export function logLlmFailure(record) {
  try { log.warn('[llm-network-failure]', JSON.stringify(record)) } catch { /* noop */ }
}

// Cartella dei log, per "Apri cartella log".
export function getLogDir() {
  try { return dirname(log.transports.file.getFile().path) } catch { return null }
}
