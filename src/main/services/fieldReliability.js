/**
 * Punteggio di affidabilità per campo — parte PURA, calcolato a-posteriori
 * dai dati già presenti sui candidati (evidenza, checksum, affinità, fatti,
 * recency). Nessuna chiamata LLM.
 *
 * `reliable` ∈ [0, 1]; `verified` elenca i tipi di verifica che hanno
 * contribuito. Usato per: flag in UI, pass selettivo del batch, diagnostica.
 */

import { parsePureAmount, validateCodiceFiscaleIva } from './polizzaValidation.js'
import { normalizeDateValue } from './polizzaDates.js'

export const ENGINE_REVISION = 4

export const LOW_RELIABILITY = 0.45

export function fieldHasChecksum(field, value) {
  if (value == null || value === '') return false
  const blob = `${field?.id || ''} ${field?.label || ''}`
  if (/fiscale|iva|\bcf\b/i.test(blob) || field?.id === 'codice_fiscale_iva') {
    return !!validateCodiceFiscaleIva(value)
  }
  return false
}

/**
 * @param {object} cand   candidato vincente { valore, affinity, file, page, effDate, lex }
 * @param {object} field  definizione campo
 * @param {object} [opts]
 * @param {boolean} [opts.factsHit]
 * @param {boolean} [opts.multiDoc]
 * @param {boolean} [opts.doublePassOk]
 * @param {boolean} [opts.evidence]
 * @returns {{ reliable: number, verified: string[] }}
 */
export function scoreFieldReliability(cand, field, opts = {}) {
  const verified = []
  let score = 0
  if (!cand || cand.valore == null || String(cand.valore).trim() === '') {
    return { reliable: 0, verified }
  }

  if (opts.evidence !== false && (cand.file || opts.evidence)) {
    score += 0.25
    verified.push('evidenza')
  }
  if (fieldHasChecksum(field, cand.valore)) {
    score += 0.25
    verified.push('checksum')
  } else if (parsePureAmount(cand.valore) != null || normalizeDateValue(cand.valore)) {
    // Importo/data ancorati al testo: mezzo punto (non è un checksum vero)
    score += 0.1
    verified.push('formato')
  }
  if (typeof cand.affinity === 'number' && cand.affinity >= 0.45) {
    score += 0.2
    verified.push('affinita')
  } else if (typeof cand.affinity === 'number' && cand.affinity >= 0.25) {
    score += 0.1
  }
  if (opts.factsHit) {
    score += 0.15
    verified.push('fatto')
  }
  if (opts.multiDoc) {
    score += 0.1
    verified.push('piu_doc')
  }
  if (cand.effDate) {
    score += 0.1
    verified.push('recency')
  }
  if (opts.doublePassOk) {
    score += 0.15
    verified.push('doppia-passata')
  }
  return { reliable: Math.min(1, Math.round(score * 100) / 100), verified }
}

/** Hash stabile delle impostazioni che influenzano l'estrazione (skip no-op). */
export function extractFingerprint({ fieldDefs, promptExtra, settingsOverride, revision = ENGINE_REVISION } = {}) {
  const fields = (fieldDefs || []).map((f) => `${f.id}|${f.label}|${f.description || ''}|${f.enabled !== false ? 1 : 0}`).join(';')
  const ov = settingsOverride && typeof settingsOverride === 'object' ? settingsOverride : {}
  const keys = ['ollamaModel', 'polizzaWholeDossierModel', 'polizzaStagedCascade', 'polizzaPerField', 'polizzaConstrainedJson']
  const ovPart = keys.map((k) => `${k}=${ov[k] === undefined ? '' : String(ov[k])}`).join(',')
  const raw = `${revision}\n${fields}\n${promptExtra || ''}\n${ovPart}`
  // FNV-1a 32-bit: deterministico, niente crypto (il modulo deve restare puro)
  let h = 0x811c9dc5
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}
