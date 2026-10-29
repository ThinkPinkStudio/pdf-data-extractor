/**
 * RIEPILOGO GENERALE (26/09/2026) — modulo PURO.
 *
 * Il cliente seleziona X polizze ESTRATTE dello stesso profilo e ottiene un
 * riepilogo salvato: dati sommati dove ha senso, andamenti per anno, confronto
 * tra due anni. Qui c'è tutta la logica che non tocca il database: lettura dei
 * valori, tipo dei campi, statistiche, default delle preferenze, ammissione dei
 * job, stato dei membri e la funzione d'ingresso `summarize`.
 *
 * Regole (CLAUDE.md, REGOLE_AGENTI.md):
 *  - il TIPO di un campo si legge SOLO dalla DESCRIZIONE (fieldValueKind,
 *    fieldAsksIdentifier, descriptionAsksVerification, structuralNature: tutti
 *    sulla testa della descrizione), MAI da id o label. Un test lo verifica
 *    sostituendo tutte le label;
 *  - nessun valore di un campo viene deciso qui: si LEGGONO i valori estratti.
 *    Le poche regole sui dati (valori tutti diversi, più valori numerici, meno
 *    valori distinti) scelgono solo i DEFAULT di visualizzazione, sono
 *    dichiarate qui sotto e l'utente le cambia in «Personalizza»;
 *  - Regola 4: la completezza ha per denominatore TUTTI i campi del profilo di
 *    riferimento × le polizze, nessuna selezione;
 *  - nessun I/O, nessun Date.now(): la data di oggi arriva come parametro
 *    `today` ('GG/MM/AAAA', calcolata dal server in Europe/Rome).
 *
 * Lo carica solo il server (importSharedService('summaryAggregate.js')); il
 * client riceve tipi e aggregati già calcolati.
 *
 * Test: test/summaryAggregate.test.mjs.
 */

import { createHash } from 'node:crypto'
import { fieldValueKind } from './gbnfSchema.js'
import { fieldAsksIdentifier, isAbsencePlaceholder } from './polizzaValidation.js'
import {
  descriptionAsksVerification, verificationAnswers, canonicalVerificationAnswer, positiveDescriptionHead,
} from './polizzaFieldKind.js'
// structuralNature: SOLO la classe binaria (limite o condizione — massimale,
// franchigia, scoperto, limite di indennizzo — contro importo periodico). La
// natura fine sbaglia su profili reali («Massimale per sinistro» di CSA RC
// Professionale esce «franchigia»), la classe no: legge la sola testa della
// descrizione, mai id o label.
import { parseAmountMaybe, structuralNature } from './polizzaNumericScan.js'
import { normalizeDateValue } from './polizzaDates.js'

// ─── Costanti ────────────────────────────────────────────────────────────────

/** Operazioni ammesse per un importo, nell'ordine canonico delle righe. */
export const AMOUNT_OPS = ['sum', 'avg', 'minmax']
/** Operazioni ammesse per un tasso: la somma di tassi non ha significato. */
export const RATE_OPS = ['avg', 'minmax']
/** Scelte di righe della Tabella per anno. */
export const TABLE_ROWS = ['amounts', 'amountsCounts', 'all']
/** Chiave di abbinamento «nome della cartella» del Confronto. */
export const DOSSIER_KEY = '@dossier'
export const MAX_HIGHLIGHTS = 4
export const MAX_MATCH_FIELDS = 3
export const MAX_SUMMARY_JOBS = 2000
export const DEFAULT_DUE_DAYS = 90
/** Chiavi speciali dei gruppi: textKey non produce mai '_', quindi non collidono. */
export const OTHER_KEY = '__other'
export const EMPTY_KEY = '__empty'

const GROUP_ROWS = 4            // righe della carta del gruppo e della Tabella (poi «Altri valori»)
const GROUP_MENU = 12           // voci del filtro «Tutti · {campo}»
const TEXT_TOP = 10             // valori più frequenti di un testo
const SHIFT_ROWS = 6            // righe del gruppo nel Confronto
const YEAR_BARS = 8             // colonne del grafico per anno
const VALUES_MODE_MAX = 6       // fino a 6 valori distinti: un secchio per valore
const MAX_BANDS = 8
const UNIQUE_MIN_FILLED = 5     // «valori tutti diversi»: da 5 polizze in su…
const UNIQUE_MIN_RATIO = 0.9    // …con almeno il 90% di valori distinti

const cmpIt = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'it')
const clean = (x) => (x == null || !Number.isFinite(x) ? (x ?? null) : Number(x.toPrecision(15)))

// ─── Lettura dei valori ──────────────────────────────────────────────────────

/** Vuoto: null/undefined, stringa vuota o segnaposto di ASSENZA («n/d», «-», «non indicato»…). */
export function isEmpty(raw) {
  if (raw == null) return true
  const s = String(raw).trim()
  if (!s) return true
  return isAbsencePlaceholder(s)
}

// Formati INGLESI che il parser del motore (italiano: la virgola è il
// decimale) leggerebbe male in silenzio — «1,234.56» diventava 1,23456 € ed
// entrava nelle somme. Riconosciuti qui: virgole di migliaia con punto
// decimale, oppure più gruppi di migliaia a virgola («1,234,567»). Una sola
// virgola seguita da tre cifre con la prima cifra diversa da 0 («1,234») è
// AMBIGUA (migliaia inglesi o tre decimali italiani): non numerica, così si
// vede tra i valori «non numerici esclusi» invece di finire nei totali.
const EN_DECIMAL = /^-?\d{1,3}(?:,\d{3})+\.\d{1,2}$/
const EN_THOUSANDS = /^-?\d{1,3}(?:,\d{3}){2,}$/
const AMBIGUOUS_COMMA = /^-?[1-9]\d{0,2},\d{3}$/
const amountToken = (raw) => String(raw).replace(/€/g, ' ').replace(/\bEuro\b/gi, ' ').replace(/\bEUR\b/g, ' ').replace(/\s+/g, '')

/**
 * Importo → numero, null se vuoto o non numerico («Illimitato», «10%»). Usa il
 * parser del motore: «1.234,56», «€ 1.000», «10689.58», «0,00» (= 0, è un
 * valore); prima riconosce i formati inglesi e scarta quelli ambigui (sopra).
 */
export function parseAmount(raw) {
  if (isEmpty(raw)) return null
  const tok = amountToken(raw)
  if (EN_DECIMAL.test(tok) || EN_THOUSANDS.test(tok)) {
    const n = Number(tok.replace(/,/g, ''))
    return Number.isFinite(n) ? n : null
  }
  if (AMBIGUOUS_COMMA.test(tok)) return null
  return parseAmountMaybe(raw)
}

/**
 * Tasso → numero. Parser apposito: parseAmountMaybe('0.245') vale 245.
 * Toglie %, ‰ e «per mille/per cento». Con «.» e «,» insieme il formato è
 * italiano (punti = migliaia, virgola = decimale); con un solo separatore che
 * compare una volta quello è il decimale; ripetuto è un separatore di migliaia.
 */
