// Filtri di enumerazione per il bulk (cartella intera di polizze):
//  1. spazzatura di sistema, sempre esclusa (baseline hardcoded);
//  2. nomi ESATTI di cartelle/file esclusi dall'utente (Impostazioni → bulkExcludedFolderNames);
//  3. parole che, se compaiono in un punto qualsiasi del PERCORSO, scartano il file;
//  4. parole che il percorso deve contenere perché il file sia accettato (se la lista è vuota
//     si accetta tutto).
// Usato sia lato client (riepilogo pre-upload) sia lato server (fonte di verità reale),
// nessuna dipendenza da Node/DB così è importabile da entrambi.

const BASELINE_NAMES = new Set([
  '.git', '.svn', '.hg', '.DS_Store', 'Thumbs.db', 'desktop.ini',
  '$RECYCLE.BIN', 'node_modules', '__MACOSX',
])

function isJunkSegment(segment: string): boolean {
  if (BASELINE_NAMES.has(segment)) return true
  if (segment.startsWith('.')) return true // cartelle/file nascosti
  if (segment.startsWith('~$')) return true // lock file di Office
  return false
}

export function parseExclusionList(csv: string | undefined | null): Set<string> {
  if (!csv) return new Set()
  return new Set(csv.split(',').map((s) => s.trim()).filter(Boolean))
}

// true se un qualsiasi segmento del percorso relativo (cartella o file) è da escludere.
export function isExcludedPath(relPath: string, extra: Set<string> = new Set()): boolean {
  const segments = relPath.split('/').filter(Boolean)
  return segments.some((seg) => isJunkSegment(seg) || extra.has(seg))
}

/**
 * Parole chiave scritte dall'utente. Separatori: virgola, punto e virgola, a capo.
 * Il confronto è sempre case-insensitive, quindi si normalizza in minuscolo;
 * spazi superflui e duplicati vengono rimossi.
 */
export function parseKeywords(text: string | undefined | null): string[] {
  if (!text) return []
  const out: string[] = []
  for (const raw of text.split(/[,;\n\r]/)) {
    const w = raw.trim().toLowerCase()
    if (w && !out.includes(w)) out.push(w)
  }
  return out
}

export interface PathFilters {
  /** Nomi esatti di cartelle/file da escludere (Impostazioni). */
  excludedNames: Set<string>
  /** Se non vuota: il percorso deve contenere almeno una di queste parole. */
  includeWords: string[]
  /** Se una di queste parole compare nel percorso, il file viene scartato. */
  excludeWords: string[]
  /** Parole di ABBINAMENTO del profilo "da evitare": scarto con reason dedicata. */
  profileExcludeWords: string[]
}

export const NO_FILTERS: PathFilters = { excludedNames: new Set(), includeWords: [], excludeWords: [], profileExcludeWords: [] }

export function makeFilters(opts: Partial<PathFilters> = {}): PathFilters {
  return {
    excludedNames: opts.excludedNames ?? new Set(),
    includeWords: opts.includeWords ?? [],
    excludeWords: opts.excludeWords ?? [],
    profileExcludeWords: opts.profileExcludeWords ?? [],
  }
}

export type SkipReason = 'notPdf' | 'excludedName' | 'excludeWord' | 'includeWord' | 'profileExcludeWord'

export interface PathVerdict {
  kept: boolean
  reason?: SkipReason
  /** Parola che ha deciso l'esito, per spiegare lo scarto all'utente. */
  matched?: string
}

/**
 * Decide se un percorso relativo (cartelle + nome file) va elaborato.
 * Le parole di 3 e 4 sono cercate come SOTTOSTRINGA sull'intero percorso, non sui
 * singoli segmenti: così "bozz" scarta sia la cartella "Bozze" sia il file
 * "polizza_bozza.pdf", e "2025" tiene tutto ciò che sta sotto una cartella "2025".
 * Ordine: estensione → nomi esclusi (spazzatura + Impostazioni) → parole da scartare
 * → parole da accettare. Lo scarto vince sempre sull'accettazione.
 */
export function evaluatePath(relPath: string, filters: PathFilters = NO_FILTERS): PathVerdict {
  const path = relPath.replace(/\\/g, '/').toLowerCase()
  if (!path.endsWith('.pdf')) return { kept: false, reason: 'notPdf' }
  if (isExcludedPath(relPath, filters.excludedNames)) return { kept: false, reason: 'excludedName' }

  const bad = filters.excludeWords.find((w) => path.includes(w))
  if (bad) return { kept: false, reason: 'excludeWord', matched: bad }

  const badProfile = filters.profileExcludeWords.find((w) => path.includes(w))
  if (badProfile) return { kept: false, reason: 'profileExcludeWord', matched: badProfile }

  if (filters.includeWords.length > 0) {
    const good = filters.includeWords.find((w) => path.includes(w))
    if (!good) return { kept: false, reason: 'includeWord' }
    return { kept: true, matched: good }
  }

  return { kept: true }
}
