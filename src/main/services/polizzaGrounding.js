/**
 * GROUNDING RIGOROSO per il motore per-field (polizzaService.extractPolizzaPerField).
 *
 * Sostituisce la verifica di evidenza BLANDA (passesEvidenceCheck) con un
 * ancoraggio deterministico al TESTO:
 *  - buildEvidenceWindows: finestre candidate costruite PRIMA della chiamata LLM
 *    (numeri strutturali → scanDocument; tutti → affinità);
 *  - groundedPrompt: prompt che OBBLIGA la citazione {doc, page, line};
 *  - verifyGroundedValue: verifica DETERMINISTICA (no LLM) che la riga citata
 *    contenga davvero il valore (close-match OCR-tollerante) e che l'etichetta
 *    di contesto non contraddica la natura del campo;
 *  - assembleGroundedResult: normalizza nel formato canonico.
 *
 * "Meglio vuoto che sbagliato": se il supporto manca → campo scartato.
 *
 * Modulo PURO (no Electron/Ollama): test/polizzaGrounding.test.mjs.
 */

import { buildNormIndex, normForMatch, hasOcrDigitRun, validateCodiceFiscaleIva, isPlaceholderValue } from './polizzaValidation.js'
import { normalizeDateValue, parseDateFromContextLine } from './polizzaDates.js'
import { fieldKind } from './polizzaFieldKind.js'
import {
  formatAmountIT, parseAmountMaybe, scanDocument, scanKindForField,
  DETERMINISTIC_MIN_CONFIDENCE,
} from './polizzaNumericScan.js'
import { collapseSpatial, detectLabelValuePairs } from './ocrLayout.js'

// Soglia per promuovere un hint deterministico a candidato DIRETTO (no LLM).
export const GROUNDING_MIN_CONFIDENCE = DETERMINISTIC_MIN_CONFIDENCE
// Confidenza sotto la cual un candidato es inafidabile.
export const MIN_TRUSTED_CONFIDENCE = 0.5
export const GROUNDING_DEFAULT_MAX_WINDOWS = 5

// ─── Seed anagraficos determinísticos (type-blind) ────────────────────────────
const AN_DATA_KINDS = Object.freeze({
  POLIZZA_NUMERO: 'polizza_numero',
  CODICE_FISCALE_IVA: 'codice_fiscale_iva',
  DECORRENZA: 'decorrenza',
  SCADENZA: 'scadenza',
})

const AN_ECON_KINDS = new Map([
  ['massimale_sinistro', /(?:massimale\s+per\s+sinistro|per\s+(?:ogni|singolo|ciascun)\s+sinistro|unico\s+per\s+sinistro)/i],
  ['massimale_annuo', /(?:massimale\s+annuo|massimale\s+.*per\s+periodo\s+assicurativo|per\s+periodo\s+assicurativo)/i],
  ['franchigia', /\bfranchig/i],
  ['scoperto', /\bscopert/i],
  ['premio_imponibile', /premio\s+imponib/i],
  ['imposta', /\bimpost/i],
  ['premio_totale', /premio\s+(?:lordo|totale|annuo)/i],
  ['fatturato', /fat[t]urato|retribuzioni|consuntiv/i],
])

export function anagraphicSeedKind(field) {
  if (!field) return null
  const blob = `${String(field?.label || '')} ${String(field?.description || '')}`.toLowerCase()
  if (/\btutela\b/i.test(blob)) return null
  if (/n[°o]?\s*(?:polizz|contratt)/i.test(blob) || /numero\s+polizz/i.test(blob)) return AN_DATA_KINDS.POLIZZA_NUMERO
  if (/p\s*\.?i\s*\.?v\s*\.?a|partita\s+iva|codice\s+fiscale|c\.?f\.?\s*\/?\s*p/i.test(blob)) return AN_DATA_KINDS.CODICE_FISCALE_IVA
  if (/\bdecorrenz|\beffetto\b|inizio\s+(?:copertura|assicurazione)/i.test(blob)) return AN_DATA_KINDS.DECORRENZA
  if (/\bscadenz|fine\s+(?:copertura|periodo)/i.test(blob)) return AN_DATA_KINDS.SCADENZA
  if (/massimal/i.test(blob) && /\bannuo|\bper\s+anno\b|periodo\s+assicurativo/i.test(blob)) return 'massimale_annuo'
  if (/massimal/i.test(blob) && /sinistr|ogni|singolo|ciascun|unico/i.test(blob)) return 'massimale_sinistro'
  if (/franchig/i.test(blob) || /sottolimit/i.test(blob)) return 'franchigia'
  if (/scopert/i.test(blob)) return 'scoperto'
  if (/premio\s+imponib/i.test(blob)) return 'premio_imponibile'
  if (/impost/i.test(blob)) return 'imposta'
  if (/premio\s+(?:lordo|totale|annuo)/i.test(blob)) return 'premio_totale'
  if (/fat[t]urato|retribuzioni|consuntiv/i.test(blob)) return 'fatturato'
  return null
}