export function parseRate(raw) {
  if (isEmpty(raw)) return null
  let s = String(raw).replace(/%|‰|\b(?:per|pro)\s*(?:mille|cento)\b/gi, '').replace(/\s+/g, '')
  if (!/^-?[\d.,]+$/.test(s) || !/\d/.test(s)) return null
  const dots = (s.match(/\./g) || []).length
  const commas = (s.match(/,/g) || []).length
  if (dots && commas) s = s.replace(/\./g, '').replace(',', '.')
  else if (commas) s = commas === 1 ? s.replace(',', '.') : s.replace(/,/g, '')
  else if (dots > 1) s = s.replace(/\./g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const DATE_IN_TEXT = /(?<!\d)\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}(?!\d)/
const ISO_IN_TEXT = /(?<!\d)\d{4}-\d{1,2}-\d{1,2}(?!\d)/

/**
 * Data → { str: 'GG/MM/AAAA', y, m, d, day } (day = giorni dall'epoca, UTC,
 * senza ora locale) oppure null. Prima il normalizzatore del motore sul valore
 * intero, poi la prima data contenuta nel testo («dal 31/12/2024»). La data
 * deve ESISTERE nel calendario: «31/02/2025» (che il normalizzatore lascia
 * passare: controlla solo giorno ≤ 31 e mese ≤ 12) è non valida, invece di
 * diventare il 03/03/2025 nell'Excel e nelle scadenze.
 */
export function parseDate(raw) {
  if (isEmpty(raw)) return null
  const s = String(raw).trim()
  let str = normalizeDateValue(s)
  if (!str) {
    const m = s.match(DATE_IN_TEXT) || s.match(ISO_IN_TEXT)
    if (m) str = normalizeDateValue(m[0])
  }
  if (!str) return null
  const [d, m, y] = str.split('/').map(Number)
  const t = Date.UTC(y, m - 1, d)
  const back = new Date(t)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null
  return { str, y, m, d, day: t / 86400000 }
}

/** Chiave di un testo: senza accenti, maiuscola, solo [A-Z0-9] («D.A.S.», «das » e «DAS» coincidono). */
export function textKey(raw) {
  if (raw == null) return ''
  return String(raw).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Risposta di un campo di VERIFICA: la grafia della descrizione («SI» → «Sì»),
 * poi la prima parola («Sì, massimale…» → «Sì»), altrimenti OTHER_KEY. Null se
 * vuoto. Se la descrizione non cita risposte: il valore ripulito (si conta
 * come un testo).
 */
export function checkAnswer(field, raw) {
  if (isEmpty(raw)) return null
  const direct = canonicalAnswer(field, String(raw).trim())
  if (direct === undefined) return String(raw).trim()
  if (direct) return direct
  const first = String(raw).trim().split(/[\s,;:.()/-]+/).filter(Boolean)[0] || ''
  return canonicalAnswer(field, first) || OTHER_KEY
}

const foldAnswer = (x) => String(x || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/**
 * Grafia canonica di una risposta (canonicalVerificationAnswer del motore):
 * undefined se il campo non cita risposte, null se la risposta non è tra
 * quelle citate. In una FOTOGRAFIA le risposte sono quelle congelate
 * (frozenKind), così un ritocco del motore non cambia i numeri consegnati.
 */
function canonicalAnswer(field, value) {
  const fz = frozenKind(field)
  if (!fz) return canonicalVerificationAnswer(field?.description || '', value)
  const answers = Array.isArray(fz.answers) ? fz.answers : []
  if (!answers.length) return undefined
  const k = foldAnswer(value)
  return answers.find((a) => foldAnswer(a) === k) || null
}

/** Valori piatti di uno stato rolling ({id: {valore}} o {id: 'x'}): stessa regola di flattenRollingState. */
export function flattenValues(state) {
  const flat = {}
  for (const [key, entry] of Object.entries(state || {})) {
    if (entry == null) continue
    if (typeof entry === 'object' && 'valore' in entry) {
      const v = entry.valore
      if (v != null && v !== '') flat[key] = String(v)
    } else if ((typeof entry === 'string' || typeof entry === 'number') && entry !== '') {
      flat[key] = String(entry)
    }
  }
  return flat
}

// ─── Tipo di un campo (solo dalla descrizione) ───────────────────────────────

/**
 * Unità di un importo, solo per la visualizzazione: 'num' se la testa positiva
 * della descrizione comincia con «Numero…» («Numero di professionisti…»),
 * altrimenti 'eur'. Nessun vocabolario copiato dal motore.
 */
function amountUnit(field) {
  return /^\s*numero\b/i.test(positiveDescriptionHead(field?.description || '')) ? 'num' : 'eur'
}

const KINDS = new Set(['identifier', 'check', 'date', 'amount', 'rate', 'text'])

/** Solo le voci note di una classificazione (niente altro finisce nel database). */
function cleanKind(c) {
  const out = { kind: c.kind }
  if (c.kind === 'identifier') out.idKind = c.idKind === 'vat' ? 'vat' : 'document'
  if (c.kind === 'check') out.answers = (Array.isArray(c.answers) ? c.answers : []).filter((a) => typeof a === 'string').slice(0, 20)
  if (c.kind === 'amount') { out.unit = c.unit === 'num' ? 'num' : 'eur'; out.structural = !!c.structural }
  return out
}

/**
 * Classificazione CONGELATA di un campo (fotografia): `frozen` è scritto da
 * freezeField quando si scatta la fotografia, così tipo, unità, natura e
 * risposte non si ricalcolano più con le funzioni del motore (che si ritoccano
 * spesso). Null se il campo non è congelato (valori aggiornati).
 */
export function frozenKind(field) {
  const c = field && field.frozen
  return c && typeof c === 'object' && KINDS.has(c.kind) ? cleanKind(c) : null
}

/** Definizione del campo con la classificazione di OGGI congelata (una già congelata resta com'è). */
export function freezeField(field) {
  return { ...defShape(field), frozen: cleanKind(classifyField(field)) }
}

/**
 * Tipo di un campo per il riepilogo, nell'ordine vincolante:
 * identificativo (P.IVA/CF 'vat' o numero di documento) → verifica («Verifica
 * se…», con le risposte citate) → data / importo / tasso (fieldValueKind) →
 * testo. Gli importi portano `unit` e `structural` (limite o condizione).
 * Un campo congelato in una fotografia (frozenKind) tiene la classificazione
 * di allora.
 */
export function classifyField(field) {
  const f = field || {}
  const fz = frozenKind(f)
  if (fz) return fz
  if (fieldAsksIdentifier(f)) return { kind: 'identifier', idKind: fieldValueKind(f) === 'vat' ? 'vat' : 'document' }
  if (descriptionAsksVerification(f.description)) return { kind: 'check', answers: verificationAnswers(f.description) }
  const vk = fieldValueKind(f)
  if (vk === 'date') return { kind: 'date' }
  if (vk === 'amount') return { kind: 'amount', unit: amountUnit(f), structural: !!structuralNature(f) }
  if (vk === 'rate') return { kind: 'rate' }
  return { kind: 'text' }
}

const isNumericKind = (k) => k === 'amount' || k === 'rate'
const allowedOps = (kind) => (kind === 'amount' ? AMOUNT_OPS : kind === 'rate' ? RATE_OPS : [])

/** Calcolo di default di un campo numerico: media per limiti/condizioni e tassi, somma per gli altri importi. */
export function defaultOp(field) {
  const c = field && field.kind ? field : classifyField(field)
  if (c.kind === 'rate') return 'avg'
  if (c.kind === 'amount') return c.structural ? 'avg' : 'sum'
  return null
}

function readNumber(kind, raw) {
  return kind === 'rate' ? parseRate(raw) : parseAmount(raw)
}

/**
 * Metadati di un campo su TUTTE le polizze del riepilogo (mai sull'insieme
 * filtrato: un campo non deve cambiare gruppo quando cambiano i filtri).
 * - unique: testo con ≥5 valori, ≥90% distinti DENTRO OGNI ANNO → «per
 *   polizza» (non aggregato). Per anno perché un rinnovo ripete il contraente
 *   l'anno dopo: su 48 polizze in 5 anni il contraente non è mai «tutto
 *   diverso» sull'insieme, lo è in ogni anno. La compagnia si ripete nello
 *   stesso anno e resta un testo aggregabile;
 * - textLike: importo/tasso con 0 valori numerici e ≥1 non numerico → si
 *   mostra come testo e non entra nei default di calcoli, evidenza e
 *   distribuzione («annuale», «10%», «Illimitato»).
 */
function describeField(field, policies) {
  const c = classifyField(field)
  let filled = 0
  let numeric = 0
  let nonzero = 0
  let nonNumeric = 0
  const distinct = new Set()
  const perYear = new Map() // anno → chiavi distinte (solo testi, per `unique`)
  for (const p of policies) {
    const raw = p.values?.[field.id]
    if (isEmpty(raw)) continue
    filled++
    if (isNumericKind(c.kind)) {
      const n = readNumber(c.kind, raw)
      if (n == null) { nonNumeric++; continue }
      numeric++
      if (n !== 0) nonzero++
      distinct.add(n)
    } else if (c.kind === 'check') {
      const a = checkAnswer(field, raw)
      distinct.add(a === OTHER_KEY ? OTHER_KEY : textKey(a))
    } else {
      const k = textKey(raw)
      distinct.add(k)
      const y = p.year ?? null
      if (!perYear.has(y)) perYear.set(y, new Set())
      perYear.get(y).add(k)
    }
  }
  const distinctInYears = [...perYear.values()].reduce((a, s) => a + s.size, 0)
  const unique = c.kind === 'text' && filled >= UNIQUE_MIN_FILLED && distinctInYears / filled >= UNIQUE_MIN_RATIO
  const textLike = isNumericKind(c.kind) && numeric === 0 && nonNumeric > 0
  let group = c.kind
  if (unique) group = 'identifier'
  else if (textLike) group = 'text'
  return {
    id: field.id,
    label: field.label ?? field.id,
    kind: c.kind,
    idKind: c.idKind ?? null,
    unit: c.unit ?? null,
    answers: c.answers ?? null,
    structural: !!c.structural,
    unique,
    textLike,
    group,
    filled,
    empty: policies.length - filled,
    numeric,
    nonzero,
    nonNumeric,
    distinct: distinct.size,
    // definizione originale (serve a checkAnswer); il server la toglie dalla risposta se vuole
    _def: field,
  }
}

function describeFields(fields, policies) {
  return (fields || []).filter((f) => f && f.id).map((f) => describeField(f, policies))
}

const publicField = (d) => {
  const { _def, nonzero, nonNumeric, numeric, distinct, ...rest } = d // eslint-disable-line no-unused-vars
  return { ...rest, numeric, nonNumeric }
}

// ─── Anni ────────────────────────────────────────────────────────────────────

/** Anno di una polizza dal campo «Anno da»; null = «Senza anno». */
export function yearOf(policy, yearFieldId) {
  if (!yearFieldId) return null
  return parseDate(policy?.values?.[yearFieldId])?.y ?? null
}

const yearOfToday = (today) => parseDate(today)?.y ?? null
const policyYear = (p, yearFieldId) => (p && 'year' in p && p.year !== undefined ? p.year : yearOf(p, yearFieldId))

/** [{ year, count, inProgress }] crescenti, più { year: null, count } se ci sono polizze senza anno. */
export function yearsOf(policies, yearFieldId, today) {
  const cur = yearOfToday(today)
  const counts = new Map()
  let none = 0
  for (const p of policies || []) {
    const y = policyYear(p, yearFieldId)
    if (y == null) none++
    else counts.set(y, (counts.get(y) || 0) + 1)
  }
  const out = [...counts].sort((a, b) => a[0] - b[0]).map(([year, count]) => ({ year, count, inProgress: cur != null && year >= cur }))
  if (none) out.push({ year: null, count: none, inProgress: false })
  return out
}

const numericYears = (years) => [...new Set((years || []).map((y) => (typeof y === 'object' && y ? y.year : y)).filter((y) => typeof y === 'number'))].sort((a, b) => a - b)

/** Anno di riferimento: il più recente con dati prima dell'anno in corso; altrimenti il più recente; null senza anni. */
export function referenceYear(years, today) {
  const ys = numericYears(years)
  if (!ys.length) return null
  const cur = yearOfToday(today)
  const past = cur == null ? ys : ys.filter((y) => y < cur)
  return past.length ? past[past.length - 1] : ys[ys.length - 1]
}

/** L'anno più recente CON DATI prima di `year` (anni con buchi: 2022 → 2024 se il 2023 manca), o null. */
export function previousYear(years, year) {
  if (year == null) return null
  const ys = numericYears(years).filter((y) => y < year)
  return ys.length ? ys[ys.length - 1] : null
}

// ─── Statistiche ─────────────────────────────────────────────────────────────

/** { n, sum, avg, median, min, max } dei numeri; con n = 0 tutto null tranne n. */
export function numStats(nums) {
  const xs = (nums || []).filter((x) => typeof x === 'number' && Number.isFinite(x))
  const n = xs.length
  if (!n) return { n: 0, sum: null, avg: null, median: null, min: null, max: null }
  const s = [...xs].sort((a, b) => a - b)
  const sum = xs.reduce((a, b) => a + b, 0)
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
  return { n, sum: clean(sum), avg: clean(sum / n), median: clean(median), min: s[0], max: s[n - 1] }
}

/** Valore di un'operazione sui numeri: sum/avg → numero, minmax → {min,max}, count → n; null senza numeri. */
export function aggregate(op, nums) {
  const st = numStats(nums)
  if (op === 'count') return st.n
  if (!st.n) return null
  if (op === 'sum') return st.sum
  if (op === 'avg') return st.avg
  if (op === 'minmax') return { min: st.min, max: st.max }
  return null
}

/** { a, b, abs: b − a, pct: (b − a)/|a| }: abs null se manca un lato, pct null anche se a = 0. */
export function delta(a, b) {
  const num = (x) => typeof x === 'number' && Number.isFinite(x)
  const abs = num(a) && num(b) ? clean(b - a) : null
  const pct = abs != null && a !== 0 ? (b - a) / Math.abs(a) : null
  return { a: num(a) ? a : null, b: num(b) ? b : null, abs, pct }
}

/**
 * Copertura di un calcolo: n valori numerici su `of` polizze. Una SOMMA con
 * polizze senza valore (vuote o non numeriche) non è confrontabile con quella
 * di un altro anno: 6 premi su 10 non sono un calo del 40%. Il delta di una
 * somma con copertura incompleta in uno dei due anni porta `partial: true`
 * (l'interfaccia non lo colora e dice quante polizze hanno il valore); medie e
 * minimo–massimo si calcolano sui soli valori presenti e restano confrontabili.
 */
const coverage = (nums, ps) => ({ n: nums.length, of: ps.length })
function withCoverage(d, op, ca, cb) {
  if (!d) return null
  return { ...d, cov: { a: ca, b: cb }, partial: op === 'sum' && !!ca && !!cb && (ca.n < ca.of || cb.n < cb.of) }
}

function mostFrequentSpelling(spellings) {
  let best = null
  let bestN = 0
  for (const [s, n] of spellings) if (n > bestN) { best = s; bestN = n }
  return best
}

/**
 * Conteggio per chiave normalizzata (textKey), per conteggio decrescente e a
 * parità per etichetta (localeCompare 'it'). Etichetta = grafia più frequente
 * (a parità la prima incontrata). { items: primi N, other: { count, distinct }, empty, distinct }.
 */
export function valueCounts(raws, topN = TEXT_TOP) {
  const map = new Map()
  let empty = 0
  for (const raw of raws || []) {
    if (isEmpty(raw)) { empty++; continue }
    const label = String(raw).trim()
    const key = textKey(label) || label
    let e = map.get(key)
    if (!e) { e = { key, count: 0, spellings: new Map() }; map.set(key, e) }
    e.count++
    e.spellings.set(label, (e.spellings.get(label) || 0) + 1)
  }
  const all = [...map.values()].map((e) => ({ key: e.key, label: mostFrequentSpelling(e.spellings), count: e.count }))
  all.sort((a, b) => b.count - a.count || cmpIt(a.label, b.label))
  const items = all.slice(0, topN)
  const rest = all.slice(topN)
  return { items, other: { count: rest.reduce((a, e) => a + e.count, 0), distinct: rest.length }, empty, distinct: all.length }
}

function bandEdges(lo, hi) {
  const raw = (hi - lo) / 5
  if (!(raw > 0) || !Number.isFinite(raw)) return null
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  let step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw * (1 - 1e-12)) ?? 10 * mag
  for (;;) {
    const first = Math.floor(lo / step) * step
    const last = Math.ceil(hi / step) * step
    const count = Math.round((last - first) / step)
    if (count <= MAX_BANDS || !Number.isFinite(count)) {
      const edges = []
      for (let i = 0; i <= Math.max(count, 1); i++) edges.push(clean(first + i * step))
      return edges
    }
    step *= 2
  }
}

/**
 * Fasce di un campo numerico (deterministiche).
 * - fino a 6 valori distinti: modo 'values', un secchio per valore crescente;
 * - altrimenti 'bands': 5° e 95° percentile per rango più vicino, passo
 *   «tondo» (1/2/2,5/5/10 × 10^k) ≥ (hi − lo)/5, al massimo 8 fasce
 *   (altrimenti passo doppio), fasce aperte «< primo bordo» / «≥ ultimo
 *   bordo» se servono, fasce intermedie vuote tenute a 0. Fasce [da, a).
 * - percentili coincidenti (93 polizze su 100 alla stessa tariffa): minimo e
 *   massimo; se coincidono anche quelli, i primi 6 valori più «altri».
 * { mode, items: [{ from, to, open, count }], empty, other }
 */
export function buckets(nums, empty = 0) {
  const xs = (nums || []).filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
  const distinct = [...new Set(xs)]
  const valuesMode = (limit) => {
    const counts = new Map()
    for (const x of xs) counts.set(x, (counts.get(x) || 0) + 1)
    const shown = distinct.slice(0, limit)
    const other = distinct.slice(limit).reduce((a, v) => a + counts.get(v), 0)
    return { mode: 'values', items: shown.map((v) => ({ from: v, to: v, open: null, count: counts.get(v) })), empty, other }
  }
  if (distinct.length <= VALUES_MODE_MAX) return valuesMode(VALUES_MODE_MAX)
  const n = xs.length
  let lo = xs[Math.max(0, Math.ceil(0.05 * n) - 1)]
  let hi = xs[Math.max(0, Math.ceil(0.95 * n) - 1)]
  if (!(hi > lo)) { lo = xs[0]; hi = xs[n - 1] }
  const edges = hi > lo ? bandEdges(lo, hi) : null
  if (!edges || edges.length < 2) return valuesMode(VALUES_MODE_MAX)
  const first = edges[0]
  const last = edges[edges.length - 1]
  const items = []
  if (xs[0] < first) items.push({ from: null, to: first, open: 'below', count: 0 })
  for (let i = 0; i < edges.length - 1; i++) items.push({ from: edges[i], to: edges[i + 1], open: null, count: 0 })
  if (xs[n - 1] >= last) items.push({ from: last, to: null, open: 'above', count: 0 })
  for (const x of xs) {
    const it = items.find((b) => (b.open === 'below' ? x < b.to : b.open === 'above' ? x >= b.from : x >= b.from && x < b.to))
    if (it) it.count++
  }
  return { mode: 'bands', items, empty, other: 0 }
}

/**
 * Completezza (Regola 4): valori pieni su campi del profilo × polizze.
 * mostEmpty: i primi 3 campi con almeno un vuoto, per vuoti decrescenti e a
 * parità nell'ordine del profilo. Contano anche gli identificativi.
 */
export function completeness(fields, policies) {
  const list = (fields || []).filter((f) => f && f.id)
  const ps = policies || []
  let filled = 0
  const empties = []
  list.forEach((f, idx) => {
    let e = 0
    for (const p of ps) { if (isEmpty(p.values?.[f.id])) e++; else filled++ }
    if (e > 0) empties.push({ fieldId: f.id, empty: e, of: ps.length, idx })
  })
  empties.sort((a, b) => b.empty - a.empty || a.idx - b.idx)
  const total = list.length * ps.length
  return {
    filled,
    total,
    pct: total ? filled / total : null,
    mostEmpty: empties.slice(0, 3).map(({ idx, ...r }) => r), // eslint-disable-line no-unused-vars
  }
}

/** Polizze che scadono tra 0 e `days` giorni da oggi (estremi inclusi), per data crescente: [{ jobId, date, days }]. */
export function dueWithin(policies, dueFieldId, today, days = DEFAULT_DUE_DAYS) {
  const t = parseDate(today)
  if (!dueFieldId || !t) return []
  const out = []
  for (const p of policies || []) {
    const d = parseDate(p.values?.[dueFieldId])
    if (!d) continue
    const diff = d.day - t.day
    if (diff >= 0 && diff <= days) out.push({ jobId: p.jobId, date: d.str, days: diff, _day: d.day, _name: p.name })
  }
  out.sort((a, b) => a._day - b._day || cmpIt(a._name, b._name))
  return out.map(({ _day, _name, ...r }) => r) // eslint-disable-line no-unused-vars
}

// ─── Gruppi («raggruppa per») ────────────────────────────────────────────────

/** Chiave di gruppo di un valore: EMPTY_KEY, la risposta canonica di una verifica, o textKey. */
function groupKeyOf(fd, raw) {
  if (isEmpty(raw)) return EMPTY_KEY
  if (fd.kind === 'check' && fd.answers && fd.answers.length) {
    const a = checkAnswer(fd._def, raw)
    return a === OTHER_KEY ? OTHER_KEY : textKey(a) || OTHER_KEY
  }
  return textKey(raw) || EMPTY_KEY
}

function groupLabelOf(fd, raw) {
  if (isEmpty(raw)) return null
  if (fd.kind === 'check' && fd.answers && fd.answers.length) {
    const a = checkAnswer(fd._def, raw)
    return a === OTHER_KEY ? null : a
  }
  return String(raw).trim()
}

/**
 * Gruppi di un campo su un insieme di polizze: [{ key, label, members }] per
 * numero decrescente, a parità per etichetta; EMPTY_KEY a parte.
 */
function groupsOf(fd, policies) {
  const map = new Map()
  const empty = []
  for (const p of policies) {
    const raw = p.values?.[fd.id]
    const key = groupKeyOf(fd, raw)
    if (key === EMPTY_KEY) { empty.push(p); continue }
    let e = map.get(key)
    if (!e) { e = { key, members: [], spellings: new Map() }; map.set(key, e) }
    e.members.push(p)
    const lab = groupLabelOf(fd, raw)
    if (lab != null) e.spellings.set(lab, (e.spellings.get(lab) || 0) + 1)
  }
  const items = [...map.values()].map((e) => ({ key: e.key, label: mostFrequentSpelling(e.spellings), members: e.members }))
  items.sort((a, b) => b.members.length - a.members.length || cmpIt(a.label, b.label))
  return { items, empty }
}

// ─── Statistiche per campo ───────────────────────────────────────────────────

function numsOf(fd, policies) {
  const out = []
  for (const p of policies) {
    const n = readNumber(fd.kind, p.values?.[fd.id])
    if (n != null) out.push(n)
  }
  return out
}

function nonNumericOf(fd, policies) {
  const counts = new Map()
  for (const p of policies) {
    const raw = p.values?.[fd.id]
    if (isEmpty(raw) || readNumber(fd.kind, raw) != null) continue
    const v = String(raw).trim()
    counts.set(v, (counts.get(v) || 0) + 1)
  }
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || cmpIt(a.value, b.value))
}

function textStats(fd, policies) {
  const vc = valueCounts(policies.map((p) => p.values?.[fd.id]), TEXT_TOP)
  return { kind: fd.kind, n: policies.length - vc.empty, empty: vc.empty, distinct: vc.distinct, unique: fd.unique, values: vc.items, other: vc.other }
}

/**
 * Statistiche di un campo. `set` = polizze filtrate; `ctx.yearSet` = polizze
 * del gruppo scelto con tutti gli anni (per le liste «per anno»), `ctx.years`
 * gli anni numerici, `ctx.focusYear` l'anno evidenziato, `ctx.withSorted` se
 * calcolare l'elenco ordinato (solo per il campo aperto in «Per campo»).
 */
export function fieldStats(fd, set, ctx = {}) {
  const years = ctx.years || []
  const yearSet = ctx.yearSet || set
  const byYearSets = years.map((y) => [y, yearSet.filter((p) => p.year === y)])
  const noYear = yearSet.filter((p) => p.year == null)
  if (isNumericKind(fd.kind)) {
    const nonNumeric = nonNumericOf(fd, set)
    if (fd.textLike) return { ...textStats(fd, set), kind: fd.kind, textLike: true, nonNumeric }
    const nums = numsOf(fd, set)
    const st = numStats(nums)
    const empty = set.filter((p) => isEmpty(p.values?.[fd.id])).length
    const yearRow = (year, ps) => {
      const s = numStats(numsOf(fd, ps))
      const row = { year, n: s.n, of: ps.length, avg: s.avg, ref: year != null && year === ctx.focusYear }
      if (fd.kind === 'amount') row.sum = s.sum
      return row
    }
    const out = {
      kind: fd.kind,
      n: st.n,
      empty,
      nonNumeric,
      avg: st.avg,
      median: st.median,
      min: st.min,
      max: st.max,
      buckets: buckets(nums, empty),
      byYear: [...byYearSets.map(([y, ps]) => yearRow(y, ps)), ...(noYear.length ? [yearRow(null, noYear)] : [])],
    }
    if (fd.kind === 'amount') out.sum = st.sum
    if (ctx.withSorted) {
      out.sorted = set
        .map((p) => ({ jobId: p.jobId, value: readNumber(fd.kind, p.values?.[fd.id]), name: p.name }))
        .filter((x) => x.value != null)
        .sort((a, b) => b.value - a.value || cmpIt(a.name, b.name))
        .map(({ name, ...r }) => r) // eslint-disable-line no-unused-vars
    }
    return out
  }
  if (fd.kind === 'date') {
    let n = 0
    let first = null
    let last = null
    const perYear = new Map()
    const invalid = []
    for (const p of set) {
      const raw = p.values?.[fd.id]
      if (isEmpty(raw)) continue
      const d = parseDate(raw)
      if (!d) { invalid.push(String(raw).trim()); continue }
      n++
      if (!first || d.day < first.day) first = d
      if (!last || d.day > last.day) last = d
      perYear.set(d.y, (perYear.get(d.y) || 0) + 1)
    }
    return {
      kind: 'date',
      n,
      empty: set.filter((p) => isEmpty(p.values?.[fd.id])).length,
      invalid: invalid.length,
      first: first ? first.str : null,
      last: last ? last.str : null,
      byYear: [...perYear].sort((a, b) => a[0] - b[0]).map(([year, count]) => ({ year, n: count })),
    }
  }
  if (fd.kind === 'check') {
    const answers = fd.answers || []
    if (!answers.length) return { ...textStats(fd, set), kind: 'check', answers: [], byYear: [] }
    const count = (ps) => {
      const m = new Map(answers.map((a) => [a, 0]))
      let other = 0
      let empty = 0
      for (const p of ps) {
        const a = checkAnswer(fd._def, p.values?.[fd.id])
        if (a == null) empty++
        else if (a === OTHER_KEY || !m.has(a)) other++
        else m.set(a, m.get(a) + 1)
      }
      return { m, other, empty, n: ps.length - empty }
    }
    const all = count(set)
    const pctFirst = (c) => (c.n ? c.m.get(answers[0]) / c.n : null)
    return {
      kind: 'check',
      n: all.n,
      empty: all.empty,
      answers: answers.map((a) => ({ answer: a, count: all.m.get(a), pct: all.n ? all.m.get(a) / all.n : null })),
      other: all.other,
      first: answers[0],
      byYear: [
        ...byYearSets.map(([y, ps]) => { const c = count(ps); return { year: y, n: c.n, pctFirst: pctFirst(c), ref: y === ctx.focusYear } }),
        ...(noYear.length ? [(() => { const c = count(noYear); return { year: null, n: c.n, pctFirst: pctFirst(c), ref: false } })()] : []),
      ],
    }
  }
  if (fd.kind === 'identifier') {
    const vc = valueCounts(set.map((p) => p.values?.[fd.id]), 0)
    return { kind: 'identifier', n: set.length - vc.empty, empty: vc.empty, distinct: vc.distinct }
  }
  return textStats(fd, set)
}

// ─── Preferenze: default e validazione ───────────────────────────────────────

const rankNumeric = (a, b) => b.nonzero - a.nonzero || b.numeric - a.numeric || a.idx - b.idx

/**
 * Default dai metadati (su tutte le polizze). Regole dichiarate:
 * - ops: 'sum' per gli importi, 'avg' per limiti/condizioni (structural) e tassi;
 *   nessuno per gli importi «testuali» (textLike);
 * - highlights: fino a 3 importi non strutturali + 1 strutturale, ciascun
 *   gruppo per più valori NON NULLI, poi più valori numerici, poi ordine del
 *   profilo (un importo sempre a 0,00 non è una carta utile); i posti liberi si
 *   riempiono con gli altri candidati (prima non strutturali). Somma per i
 *   non strutturali, media per gli strutturali;
 * - groupFieldId: il testo non «unique» con meno valori distinti ma almeno 2;
 * - distributionFieldId: tra gli importi valorizzati in almeno metà delle
 *   polizze, prima i limiti/condizioni poi gli altri, quello con meno valori
 *   distinti ma almeno 2; altrimenti il primo importo;
 * - matchFieldIds: primo numero di documento, prima P.IVA/CF; altrimenti la cartella.
 */
function defaultsFromMeta(meta, policyCount) {
  const withIdx = meta.map((m, idx) => ({ ...m, idx }))
  const ops = {}
  for (const m of withIdx) {
    if (!isNumericKind(m.kind) || m.textLike) continue
    ops[m.id] = [m.kind === 'rate' ? 'avg' : m.structural ? 'avg' : 'sum']
  }
  const amounts = withIdx.filter((m) => m.kind === 'amount' && !m.textLike)
  const ns = amounts.filter((m) => !m.structural).sort(rankNumeric)
  const st = amounts.filter((m) => m.structural).sort(rankNumeric)
  let nS = Math.min(1, st.length)
  const nN = Math.min(ns.length, MAX_HIGHLIGHTS - nS)
  if (nN + nS < MAX_HIGHLIGHTS) nS = Math.min(st.length, MAX_HIGHLIGHTS - nN)
  const highlights = [
    ...ns.slice(0, nN).map((m) => ({ fieldId: m.id, op: 'sum' })),
    ...st.slice(0, nS).map((m) => ({ fieldId: m.id, op: 'avg' })),
  ]
  const fewestDistinct = (cands) => cands
    .filter((m) => m.distinct >= 2)
    .sort((a, b) => a.distinct - b.distinct || a.idx - b.idx)[0] || null
  const groupPick = fewestDistinct(withIdx.filter((m) => m.kind === 'text' && !m.unique && m.filled >= 1))
  const half = policyCount / 2
  const filledHalf = amounts.filter((m) => policyCount > 0 && m.numeric >= half)
  const distPick = fewestDistinct(filledHalf.filter((m) => m.structural))
    || fewestDistinct(filledHalf.filter((m) => !m.structural))
    || amounts[0] || null
  const doc = withIdx.find((m) => m.kind === 'identifier' && m.idKind === 'document')
  const vat = withIdx.find((m) => m.kind === 'identifier' && m.idKind === 'vat')
  const match = [doc, vat].filter(Boolean).map((m) => m.id)
  return {
    ops,
    highlights,
    groupFieldId: groupPick ? groupPick.id : null,
    distributionFieldId: distPick ? distPick.id : null,
    dueDays: DEFAULT_DUE_DAYS,
    matchFieldIds: match.length ? match : [DOSSIER_KEY],
    tableRows: 'amountsCounts',
  }
}

function normalizePolicies(policies, yearFieldId) {
  return (policies || []).filter((p) => p && p.jobId).map((p) => ({
    jobId: p.jobId,
    batchId: p.batchId ?? null,
    name: p.name ?? '',
    path: p.path ?? '',
    values: p.values || {},
    state: p.state || 'ok',
    valuesAt: p.valuesAt ?? null,
    year: yearOf(p, yearFieldId),
  })).sort((a, b) => cmpIt(a.name, b.name) || cmpIt(a.jobId, b.jobId))
}

/** Preferenze di default (§2.6 con le correzioni della revisione): mai dalla label. */
export function defaultPrefs(fields, policies, yearFieldId) {
  const ps = normalizePolicies(policies, yearFieldId)
  return defaultsFromMeta(describeFields(fields, ps), ps.length)
}

/** Primo campo data nell'ordine del profilo, o null. */
export function defaultYearFieldId(fields) {
  const f = (fields || []).find((x) => x && x.id && classifyField(x).kind === 'date')
  return f ? f.id : null
}

/**
 * Campo «scadenza da» di default: tra le date diverse da quella dell'anno, la
 * più spesso SUCCESSIVA a quella dell'anno (a parità l'ordine del profilo);
 * se nessuna lo è mai, la prima data diversa dall'anno; altrimenti null.
 */
export function defaultDueFieldId(fields, policies, yearFieldId) {
  const dates = (fields || []).filter((x) => x && x.id && x.id !== yearFieldId && classifyField(x).kind === 'date')
  if (!dates.length) return null
  let best = null
  let bestN = 0
  for (const f of dates) {
    let n = 0
    for (const p of policies || []) {
      const y = yearFieldId ? parseDate(p?.values?.[yearFieldId]) : null
      const d = parseDate(p?.values?.[f.id])
      if (y && d && d.day > y.day) n++
    }
    if (n > bestN) { best = f; bestN = n }
  }
  return (best || dates[0]).id
}

/**
 * Valida preferenze grezze contro i campi (classificati dalla descrizione).
 * Restituisce { prefs (solo le voci valide), errors: [{ key, reason, fieldId? }] }.
 * `raw === null` → { prefs: {} } (ripristino dei default). Un `groupFieldId` o
 * `distributionFieldId` null è una scelta valida («nessuno»).
 */
export function sanitizePrefs(raw, fields) {
  const errors = []
  const prefs = {}
  if (raw === null || raw === undefined) return { prefs, errors }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { prefs, errors: [{ key: 'prefs', reason: 'not-object' }] }
  const kinds = new Map((fields || []).filter((f) => f && f.id).map((f) => [f.id, classifyField(f).kind]))
  const KNOWN = new Set(['ops', 'highlights', 'groupFieldId', 'distributionFieldId', 'dueDays', 'matchFieldIds', 'tableRows'])
  for (const key of Object.keys(raw)) if (!KNOWN.has(key)) errors.push({ key, reason: 'unknown-key' })

  if ('ops' in raw) {
    const o = raw.ops
    if (!o || typeof o !== 'object' || Array.isArray(o)) errors.push({ key: 'ops', reason: 'not-object' })
    else {
      const out = {}
      for (const [fid, list] of Object.entries(o)) {
        const k = kinds.get(fid)
        if (!k) { errors.push({ key: 'ops', reason: 'unknown-field', fieldId: fid }); continue }
        if (!isNumericKind(k)) { errors.push({ key: 'ops', reason: 'not-numeric', fieldId: fid }); continue }
        if (!Array.isArray(list) || !list.length) { errors.push({ key: 'ops', reason: 'empty', fieldId: fid }); continue }
        const ok = allowedOps(k)
        const bad = list.filter((x) => !ok.includes(x))
        if (bad.length) { errors.push({ key: 'ops', reason: 'bad-op', fieldId: fid }); continue }
        out[fid] = ok.filter((x) => list.includes(x))
      }
      prefs.ops = out
    }
  }
  if ('highlights' in raw) {
    const h = raw.highlights
    if (!Array.isArray(h)) errors.push({ key: 'highlights', reason: 'not-array' })
    else if (h.length > MAX_HIGHLIGHTS) errors.push({ key: 'highlights', reason: 'too-many' })
    else {
      const out = []
      const seen = new Set()
      for (const x of h) {
        const fid = x && x.fieldId
        const k = kinds.get(fid)
        if (!k) { errors.push({ key: 'highlights', reason: 'unknown-field', fieldId: fid }); continue }
        if (!isNumericKind(k)) { errors.push({ key: 'highlights', reason: 'not-numeric', fieldId: fid }); continue }
        if (!allowedOps(k).includes(x.op)) { errors.push({ key: 'highlights', reason: 'bad-op', fieldId: fid }); continue }
        const sig = `${fid}|${x.op}`
        if (seen.has(sig)) { errors.push({ key: 'highlights', reason: 'duplicate', fieldId: fid }); continue }
        seen.add(sig)
        out.push({ fieldId: fid, op: x.op })
      }
      prefs.highlights = out
    }
  }
  const pickField = (key, okKinds) => {
    if (!(key in raw)) return
    const fid = raw[key]
    if (fid === null) { prefs[key] = null; return }
    const k = kinds.get(fid)
    if (!k) errors.push({ key, reason: 'unknown-field', fieldId: fid })
    else if (!okKinds.includes(k)) errors.push({ key, reason: 'bad-kind', fieldId: fid })
    else prefs[key] = fid
  }
  pickField('groupFieldId', ['text', 'check'])
  pickField('distributionFieldId', ['amount', 'rate'])
  if ('dueDays' in raw) {
    const d = raw.dueDays
    if (!Number.isInteger(d) || d < 1 || d > 366) errors.push({ key: 'dueDays', reason: 'out-of-range' })
    else prefs.dueDays = d
  }
  if ('matchFieldIds' in raw) {
    const m = raw.matchFieldIds
    if (!Array.isArray(m) || !m.length) errors.push({ key: 'matchFieldIds', reason: 'not-array' })
    else if (m.length > MAX_MATCH_FIELDS) errors.push({ key: 'matchFieldIds', reason: 'too-many' })
    else {
      const out = []
      for (const fid of m) {
        const k = fid === DOSSIER_KEY ? 'dossier' : kinds.get(fid)
        if (!k) { errors.push({ key: 'matchFieldIds', reason: 'unknown-field', fieldId: fid }); continue }
        if (!['dossier', 'identifier', 'text'].includes(k)) { errors.push({ key: 'matchFieldIds', reason: 'bad-kind', fieldId: fid }); continue }
        if (!out.includes(fid)) out.push(fid)
      }
      if (out.length) prefs.matchFieldIds = out
    }
  }
  if ('tableRows' in raw) {
    if (!TABLE_ROWS.includes(raw.tableRows)) errors.push({ key: 'tableRows', reason: 'bad-value' })
    else prefs.tableRows = raw.tableRows
  }
  return { prefs, errors }
}

/**
 * Unione di una modifica (PATCH) sulle preferenze salvate: entrambe passano da
 * sanitizePrefs (mai il corpo grezzo nel database); `ops` si unisce campo per
 * campo, il resto voce per voce. `patch === null` → {} (ripristino).
 * Con errori nella modifica restituisce le salvate invariate e gli errori.
 */
export function mergePrefs(saved, patch, fields) {
  if (patch === null) return { prefs: {}, errors: [] }
  const base = sanitizePrefs(saved ?? {}, fields).prefs
  const p = sanitizePrefs(patch ?? {}, fields)
  if (p.errors.length) return { prefs: base, errors: p.errors }
  const out = { ...base, ...p.prefs }
  if (base.ops || p.prefs.ops) out.ops = { ...(base.ops || {}), ...(p.prefs.ops || {}) }
  return { prefs: out, errors: [] }
}

function effectiveFromMeta(saved, fields, meta, policyCount) {
  const s = sanitizePrefs(saved ?? {}, fields).prefs
  const d = defaultsFromMeta(meta, policyCount)
  const ops = { ...d.ops }
  for (const [fid, list] of Object.entries(s.ops || {})) ops[fid] = list
  return {
    ops,
    highlights: 'highlights' in s ? s.highlights : d.highlights,
    groupFieldId: 'groupFieldId' in s ? s.groupFieldId : d.groupFieldId,
    distributionFieldId: 'distributionFieldId' in s ? s.distributionFieldId : d.distributionFieldId,
    dueDays: s.dueDays ?? d.dueDays,
    matchFieldIds: s.matchFieldIds && s.matchFieldIds.length ? s.matchFieldIds : d.matchFieldIds,
    tableRows: s.tableRows ?? d.tableRows,
  }
}

/** Preferenze effettive: le salvate valide, voce per voce, sopra i default calcolati sui dati. */
export function effectivePrefs(saved, fields, policies, yearFieldId) {
  const ps = normalizePolicies(policies, yearFieldId)
  return effectiveFromMeta(saved, fields, describeFields(fields, ps), ps.length)
}

// ─── Confronto tra due anni ──────────────────────────────────────────────────

/**
 * Confronto A → B sull'insieme INTERO (ignora i filtri anno e gruppo).
 * Abbinamento 1:1 a passate nell'ordine di prefs.matchFieldIds; B di default
 * = anno di riferimento, A di default = l'anno più recente con dati prima di B
 * (anni con buchi). Un anno chiesto che non ha polizze torna al default.
 */
export function compareYears({ fields, policies: rawPolicies, prefs = {}, yearA, yearB, today, yearFieldId = null }) {
  const policies = (rawPolicies || []).map((p) => (p && p.year !== undefined ? p : { ...p, year: yearOf(p, yearFieldId) }))
  // Campi già descritti (da summarize) o grezzi (chiamata diretta): mai la label.
  const meta = (fields || []).every((f) => f && f._def) ? fields : describeFields(fields, policies)
  const byId = new Map(meta.map((f) => [f.id, f]))
  const years = numericYears(policies.map((p) => p.year))
  if (years.length < 2) return { error: 'need-two-years', years }
  const b = years.includes(yearB) ? yearB : referenceYear(years, today)
  const a = years.includes(yearA) ? yearA : (previousYear(years, b) ?? years.find((y) => y !== b))
  if (a === b) return { error: 'same-year', yearA: a, yearB: b, years }
  const PA = policies.filter((p) => p.year === a)
  const PB = policies.filter((p) => p.year === b)
  const match = (prefs.matchFieldIds || []).filter((fid) => fid === DOSSIER_KEY || byId.has(fid))
  const keyOf = (p, fid) => {
    if (fid === DOSSIER_KEY) return textKey(p.name)
    const raw = p.values?.[fid]
    return isEmpty(raw) ? '' : textKey(raw)
  }
  const usedA = new Set()
  const usedB = new Set()
  const pairs = []
  const matchedBy = {}
  for (const fid of match) {
    const queue = new Map()
    for (const pb of PB) {
      if (usedB.has(pb.jobId)) continue
      const k = keyOf(pb, fid)
      if (!k) continue
      if (!queue.has(k)) queue.set(k, [])
      queue.get(k).push(pb)
    }
    for (const pa of PA) {
      if (usedA.has(pa.jobId)) continue
      const k = keyOf(pa, fid)
      if (!k) continue
      const q = queue.get(k)
      const pb = q && q.find((x) => !usedB.has(x.jobId))
      if (!pb) continue
      usedA.add(pa.jobId)
      usedB.add(pb.jobId)
      pairs.push({ pa, pb, matchedBy: fid })
      matchedBy[fid] = (matchedBy[fid] || 0) + 1
    }
  }
  const highlights = prefs.highlights || []
  const hlFields = [...new Set(highlights.map((h) => h.fieldId))].filter((fid) => byId.has(fid))
  const amountFields = hlFields.slice(0, 2)
  const groupFd = prefs.groupFieldId ? byId.get(prefs.groupFieldId) : null
  const changeFields = [...new Set([groupFd ? groupFd.id : null, ...hlFields.slice(1)].filter(Boolean))]
  const num = (p, fid) => (p ? readNumber(byId.get(fid).kind, p.values?.[fid]) : null)
  const label = (p) => (p && groupFd ? groupLabelOf(groupFd, p.values?.[groupFd.id]) : null)
  const differs = (fid, pa, pb) => {
    const fd = byId.get(fid)
    const ra = pa.values?.[fid]
    const rb = pb.values?.[fid]
    if (isEmpty(ra) || isEmpty(rb)) return false
    if (isNumericKind(fd.kind)) {
      const na = readNumber(fd.kind, ra)
      const nb = readNumber(fd.kind, rb)
      if (na != null && nb != null) return na !== nb
    }
    if (fd.kind === 'check') return textKey(checkAnswer(fd._def, ra)) !== textKey(checkAnswer(fd._def, rb))
    return textKey(ra) !== textKey(rb)
  }
  const row = (kind, pa, pb, by) => {
    const shown = pb || pa
    const amounts = amountFields.map((fid) => {
      const va = num(pa, fid)
      const vb = num(pb, fid)
      return { fieldId: fid, a: va, b: vb, diff: va != null && vb != null ? clean(vb - va) : null }
    })
    // Cambio del gruppo per CHIAVE (textKey / risposta canonica), non per
    // grafia: «DAS» → «D.A.S.» non è un cambio di compagnia.
    const gka = pa && groupFd ? groupKeyOf(groupFd, pa.values?.[groupFd.id]) : null
    const gkb = pb && groupFd ? groupKeyOf(groupFd, pb.values?.[groupFd.id]) : null
    return {
      kind,
      jobA: pa ? pa.jobId : null,
      jobB: pb ? pb.jobId : null,
      name: shown.name,
      batchId: shown.batchId,
      matchedBy: by || null,
      group: { a: label(pa), b: label(pb), changed: !!(pa && pb && gka && gkb && gka !== EMPTY_KEY && gkb !== EMPTY_KEY && gka !== gkb) },
      amounts,
      changed: kind === 'renewed' ? changeFields.filter((fid) => differs(fid, pa, pb)) : [],
    }
  }
  const absDiff = (r) => (r.amounts[0] && r.amounts[0].diff != null ? Math.abs(r.amounts[0].diff) : -1)
  const renewed = pairs.map((x) => row('renewed', x.pa, x.pb, x.matchedBy)).sort((x, y) => absDiff(y) - absDiff(x) || cmpIt(x.name, y.name))
  const added = PB.filter((p) => !usedB.has(p.jobId)).map((p) => row('added', null, p))
  const lost = PA.filter((p) => !usedA.has(p.jobId)).map((p) => row('lost', p, null))
  const cards = [
    { fieldId: null, op: 'count', a: PA.length, b: PB.length, delta: delta(PA.length, PB.length) },
    ...highlights.slice(0, 3).filter((h) => byId.has(h.fieldId)).map((h) => {
      const fd = byId.get(h.fieldId)
      const na = numsOf(fd, PA)
      const nb = numsOf(fd, PB)
      const va = aggregate(h.op, na)
      const vb = aggregate(h.op, nb)
      const ca = coverage(na, PA)
      const cb = coverage(nb, PB)
      return { fieldId: h.fieldId, op: h.op, a: va, b: vb, cov: { a: ca, b: cb }, delta: h.op === 'minmax' ? null : withCoverage(delta(va, vb), h.op, ca, cb) }
    }),
  ]
  let groupShift = null
  if (groupFd) {
    const ga = groupsOf(groupFd, PA)
    const gb = groupsOf(groupFd, PB)
    const all = new Map()
    for (const g of ga.items) all.set(g.key, { key: g.key, label: g.label, a: g.members.length, b: 0 })
    for (const g of gb.items) {
      const e = all.get(g.key) || { key: g.key, label: g.label, a: 0, b: 0 }
      e.b = g.members.length
      if (e.label == null) e.label = g.label
      all.set(g.key, e)
    }
    const rows = [...all.values()]
      .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b) || cmpIt(x.label, y.label))
      .slice(0, SHIFT_ROWS)
      .map((e) => ({ ...e, diff: e.b - e.a }))
    groupShift = { fieldId: groupFd.id, rows }
  }
  return {
    yearA: a,
    yearB: b,
    years,
    matchFieldIds: match,
    cards,
    continuity: { renewed: renewed.length, added: added.length, lost: lost.length, matchedBy },
    groupShift,
    rows: [...renewed, ...added, ...lost],
  }
}

