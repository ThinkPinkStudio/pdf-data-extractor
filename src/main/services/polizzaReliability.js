/**
 * Punteggio di affidabilità per campo/scelta ("credenza") — modulo PURO.
 *
 * Rama di FEATURE F: esporre al termine dell'estrazione, per ogni campo,
 *   { valore, reliable: 0..1, tipoDiVerifica: ['evidenza','checksum','piu_doc','recency'] }
 *
 * Calcolato A-POSTERIORI sui dati GIÀ presenti nei candidati `best[k]`/`sources`
 * (nessuna nuova chiamata LLM, nessun provider). Tutto deterministico.
 *
 * Documenti TUTTI UGUALI: il punteggio NON assegna alcuna priorità al tipo
 * documento. La recency/docPos/appendixOrd entrano SOLO come segnale di supporto
 * (quando il candidato è datato), mai come "il tipo vince".
 *
 * Questo modulo è puro (nessun import Electron / pdfjs / provider LLM): importabile
 * e testabile in Node (vedi test/polizzaReliability.test.mjs). Dipende solo da
 * polizzaValidation.js (a sua volta puro).
 */

import { isPlaceholderValue, validateCodiceFiscaleIva } from './polizzaValidation.js'

const WEIGHTS = {
  evidence: 0.3,   // sorgente localizzata (file + pagina) → tag 'evidenza'
  checksum: 0.4,   // campo verificato-to-pass col checksum → tag 'checksum'
  recency: 0.2,    // candidato datato → tag 'recency'
  piuDoc: 0.2,     // stesso valore visto in ≥2 documenti → tag 'piu_doc'
  affinity: 0.2, // affinità CONSEGNATA dal candidato (embedding/lessicale) → tag 'affinity'
}

/** Soglia sotto la quale un campo è segnalato come "sotto soglia" nella diagnostica. */
export const RELIABILITY_THRESHOLD = 0.5

function rond(v) {
  return Math.round(v * 100) / 100
}

/**
 * Affidabilità di un singolo candidato di campo, a-posteriori e deterministica.
 *
 * @param {object} args
 * @param {string} args.id              id del campo
 * @param {object|null} args.candidate candidato VINCENTE { valore, file, page, effDate, affinità, … } o null
 * @param {object} [args.source]       entry di `sources[id]` (file/page)
 * @param {object} [args.field]        definizione del campo (per rilevare P.IVA/CF)
 * @param {{checksum?: boolean}} [args.verifiedBy] segnali di verifica già applicati dal chiamante
 * @param {number} [args.seenCount]    quanti documenti distinti contengono il valore (≥2 → 'piu_doc')
 * @param {boolean} [args.recent]      true se il candidato è da ritenere recente/datato
 * @returns {{ reliable: number, tipoDiVerifica: string[] }}
 */
export function computeFieldReliability({ id, candidate, source, field, verifiedBy, seenCount, recent }) {
  if (!candidate || candidate.valore == null || String(candidate.valore).trim() === '') {
    return { reliable: 0, tipoDiVerifica: [] }
  }
  if (isPlaceholderValue(candidate.valore)) {
    return { reliable: 0, tipoDiVerifica: [] } // "meglio vuoto che sbagliato"
  }

  let reliable = 0
  const tags = []

  // Evidenza: sorgente localizzata a file+pagina (metadati del candidato, con
  // fallback sull'entry `source`).
  const candHasPage = Boolean(candidate.file) && Boolean(candidate.page && candidate.page !== '')
  const srcHasPage = Boolean(source && source.file) && Boolean(source && source.page && source.page !== '')
  if (candHasPage || srcHasPage) {
    reliable += WEIGHTS.evidence
    tags.push('evidenza')
  }

  // Checksum: verifica-fino-a-passare (es. P.IVA/CF col carattere di controllo).
  // Il flag arriva dal chiamante; in più, se il campo è manifestamente una
  // P.IVA/CF lo risolviamo anche qui (difensivo, senza ripetere il chiamante).
  let checksum = Boolean(verifiedBy && verifiedBy.checksum)
  if (!checksum) {
    const blob = `${id || ''} ${field?.label || ''} ${field?.description || ''}`
    const isIVA = /iva|c\s*\.?\s*f\s*\.?|fiscale|p\s*\.?\s*i\s*\.?\s*v\s*\.?/i.test(blob)
    if (isIVA && validateCodiceFiscaleIva(candidate.valore)) checksum = true
  }
  if (checksum) {
    reliable += WEIGHTS.checksum
    tags.push('checksum')
  }

  // Recency: candidato datato (effDate non-null) → dato "fresco" = più robusto.
  // MAI una priorità per tipo documento: è solo evidenza di supporto.
  const dateRecente = candidate.effDate != null && candidate.effDate !== ''
  if (recent === true || (recent !== false && dateRecente)) {
    reliable += WEIGHTS.recency
    tags.push('recency')
  }

  // Piu_doc: lo stesso valore visto in ≥2 documenti distinti (conteggio dato dal
  // chiamante). Dato reale, mai conteggi inventati.
  if (typeof seenCount === 'number' && seenCount >= 2) {
    reliable += WEIGHTS.piuDoc
    tags.push('piu_doc')
  }

  // Affinità CONSEGNATA dal candidato (embedding/fallback lessicale già calcolata
  // dal motore a stadi). Segnale positivo ma blando.
  if (typeof candidate.affinity === 'number') {
    reliable += WEIGHTS.affinity
    tags.push('affinity')
  }

  return { reliable: rond(Math.min(1, Math.max(0, reliable))), tipoDiVerifica: tags }
}

/**
 * Mappa affidabilità per tutti i campi valorizzati in `best`.
 *
 * @param {Record<string, object>} best        id → candidato vincente
 * @param {Record<string, object>} fieldsById id → definizione campo attiva
 * @param {{ checksumsById?: Record<string, boolean>, seenCountsById?: Record<string, number> }} [opts]
 * @returns {Record<string, { reliable: number, tipoDiVerifica: string[] }>} con reliable arrotondato a 2 decimali
 */
export function buildReliabilityMap(best, fieldsById = {}, opts = {}) {
  const out = {}
  const { checksumsById = {}, seenCountsById = {} } = opts
  for (const [id, candidate] of Object.entries(best || {})) {
    if (!candidate) continue
    const res = computeFieldReliability({
      id,
      candidate,
      field: fieldsById[id],
      verifiedBy: { checksum: checksumsById[id] === true },
      seenCount: seenCountsById[id],
    })
    out[id] = { reliable: rond(res.reliable), tipoDiVerifica: res.tipoDiVerifica }
  }
  return out
}