export function anagraphicSeeds(field, docs) {
  const list = Array.isArray(docs) ? docs : []
  if (!list.length) return []
  const kind = anagraphicSeedKind(field)
  if (!kind) return []
  const out = []
  list.forEach((d, i) => {
    const pages = Array.isArray(d?.pages) && d.pages.length
      ? d.pages.map((p) => collapseSpatial(String(p || '')))
      : (typeof d?.text === 'string' && d.text ? [collapseSpatial(d.text)] : [])
    pages.forEach((page, pi) => {
      const lnAt = (needle) => page.split('\n').findIndex((l) => l.includes(needle)) + 1
      const add = (value, line, conf) => {
        if (!value || value === '') return
        const lines = page.split('\n')
        const ln = line && line >= 1 && line <= lines.length ? line : null
        const snippet = ln ? (lines[Math.max(0, ln - 2)] || '').trim() : ''
        out.push({ value: String(value), docIndex: i, page: pi + 1, line: ln, snippet: snippet.slice(0, 120), confidence: conf, kind, _recency: Number.isFinite(d?.ts ?? NaN) ? d.ts : null })
      }
      switch (kind) {
        case AN_DATA_KINDS.POLIZZA_NUMERO: {
          const m = page.match(/(?:N[°oO.\s]{0,3}(?:de\s+)?)?POLIZA\s+(?:R\.?C\.?\s+)?(?:N[°oO.\s]{0,3})?([A-Z]{0,5}\d(?: ?\d){3,15})/i)
          if (m) add(m[1].replace(/\s+/g, ''), lnAt(m[0].slice(0, 12)), 0.96)
          break
        }
        case AN_DATA_KINDS.CODICE_FISCALE_IVA: {
          const m = page.match(/(?:P\.?IVA|PARTITA\s+IVA|CODICE\s+FISCAL|C\.?\s*F\.)[^\n]{0,40}([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})/i)
          if (!m) break
          const v = m[1].toUpperCase()
          if (!validateCodiceFiscaleIva(v)) break
          add(v, lnAt(v), 0.8)
          break
        }
        case AN_DATA_KINDS.DECORRENZA: {
          const d = parseDateFromContextLine(page, /DECORRENZA|EFFETTO|INIZIO\s+COPERTURA/i)
          if (d) add(normalizeDateValue(d), null, 0.95)
          break
        }
        case AN_DATA_KINDS.SCADENZA: {
          const d = parseDateFromContextLine(page, /SCADENZA/i)
          if (d) add(normalizeDateValue(d), null, 0.95)
          break
        }
        default: {
          const re = AN_ECON_KINDS.get(kind)
          if (!re) break
          const m = page.match(re)
          if (m) {
            const num = (m[0].match(/\d{1,3}(?:\.\d{3})*(?:,\d{2})?/) || [])[0]
            if (num) add(formatAmountIT(parseAmountMaybe(num)), null, 0.9)
          }
          break
        }
      }
    })
  })
  out.sort((a, b) => ((b._recency ?? -Infinity) - (a._recency ?? -Infinity)) || (b.confidence - a.confidence))
  return out
}

