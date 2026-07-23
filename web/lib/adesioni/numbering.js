/**
 * Numerazione progressiva dell'IDENTIFICATIVO UNIVOCO (modulo PURO, testabile in
 * Node — nessun import Electron).
 *
 * Regola: il prossimo identificativo si ottiene incrementando il blocco di cifre
 * FINALE, preservando il prefisso e l'ampiezza dello zero-padding. L'ampiezza si
 * allarga solo se il numero trabocca:
 *   W0000001 → W0000002 · S013 → S014 · S099 → S100 · 999 → 1000
 * Se il valore non termina con cifre, viene restituito invariato (caso di guardia).
 */

/**
 * @param {string} value identificativo corrente (es. "W0000001")
 * @returns {string} identificativo successivo, o il valore invariato se non
 *                   termina con un blocco di cifre.
 */
export function nextIdentificativo(value) {
  const s = String(value == null ? '' : value)
  const m = s.match(/^(.*?)(\d+)(\D*)$/)
  if (!m) return s
  const [, prefix, digits, suffix] = m
  const width = digits.length
  const incremented = String(BigInt(digits) + 1n)
  const padded = incremented.padStart(width, '0')
  return `${prefix}${padded}${suffix}`
}

/**
 * Calcola il prossimo valore suggerito DOPO un salvataggio.
 * Regola: la numerazione avanza SOLO se l'operatore ha accettato il valore
 * suggerito (`accepted === current`). Se ha cambiato il numero (override) o non
 * c'era alcun suggerimento attivo, il suggerimento resta invariato.
 *
 * @param {string} current valore attualmente suggerito ('' = nessuna serie)
 * @param {string} accepted identificativo effettivamente salvato
 * @returns {string} nuovo valore suggerito
 */
export function advanceIfAccepted(current, accepted) {
  const cur = String(current == null ? '' : current)
  if (cur && String(accepted) === cur) return nextIdentificativo(cur)
  return cur
}