// ─── Membri, nomi, chiavi di profilo, ammissione ─────────────────────────────

/**
 * Nome della polizza come in Elaborazioni (shortName + splitName di
 * web/components/jobs/model.ts): senza la cartella del batch, name = ultimo
 * segmento, path = gli altri uniti da « / »; senza nome il primo file in
 * ordine alfabetico con « (+N) », poi i primi 8 caratteri dell'id.
 */
export function policyName({ dossierName, batchLabel, scannedFiles, jobId } = {}) {
  let full = dossierName || ''
  if (full && batchLabel && full.startsWith(batchLabel + '/')) full = full.slice(batchLabel.length + 1)
  if (!full) {
    const sorted = [...(scannedFiles || [])].sort((a, b) => String(a).localeCompare(String(b)))
    full = sorted.length ? `${sorted[0]}${sorted.length > 1 ? ` (+${sorted.length - 1})` : ''}` : String(jobId || '').slice(0, 8)
  }
  const segments = full.split('/').map((x) => x.trim()).filter(Boolean)
  if (!segments.length) return { name: full, path: '' }
  return { name: segments[segments.length - 1], path: segments.slice(0, -1).join(' / ') }
}

const sameIdSet = (ids, set) => ids.length === set.size && ids.every((x) => set.has(x))
const fieldIdsOf = (defs) => [...new Set((defs || []).map((f) => f && f.id).filter(Boolean))].sort()