export function windowsFromLabelValuePairs(field, docs, relevantDocs = null) {
  const list = Array.isArray(docs) ? docs : []
  const relevant = Array.isArray(relevantDocs) && relevantDocs.length ? new Set(relevantDocs) : null
  const label = String(field?.label || '').toLowerCase()
  const desc = String(field?.description || '')
  const stems = (label + ' ' + desc).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z]+/).filter((w) => w.length >= 4)
  const windows = []
  list.forEach((d, di) => {
    if (relevant && !relevant.has(di)) return
    const pages = Array.isArray(d?.pages) && d.pages.length
      ? d.pages.map((p) => collapseSpatial(String(p || '')))
      : (typeof d?.text === 'string' && d.text ? [collapseSpatial(d.text)] : [])
    pages.forEach((page, pi) => {
      for (const p of detectLabelValuePairs(page)) {
        const pl = String(p.label || '').toLowerCase()
        const labelledOk = pl.includes(label) || stems.some((s) => s.length >= 4 && pl.includes(s))
        if (!labelledOk) continue
        const val = String(p.value || '').trim()
        if (!val || isPlaceholderValue(val)) continue
        const lines = page.split('\n')
        const from = Math.max(0, p.row - 2)
        const to = Math.min(lines.length, p.row + 1)
        const snippet = lines.slice(from, to).join('\n').trim().slice(0, 240)
        windows.push({ docIndex: di, page: pi + 1, line: p.row, snippet, labelMatched: true, affinity: 0.7, value: val })
      }
    })
  })
  return windows
}

// ─── Utilità ──────────────────────────────────────────────────────────────────

// Numero di riga (1-based) del carattere assoluto `pos` nel testo.
function lineAt(text, pos) {
  if (pos < 0 || text == null) return 1
  let n = 1
  for (let i = 0; i < pos && i < String(text).length; i++) {
    if (text[i] === '\n') n++
  }
  return n
}

// Pagine PIATTE (collapseSpatial) di un documento, come da convenzione del motore.
function flatPagesOf(doc) {
  if (Array.isArray(doc?.pages) && doc.pages.length) return doc.pages.map((p) => collapseSpatial(String(p || '')))
  if (typeof doc?.text === 'string' && doc.text) return [collapseSpatial(doc.text)]
  return []
}

function digitOnly(s) {
  return String(s ?? '').replace(/\D/g, '')
}

// Numero di riga della prima occorrenza normalizzata di `needle` nel piatto.
function normLineOf(flatText, needle) {
  const nn = normForMatch(needle)
  if (!nn || nn.length < 3) return null
  const { norm, map } = buildNormIndex(flatText)
  const at = norm.indexOf(nn)
  if (at < 0) return null
  return lineAt(flatText, map[at] ?? 0)
}

// Prefisso capitale della riga ("MASSIMALE …", "FRANCHIGIA …", "PREMIO …").
function leadingLabel(line) {
  const s = String(line || '').trim()
  const m = s.match(/^\s*([A-ZÀ-Ý][A-ZÀ-Ý0-9'’\-/,:.]*(?:\s+[A-ZÀ-Ý][A-ZÀ-Ý0-9'’\-/,:.]*){0,2})\b/)
  if (!m) return ''
  const w = m[1].trim()
  return /[A-ZÀ-Ý]{2}/.test(w) ? w : ''
}

// il campo è un importo STRUTTURALE per la scan (massimale/franchigia/…)?
// La natura del campo viene SOLO dal tipo dichiarato (field.type = number):
// MAI dedotta dalla label/description, che l'utente può modificare nel editor.
function isStructuralNumeric(field) {
  if (!field) return false
  // La scan numerica decide da SOLA la natura del campo (massimale/franchigia/
  // premio/fatturato/tasso…) in modo type-blind: NON serve che il kind sia
  // 'number'. Se la scan riconosce una natura per label/descrizione, i suoi
  // hint (confidenza ≥ soglia) sono la fonte deterministicà per la passata 1.
  return scanKindForField(field) != null
}

// Cerca la riga della pagina PIATTA che contiene `digits` (close-match OCR).
function lineHoldingDigits(pageFlat, digits) {
  const d = digitOnly(digits)
  if (!d) return null
  const lines = String(pageFlat || '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (hasOcrDigitRun(lines[i], d)) return i + 1
  }
  if (d.length >= 3) {
    for (let i = 0; i < lines.length; i++) {
      const ld = digitOnly(lines[i])
      if (ld && (ld.includes(d) || d.includes(ld))) return i + 1
    }
  }
  return null
}

