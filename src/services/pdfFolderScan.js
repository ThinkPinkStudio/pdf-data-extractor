/**
 * Enumerazione ricorsiva dei PDF di una cartella (per "Seleziona cartella"
 * nelle pagine Polizze e Batch). Modulo Node puro, senza dipendenze Electron,
 * così è testabile in isolamento.
 */
import { readdirSync } from 'fs'
import { join } from 'path'

/**
 * Elenca ricorsivamente i file .pdf (case-insensitive) sotto `dir`.
 * Salta le cartelle nascoste (prefisso '.') e non segue i link simbolici,
 * per non finire in loop o fuori dall'albero scelto dall'utente.
 *
 * @param {string} dir
 * @param {{ maxFiles?: number }} [opts]
 * @returns {{ paths: string[], truncated: boolean }} percorsi ordinati alfabeticamente
 */
export function listPdfFilesRecursive(dir, { maxFiles = 2000 } = {}) {
  const paths = []
  let truncated = false

  const walk = (current) => {
    if (truncated) return
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return // cartella non leggibile (permessi, rimossa nel frattempo): si salta
    }
    // Ordine deterministico indipendente dal filesystem
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        walk(full)
        if (truncated) return
      } else if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
        if (paths.length >= maxFiles) { truncated = true; return }
        paths.push(full)
      }
    }
  }

  walk(dir)
  paths.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  return { paths, truncated }
}