/**
 * Firma dei campi di un'estrazione singola (senza profilo): 'campi:' + sha1
 * degli id ordinati (16 caratteri). È anche la chiave di ripiego di profileKeyOf.
 */
export function fieldSig(fieldDefs) {
  return 'campi:' + createHash('sha1').update(fieldIdsOf(fieldDefs).join(',')).digest('hex').slice(0, 16)
}

/**
 * Chiave del profilo di un job (o di una run: { profile_id, field_defs: run.fields, status: 'done' }).
 * 1. 'auto' non ancora estratto → { error: 'auto-profile' } (un 'auto' già
 *    estratto, rimasto tale perché la classifica non ha risposto, si risolve
 *    dai campi come una singola);
 * 2. profile_id → quella chiave (nome: profile_name o quello delle impostazioni);
 * 3. estrazione singola (sig = fieldSig dei suoi campi):
 *    a. firma già AMMESSA nel riepilogo (opts.acceptedSigs, salvate quando la
 *       polizza è entrata) → la chiave del riepilogo (opts.preferKey): una
 *       copia del profilo o un campo tolto nelle Impostazioni non la fanno
 *       più uscire dal riepilogo;
 *    b. il profilo i cui campi ABILITATI hanno esattamente gli stessi id (il
 *       riepilogo, se è tra questi; poi i profili ATTIVI: una copia non attiva
 *       non rende il confronto ambiguo);
 *    c. altrimenti il profilo che contiene tutti gli id del job (il riepilogo
 *       se è tra questi, poi l'UNICO tra gli attivi, poi l'unico in assoluto:
 *       un campo aggiunto dopo non separa le singole di prima);
 *    d. altrimenti la firma stessa, nome null.
 * I valori non si mescolano mai per id tra chiavi diverse: 30 id di campo sono
 * condivisi tra profili reali con significati diversi.
 * → { key, name, sig } (sig null per i job con profile_id) | { error }
 */
