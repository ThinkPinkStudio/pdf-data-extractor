/**
 * Registro dei «fatti numerici» — parte PURA, zero LLM.
 *
 * Dopo lo Stadio A si elencano TUTTI gli importi e le date che esistono
 * davvero in un documento, con la finestra di testo attorno. Serve a:
 *  1. whitelist di valori plausibili per un campo (il merge non può
 *     promuovere un numero che non sta nel registro);
 *  2. veto dei sub-limiti: un importo la cui unica occorrenza vive in
 *     una clausola (franchigia / sub-limite / minimo) non può diventare
 *     massimale.
 *
 * Type-blind: nessuna preferenza per tipo documento. Test: test/numericFacts.test.mjs.
 */

import { normalizeDateValue } from './polizzaDates.js'
import { looseAmount, fieldLabelStems, normForMatch } from './polizzaValidation.js'

const AMOUNT_RE = /(?:€\.?\s*)?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,7},\d{2}/g
const DATE_RE = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-]((?:19|20)\d{2})\b/g

const CLAUSE_LABEL_RE = /franchig|scopert|sub[-\s]?limit|sotto[-\s]?limit|minimo|minima|massimale\s+ridott|limite\s+di\s+indennizzo/i
const MASSIMALE_FIELD_RE = /massimal/i
const PREMIO_FIELD_RE = /premio|imposta|importo\s+preventiv/i
const PREMIO_WINDOW_RE = /premio|imposta|tasso|imponibile|lordo|quietanz|regolazion/i

function windowAround(text, index, length, span = 80) {
  const start = Math.max(0, index - span)
  const end = Math.min(text.length, index + length + span)
  return text.slice(start, end)
}

function yearOf(dateStr, docName) {
  const d = normalizeDateValue(dateStr)
  if (d) return parseInt(d.slice(-4), 10)
  const ym = String(docName || '').match(/\b((?:19|20)\d{2})\b/)
  return ym ? parseInt(ym[1], 10) : null
}

/**
 * Estrae i fatti numerici (importi + date) da UNA pagina.
 * @returns {Array<{ kind:'amount'|'date', raw:string, numeric:number|null, date:string|null, window:string, page:number }>}
 */
export function extractNumericFactsFromPage(pageText, page = 1) {
  const text = String(pageText || '')
  const out = []
  if (!text.trim()) return out

  const amounts = text.matchAll(AMOUNT_RE)
  for (const m of amounts) {
    const raw = m[0]
    const numeric = looseAmount(raw)
    if (numeric == null) continue
    // Importi da 2 cifre (es. "12,00") sono rumore da articoli/pagine
    if (numeric < 10) continue
    out.push({
      kind: 'amount',
      raw,
      numeric,
      date: null,
      window: windowAround(text, m.index, raw.length),
      page,
    })
  }

  const dates = text.matchAll(DATE_RE)
  for (const m of dates) {
    const raw = m[0]
    const date = normalizeDateValue(raw)
    if (!date) continue
    out.push({
      kind: 'date',
      raw,
      numeric: null,
      date,
      window: windowAround(text, m.index, raw.length),
      page,
    })
  }
  return out
}

/**
 * Registro per un fascicolo analizzato (stessa shape di analyzeStagedDocs:
 * { name, pages, dateStr }).
 */
export function buildFactsRegistry(analyzed) {
  const facts = []
  for (const d of analyzed || []) {
    const pages = Array.isArray(d.pages) ? d.pages : [d.text || '']
    const year = yearOf(d.dateStr, d.name)
    pages.forEach((pageText, i) => {
      for (const f of extractNumericFactsFromPage(pageText, i + 1)) {
        facts.push({
          ...f,
          docname: d.name,
          docPos: d.pos ?? null,
          year,
        })
      }
    })
  }
  return facts
}

function amountDigits(n) {
  if (n == null || !Number.isFinite(n)) return ''
  return String(Math.trunc(Math.abs(n)))
}

function fieldBlob(field) {
  return `${field?.id || ''} ${field?.label || ''} ${field?.description || ''}`
}

/**
 * Il candidato numerico è supportato dal registro?
 * - deve esistere un fatto con le STESSE cifre (importo) o la stessa data;
 * - per i massimali: almeno un'occorrenza NON deve vivere in una clausola
 *   di sub-limite/franchigia (altrimenti è un sub-limite pescato male);
 * - per i premi: almeno un'occorrenza deve parlare di premio/imposta/tasso
 *   OPPURE non esserci un veto di clausola.
 *
 * @returns {{ ok: boolean, reason: string, hits: object[] }}
 */
export function factSupports(registry, field, value, srcDoc = null) {
  const facts = Array.isArray(registry) ? registry : []
  const blob = fieldBlob(field)
  const amount = looseAmount(value)
  const asDate = normalizeDateValue(value)

  let candidates
  if (amount != null) {
    const digits = amountDigits(amount)
    if (digits.length < 2) return { ok: true, reason: 'importo-corto', hits: [] }
    candidates = facts.filter((f) => f.kind === 'amount' && amountDigits(f.numeric) === digits)
  } else if (asDate) {
    candidates = facts.filter((f) => f.kind === 'date' && f.date === asDate)
  } else {
    return { ok: true, reason: 'non-numerico', hits: [] }
  }

  if (srcDoc?.name) {
    const local = candidates.filter((f) => f.docname === srcDoc.name)
    if (local.length) candidates = local
  }

  if (!candidates.length) {
    // Il fatto può mancare (OCR senza separatori delle migliaia): non è un veto
    // — ci pensa già passesStagedEvidence. Il registro vieta i SUB-LIMITI, non
    // i numeri legittimi scritti in forma inattesa.
    return { ok: true, reason: 'fatto-non-elencato', hits: [] }
  }

  if (MASSIMALE_FIELD_RE.test(blob) && amount != null) {
    // Una finestra che PARLA di massimale è pulita anche se un sub-limite
    // compare a poche decine di caratteri (stesso paragrafo). Il veto scatta
    // solo se TUTTE le occorrenze vivono in una clausola senza "massimale".
    const clean = candidates.filter((f) => /massimal/i.test(f.window) || !CLAUSE_LABEL_RE.test(f.window))
    if (!clean.length) return { ok: false, reason: 'solo-clausola', hits: candidates }
    return { ok: true, reason: 'massimale', hits: clean }
  }

  if (PREMIO_FIELD_RE.test(blob) && amount != null) {
    const prize = candidates.filter((f) => PREMIO_WINDOW_RE.test(f.window))
    if (prize.length) return { ok: true, reason: 'premio', hits: prize }
    // Nessuna finestra "premio": accetta comunque se non è una clausola
    const clean = candidates.filter((f) => !CLAUSE_LABEL_RE.test(f.window))
    if (!clean.length) return { ok: false, reason: 'solo-clausola', hits: candidates }
    return { ok: true, reason: 'importo', hits: clean }
  }

  // Altri campi numerici: basta che il fatto esista. Se l'etichetta del
  // campo ha stemmi, preferisci le finestre che li contengono, ma non veto.
  const stems = fieldLabelStems(field)
  if (stems.length) {
    const labeled = candidates.filter((f) => {
      const n = normForMatch(f.window)
      return stems.some((s) => n.includes(s))
    })
    if (labeled.length) return { ok: true, reason: 'etichetta', hits: labeled }
  }
  return { ok: true, reason: 'presente', hits: candidates }
}