// ─── PARTE 1 — buildEvidenceWindows ───────────────────────────────────────────

/**
 * Finestre candidate per il campo, ordinate per affidabilità.
 * - numeri strutturali: hint con natura chiara (scanDocument) + finestre di
 *   affinità attorno a label/descrizione;
 * - tutti gli altri: soltanto finestre di affinità.
 *
 * @param {object} field definizione campo ({label, description, type})
 * @param {Array}  docs  ({name, pages?|text?, dateStr?})
 * @param {{maxWindows?:number,useNumericScan?:boolean}} [opts]
 * @returns {Array<{docIndex,page,line,snippet,labelMatched,affinity}>}
 */
export function buildEvidenceWindows(field, docs, opts = {}) {
  const maxWindows = opts.maxWindows ?? GROUNDING_DEFAULT_MAX_WINDOWS
  const useNumericScan = opts.useNumericScan !== false
  const list = Array.isArray(docs) ? docs : []
  const targetKind = scanKindForField(field)
  const numeric = isStructuralNumeric(field)
  const windows = []

  // 1. Hint numerici con natura per il campo.
  if (numeric && useNumericScan && targetKind) {
    for (let di = 0; di < list.length; di++) {
      const pages = flatPagesOf(list[di])
      for (let pi = 0; pi < pages.length; pi++) {
        const page = pages[pi] || ''
        if (!page.trim()) continue
        let hints = []
        try {
          hints = scanDocument({ ...list[di], name: list[di]?.name || `doc_${di}`, pages: [page] }) || []
        } catch { hints = [] }
        for (const h of hints) {
          if (h.kind !== targetKind) continue
          const line = lineHoldingDigits(page, h.value) ||
            (Number.isInteger(h.line) && h.line >= 1 && h.line <= page.split('\n').length ? h.line : null)
          if (line == null) continue
          const snippet = (page.split('\n')[line - 1] || h.source || '').trim().slice(0, 200)
          windows.push({
            docIndex: di, page: pi + 1, line,
            snippet,
            labelMatched: true,
            affinity: typeof h.confidence === 'number' ? h.confidence : 0,
            value: h.value != null ? String(h.value) : null,
          })
        }
      }
    }
  }

  // 2. Finestre di affinità (tutti i campi): vicino a label/descrizione nel piatto.
  //    La finestra è una PANORAMICA COMPATTA: riga della label + alcune righe
  //    seguenti, così valore e label restano vicini (es. header "N° Polizza" con
  //    il numero nella riga sotto — una finestra a riga singola vedrebbe solo
  //    l'etichetta e il per-field risponderebbe {}).
  for (let di = 0; di < list.length; di++) {
    const pages = flatPagesOf(list[di])
    const probe = [field?.label, field?.description].find((p) => p && normForMatch(p).length >= 3)
    if (!probe) continue
    for (let pi = 0; pi < pages.length; pi++) {
      const page = pages[pi] || ''
      if (!page.trim()) continue
      const line = normLineOf(page, probe)
      if (line == null) continue
      const lines = page.split('\n')
      const from = Math.max(0, line - 1 - 1) // 1 riga di contesto sopra
      const to = Math.min(lines.length, line - 1 + 1 + 3) // fino a 3 righe sotto
      const snippet = lines.slice(from, to).join('\n').trim().slice(0, 240)
      windows.push({
        docIndex: di, page: pi + 1, line,
        snippet,
        labelMatched: !!leadingLabel(lines[line - 1] || ''),
        affinity: 0.5,
      })
    }
  }

  // Ordinamento per affidabilità e dedup.
  const scored = windows.map((w) => {
    let s = typeof w.affinity === 'number' ? w.affinity : 0
    if (w.labelMatched) s += 0.3
    const lab = leadingLabel(w.snippet || '').toLowerCase()
    if (lab && /(?:massimal|sinistro|franchig|scopert|premio|imponib|impost|totale|fatturate|annuo)/.test(lab)) s += 0.4
    return { ...w, _s: s }
  })
  scored.sort((a, b) => b._s - a._s || a.docIndex - b.docIndex || a.page - b.page || a.line - b.line || (a.snippet || '').localeCompare(b.snippet || ''))

  const seen = new Set()
  const out = []
  for (const w of scored) {
    const k = `${w.docIndex}:${w.page}:${w.line}:${(w.snippet || '').slice(0, 24)}`
    if (seen.has(k)) continue
    seen.add(k)
    // NB: l'hint numerico porta `value` (dalla scan): NON verrà buttato via nel
    // dedup, altrimenti il chiamante non può promuovere il directDraft
    // (buildEvidenceWindows cerca w.value per l'override deterministico).
    const pick = { docIndex: w.docIndex, page: w.page, line: w.line, snippet: w.snippet, labelMatched: w.labelMatched, affinity: w.affinity }
    if (w.value != null) pick.value = w.value
    if (typeof w.confidence === 'number') pick.confidence = w.confidence
    out.push(pick)
    if (out.length >= maxWindows) break
  }
  return out
}