export function profileKeyOf(job, profiles = [], opts = {}) {
  const pid = job?.profile_id ?? null
  if (pid === 'auto' && job?.status !== 'done') return { error: 'auto-profile' }
  const list = (Array.isArray(profiles) ? profiles : []).filter((p) => p && p.id)
  if (pid && pid !== 'auto') {
    const p = list.find((x) => x.id === pid)
    return { key: pid, name: job.profile_name || p?.name || null, sig: null }
  }
  const ids = fieldIdsOf(job?.field_defs)
  const sig = fieldSig(job?.field_defs)
  const prefer = typeof opts.preferKey === 'string' && opts.preferKey ? opts.preferKey : null
  const found = (p) => ({ key: p.id, name: p.name || null, sig })
  if (prefer && Array.isArray(opts.acceptedSigs) && opts.acceptedSigs.includes(sig)) {
    const p = list.find((x) => x.id === prefer)
    return { key: prefer, name: p?.name || null, sig }
  }
  if (ids.length) {
    const idSet = new Set(ids)
    const active = (arr) => arr.filter((p) => p.enabled !== false)
    const equal = list.filter((p) => sameIdSet((p.fields || []).filter((f) => f && f.id && f.enabled !== false).map((f) => f.id), idSet))
    const preferred = prefer ? equal.find((p) => p.id === prefer) : null
    if (preferred) return found(preferred)
    if (active(equal).length === 1) return found(active(equal)[0])
    if (equal.length === 1) return found(equal[0])
    if (!equal.length) {
      const containing = list.filter((p) => {
        const all = new Set((p.fields || []).map((f) => f && f.id).filter(Boolean))
        return ids.every((x) => all.has(x))
      })
      const pc = prefer ? containing.find((p) => p.id === prefer) : null
      if (pc) return found(pc)
      if (active(containing).length === 1) return found(active(containing)[0])
      if (containing.length === 1) return found(containing[0])
    }
  }
  return { key: sig, name: null, sig }
}

