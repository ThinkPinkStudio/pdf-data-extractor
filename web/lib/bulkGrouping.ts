// Raggruppamento in dossier di un elenco di percorsi relativi (cartella caricata via
// webkitdirectory). Usato lato client per proporre i confini dei dossier; l'utente
// poi RIVEDE l'elenco, esclude a mano le cartelle che non vuole e può UNIRE più
// cartelle in un unico dossier (la fusione è stato della UI, non di questa funzione).
// Nessuna dipendenza da Node/DB, importabile anche lato server se servisse rivalidare.

import { evaluatePath, NO_FILTERS, type PathFilters, type SkipReason } from './bulkExclusions'

export interface GroupedDossier { dossierName: string; fileIndexes: number[] }
export interface SkippedPath { index: number; relPath: string; reason: SkipReason; matched?: string }
export interface GroupResult { root: string; dossiers: GroupedDossier[]; skipped: SkippedPath[] }

// Rilevamento "a foglia", A QUALSIASI PROFONDITÀ: la chiave di ogni dossier è il
// PERCORSO-CARTELLA COMPLETO che contiene direttamente il PDF (tutti i segmenti tra
// la radice e il file). Non si assume nessun livello fisso: due PDF nella stessa
// cartella finiscono insieme, cartelle diverse restano dossier diversi — che siano a
// 1 o a 10 livelli di profondità. Se i documenti di UNA polizza sono sparsi in
// sotto-sottocartelle diverse (es. "PolizzaX/Scansioni" e "PolizzaX/Condizioni"),
// questa euristica li propone separati: l'utente li RICOMPONE con l'unione manuale
// nell'elenco (nessun euristica può indovinare il confine, che varia da ramo a ramo).
// I PDF caricati sciolti nella radice (nessuna sottocartella) diventano ciascuno il
// proprio dossier.
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
    const middle = segments.slice(1, -1) // cartelle tra radice e file; vuoto = file sciolto in radice

    let dossierName: string
    if (middle.length === 0) {
      looseCounter++
      dossierName = `__loose__${looseCounter}__${segments[segments.length - 1]}`
    } else {
      // Percorso-cartella completo relativo alla radice: distingue i dossier a
      // qualunque profondità, senza fermarsi a un livello prefissato.
      dossierName = middle.join('/')
    }

    if (!indexByDossier.has(dossierName)) { indexByDossier.set(dossierName, []); order.push(dossierName) }
    indexByDossier.get(dossierName)!.push(i)
  })

  return { root, dossiers: order.map((name) => ({ dossierName: name, fileIndexes: indexByDossier.get(name) || [] })), skipped }
}

// Nome leggibile per l'interfaccia: per i file sciolti mostra solo il nome del file,
// altrimenti il percorso-cartella completo relativo alla radice.
export function displayDossierName(dossierName: string, root: string): string {
  if (dossierName.startsWith('__loose__')) {
    const parts = dossierName.split('__')
    return parts[parts.length - 1]
  }
  return `${root}/${dossierName}`
}