// ─── PARTE 2 — groundedPrompt ────────────────────────────────────────────────

function formatHintForKind(kind) {
  if (kind === 'number') return 'importo italiano con "." migliaia e "," decimale (es. 1.000,50)'
  if (kind === 'date') return 'GG/MM/AAAA'
  if (kind === 'fiscal') return 'maiuscolo senza spazi (11 cifre P.IVA o 16 char CF)'
  if (kind === 'percent') return 'numero (es. 2,45)'
  if (kind === 'boolean') return 'SÌ/NO'
  return 'testo'
}

function jsonHintFor(kind) {
  const v = typeof kind === 'string'
    ? (kind === 'date' ? '"31/12/2025"'
      : kind === 'number' ? '"4.000.000,00"'
      : kind === 'fiscal' ? '"00151510344"'
      : '"testo"')
    : '"testo"'
  return `{"valore": ${v} oppure null, "source": {"doc": 0, "page": 1, "line": 12}, "confidence": 0.9}`
}

/**
 * Prompt per-field che OBBLIGA la citazione. Le finestre arrivano numerate
 * [D{d} p{m} r{l}] con riga + snippet. Risposta:
 * {"valore": <valore o null>, "source": {"doc": n, "page": m, "line": l},
 *  "confidence": 0-1} — il valore DEVE essere presente nella riga citata.
 *
 * @param {object} field
 * @param {Array}  windows  da buildEvidenceWindows
 * @param {string} kind     kind canonic da fieldKind (opzionale: auto)
 */
export function groundedPrompt(field, windows, kind) {
  const k = (typeof kind === 'string' && kind) ? kind : fieldKind(field)
  const frame = (Array.isArray(windows) ? windows : []).map((w) => {
    const d = w.docIndex ?? 0
    const p = w.page ?? 0
    const l = w.line ?? 0
    return `[D${d} p${p} r${l}] ${String(w.snippet || '').trim()}`
  }).join('\n')
  const fmt = formatHintForKind(k)
  const req = jsonHintFor(k)
  const fmtLine = fmt ? `  Formato valore: ${fmt}.` : ''
  return [
    `CAMPO: ${field?.label || ''}`,
    `DESCRIZIONE: ${field?.description || field?.label || ''}`,
    `TIPO: ${k}`,
    '',
    'FINESTRE CANDIDATE (ordinate per affidabilità):',
    frame || '(nessuna finestra deterministica disponibile)',
    '',
    'REGOLE TASSATIVE:',
    '1. Il valore DEVE essere PRESENTE nella riga citata in source.',
    '   Se non è in nessuna riga dei finestre → valore = null.',
    '2. source = {"doc": <n>, "page": <m>, "line": <l>}, coerente con UNA delle',
    '   finestre [D… p… r…] che contiene il valore.',
    '3. Non inventare, non dedurre, non riusare numeri/testi della descrizione.',
    '   Meglio null che un valore sbagliato.',
    fmtLine,
    '',
    `RISPOSTA (solo JSON): ${req}`,
  ].filter(Boolean).join('\n')
}

// ─── PARTE 3 — verifyGroundedValue ───────────────────────────────────────────

function numberParse(v) {
  return parseAmountMaybe(v)
}

