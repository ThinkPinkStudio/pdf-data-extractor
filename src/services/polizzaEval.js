/**
 * Harness di valutazione per estrazioni polizza RC.
 *
 * Modulo PURO (niente Electron/Ollama/fs): confronta un oggetto {campo: valore}
 * con un golden set e produce metriche per campo (exact / normalizzato /
 * mismatch / missing / forbidden). Testabile in Node puro — vedi
 * test/polizzaEval.test.mjs.
 *
 * Il golden EULIP è la fonte di verità documentata in CLAUDE.md: serve a
 * misurare se un cambio (modello, GBNF, strategia) migliora davvero, non a
 * guidare l'estrazione.
 */

import { normalizeDateValue } from './polizzaDates.js'
import {
  parsePureAmount, looseAmount, normForMatch, validateCodiceFiscaleIva,
} from './polizzaValidation.js'

// Normalizza una label per il confronto label→campo (minuscole, senza accenti,
// senza punteggiatura: "N° Polizza" == "n polizza"). Caso d'uso: il golden usa
// le label, l'estrazione usa gli id del profilo.
export function normLabel(label) {
  return String(label || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Fascicolo di riferimento (EULIP, 45 PDF).
 * Valori da CLAUDE.md — taratura, non un secondo prompt.
 *
 * `mode` dice come confrontare:
 *   exact    — stringa identica dopo trim
 *   text     — uguaglianza sul testo normalizzato (case/accenti/spazi)
 *   date     — GG/MM/AAAA dopo normalizeDateValue
 *   amount   — stesso numero (parsePureAmount, fallback looseAmount)
 *   vat      — checksum P.IVA/CF, poi uguaglianza del valore riparato
 *   contains — il valore atteso (normalizzato) è contenuto nell'estratto
 */
export const EULIP_EXPECTED = {
  id: 'eulip',
  label: 'Fascicolo EULIP (45 PDF)',
  // Chiavi = LABEL dei campi (stabili e leggibili). Gli id dei campi ora sono
  // UUID casuali: il golden NON può dipendere da loro. scoreExtraction risolve
  // la label verso il campo estratti tramite `fieldDefs` (se passato) o
  // direttamente se l'estrazione usa chiavi-label.
  fields: {
    'N° Polizza': { value: '283618616',     mode: 'exact' },
    'P. IVA / Cod. Fiscale': { value: '00151510344',   mode: 'vat' },
    'Decorrenza': { value: '31/12/2024',    mode: 'date' },
    'Scadenza': { value: '31/12/2025',    mode: 'date' },
    'Massimale per sinistro': { value: '4.000.000,00',  mode: 'amount' },
    'Imposta': { value: '1.001,25',      mode: 'amount' },
    'Premio totale': { value: '5.501,25',      mode: 'amount' },
    'Agenzia': { value: 'ACQUI TERME',   mode: 'text' },
    'Parametro regolazione': {                                    // rct_parametro
      value: 'retribuzioni',
      mode: 'contains',
      // Bug storico: il modello copiava l'intestazione di colonna "Premi".
      forbidden: ['Premi', 'Premio', 'Consuntivo', 'Preventivo'],
    },
    'Importo preventivo parametro': { value: '1.800.000',     mode: 'amount' },
  },
}

function actualMap(extracted) {
  if (!extracted || typeof extracted !== 'object' || Array.isArray(extracted)) return {}
  const src = extracted.data && typeof extracted.data === 'object' && !Array.isArray(extracted.data)
    ? extracted.data
    : extracted
  const out = {}
  for (const [k, v] of Object.entries(src)) {
    if (v == null) continue
    // Motore a stadi / rolling: { valore, evidenza, … } oppure stringa piatta.
    const raw = (typeof v === 'object' && v !== null && 'valore' in v) ? v.valore : v
    const s = String(raw ?? '').trim()
    if (s) out[k] = s
  }
  return out
}

function isForbidden(actual, forbidden) {
  if (!actual || !Array.isArray(forbidden) || !forbidden.length) return false
  const na = normForMatch(actual)
  if (!na) return false
  const tokens = String(actual)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  return forbidden.some((f) => {
    const nf = normForMatch(f)
    if (!nf) return false
    // Intero valore = parola vietata, oppure la parola compare come token
    // ("Premi", "Premi RCT"). "retribuzioni" non contiene il token "premi".
    return na === nf || tokens.includes(nf)
  })
}

function amountOf(v) {
  return parsePureAmount(v) ?? looseAmount(v)
}

/**
 * Confronta un valore estratto con la spec del golden.
 * @returns {{ status: 'exact'|'normalized'|'mismatch'|'missing'|'forbidden', reason?: string }}
 */
export function compareField(spec, actualRaw) {
  const actual = actualRaw == null ? '' : String(actualRaw).trim()
  if (!actual) return { status: 'missing' }
  if (isForbidden(actual, spec?.forbidden)) {
    return { status: 'forbidden', reason: `valore vietato: "${actual}"` }
  }

  const expected = spec?.value
  const mode = spec?.mode || 'text'

  if (mode === 'exact') {
    return actual === String(expected) ? { status: 'exact' } : { status: 'mismatch' }
  }
  if (mode === 'text') {
    const a = normForMatch(actual)
    const e = normForMatch(expected)
    if (a && a === e) return actual === String(expected) ? { status: 'exact' } : { status: 'normalized' }
    return { status: 'mismatch' }
  }
  if (mode === 'date') {
    const a = normalizeDateValue(actual)
    const e = normalizeDateValue(expected)
    if (!a || !e) return { status: 'mismatch' }
    if (a === e) return actual === String(expected) ? { status: 'exact' } : { status: 'normalized' }
    return { status: 'mismatch' }
  }
  if (mode === 'amount') {
    const a = amountOf(actual)
    const e = amountOf(expected)
    if (a == null || e == null) return { status: 'mismatch' }
    if (a === e) {
      // Stessa cifra: "exact" solo se la stringa (trim) coincide, altrimenti
      // "1.800.000" vs "1.800.000,00" è un match normalizzato — corretto.
      return actual === String(expected).trim() ? { status: 'exact' } : { status: 'normalized' }
    }
    return { status: 'mismatch' }
  }
  if (mode === 'vat') {
    const a = validateCodiceFiscaleIva(actual)
    const e = validateCodiceFiscaleIva(expected) || String(expected)
    if (!a) return { status: 'mismatch' }
    if (a === e) return actual === e ? { status: 'exact' } : { status: 'normalized' }
    return { status: 'mismatch' }
  }
  if (mode === 'contains') {
    const a = normForMatch(actual)
    const e = normForMatch(expected)
    if (a && e && a.includes(e)) {
      return a === e ? { status: 'exact' } : { status: 'normalized' }
    }
    return { status: 'mismatch' }
  }
  return actual === String(expected) ? { status: 'exact' } : { status: 'mismatch' }
}

/**
 * Punteggio di un'estrazione contro un golden set.
 *
 * Metriche:
 *  - fieldMatchRate  = (exact + normalized) / campi attesi  — "quanto abbiamo preso"
 *  - exactMatchRate  = exact / campi attesi
 *  - hallucinationRate = (mismatch + forbidden) / campi estratti che erano attesi
 *    (un campo atteso sbagliato è un'allucinazione; un campo extra non in golden
 *    è riportato ma non entra nel tasso: il golden non copre tutti i campi)
 *
 * @param {object} extracted  {data} o mappa piatta campo→valore
 * @param {object} [expected] golden (default EULIP_EXPECTED)
 */
export function scoreExtraction(extracted, expected = EULIP_EXPECTED) {
  const got = actualMap(extracted)
  const specs = expected?.fields || {}
  const perField = {}
  const counts = { exact: 0, normalized: 0, mismatch: 0, missing: 0, forbidden: 0 }

  // Mappa label → id campo (estrazioni moderne con chiavi UUID/c0): il golden
  // usa LABEL stabili, l'estratto usa gli id del profilo.
  const labelToId = new Map()
  for (const f of Array.isArray(expected?.fieldDefs) ? expected.fieldDefs : []) {
    if (f?.label) labelToId.set(normLabel(f.label), f.id)
  }

  for (const [key, spec] of Object.entries(specs)) {
    const k = (key in got)
      ? key
      : (labelToId.get(normLabel(key)) && labelToId.get(normLabel(key)) in got ? labelToId.get(normLabel(key)) : key)
    const cmp = compareField(spec, got[k])
    perField[key] = {
      expected: spec.value,
      actual: got[k] || '',
      mode: spec.mode || 'text',
      ...cmp,
    }
    counts[cmp.status] = (counts[cmp.status] || 0) + 1
  }

  const extra = Object.keys(got).filter((k) => !(k in specs))
  const expectedN = Object.keys(specs).length
  const matched = counts.exact + counts.normalized
  const extractedExpected = expectedN - counts.missing
  const wrong = counts.mismatch + counts.forbidden

  return {
    dossier: expected?.id || 'unknown',
    label: expected?.label || '',
    expected: expectedN,
    matched,
    counts,
    extra,
    extraCount: extra.length,
    exactMatchRate: expectedN ? counts.exact / expectedN : 0,
    fieldMatchRate: expectedN ? matched / expectedN : 0,
    hallucinationRate: extractedExpected ? wrong / extractedExpected : 0,
    perField,
  }
}

/** Tabella testo per log / CLI. */
export function formatScoreReport(score) {
  const pct = (n) => `${Math.round((n || 0) * 1000) / 10}%`
  const rows = Object.entries(score.perField || {}).map(([id, r]) => {
    const mark = {
      exact: 'OK ',
      normalized: 'OK~',
      mismatch: 'NO ',
      missing: '—  ',
      forbidden: 'NO!',
    }[r.status] || r.status
    return `  ${mark} ${id.padEnd(28)} atteso=${String(r.expected).padEnd(16)} ottenuto=${r.actual || '∅'}${r.reason ? `  (${r.reason})` : ''}`
  })
  return [
    `Eval ${score.dossier}${score.label ? ` — ${score.label}` : ''}`,
    `  match ${score.matched}/${score.expected} (${pct(score.fieldMatchRate)})  exact ${pct(score.exactMatchRate)}  allucinazioni ${pct(score.hallucinationRate)}  extra ${score.extraCount}`,
    ...rows,
  ].join('\n')
}

/**
 * Punteggio a VERITÀ PIENA (Regola 4): OGNI campo del profilo ha una verità —
 * un valore o VUOTO (`value: null`) — e il punteggio è giusti/N con N =
 * campi del profilo. Un campo lasciato vuoto quando la verità è vuota è
 * GIUSTO (lo scorer storico lo contava «mancante»); un valore dove la verità
 * è vuota è SBAGLIATO. Modalità in più rispetto a compareField:
 *   yes       — risposta affermativa (Sì/Si/Yes)
 *   emptyOrNo — vuoto oppure «No»
 *   anyof     — l'estratto contiene uno dei `values` (normalizzati)
 * I campi del profilo senza verità nel golden sono riportati a parte
 * (`noTruth`) e contano come SBAGLIATI: la misura non si fa su selezioni.
 * @param {object} extracted  {data} o mappa piatta id→valore
 * @param {{fields:object}} golden  chiavi = label del campo
 * @param {{id:string,label:string}[]} fieldDefs  campi attivi del profilo
 */
export function scoreFullTruth(extracted, golden, fieldDefs) {
  const got = actualMap(extracted)
  // «Label#N» = il campo di INDICE N (da 0) del profilo: per le label doppie
  // (RC PROF MED V2 ha due «Frazionamento», indici 10 e 28).
  const byLabel = new Map()
  const byPos = new Map()
  for (const [label, spec] of Object.entries(golden?.fields || {})) {
    const m = label.match(/^(.*)#(\d+)$/)
    if (m) byPos.set(Number(m[2]), spec)
    else byLabel.set(normLabel(label), spec)
  }
  const isYes = (s) => /^(si|sì|yes|s)$/i.test(normForMatch(s).replace(/[^a-z]/g, '') || '')
  const isNo = (s) => /^(no|n)$/i.test(normForMatch(s).replace(/[^a-z]/g, '') || '')
  const rows = []
  let right = 0
  const noTruth = []
  for (const [i, f] of (fieldDefs || []).entries()) {
    const spec = byPos.get(i) || byLabel.get(normLabel(f.label))
    const actual = got[f.id] || ''
    let ok = false
    let why = ''
    if (!spec) { noTruth.push(f.label); why = 'nessuna verità nel golden' }
    else {
      const mode = spec.mode || 'text'
      const expectEmpty = spec.value == null && mode !== 'anyof'
      if (mode === 'emptyOrNo') ok = !actual || isNo(actual)
      else if (expectEmpty) ok = !actual
      else if (!actual) ok = false
      else if (mode === 'yes') ok = isYes(actual)
      else if (mode === 'anyof') ok = (spec.values || []).some((v) => normForMatch(actual).includes(normForMatch(v)))
      else { const st = compareField(spec, actual).status; ok = st === 'exact' || st === 'normalized' }
      if (!ok) why = expectEmpty ? 'doveva restare vuoto' : (!actual ? 'mancante' : 'valore sbagliato')
    }
    if (ok) right++
    rows.push({ label: f.label, id: f.id, expected: spec ? (spec.mode === 'anyof' ? (spec.values || []).join('|') : spec.value) : undefined, actual, ok, why })
  }
  return { dossier: golden?.id || 'unknown', label: golden?.label || '', right, total: (fieldDefs || []).length, noTruth, rows }
}

/** Tabella testo del punteggio a verità piena. */
export function formatFullTruthReport(s) {
  const pct = s.total ? Math.round((s.right / s.total) * 1000) / 10 : 0
  return [
    `Eval ${s.dossier}${s.label ? ` — ${s.label}` : ''}`,
    `  giusti ${s.right}/${s.total} (${pct}%)${s.noTruth.length ? `  · senza verità: ${s.noTruth.length}` : ''}`,
    ...s.rows.map((r) => `  ${r.ok ? 'OK ' : 'NO '} ${String(r.label).padEnd(40)} atteso=${String(r.expected ?? '∅').slice(0, 30).padEnd(30)} ottenuto=${r.actual ? String(r.actual).slice(0, 60) : '∅'}${r.why ? `  (${r.why})` : ''}`),
  ].join('\n')
}
