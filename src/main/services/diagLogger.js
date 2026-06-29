import log from 'electron-log/main'
import { app } from 'electron'
import { dirname, join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'

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

// Traccia di una singola estrazione polizza (passi + esito), sempre su main.log.
// Così, anche se al cliente "non succede nulla", su disco resta il perché.
export function logPolizzaRun(text) {
  try { log.info('[polizza-run]\n' + (text || '')) } catch { /* noop */ }
}

// Scrive un file di log DEDICATO a una singola pratica e ne ritorna il percorso,
// così il cliente può allegarlo a una mail. Non solleva mai: se fallisce torna null.
export function writePolizzaRunFile(text) {
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const file = join(dir, `polizza-run-${ts}.log`)
    writeFileSync(file, text || '', 'utf-8')
    return file
  } catch { return null }
}
