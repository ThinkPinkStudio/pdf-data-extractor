/**
 * Auto-validazione "zero-shot" dei candidati testuali/incerti (FEATURE B) — modulo PURO.
 *
 * Una SECONDA chiamata LLM compatta (poche decine di token) che riceve SOLO
 * `{ campo, valore_candidato, evidenza, coppia_etichettata }` e risponde
 * `{"ok": true|false, "motivo": "..."}` su dove il valore è DUBBIO (riducibile)
 * o manifestamente fuori luogo. Serve a recuperare precision per i campi TESTUALI
 * SENZA checksum, dove l'arbitro semantico/recency da solo è cieco.
 *
 * Sempre dietro flag (`settings.polizzaAutoVerify === true`): disattivato
 * (assente/`undefined`/false) NON si fa NESSUNA chiamata. Regola ferrea: un
 * fallimento o un parse fallito → CONSERVA (mai bloccare per un errore del
 * guard rail, come il pre-check).
 *
 * Modulo puro: nessun import Electron / pdfjs / provider LLM. La chiamata LLM è
 * INIETTATA (parametro `callModel`) → testabile con uno stub in Node.
 */

import { RELIABILITY_THRESHOLD } from './polizzaReliability.js'

/** Numero massimo di campi ricontrollati per run (le più dubbie prima). */
export const DEFAULT_MAX_FIELDS = 8

/** Sistema per la seconda chiamata: risposta SOLO `{"ok": true|false, "motivo": "…"}`. */
export const AUTO_VERIFY_SYSTEM =
`Sei un revisore di un'estrazione assicurativa: valuti se un VALORE CANDIDATO
coincide con la DESCrizione del campo. Rispondi SOLO con JSON di 2 chiavi:
{"ok": true|false, "motivo": "una breve frase in italiano"}. "ok": true se il
valore è plausibile/coerente col campo; "ok": false solo se è manifestamente
incoerente o apparentemente inventato. In caso di dubbio preferisci "ok": true.`

// ─── Euristiche di "campo testuale senza checksum" ───────────────────────────
// Un campo è DUBBIO (da ricontrollare) solo se il suo valore è TESTUALE libera:
// non una data, non un importo/numero, e privo di checksum (P.IVA/CF). Un campo
// il cui candidato è un numero/importo/anno è inequivocabile e non va verificato.
const DATE_VAL_RE = /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/
const AMOUNT_VAL_RE = /^\d{1,3}(?:\.\d{3})*(?:,\d+)?$/
const NUMBER_VAL_RE = /^\d+(?:[.,]\d+)?$/
const IVA_BLOB_RE = /iva|c\s*\.?\s*f\s*\.?|fiscale|p\s*\.?\s*i\s*\.?\s*v\s*\.?/i

function isChecksumField(id, field) {
  const blob = `${id || ''} ${field?.label || ''} ${field?.description || ''}`
  return IVA_BLOB_RE.test(blob)
}

function isTextualDoubtful(id, field, candidate, checksumsById) {
  if (!field || !candidate) return false
  if (checksumsById[id] === true) return false         // già verificato (checksum)
  if (isChecksumField(id, field)) return false          // P.IVA/CF: difensivo
  if (field.type === 'date') return false                // date: fuori doppia
  const v = String(candidate.valore ?? '').trim()
  if (!v) return false
  if (DATE_VAL_RE.test(v)) return false                 // valore-data
  if (AMOUNT_VAL_RE.test(v) || NUMBER_VAL_RE.test(v)) return false // importo/numero
  return true                                            // testo libera: dubbia
}

/**
 * Seleziona i campi su cui fare la doppia verifica.
 *
 * @param {Record<string, object>} best            id → candidato vincente
 * @param {Record<string, {reliable:number}>} reliabilityById  id → affidabilità
 * @param {Record<string, object>} fieldsById      id → definizione campo
 * @param {{checksumsById?:Record<string,boolean>, threshold?:number, max?:number}} [opts]
 * @returns {string[]} id dei campi dubbi, i più dubbie PRIMA (reliable crescente), max cap
 */
