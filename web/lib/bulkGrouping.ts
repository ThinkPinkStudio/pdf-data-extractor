// Raggruppamento in dossier di un elenco di percorsi relativi (cartella caricata via
// webkitdirectory). Usato lato client per decidere i confini di ciascun upload a
// chunk (un dossier = una richiesta) — nessuna dipendenza da Node/DB, importabile
// anche lato server se in futuro servisse rivalidare.

import { evaluatePath, NO_FILTERS, type PathFilters, type SkipReason } from './bulkExclusions'

export type GroupingMode = 'leaf' | 'firstLevel'

export interface GroupedDossier { dossierName: string; fileIndexes: number[] }
export interface SkippedPath { index: number; relPath: string; reason: SkipReason; matched?: string }
export interface GroupResult { root: string; dossiers: GroupedDossier[]; skipped: SkippedPath[] }

// mode 'leaf' (default, consigliata quando la profondità delle cartelle non è nota):
// la cartella immediata che contiene il PDF è la chiave del dossier, qualunque sia la
// profondità — due PDF nella stessa cartella finiscono sempre insieme, cartelle
// diverse sono sempre dossier diversi. Se i documenti di UNA polizza sono sparsi in
// sotto-sottocartelle diverse (es. "PolizzaX/Scansioni" e "PolizzaX/Condizioni"),
// questa euristica li separa: è un limite noto, non risolvibile senza sapere come è
// organizzata la cartella in anticipo.
// mode 'firstLevel': il secondo segmento del percorso (prima sottocartella sotto la
// radice) è la chiave, indipendentemente da quanto è annidato il file — adatto solo
// quando la struttura Cliente/Polizza è nota e uniforme.
// I PDF caricati sciolti direttamente nella radice (nessuna sottocartella) diventano
// ciascuno il proprio dossier, in entrambe le modalità.
export function groupPathsByDossier(relPaths: string[], mode: GroupingMode, filters: PathFilters = NO_FILTERS): GroupResult {
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
    } else if (mode === 'firstLevel') {
      dossierName = middle[0]
    } else {
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