/**
 * Validazione di un elenco di id di job dal corpo di una richiesta: array di
 * stringhe non vuote di al massimo 64 caratteri; i doppioni si tolgono
 * (ordine della prima comparsa). `max` è il tetto dell'elenco risultante (il
 * server lo riapplica DOPO l'aggiunta ai membri esistenti).
 * → { ids, error: null | 'not-array' | 'empty' | 'bad-id' | 'too-many' }
 */
export function sanitizeJobIds(raw, max = MAX_SUMMARY_JOBS) {
  if (!Array.isArray(raw)) return { ids: [], error: 'not-array' }
  if (raw.some((x) => typeof x !== 'string' || !x.trim() || x.length > 64)) return { ids: [], error: 'bad-id' }
  const ids = [...new Set(raw)]
  if (!ids.length) return { ids, error: 'empty' }
  if (ids.length > max) return { ids: [], error: 'too-many' }
  return { ids, error: null }
}

const jobName = (job) => policyName({ dossierName: job.dossier_name, batchLabel: job.batch_label, scannedFiles: job.scanned_files, jobId: job.id }).name
const jobHasValues = (job) => Object.keys(job.values && typeof job.values === 'object' ? job.values : flattenValues(job.rolling_state)).length > 0

function hashSetKey(hashes) {
  if (!Array.isArray(hashes) || !hashes.length || hashes.some((h) => !h)) return null
  return [...new Set(hashes)].sort().join('|')
}

/**
 * Ammissione dei job in un riepilogo (creazione: summaryKey null; aggiunta:
 * la chiave del riepilogo e i membri). Ordine dei controlli per job:
 * già membro → not-found → test-run → not-valid (prima di not-done: un Non
 * valido è 'mismatch') → not-done → no-values → auto-profile → chiave
 * (other-profile) → duplicate (stesso insieme di file per contenuto di un
 * membro o di un job già ammesso, oppure duplicate_of verso uno di loro).
 * Alla creazione la chiave è la più frequente tra i job ammissibili (a parità
 * quella del primo nell'ordine della richiesta).
 *
 * jobs: righe di getJobsLight con `notValid` (isNotValidJob, calcolato dal server).
 * hashesByJob: { jobId: [file_hash…] } per i job richiesti e per i membri.
 * members: [{ jobId, name }] (il nome serve al dettaglio del rifiuto duplicate).
 * acceptedSigs: firme delle estrazioni singole già ammesse nel riepilogo (profileKeyOf).
 * → { key, name, eligible: [{ jobId, name }], refused: [{ jobId, name, reason, detail? }], already: [jobId],
 *     sigs: firme delle singole ammesse (da salvare nel riepilogo) }
 */
export function checkEligible({ requestedIds = [], jobs = [], profiles = [], summaryKey = null, members = [], hashesByJob = {}, acceptedSigs = [] } = {}) {
  const byId = new Map((jobs || []).filter((j) => j && j.id).map((j) => [j.id, j]))
  const memberIds = new Set((members || []).map((m) => m.jobId))
  const order = new Map()
  const refused = []
  const already = []
  const pending = []
  for (const id of requestedIds || []) {
    if (typeof id !== 'string' || !id || order.has(id)) continue
    order.set(id, order.size)
    if (memberIds.has(id)) { already.push(id); continue }
    const job = byId.get(id)
    if (!job) { refused.push({ jobId: id, name: id.slice(0, 8), reason: 'not-found' }); continue }
    const name = jobName(job)
    const refuse = (reason, detail) => refused.push({ jobId: id, name, reason, ...(detail !== undefined ? { detail } : {}) })
    if (job.source_job_id) { refuse('test-run'); continue }
    if (job.notValid) { refuse('not-valid'); continue }
    if (job.status !== 'done') { refuse('not-done'); continue }
    if (!jobHasValues(job)) { refuse('no-values'); continue }
    const k = profileKeyOf(job, profiles, { preferKey: summaryKey, acceptedSigs })
    if (k.error) { refuse(k.error); continue }
    pending.push({ id, name, job, key: k.key, keyName: k.name, sig: k.sig })
  }
  let key = summaryKey || null
  let keyName = null
  if (!key && pending.length) {
    const counts = new Map()
    for (const x of pending) counts.set(x.key, (counts.get(x.key) || 0) + 1)
    let best = null
    for (const x of pending) if (!best || counts.get(x.key) > counts.get(best.key)) best = x
    key = best.key
    keyName = best.keyName
  } else if (key) {
    keyName = pending.find((x) => x.key === key)?.keyName ?? null
  }
  const owners = new Map()
  const memberName = new Map((members || []).map((m) => [m.jobId, m.name || String(m.jobId).slice(0, 8)]))
  for (const m of members || []) {
    const hk = hashSetKey(hashesByJob[m.jobId])
    if (hk && !owners.has(hk)) owners.set(hk, memberName.get(m.jobId))
  }
  const eligible = []
  const eligibleNames = new Map()
  const sigs = new Set()
  for (const x of pending) {
    if (x.key !== key) { refused.push({ jobId: x.id, name: x.name, reason: 'other-profile', detail: x.keyName }); continue }
    const hk = hashSetKey(hashesByJob[x.id])
    if (hk && owners.has(hk)) { refused.push({ jobId: x.id, name: x.name, reason: 'duplicate', detail: owners.get(hk) }); continue }
    const dup = x.job.duplicate_of
    if (dup && (memberIds.has(dup) || eligibleNames.has(dup))) {
      refused.push({ jobId: x.id, name: x.name, reason: 'duplicate', detail: memberName.get(dup) ?? eligibleNames.get(dup) })
      continue
    }
    if (hk) owners.set(hk, x.name)
    eligibleNames.set(x.id, x.name)
    eligible.push({ jobId: x.id, name: x.name })
    if (x.sig) sigs.add(x.sig)
  }
  refused.sort((p, q) => order.get(p.jobId) - order.get(q.jobId))
  return { key, name: keyName, eligible, refused, already, sigs: [...sigs] }
}

