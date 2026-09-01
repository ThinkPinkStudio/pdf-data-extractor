import { join, isAbsolute } from 'path'
import { pathToFileURL } from 'url'
import { existsSync } from 'fs'

// ─── Caricatore dei servizi condivisi (src/services) ─────────────────────────
//
// I servizi condivisi vivono FUORI da web/ (in ../src/services) e usano sintassi
// ESM + bare-import (pdf-parse, exceljs, tesseract.js…). Per caricarli in modo
// affidabile sia in dev sia nel container standalone:
//
//   1. risolviamo una cartella ASSOLUTA dei servizi (niente path relativo al
//      chunk webpack, che in standalone punterebbe alla cartella sbagliata);
//   2. importiamo via URL file:// con `webpackIgnore`, così è Node a risolvere a
//      runtime il file reale e i suoi bare-import dalla node_modules raggiungibile
//      (in container: symlink /app/node_modules → /app/web/node_modules). Vedi
//      web/Dockerfile.
//
// Override esplicito possibile con SHARED_SERVICES_DIR.

function servicesDir(): string {
  const env = process.env.SHARED_SERVICES_DIR
  if (env && existsSync(env)) return env

  const candidates = [
    join(process.cwd(), '..', 'src', 'services'), // dev: web/→repo; container: /app/web→/app
    join(process.cwd(), 'src', 'services'),
    '/app/src/services',
  ]
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }
  // Ultima spiaggia: il primo candidato (errore esplicito a runtime se assente).
  return candidates[0]
}

const cache = new Map<string, Promise<Record<string, unknown>>>()

/**
 * Importa un modulo dei servizi condivisi per nome file (es. 'polizzaService.js').
 * Restituisce il namespace del modulo. Risultato memoizzato per file.
 */
export function importSharedService<T = Record<string, unknown>>(file: string): Promise<T> {
  if (!cache.has(file)) {
    const abs = isAbsolute(file) ? file : join(servicesDir(), file)
    const url = pathToFileURL(abs).href
    cache.set(file, import(/* webpackIgnore: true */ url))
  }
  return cache.get(file) as Promise<T>
}