export function selectFieldsToDoubleCheck(best, reliabilityById = {}, fieldsById = {}, opts = {}) {
  const {
    checksumsById = {},
    threshold = RELIABILITY_THRESHOLD,
    max = DEFAULT_MAX_FIELDS,
  } = opts
  const out = []
  for (const [id, candidate] of Object.entries(best || {})) {
    if (!candidate) continue
    const reliable = (reliabilityById[id] && typeof reliabilityById[id].reliable === 'number')
      ? reliabilityById[id].reliable : 0
    if (reliable >= threshold) continue
    const field = fieldsById[id]
    if (!isTextualDoubtful(id, field, candidate, checksumsById)) continue
    out.push({ id, reliable })
  }
  out.sort((a, b) => (a.reliable - b.reliable) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return out.slice(0, Math.max(0, Number(max) || DEFAULT_MAX_FIELDS)).map((e) => e.id)
}

/**
 * Prompt UTENTE compatta per la seconda auto-verifica.
 * Riceve SOLO i dati del singolo campo — mai l'intero fascicolo.
 *
 * @param {object} args
 * @param {object} args.field         definizione del campo (id/label/description)
 * @param {object} args.candidate     candidato vincente { valore, file, page }
 * @param {string} [args.evidenza]    contesto/estratto dove è stato trovato
 * @param {string} [args.coppia]      coerente coppia label+descrizione (default derivata)
 * @returns {string}
 */
export function buildDoubleCheckPrompt({ field, candidate, evidenza = '', coppia }) {
  const pair = coppia || `${field?.label || field?.id || 'campo'}: ${field?.description || ''}`
  const valore = candidate?.valore ?? ''
  return [
    'CAMPO: ' + (field?.id || '?'),
    'COPPIA (che cos\'è): ' + pair,
    'VALORE CANDIDATO: ' + String(valore),
    evidenza ? 'EVIDENZA (contesto nel documento):\n' + String(evidenza).slice(0, 160) : '',
    '',
    'Il VALORE CANDIDATO sopra è coerente con la COPPIA (descrizione del campo) e plausibile? Rispondi SOLO con {"ok": true|false, "motivo": "..."}.',
  ].filter(Boolean).join('\n')
}

/**
 * Parse difensivo della risposta della doppia verifica: accetta "tofu" JSON o
 * testo con extra attorno. Se non si riesce a determinare `ok` → `{ok:null}`:
 * il chiamante, per regola, CONSERVA il candidato (mai bloccare).
 *
 * @param {string} raw
 * @returns {{ok: boolean|null, motivo: string|null}}
 */
export function parseDoubleCheck(raw) {
  const s = String(raw || '')
  const okM = s.match(/"ok"\s*:\s*(true|false)/i)
  if (!okM) return { ok: null, motivo: null }
  const ok = okM[1].toLowerCase() === 'true'
  const m = s.match(/"motivo"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  const motivo = m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : null
  return { ok, motivo }
}

/**
 * Applica la doppia verifica sui campi dubbi, con la chiamata LLM INIETTATA.
 *
 * Guardie comportamentali:
 *  - DEFAULT OFF: `settings.polizzaAutoVerify !== true` → 0 chiamate, best intatto.
 *  - `callModel` lancia / risposta non-parsabile / ok===null → CONSERVA.
 *  - ok===false CON motivo → SCARTA il campo da best.
 *  - I campi da verificare vengono scelti con selectFieldsToDoubleCheck.
 *
 * @param {object} args
 * @param {Record<string,object>} args.best
 * @param {Record<string,object>} args.fieldsById
 * @param {Record<string,boolean>} [args.checksumsById]
 * @param {Record<string,{reliable:number}>} [args.reliabilityById]
 * @param {object} [args.settings]      deve contenere `polizzaAutoVerify`
 * @param {(prompt:string)=>Promise<string>} args.callModel  chiamata LLM iniettata
 * @param {(id:string, cand:object)=>string} [args.getEvidence]
 * @param {object} [args.opts]          passati a selectFieldsToDoubleCheck (max…)
 * @returns {Promise<{calls:number, scartati:number, kept:number}>}
 */
export async function runAutoValidation({ best, fieldsById, checksumsById = {}, reliabilityById = {}, settings = {}, callModel, getEvidence, opts = {} }) {
  if (settings.polizzaAutoVerify !== true) return { calls: 0, scartati: 0, kept: 0 }
  if (typeof callModel !== 'function' || !best || typeof best !== 'object') {
    return { calls: 0, scartati: 0, kept: 0 }
  }
  const ids = selectFieldsToDoubleCheck(best, reliabilityById, fieldsById, { checksumsById, ...opts })
  let calls = 0, scartati = 0, kept = 0
  for (const id of ids) {
    const field = fieldsById[id]
    const cand = best[id]
    if (!field || !cand) continue
    const evidenza = typeof getEvidence === 'function' ? (getEvidence(id, cand) || '') : ''
    const prompt = buildDoubleCheckPrompt({ field, candidate: cand, evidenza })
    try {
      const raw = await callModel(prompt)
      const { ok, motivo } = parseDoubleCheck(raw)
      if (ok === false && motivo) {
        delete best[id] // scartato MOTIVATO
        scartati++
      } else {
        kept++ // ok:true, ok:null, parse fallito, risposta vuota → conserva
      }
      calls++
    } catch {
      kept++ // errore → conserva (mai bloccare per un fallimento del modello)
      calls++
    }
  }
  return { calls, scartati, kept }
}