/**
 * Stato di una polizza del riepilogo.
 * Fotografia: sempre 'ok' coi valori fotografati ('missing' se la voce manca).
 * Valori aggiornati (live), precedenza:
 *  1. job eliminato → missing;
 *  2. job 'done': chiave diversa → excluded/otherProfile, altrimenti ok;
 *  3. 'mismatch' → excluded/notValid (isNotValidJob, dal server) o
 *     excluded/notPertinent; 'review' → excluded/review. Mai i valori vecchi:
 *     «in dubbio non si estrae», e un Non valido non si riepiloga;
 *  4. ultima run 'done' con la stessa chiave → stale (valori della run, con avviso);
 *  5. il job ora ha un'altra chiave → excluded/otherProfile;
 *  6. altrimenti excluded/notDone.
 * → { state, reason?, values, valuesAt, forced, fieldDefs, status }
 */
export function resolveMember({ mode, job, lastDoneRun, snapshotEntry, summaryKey, jobKey, runKey, notValid = false, forced = false } = {}) {
  if (mode === 'snapshot') {
    if (!snapshotEntry) return { state: 'missing', values: {}, valuesAt: null, forced: false, fieldDefs: null, status: job?.status ?? null }
    return { state: 'ok', values: snapshotEntry.values || {}, valuesAt: snapshotEntry.jobUpdatedAt ?? null, forced: !!snapshotEntry.forced, fieldDefs: null, status: job?.status ?? null }
  }
  if (!job) return { state: 'missing', values: {}, valuesAt: null, forced: false, fieldDefs: null, status: null }
  const base = { forced: !!forced, status: job.status }
  const excluded = (reason) => ({ ...base, state: 'excluded', reason, values: {}, valuesAt: null, fieldDefs: null })
  if (job.status === 'done') {
    if (jobKey !== summaryKey) return excluded('otherProfile')
    return { ...base, state: 'ok', values: job.values && typeof job.values === 'object' ? job.values : flattenValues(job.rolling_state), valuesAt: job.updated_at ?? null, fieldDefs: job.field_defs || [] }
  }
  if (job.status === 'mismatch') return excluded(notValid ? 'notValid' : 'notPertinent')
  if (job.status === 'review') return excluded('review')
  if (lastDoneRun && runKey === summaryKey) {
    return {
      ...base,
      state: 'stale',
      values: lastDoneRun.field_values || {},
      valuesAt: lastDoneRun.finished_at ?? null,
      fieldDefs: jobKey === summaryKey && (job.field_defs || []).length ? job.field_defs : (lastDoneRun.fields || []),
    }
  }
  if (typeof jobKey === 'string' && jobKey && jobKey !== summaryKey) return excluded('otherProfile')
  return excluded('notDone')
}

/**
 * Avvisi dai membri risolti: [{ code: 'missing'|'stale'|'excluded'|'forced', jobIds, byReason? }].
 * excluded porta byReason: { notDone, otherProfile, notValid, notPertinent, review }.
 */
export function memberWarnings(members) {
  const by = { missing: [], stale: [], excluded: [], forced: [] }
  const byReason = {}
  for (const m of members || []) {
    if (m.state === 'missing') by.missing.push(m.jobId)
    else if (m.state === 'stale') by.stale.push(m.jobId)
    else if (m.state === 'excluded') {
      by.excluded.push(m.jobId)
      ;(byReason[m.reason] = byReason[m.reason] || []).push(m.jobId)
    }
    if ((m.state === 'ok' || m.state === 'stale') && m.forced) by.forced.push(m.jobId)
  }
  const out = []
  for (const code of ['missing', 'stale', 'excluded', 'forced']) {
    if (!by[code].length) continue
    out.push(code === 'excluded' ? { code, jobIds: by[code], byReason } : { code, jobIds: by[code] })
  }
  return out
}

function defShape(f) {
  const fz = frozenKind(f)
  return {
    id: f.id,
    label: f.label ?? f.id,
    ...(f.description != null ? { description: f.description } : {}),
    ...(f.type != null ? { type: f.type } : {}),
    ...(fz ? { frozen: fz } : {}),
  }
}

/**
 * Campi del riepilogo (Regola 4: N = i campi del profilo di RIFERIMENTO).
 * sources: [{ fieldDefs, at }]. Riferimento = i fieldDefs della fonte più
 * recente (a parità la prima); `removed` = gli id delle altre fonti che il
 * riferimento non ha (campi tolti dal profilo): si vedono in «Per campo», fuori da N.
 * Il server passa i membri 'ok' (e gli 'stale' se non ce ne sono) con la loro
 * data; per una fotografia [{ fieldDefs: snapshot.fieldDefs, at: Infinity },
 * { fieldDefs: snapshot.removedFieldDefs, at: -Infinity }].
 */
export function referenceFields(sources) {
  const all = (sources || []).filter((s) => s && Array.isArray(s.fieldDefs) && s.fieldDefs.length)
  // Mai come riferimento una fonte SENZA descrizioni (le run salvano solo id e
  // label): senza descrizione ogni campo sarebbe un testo, niente importi né
  // «Anno da». Si usano solo se non c'è altro.
  const described = all.filter((s) => s.fieldDefs.some((f) => f && typeof f.description === 'string' && f.description.trim()))
  const list = described.length ? described : all
  if (!list.length) return { fields: [], removed: [] }
  let ref = list[0]
  for (const s of list) if ((s.at ?? -Infinity) > (ref.at ?? -Infinity)) ref = s
  const fields = ref.fieldDefs.filter((f) => f && f.id).map(defShape)
  const have = new Set(fields.map((f) => f.id))
  const removed = []
  for (const s of list) {
    if (s === ref) continue
    for (const f of s.fieldDefs) {
      if (!f || !f.id || have.has(f.id)) continue
      have.add(f.id)
      removed.push(defShape(f))
    }
  }
  return { fields, removed }
}

const pickValues = (values, ids) => {
  const out = {}
  for (const id of ids) if (values && values[id] != null) out[id] = values[id]
  return out
}

const nonEmptyValues = (values) => {
  const out = {}
  for (const [k, v] of Object.entries(values || {})) if (v != null && String(v).trim() !== '') out[k] = String(v)
  return out
}

/**
 * Fotografia dei membri. Entrano i membri 'ok'/'stale' coi loro valori (solo i
 * campi non vuoti); un membro ora Non valido esce (dropped) e non conserva la
 * voce vecchia; gli altri non disponibili conservano la voce della fotografia
 * precedente se c'era (keptOld), altrimenti escono (dropped).
 * members: [{ jobId, state, reason, values, valuesAt, forced, dossierName, batchId, batchLabel, scannedFiles }]
 * → { snapshot: { takenAt, fieldDefs, removedFieldDefs, jobs }, dropped, keptOld }
 */
export function buildSnapshot({ takenAt, fields = [], removedFields = [], members = [], previous = null } = {}) {
  const jobs = {}
  const dropped = []
  const keptOld = []
  for (const m of members) {
    if (m.state === 'ok' || m.state === 'stale') {
      jobs[m.jobId] = {
        values: nonEmptyValues(m.values),
        dossierName: m.dossierName ?? null,
        batchId: m.batchId ?? null,
        batchLabel: m.batchLabel ?? null,
        scannedFiles: m.scannedFiles || [],
        jobUpdatedAt: m.valuesAt ?? null,
        forced: !!m.forced,
      }
    } else if (m.reason !== 'notValid' && previous?.jobs?.[m.jobId]) {
      jobs[m.jobId] = previous.jobs[m.jobId]
      keptOld.push(m.jobId)
    } else {
      dropped.push(m.jobId)
    }
  }
  return {
    // Campi CONGELATI (freezeField): tipo, unità, natura e risposte di oggi.
    snapshot: { takenAt, fieldDefs: fields.map(freezeField), removedFieldDefs: removedFields.map(freezeField), jobs },
    dropped,
    keptOld,
  }
}

// ─── Ingresso: summarize ─────────────────────────────────────────────────────

function viewYear(v) {
  if (v === 'none') return 'none'
  if (typeof v === 'number' && Number.isInteger(v)) return v
  if (typeof v === 'string' && /^\d{4}$/.test(v)) return Number(v)
  return null
}

/**
 * Riepilogo completo.
 * input: {
 *   fields,         // [{ id, label, description, type }] del profilo di riferimento (N)
 *   removedFields,  // campi tolti dal profilo ma presenti in membri vecchi (fuori da N)
 *   policies,       // [{ jobId, batchId, name, path, values, state: 'ok'|'stale', valuesAt }] solo quelle nei calcoli
 *   yearFieldId, dueFieldId,
 *   prefs,          // salvate (sparse)
 *   today,          // 'GG/MM/AAAA'
 *   view,           // { year?: number|'none', group?: chiave, yearA?, yearB?, field? }
 *   values,         // 'all' = policies[].values con tutti i campi; di default solo i campi «per polizza»
 * }
 * Filtri: anno e gruppo si applicano a carte, gruppo, scadenze, distribuzione,
 * completezza, statistiche per campo ed elenco delle polizze; il grafico per
 * anno, la Tabella e le liste «per anno» usano il solo filtro gruppo (gli anni
 * sono le colonne) ed evidenziano l'anno scelto; il Confronto li ignora.
 */