// close-match: la riga contiene il valore (OCR-tollerante, per kind).
function lineHoldsValue(field, lineText, rawValue) {
  const v = String(rawValue ?? '').trim()
  if (!v) return false
  const kind = fieldKind(field)
  if (kind === 'number') {
    const n = numberParse(v)
    // run completa delle cifre del valore (inclusi i decimali, es. "1.001,25" → "100125"):
    // è l'ancora più forte e resta una run ESATTA, mai una sottosequenza.
    const fullDigits = digitOnly(v)
    if (fullDigits.length >= 3 && hasOcrDigitRun(lineText, fullDigits)) return true
    if (n != null) {
      const whole = String(Math.trunc(Math.abs(n)))
      if (whole.length >= 3) return hasOcrDigitRun(lineText, whole)
      const ld = digitOnly(lineText)
      return ld.includes(whole)
    }
    return false
  }
  if (kind === 'date') {
    const norm = normalizeDateValue(v)
    if (!norm) return false
    return normForMatch(lineText).includes(String(norm).replace(/\//g, ''))
  }
  if (kind === 'fiscal') {
    return normForMatch(lineText).includes(normForMatch(v))
  }
  const nv = normForMatch(v)
  return nv.length > 0 && normForMatch(lineText).includes(nv)
}

// L'etichetta di contesto della riga non deve contraddire la natura del campo.
function labelContradicts(lineText, field) {
  const lab = leadingLabel(lineText).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (!lab || !/^(?:massimal|franchig|scop|premio|imponib|impost|totale|fattur|sottolimit|tasso)/.test(lab)) return null
  const blob = String(field?.label || '').toLowerCase()
  const isMassimale = /massimal/.test(blob)
  const isFranchigiaScoperto = /franchig|scop/.test(blob)
  const isEconomico = /premio|imponib|impost|fattur/.test(blob)
  if (isFranchigiaScoperto && /massimal/.test(lab)) return 'etichetta di riga "massimale" contraddice campo franchigia/scoperto'
  if (isMassimale && /franchig|scop/.test(lab)) return 'etichetta di riga "franchigia/scoperto" contraddice campo massimale'
  if (isEconomico && /massimal|franchig|scop/.test(lab)) return 'etichetta di riga strutturale contraddice campo economico'
  if ((isMassimale || isFranchigiaScoperto) && /premio|imponib|impost|totale/.test(lab)) return 'etichetta di riga economica contraddice campo strutturale'
  return null
}

/**
 * Verifica DETERMINISTICA (no LLM) che l'entry del modello {valore,
 * source:{doc,page,line}, confidence} sia sostenuta da una riga reale dei
 * documenti:
 *  (a) la riga citata esiste e contiene il valore (close-match OCR-tollerante);
 *  (b) l'etichetta di contesto della riga NON contraddica la natura del campo;
 *  (c) confidence < MIN_TRUSTED_CONFIDENCE → inaffidabile;
 *  (d) formati: numeri parsabili, date normalizzabili, codice fiscale valido.
 *
 * @param {object} field
 * @param {object} draft
 * @param {Array}  docs
 * @returns {{ok:boolean, reason:string}}
 */
export function verifyGroundedValue(field, draft, docs) {
  const D = (draft && typeof draft === 'object') ? draft : {}
  const S = (D.source && typeof D.source === 'object') ? D.source : {}
  const conf = typeof D.confidence === 'number' ? D.confidence : null
  if (conf != null && conf < MIN_TRUSTED_CONFIDENCE) {
    return { ok: false, reason: `confidenza ${conf} sotto ${MIN_TRUSTED_CONFIDENCE}` }
  }
  const valore = D.valore
  if (valore == null || valore === '') return { ok: false, reason: 'valore nullo' }

  const docIdx = Number(S.doc ?? -1)
  const pageNo = Number(S.page ?? -1)
  const lineNo = Number(S.line ?? -1)
  const docsList = Array.isArray(docs) ? docs : []
  if (!Number.isInteger(docIdx) || docIdx < 0 || docIdx >= docsList.length) return { ok: false, reason: `doc ${S.doc} non risolvibile` }
  const doc = docsList[docIdx]
  const pages = flatPagesOf(doc) || []
  if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > pages.length) return { ok: false, reason: `pagina ${S.page} assente` }
  const page = pages[pageNo - 1] || ''
  const lines = page.split('\n')
  if (!Number.isInteger(lineNo) || lineNo < 1 || lineNo > lines.length) return { ok: false, reason: `riga ${S.line} fuori range` }
  const lineText = lines[lineNo - 1] || ''

  if (!lineHoldsValue(field, lineText, valore)) {
    return { ok: false, reason: `riga ${lineNo} non contiene il valore "${valore}"` }
  }
  const contrad = labelContradicts(lineText, field)
  if (contrad) return { ok: false, reason: contrad }

  const kind = fieldKind(field)
  if (kind === 'number' && numberParse(String(valore)) == null) {
    return { ok: false, reason: `importo non parsabile: "${valore}"` }
  }
  if (kind === 'fiscal' && validateCodiceFiscaleIva(String(valore)) == null) {
    return { ok: false, reason: 'codice fiscale/P.IVA malformato' }
  }
  return { ok: true, reason: 'supportato (riga citata)' }
}

// ─── PARTE 4 — assembleGroundedResult ────────────────────────────────────────

/**
 * Normalizza l'entry della risposta LLM nel formato canonico:
 * {value, source:{file,page,line}, snippet?, confidence?}.
 * Gestisce valore:null / {} / placeholder → {value:null}.
 *
 * @param {object} field
 * @param {object} draft
 * @param {Array}  docs
 * @returns {object}
 */
export function assembleGroundedResult(field, draft, docs = []) {
  const D = (draft && typeof draft === 'object') ? draft : {}
  const raw = D.valore
  if (raw == null || raw === '' || isPlaceholderValue(raw)) return { value: null }

  const kind = fieldKind(field)
  let value = String(raw).trim()
  if (kind === 'number') {
    const n = numberParse(value)
    if (n == null) return { value: null }
    value = formatAmountIT(n)
  } else if (kind === 'date') {
    const nd = normalizeDateValue(value)
    if (!nd) return { value: null }
    value = nd
  } else if (kind === 'fiscal') {
    const v = validateCodiceFiscaleIva(value)
    if (v == null) return { value: null }
    value = v
  } else if (kind === 'percent') {
    const n = numberParse(value)
    if (n == null) return { value: null }
    value = formatPlainNumber(n)
  }

  const out = { value }
  const docIdx = Number(D.source?.doc ?? -1)
  if (Number.isInteger(docIdx) && docIdx >= 0 && docIdx < docs.length) {
    const lineNo = Number(D.source?.line ?? -1)
    const pageNo = Number(D.source?.page ?? -1)
    out.source = { file: docs[docIdx]?.name || null, page: Number.isInteger(pageNo) && pageNo >= 1 ? pageNo : null, line: Number.isInteger(lineNo) && lineNo >= 1 ? lineNo : null }
    const pages = flatPagesOf(docs[docIdx]) || []
    if (Number.isInteger(pageNo) && pageNo >= 1 && pageNo <= pages.length) {
      const page = pages[pageNo - 1] || ''
      const lines = page.split('\n')
      if (Number.isInteger(lineNo) && lineNo >= 1 && lineNo <= lines.length) {
        out.snippet = (lines[lineNo - 1] || '').trim().slice(0, 200) || null
      }
    }
  } else {
    out.source = {}
  }
  if (typeof D.confidence === 'number') out.confidence = D.confidence
  // per costruzione, arriva qui solo se verifyGroundedValue ha detto ok: verified
  out.verified = true
  return out
}

/**
 * Ordina finestre candidate per RECENCY (documento più recente in testa),
 * spareggiando per pagina/riga. Ogni finestra può arrivare dalla retrieval
 * semantica (chunk/pagina piena) o dalla scan deterministica (riga precisa);
 * `docMeta` associa a ogni indice doc la data di copertura (`ts`, più alto =
 * più recente; null = assente) e un'etichetta leggibile (`date`).
 *
 * @param {Array}  candidate  [{doc, page, line?, snippet?, kind:'semantic'|'deterministic'}]
 * @param {Array}  docMeta    [{name, date, ts}] per ogni indice doc
 * @returns {Array} una copia già ordinata (in-place no), con un campo `order`
 */
export function rankWindowsByRecency(candidate, docMeta) {
  const meta = Array.isArray(docMeta) ? docMeta : []
  return (Array.isArray(candidate) ? candidate : [])
    .map((w, i) => {
      const m = meta[w.doc] || {}
      return { ...w, _ts: (m.ts ?? null), _pageOrd: 0 }
    })
    .sort((a, b) => {
      const ta = a._ts ?? -Infinity
      const tb = b._ts ?? -Infinity
      if (tb !== ta) return tb - ta
      return (a.page ?? 0) - (b.page ?? 0) || (a.line ?? 0) - (b.line ?? 0)
    })
}

/**
 * Prompt "una domanda per campo" per la PASSATA 2: le finestre candidate
 * arrivano GIÀ ORDINATE per recency (più recente in testa). Il modello deve
 * soltanto TRASCRIVERE il valore dalla prima finestra che lo contiene:
 * non deve cercare nel fascicolo né ragionare sulla data.
 *
 * @param {object} field
 * @param {Array}  ordered  finestre già ordinate ({doc, page, line?, snippet, text?, date?})
 * @param {object} docMeta  [{date, ts, name}]
 * @param {string} kind
 * @returns {string} il prompt user
 */
export function recencyPrompt(field, orderedWindows, docMeta, kind) {
  const k = (typeof kind === 'string' && kind) ? kind : fieldKind(field)
  const frame = (Array.isArray(orderedWindows) ? orderedWindows : []).map((w, i) => {
    const meta = (docMeta && docMeta[w.doc]) || {}
    const where = `[F${i} doc${w.doc} pag.${w.page}${w.line ? ` r${w.line}` : ''}${meta.date ? ` ${meta.date}` : ''}]`
    const body = String(w.snippet || w.text || '').replace(/\n{2,}/g, '\n').trim()
    return `${where} ${body}`
  }).join('\n')
  return [
    `CAMPO: ${field?.label || ''}`,
    `DESCRIZIONE: ${field?.description || field?.label || ''}`,
    '',
    'FINESTRE CANDIDATE (ordinate dal documento PIÚ RECENTE al PIÚ VECCHIO):',
    frame || '(nessuna finestra)',
    '',
    'REGOLE:',
    '1. Trascrivi il valore del campo dalla finestra PIÚ RECENTE che lo contiene,',
    '   letteralmente. Le finestre sono già ordinate: la prima in alto è la più recente.',
    '2. source = {"doc":N,"page":M} della finestra da cui trascrivi (i tag [F… doc… pag…]).',
    '3. Se nessuna finestra contiene il valore → rispondi esattamente {}.',
    '   Mai dedurre, mai riusare testi della descrizione.',
    formatRecencyHintForKind(k, field),
  ].filter(Boolean).join('\n')
}

function formatRecencyHintForKind(kind, field) {
  // I "NUMERO documento" (N° Polizza, proposta, preventivo, appendice) sono
  // IDENTIFICATIVI alfanumerici, NON importi: un hint "importo italiano"
  // contraddirebbe il valore reale (RCM00010027822) e spingerebbe il modello a {}
  if (kind === 'number') {
    const blob = `${field?.id || ''} ${field?.label || ''} ${field?.description || ''}`
    if (/numero\s+(di\s+|della\s+|delle\s+|del\s+)?(polizz|proposta|preventiv|appendic|contratt|adesion)|n[°.]?\s*(polizz|propost|preventiv|appendic)/i.test(blob)) {
      return 'Formato valore: codice/documento, trascrivi esattamente (es. RCM00010027822)'
    }
    return `Formato valore: importo italiano es. "4.000.000,00"`
  }
  if (kind === 'date') return 'Formato valore: GG/MM/AAAA'
  if (kind === 'fiscal') return 'Formato valore: maiuscolo senza spazi (11 cifre P.IVA o 16 char CF)'
  if (kind === 'percent') return 'Formato valore: numero es. 2,45'
  if (kind === 'boolean') return 'Formato valore: SÌ/NO'
  return ''
}

// ── normalizzazione numero per kind 'percent' (cifre, 2 decimali, virgola) ──
function formatPlainNumber(n) {
  if (n == null || !Number.isFinite(n)) return null
  return String(Math.round(n * 100) / 100).replace('.', ',')
}