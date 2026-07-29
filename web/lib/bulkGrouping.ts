// Raggruppamento in dossier di un elenco di percorsi relativi (cartella caricata via
// webkitdirectory). Usato lato client per proporre i confini dei dossier; l'utente
// poi RIVEDE l'elenco, esclude a mano le cartelle che non vuole e può UNIRE più
// cartelle in un unico dossier (la fusione è stato della UI, non di questa funzione).
// Nessuna dipendenza da Node/DB, importabile anche lato server se servisse rivalidare.

import { evaluatePath, NO_FILTERS, type PathFilters, type SkipReason } from './bulkExclusions'

export interface GroupedDossier { dossierName: string; fileIndexes: number[] }
export interface SkippedPath { index: number; relPath: string; reason: SkipReason; matched?: string }
export interface GroupResult { root: string; dossiers: GroupedDossier[]; skipped: SkippedPath[] }

// Rilevamento "per cartella", A QUALSIASI PROFONDITÀ: la chiave di ogni dossier è il
// PERCORSO DELLA CARTELLA che contiene direttamente il PDF — RADICE INCLUSA. Regola:
// una cartella = una polizza. Tutti i PDF sciolti dentro la cartella selezionata
// finiscono in UN unico dossier (la radice), non uno per file; una sottocartella è
// una cartella diversa quindi un dossier diverso, a 1 o a 10 livelli di profondità.
// Se i documenti di UNA polizza sono sparsi in cartelle diverse (es. "Pol/Scansioni"
// e "Pol/Condizioni"), vengono proposti separati: l'utente li RICOMPONE con l'unione
// manuale (nessuna euristica può indovinare il confine, che varia da ramo a ramo).
// Solo i file davvero senza cartella (drag di singoli file, relPath senza "/")
// diventano un dossier a testa.
export function groupPathsByDossier(relPaths: string[], filters: PathFilters = NO_FILTERS): GroupResult {
  let root = ''
  const order: string[] = []
  const indexByDossier = new Map<string, number[]>()
  const skipped: SkippedPath[] = []
  let looseCounter = 0

  relPaths.forEach((relPath, i) => {
    const verdict = evaluatePath(relPath, filters)
    if (!verdict.kept) {
      // La radice va comunque ricavata anche se il primo file è scartato,
      // altrimenti l'etichetta della cartella resterebbe vuota.
      const first = relPath.split('/').filter(Boolean)[0]
      if (!root && first) root = first
      skipped.push({ index: i, relPath, reason: verdict.reason!, matched: verdict.matched })
      return
    }
    const segments = relPath.split('/').filter(Boolean)
    if (!root && segments.length) root = segments[0]
    // Cartella che contiene il file, dalla radice compresa (tutti i segmenti tranne il
    // nome file). Vuoto solo se il file non ha alcuna cartella (drag di singoli file).
    const dir = segments.slice(0, -1).join('/')

    let dossierName: string
    if (dir === '') {
      looseCounter++
      dossierName = `__loose__${looseCounter}__${segments[segments.length - 1]}`
    } else {
      dossierName = dir
    }

    if (!indexByDossier.has(dossierName)) { indexByDossier.set(dossierName, []); order.push(dossierName) }
    indexByDossier.get(dossierName)!.push(i)
  })

  return { root, dossiers: order.map((name) => ({ dossierName: name, fileIndexes: indexByDossier.get(name) || [] })), skipped }
}

// Nome leggibile per l'interfaccia: per i file davvero sciolti mostra solo il nome del
// file, altrimenti il percorso-cartella (già completo dalla radice).
export function displayDossierName(dossierName: string, _root?: string): string {
  if (dossierName.startsWith('__loose__')) {
    const parts = dossierName.split('__')
    return parts[parts.length - 1]
  }
  return dossierName
}
