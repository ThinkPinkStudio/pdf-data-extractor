// Nomi di cartelle/file sempre esclusi dall'enumerazione bulk (spazzatura di sistema),
// più una lista aggiuntiva configurabile dall'utente (Impostazioni → bulkExcludedFolderNames).
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
