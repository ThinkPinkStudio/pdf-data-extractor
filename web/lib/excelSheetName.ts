// Nomi di foglio validi per Excel: max 31 caratteri, senza \ / ? * [ ] :,
// senza apostrofo in testa/coda, mai «History» (riservato), unici senza
// distinzione di maiuscole. Un nome fuori regola faceva fallire l'export.
// Estratto dall'export del batch (26/09/2026) per usarlo anche nei riepiloghi:
// una sola regola, nessuna dipendenza (si testa da solo).

/** Nomi già usati in un workbook (minuscoli); «history» è riservato da Excel. */
export function reservedSheetNames(...names: string[]): Set<string> {
  return new Set(['history', ...names.map((n) => n.toLowerCase())])
}

/**
 * Nome di foglio sanificato e unico: toglie i caratteri vietati, tronca a 28
 * caratteri e, se il nome è già in `used`, aggiunge « 2», « 3»… (il risultato
 * resta entro 31). Registra il nome scelto in `used`.
 */
export function excelSheetName(raw: string, used: Set<string>, fallback = 'Foglio'): string {
  let title = String(raw ?? '').replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 28) || fallback
  let n = 2
  while (used.has(title.toLowerCase())) title = `${title.slice(0, 25).replace(/'+$/g, '')} ${n++}`
  used.add(title.toLowerCase())
  return title
}