export function summarize(input = {}) {
  const today = input.today
  const yearFieldId = input.yearFieldId || null
  const dueFieldId = input.dueFieldId || null
  const view = input.view || {}
  const all = normalizePolicies(input.policies, yearFieldId)
  const meta = describeFields(input.fields, all)
  const metaIds = new Set(meta.map((m) => m.id))
  const removedMeta = describeFields((input.removedFields || []).filter((f) => f && f.id && !metaIds.has(f.id)), all)
    .map((m) => ({ ...m, group: 'removed' }))
  const byId = new Map([...meta, ...removedMeta].map((m) => [m.id, m]))
  const prefs = effectiveFromMeta(input.prefs, input.fields || [], meta, all.length)
  const groupFd = prefs.groupFieldId ? byId.get(prefs.groupFieldId) || null : null
  const cur = yearOfToday(today)

  // Filtri
  const vYear = viewYear(view.year)
  const vGroup = groupFd && typeof view.group === 'string' && view.group ? view.group : null
  const inGroup = (p) => !vGroup || groupKeyOf(groupFd, p.values?.[groupFd.id]) === vGroup
  const inYear = (p) => vYear == null || (vYear === 'none' ? p.year == null : p.year === vYear)
  const groupSet = all.filter(inGroup)
  const filtered = groupSet.filter(inYear)
  const yearOnlySet = all.filter(inYear)

  const yearsList = yearsOf(groupSet, yearFieldId, today)
  const years = numericYears(yearsList)
  const refYear = referenceYear(years, today)
  const focusYear = typeof vYear === 'number' ? vYear : vYear == null ? refYear : null
  const prevYear = focusYear != null ? previousYear(years, focusYear) : null
  const bySetYear = (set, y) => set.filter((p) => p.year === y)

  // Chiavi di gruppo per il menu (filtro anno, non gruppo)
  const groupValues = groupFd
    ? groupsOf(groupFd, yearOnlySet).items.slice(0, GROUP_MENU).map((g) => ({ key: g.key, label: g.label, count: g.members.length }))
    : []

  const h0 = prefs.highlights[0] && byId.get(prefs.highlights[0].fieldId) ? prefs.highlights[0] : null
  const h0fd = h0 ? byId.get(h0.fieldId) : null

  // ── Cruscotto
  const kpis = prefs.highlights.filter((h) => byId.has(h.fieldId)).map((h) => {
    const fd = byId.get(h.fieldId)
    const nums = numsOf(fd, filtered)
    const st = numStats(nums)
    let d = null
    if ((h.op === 'sum' || h.op === 'avg') && focusYear != null && prevYear != null) {
      const psA = bySetYear(groupSet, prevYear)
      const psB = bySetYear(groupSet, focusYear)
      const na = numsOf(fd, psA)
      const nb = numsOf(fd, psB)
      const x = withCoverage(delta(aggregate(h.op, na), aggregate(h.op, nb)), h.op, coverage(na, psA), coverage(nb, psB))
      if (x.abs != null) d = { ...x, yearA: prevYear, yearB: focusYear }
    }
    const nonNumeric = nonNumericOf(fd, filtered).reduce((a, x) => a + x.count, 0)
    return {
      fieldId: h.fieldId,
      op: h.op,
      value: aggregate(h.op, nums),
      delta: d,
      range: st.n ? { min: st.min, max: st.max } : null,
      n: st.n,
      of: filtered.length,
      nonNumeric,
      empty: filtered.length - st.n - nonNumeric,
    }
  })
  const barOp = h0 ? (h0.op === 'minmax' ? 'avg' : h0.op) : null
  const byYear = h0fd
    ? {
        fieldId: h0fd.id,
        op: barOp,
        bars: years.slice(-YEAR_BARS).map((y) => {
          const ps = bySetYear(groupSet, y)
          const nums = numsOf(h0fd, ps)
          return { year: y, inProgress: cur != null && y >= cur, ref: y === focusYear, value: aggregate(barOp, nums), count: ps.length, n: nums.length }
        }),
      }
    : null
  const amountOf = (ps) => (h0fd ? aggregate(h0.op, numsOf(h0fd, ps)) : null)
  let group = null
  if (groupFd) {
    const g = groupsOf(groupFd, filtered)
    const top = g.items.slice(0, GROUP_ROWS)
    const rest = g.items.slice(GROUP_ROWS)
    const restMembers = rest.flatMap((x) => x.members)
    group = {
      fieldId: groupFd.id,
      amountFieldId: h0fd ? h0fd.id : null,
      op: h0 ? h0.op : null,
      total: filtered.length,
      rows: top.map((x) => ({ key: x.key, label: x.label, count: x.members.length, amount: amountOf(x.members) })),
      other: { count: restMembers.length, distinct: rest.length, amount: restMembers.length ? amountOf(restMembers) : null },
      empty: { count: g.empty.length, amount: g.empty.length ? amountOf(g.empty) : null },
    }
  }
  const nameOf = new Map(all.map((p) => [p.jobId, p]))
  const due = {
    fieldId: dueFieldId,
    days: prefs.dueDays,
    items: dueWithin(filtered, dueFieldId, today, prefs.dueDays).map((x) => {
      const p = nameOf.get(x.jobId)
      return { ...x, name: p.name, batchId: p.batchId, group: groupFd ? groupLabelOf(groupFd, p.values?.[groupFd.id]) : null }
    }),
  }
  const distFd = prefs.distributionFieldId ? byId.get(prefs.distributionFieldId) : null
  let distribution = null
  if (distFd && isNumericKind(distFd.kind)) {
    const nums = numsOf(distFd, filtered)
    const empty = filtered.filter((p) => isEmpty(p.values?.[distFd.id])).length
    distribution = { fieldId: distFd.id, kind: distFd.kind, unit: distFd.unit, ...buckets(nums, empty), nonNumeric: nonNumericOf(distFd, filtered).reduce((a, x) => a + x.count, 0) }
  }
  const dashboard = {
    total: filtered.length,
    focusYear,
    focusYearCount: focusYear != null ? bySetYear(filtered, focusYear).length : null,
    kpis,
    byYear,
    group,
    due,
    distribution,
    completeness: completeness(input.fields || [], filtered),
  }

  // ── Tabella per anno (filtro gruppo; gli anni sono le colonne)
  const hasNone = groupSet.some((p) => p.year == null)
  const columns = [
    ...years.map((y) => ({ key: String(y), year: y, inProgress: cur != null && y >= cur, ref: y === focusYear })),
    ...(hasNone ? [{ key: 'none', year: null, inProgress: false, ref: false }] : []),
  ]
  const colSets = new Map(columns.map((c) => [c.key, c.year == null ? groupSet.filter((p) => p.year == null) : bySetYear(groupSet, c.year)]))
  const deltaYears = focusYear != null && prevYear != null ? { a: prevYear, b: focusYear } : null
  const rowDelta = (cells, op) => (deltaYears && op !== 'minmax' ? delta(cells[String(deltaYears.a)], cells[String(deltaYears.b)]) : null)
  const cellsBy = (fn) => Object.fromEntries(columns.map((c) => [c.key, fn(colSets.get(c.key))]))
  // Righe numeriche: valore e copertura (n valori su `of` polizze) per colonna.
  const numRow = (fd, op) => {
    const cells = {}
    const cov = {}
    for (const c of columns) {
      const ps = colSets.get(c.key)
      const nums = numsOf(fd, ps)
      cells[c.key] = aggregate(op, nums)
      cov[c.key] = coverage(nums, ps)
    }
    const all = numsOf(fd, groupSet)
    const d = rowDelta(cells, op)
    return {
      fieldId: fd.id,
      op,
      cells,
      cov,
      total: aggregate(op, all),
      totalCov: coverage(all, groupSet),
      delta: d && deltaYears ? withCoverage(d, op, cov[String(deltaYears.a)], cov[String(deltaYears.b)]) : d,
      strong: !!(h0 && h0.fieldId === fd.id && h0.op === op),
    }
  }
  const tableGroups = []
  const portfolioCells = cellsBy((ps) => ps.length)
  tableGroups.push({ key: 'portfolio', rows: [{ fieldId: null, op: 'count', cells: portfolioCells, total: groupSet.length, delta: rowDelta(portfolioCells, 'count'), strong: false }] })
  const opsRows = (pred) => {
    const rows = []
    for (const fd of meta) {
      if (!pred(fd)) continue
      const chosen = prefs.ops[fd.id] || []
      for (const op of allowedOps(fd.kind)) if (chosen.includes(op)) rows.push(numRow(fd, op))
    }
    return rows
  }
  const pushGroup = (key, rows, extra = {}) => { if (rows.length) tableGroups.push({ key, ...extra, rows }) }
  pushGroup('amounts', opsRows((fd) => fd.kind === 'amount' && !fd.structural))
  pushGroup('conditions', opsRows((fd) => fd.kind === 'amount' && fd.structural))
  if (prefs.tableRows === 'all') {
    pushGroup('rates', opsRows((fd) => fd.kind === 'rate'))
    const checkRows = []
    for (const fd of meta) {
      if (fd.kind !== 'check' || !fd.answers || !fd.answers.length) continue
      const first = fd.answers[0]
      const pctOf = (ps) => {
        let n = 0
        let yes = 0
        for (const p of ps) {
          const a = checkAnswer(fd._def, p.values?.[fd.id])
          if (a == null) continue
          n++
          if (a === first) yes++
        }
        return n ? yes / n : null
      }
      const cells = cellsBy(pctOf)
      checkRows.push({ fieldId: fd.id, op: 'pct', label: first, cells, total: pctOf(groupSet), delta: rowDelta(cells, 'pct'), strong: false })
    }
    pushGroup('checks', checkRows)
  }
  if (groupFd && (prefs.tableRows === 'amountsCounts' || prefs.tableRows === 'all')) {
    const g = groupsOf(groupFd, groupSet)
    const top = g.items.slice(0, GROUP_ROWS)
    const topKeys = new Set(top.map((x) => x.key))
    const countRow = (key, label, pick) => {
      const cells = cellsBy((ps) => ps.filter(pick).length)
      return { fieldId: groupFd.id, op: 'count', key, label, cells, total: groupSet.filter(pick).length, delta: rowDelta(cells, 'count'), strong: false }
    }
    const kOf = (p) => groupKeyOf(groupFd, p.values?.[groupFd.id])
    const rows = top.map((x) => countRow(x.key, x.label, (p) => kOf(p) === x.key))
    const other = (p) => { const k = kOf(p); return k !== EMPTY_KEY && !topKeys.has(k) }
    if (groupSet.some(other)) rows.push(countRow(OTHER_KEY, null, other))
    if (g.empty.length) rows.push(countRow(EMPTY_KEY, null, (p) => kOf(p) === EMPTY_KEY))
    pushGroup('group', rows, { fieldId: groupFd.id })
  }
  const table = { columns, deltaYears, groups: tableGroups }

  // ── Per campo
  const sortedFor = typeof view.field === 'string' && byId.has(view.field) ? view.field : (h0fd ? h0fd.id : null)
  const fieldStatsOut = {}
  for (const fd of [...meta, ...removedMeta]) {
    fieldStatsOut[fd.id] = fieldStats(fd, filtered, { years, yearSet: groupSet, focusYear, withSorted: fd.id === sortedFor })
  }

  // ── Confronto (insieme intero)
  const compare = compareYears({
    fields: [...meta, ...removedMeta],
    policies: all,
    prefs,
    yearA: viewYear(view.yearA),
    yearB: viewYear(view.yearB),
    today,
  })

  // ── Stessa polizza due volte (primo numero di documento + anno, su tutto l'insieme)
  const warnings = []
  const docFd = meta.find((m) => m.kind === 'identifier' && m.idKind === 'document')
  if (docFd) {
    const seen = new Map()
    for (const p of all) {
      const raw = p.values?.[docFd.id]
      if (isEmpty(raw)) continue
      const k = textKey(raw)
      if (!k) continue
      const sig = `${k}|${p.year ?? ''}`
      if (!seen.has(sig)) seen.set(sig, { value: String(raw).trim(), year: p.year, jobIds: [] })
      seen.get(sig).jobIds.push(p.jobId)
    }
    const groups = [...seen.values()].filter((x) => x.jobIds.length > 1)
    if (groups.length) warnings.push({ code: 'samePolicy', jobIds: groups.flatMap((x) => x.jobIds), groups })
  }

  // Valori per polizza nella risposta: di default solo i campi «per polizza»
  // (identificativi e testi tutti diversi), gli unici che le viste mostrano
  // polizza per polizza; il resto è già aggregato (2000 polizze × 35 campi
  // sono ~3,6 MB). values: 'all' per chi li vuole tutti (export Excel).
  const keepValues = input.values === 'all' ? null : new Set(meta.filter((m) => m.group === 'identifier').map((m) => m.id))

  return {
    fields: meta.map(publicField),
    removedFields: removedMeta.map(publicField),
    prefs,
    policies: filtered.map((p) => ({
      jobId: p.jobId,
      batchId: p.batchId,
      name: p.name,
      path: p.path,
      year: p.year,
      values: keepValues ? pickValues(p.values, keepValues) : p.values,
      state: p.state,
      valuesAt: p.valuesAt,
      groupLabel: groupFd ? groupLabelOf(groupFd, p.values?.[groupFd.id]) : null,
    })),
    view: {
      year: vYear,
      group: vGroup,
      field: sortedFor,
      refYear,
      focusYear,
      prevYear,
      years: yearsList,
      groupValues,
    },
    dashboard,
    table,
    fieldStats: fieldStatsOut,
    compare,
    warnings,
  }
}
