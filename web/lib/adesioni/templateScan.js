/**
 * Analisi PURA dei segnaposto in un template HTML del modulo (testabile in Node).
 *
 * Un segnaposto ha la forma `{{nome}}` (stessa regex usata dal riempimento in
 * moduloFill.js). L'inventario dei segnaposto di un template serve a vincolare
 * i "Segnaposto modulo" dei CAMPI DELLA MASCHERA: sono ammessi solo i nomi
 * effettivamente presenti nel template attivo.
 */

// Segnaposto SEMPRE valorizzati automaticamente da recordMapper.buildDocxData,
// indipendentemente dai campi della maschera: non vanno segnalati come mancanti.
export const AUTO_PLACEHOLDERS = ['cognome_nome', 'premio', 'pacchetto']

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g

/** Estrae l'elenco (unico, in ordine di prima comparsa) dei segnaposto da un testo. */
export function scanPlaceholders(text) {
  const out = []
  const seen = new Set()
  let m
  PLACEHOLDER_RE.lastIndex = 0
  while ((m = PLACEHOLDER_RE.exec(String(text || ''))) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]) }
  }
  return out
}

/** Unione ordinata dei segnaposto trovati in più testi. */
export function mergePlaceholders(texts) {
  const out = []
  const seen = new Set()
  for (const t of texts || []) {
    for (const name of scanPlaceholders(t)) {
      if (!seen.has(name)) { seen.add(name); out.push(name) }
    }
  }
  return out
}

/**
 * Classifica il "Segnaposto modulo" (`docx`) di un campo rispetto all'inventario
 * del template attivo:
 *   - 'unset'    : nessun segnaposto assegnato (campo non ancora posizionato)
 *   - 'ok'       : il segnaposto esiste nel template (o è uno automatico)
 *   - 'mismatch' : il segnaposto NON esiste nel template → da correggere
 * Con inventario assente (nessun template/placeholder) tutto è 'ok' (nessun vincolo).
 */
export function classifyFieldDocx(docx, placeholders) {
  const name = String(docx || '').trim()
  if (!name) return 'unset'
  if (!Array.isArray(placeholders) || placeholders.length === 0) return 'ok'
  if (AUTO_PLACEHOLDERS.includes(name)) return 'ok'
  return placeholders.includes(name) ? 'ok' : 'mismatch'
}

/** Segnaposto del template non ancora coperti da alcun campo (né automatici). */
export function unmappedPlaceholders(placeholders, fields) {
  const used = new Set((fields || []).map((f) => String(f.docx || '').trim()).filter(Boolean))
  return (placeholders || []).filter((p) => !AUTO_PLACEHOLDERS.includes(p) && !used.has(p))
}
