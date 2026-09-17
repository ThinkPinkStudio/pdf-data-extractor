// Portafoglio Compare — motore di confronto tra due file Excel.
// Portato (quasi verbatim) da csa-xsl-cfr/src/app.js: pure functions, nessuna
// dipendenza da DOM/Electron. Riusabile lato client o server.
//
// Un "workbook" è { sheetNames, sheets } dove sheets[name] è un array di righe
// (oggetti colonna→valore). Il matching avviene sempre PER VALORE, mai per
// posizione di riga.

export type Row = Record<string, unknown>

export interface Workbook {
  sheetNames: string[]
  sheets: Record<string, Row[]>
  length?: number
}

export type Transform = 'none' | 'letters_only' | 'digits_only' | 'last6' | 'last4'

export interface MatchKey {
  label: string
  columnA?: string
  columnB?: string
  column?: string // legacy: colonna condivisa A/B
  sheetA?: string
  sheetB?: string
  sameColumn?: boolean
  enabled?: boolean
  transform?: Transform
}

export type CondMode = 'contains' | 'equals' | 'not_equals' | 'not_contains'

export interface Condition {
  columnA: string
  columnB: string
  sheetA?: string
  sheetB?: string
  mode: CondMode
  transform?: Transform
  connector?: 'AND' | 'OR'
}

export interface CompareConfig {
  matchKeys: MatchKey[]
  fuzzyEnabled: boolean
  fuzzyMinOverlap: number
  fuzzyIgnoreWords: string
  fuzzyBroadEnabled: boolean
  fuzzyMinOverlapBroad: number
  // Soglie decisionali (percentuale di somiglianza, 0–100): sotto la bassa la
  // coppia è scartata, tra le due «da verificare», sopra l'alta accettata.
  fuzzyThresholdLow: number
  fuzzyThresholdHigh: number
  searchConditions: Condition[]
  bothMatchConditions: Condition[]
  bothFilterConditions: Condition[]
}

// Opzioni fuzzy passate a compare(): un unico oggetto invece di parametri
// sciolti, così l'interruttore principale e le parole ignorate viaggiano
// insieme alle soglie (worker compreso).
export interface FuzzyOpts {
  enabled?: boolean // default true (config salvate prima del flag)
  minOverlap?: number
  ignoreWords?: string // testo libero: "totale, srl" (separatori: virgola, punto e virgola, a-capo)
  broadEnabled?: boolean
  broadMinOverlap?: number
  thresholdLow?: number // default 50
  thresholdHigh?: number // default 80
}

export interface FuzzyPair {
  rowA: Row
  rowB: Row
  kind: 'key' | 'broad'
  score: number // somiglianza 0–100 (vedi similarity)
}

export interface CompareResult {
  onlyA: Row[]
  onlyB: Row[]
  fuzzy: FuzzyPair[] // soglia bassa ≤ score < soglia alta: da verificare
  accepted: FuzzyPair[] // score ≥ soglia alta: accettate in automatico
  diffA: Row[]
  diffB: Row[]
}

/* ─── Opzioni UI ─────────────────────────────────────────────────────────── */
export const TRANSFORM_OPTIONS: { value: Transform; label: string }[] = [
  { value: 'none', label: 'Nessuna' },
  { value: 'letters_only', label: 'Solo lettere' },
  { value: 'digits_only', label: 'Solo cifre' },
  { value: 'last6', label: 'Ultime 6 cifre' },
  { value: 'last4', label: 'Ultime 4 cifre' },
]

// Trasformazione proposta per le chiavi/condizioni NUOVE (e per quelle salvate
// senza trasformazione). Le chiavi predefinite sul numero di polizza la
// dichiarano esplicitamente: «Solo lettere» svuoterebbe un numero.
export const DEFAULT_TRANSFORM: Transform = 'letters_only'

export const DEFAULT_THRESHOLD_LOW = 50
export const DEFAULT_THRESHOLD_HIGH = 80

export const BOTH_MODE_OPTIONS: { value: CondMode; label: string }[] = [
  { value: 'contains', label: 'Contiene' },
  { value: 'equals', label: 'Uguale a' },
  { value: 'not_equals', label: 'Diverso da' },
  { value: 'not_contains', label: 'Non contiene' },
]

/* ─── Default ────────────────────────────────────────────────────────────── */
export function defaultMatchKeys(): MatchKey[] {
  return ([
    { label: 'Numero Polizza', columnA: 'Numero Polizza', columnB: 'Numero Polizza', sheetA: '', sheetB: '', sameColumn: true, enabled: true, transform: 'none' },
    { label: 'Numero Polizza (solo cifre)', columnA: 'Numero Polizza', columnB: 'Numero Polizza', sheetA: '', sheetB: '', sameColumn: true, enabled: true, transform: 'digits_only' },
    { label: 'Ultime 6 cifre polizza', columnA: 'Numero Polizza', columnB: 'Numero Polizza', sheetA: '', sheetB: '', sameColumn: true, enabled: true, transform: 'last6' },
    { label: 'Ultime 4 cifre polizza', columnA: 'Numero Polizza', columnB: 'Numero Polizza', sheetA: '', sheetB: '', sameColumn: true, enabled: true, transform: 'last4' },
    { label: 'Targa Veicolo', columnA: 'Targa Veicolo', columnB: 'Targa Veicolo', sheetA: '', sheetB: '', sameColumn: true, enabled: true, transform: 'none' },
    { label: 'Veicolo', columnA: 'Veicolo', columnB: 'Veicolo', sheetA: '', sheetB: '', sameColumn: true, enabled: true, transform: 'none' },
  ] as MatchKey[]).map(normaliseKey)
}

// Nome della chiave calcolato dalle colonne/fogli (la UI non lo fa più scrivere).
export function keyLabel(k: MatchKey): string {
  const sheet = (s?: string) => (s && s.trim() ? s.trim() : '1° foglio')
  const colA = k.columnA ?? k.column ?? ''
  const colB = k.columnB ?? k.column ?? ''
  return `${colA || '—'} - ${sheet(k.sheetA)} - ${colB || '—'} - ${sheet(k.sheetB)}`
}

// Chiave in forma esplicita A/B: le chiavi storiche «stessa colonna» (o col solo
// `column`) ricevono colonna e foglio di B uguali ad A; label ricalcolato.
export function normaliseKey(k: MatchKey): MatchKey {
  const columnA = k.columnA ?? k.column ?? ''
  const same = k.sameColumn !== false
  const columnB = k.columnB || columnA
  const sheetA = k.sheetA || ''
  const sheetB = k.sheetB || (same ? sheetA : '')
  const out: MatchKey = { ...k, columnA, columnB, sheetA, sheetB, sameColumn: false, transform: k.transform || DEFAULT_TRANSFORM }
  delete out.column
  out.label = keyLabel(out)
  return out
}

export function defaultSearchConditions(): Condition[] {
  return [{ columnA: '', columnB: '', sheetA: '', sheetB: '', mode: 'contains', transform: DEFAULT_TRANSFORM, connector: 'AND' }]
}

export function defaultBothMatchConditions(): Condition[] {
  return [{ columnA: '', columnB: '', sheetA: '', sheetB: '', mode: 'equals', transform: DEFAULT_TRANSFORM, connector: 'AND' }]
}

export function defaultCompareConfig(): CompareConfig {
  return {
    matchKeys: defaultMatchKeys(),
    fuzzyEnabled: true,
    fuzzyMinOverlap: 4,
    fuzzyIgnoreWords: '',
    fuzzyBroadEnabled: true,
    fuzzyMinOverlapBroad: 6,
    fuzzyThresholdLow: DEFAULT_THRESHOLD_LOW,
    fuzzyThresholdHigh: DEFAULT_THRESHOLD_HIGH,
    searchConditions: defaultSearchConditions(),
    bothMatchConditions: defaultBothMatchConditions(),
    bothFilterConditions: [],
  }
}

/* ─── Profili ────────────────────────────────────────────────────────────── */
// Un solo blocco di profili, in Configurazione: chiavi di abbinamento + fuzzy +
// soglie. Servono sia a «Differenze» sia a «Uguale a» nella Comparazione. I
// profili storici del Confronto righe (RowsProfile) si convertono in chiavi
// (comparisonProfileFromRows) e restano caricabili.
export type ComparisonProfile = Pick<CompareConfig, 'matchKeys' | 'fuzzyEnabled' | 'fuzzyMinOverlap' | 'fuzzyIgnoreWords' | 'fuzzyBroadEnabled' | 'fuzzyMinOverlapBroad' | 'fuzzyThresholdLow' | 'fuzzyThresholdHigh'>
export type RowsProfile = Pick<CompareConfig, 'bothMatchConditions' | 'bothFilterConditions'>

export function comparisonProfileFrom(c: CompareConfig): ComparisonProfile {
  return {
    matchKeys: c.matchKeys,
    fuzzyEnabled: c.fuzzyEnabled !== false,
    fuzzyMinOverlap: c.fuzzyMinOverlap,
    fuzzyIgnoreWords: c.fuzzyIgnoreWords ?? '',
    fuzzyBroadEnabled: c.fuzzyBroadEnabled !== false,
    fuzzyMinOverlapBroad: c.fuzzyMinOverlapBroad,
    fuzzyThresholdLow: c.fuzzyThresholdLow,
    fuzzyThresholdHigh: c.fuzzyThresholdHigh,
  }
}

// Soglie coerenti: interi 0–100, bassa ≤ alta; default dove mancano.
export function clampThresholds(low: unknown, high: unknown): { low: number; high: number } {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : d)
  const l = num(low, DEFAULT_THRESHOLD_LOW)
  const h = num(high, DEFAULT_THRESHOLD_HIGH)
  return l <= h ? { low: l, high: h } : { low: h, high: l }
}

// Profilo storico del Confronto righe → profilo della Comparazione: ogni
// condizione «Uguale a» completa diventa una chiave. null se non ce n'è nessuna.
export function comparisonProfileFromRows(p: Partial<RowsProfile> | null | undefined): ComparisonProfile | null {
  const conds = p && Array.isArray(p.bothMatchConditions) ? p.bothMatchConditions : []
  const keys = conds
    .filter((c) => c && c.mode === 'equals' && c.columnA && c.columnB)
    .map((c) => normaliseKey({ label: '', columnA: c.columnA, columnB: c.columnB, sheetA: c.sheetA || '', sheetB: c.sheetB || '', sameColumn: false, enabled: true, transform: c.transform || DEFAULT_TRANSFORM }))
  if (!keys.length) return null
  return comparisonProfileFrom({ ...defaultCompareConfig(), matchKeys: keys })
}

// I profili storici erano CompareConfig INTERE (comprese le condizioni del
// Confronto righe): qui se ne prendono solo i campi della Comparazione, con i
// default per quelli aggiunti dopo il salvataggio.
export function applyComparisonProfile(c: CompareConfig, p: Partial<ComparisonProfile> & Partial<RowsProfile>): CompareConfig {
  const d = defaultCompareConfig()
  if (!Array.isArray(p.matchKeys) && Array.isArray(p.bothMatchConditions)) {
    const conv = comparisonProfileFromRows(p)
    if (conv) p = conv
  }
  const t = clampThresholds(p.fuzzyThresholdLow, p.fuzzyThresholdHigh)
  return {
    ...c,
    matchKeys: Array.isArray(p.matchKeys) && p.matchKeys.length ? p.matchKeys.map(normaliseKey) : d.matchKeys,
    fuzzyEnabled: p.fuzzyEnabled !== false,
    fuzzyMinOverlap: typeof p.fuzzyMinOverlap === 'number' ? p.fuzzyMinOverlap : d.fuzzyMinOverlap,
    fuzzyIgnoreWords: typeof p.fuzzyIgnoreWords === 'string' ? p.fuzzyIgnoreWords : d.fuzzyIgnoreWords,
    fuzzyBroadEnabled: p.fuzzyBroadEnabled !== false,
    fuzzyMinOverlapBroad: typeof p.fuzzyMinOverlapBroad === 'number' ? p.fuzzyMinOverlapBroad : d.fuzzyMinOverlapBroad,
    fuzzyThresholdLow: t.low,
    fuzzyThresholdHigh: t.high,
  }
}

export function rowsProfileFrom(c: Pick<CompareConfig, 'bothMatchConditions' | 'bothFilterConditions'>): RowsProfile {
  return {
    bothMatchConditions: c.bothMatchConditions,
    bothFilterConditions: c.bothFilterConditions ?? [],
  }
}

export function applyRowsProfile(c: CompareConfig, p: Partial<RowsProfile>): CompareConfig {
  const d = defaultCompareConfig()
  return {
    ...c,
    bothMatchConditions: Array.isArray(p.bothMatchConditions) && p.bothMatchConditions.length ? p.bothMatchConditions : d.bothMatchConditions,
    bothFilterConditions: Array.isArray(p.bothFilterConditions) ? p.bothFilterConditions : [],
  }
}

/* ─── Multi-sheet ────────────────────────────────────────────────────────── */
export function normaliseWorkbook(raw: unknown): Workbook {
  // Retrocompat: una vecchia versione poteva restituire un semplice array di righe.
  if (Array.isArray(raw)) {
    const wb: Workbook = { sheetNames: ['Foglio1'], sheets: { Foglio1: raw as Row[] } }
    wb.length = (raw as Row[]).length
    return wb
  }
  const r = (raw || {}) as Partial<Workbook>
  const sheetNames = r.sheetNames || []
  const sheets = r.sheets || {}
  const primary = sheetNames[0]
  const wb: Workbook = { sheetNames, sheets }
  wb.length = primary && sheets[primary] ? sheets[primary].length : 0
  return wb
}

// Sceglie le righe da confrontare per un lato. Il foglio è preso dalla prima
// chiave/condizione attiva che lo nomina (sheetA per 'a', sheetB per 'b');
// se nessuno lo nomina, si usa il primo foglio.
export function sheetRows(wb: Workbook | null, entries: Array<{ sheetA?: string; sheetB?: string }>, side: 'a' | 'b'): Row[] {
  if (!wb || !wb.sheetNames || !wb.sheetNames.length) return []
  const field = side === 'a' ? 'sheetA' : 'sheetB'
  let name = ''
  for (const e of entries || []) {
    const s = e && e[field] ? String(e[field]).trim() : ''
    if (s && wb.sheets[s]) { name = s; break }
  }
  if (!name) name = wb.sheetNames[0]
  return wb.sheets[name] || []
}

// Colonne effettivamente presenti in un foglio (scansiona le prime righe).
export function workbookColumns(wb: Workbook | null, sheetName?: string): string[] {
  if (!wb || !wb.sheetNames.length) return []
  const name = sheetName && wb.sheets[sheetName] ? sheetName : wb.sheetNames[0]
  const rows = wb.sheets[name] || []
  const set = new Set<string>()
  for (const r of rows.slice(0, 50)) Object.keys(r).forEach((k) => set.add(k))
  return Array.from(set)
}

/* ─── Normalizzazione valori ─────────────────────────────────────────────── */
export function normalise(val: unknown, transform?: Transform): string {
  if (val == null) return ''
  const raw = String(val).trim()
  const upper = stripAccents(raw).toUpperCase()
  // base: maiuscolo, rimuove spazi e punteggiatura comune, azzera zeri iniziali
  const base = upper.replace(/[\s.'`]/g, '').replace(/^0+([^0])/, '$1')
  switch (transform) {
    case 'letters_only':
      return upper.replace(/[^A-Z]/g, '')
    case 'digits_only':
      return base.replace(/\D/g, '')
    case 'last6':
      return base.replace(/\D/g, '').slice(-6)
    case 'last4':
      return base.replace(/\D/g, '').slice(-4)
    default:
      return base
  }
}

function rowKeyA(row: Row, key: MatchKey): string {
  return normalise(row[key.columnA ?? key.column ?? ''], key.transform)
}
function rowKeyB(row: Row, key: MatchKey): string {
  return normalise(row[key.columnB ?? key.column ?? ''], key.transform)
}

/* ─── Confronto principale ───────────────────────────────────────────────── */
export function compare(
  dataA: Row[],
  dataB: Row[],
  keys: MatchKey[],
  fuzzy?: FuzzyOpts
): CompareResult {
  const mapsB = keys.map((k) => {
    const m = new Map<string, Row[]>()
    dataB.forEach((row) => {
      const v = rowKeyB(row, k)
      if (v) {
        if (!m.has(v)) m.set(v, [])
        m.get(v)!.push(row)
      }
    })
    return m
  })

  const matchedB = new Set<Row>()
  const unmatA: Row[] = []

  dataA.forEach((rowA) => {
    let matched = false
    for (let i = 0; i < keys.length; i++) {
      const v = rowKeyA(rowA, keys[i])
      if (!v) continue
      if (mapsB[i].has(v)) {
        mapsB[i].get(v)!.forEach((rowB) => matchedB.add(rowB))
        matched = true
        break
      }
    }
    if (!matched) unmatA.push(rowA)
  })

  const unmatB = dataB.filter((r) => !matchedB.has(r))

  const stage = fuzzyStage(unmatA, unmatB, keys, fuzzy)
  return { onlyA: stage.remainA, onlyB: stage.remainB, fuzzy: stage.fuzzy, accepted: stage.accepted, diffA: [], diffB: [] }
}

// Fase fuzzy comune a «Differenze» e «Uguale a»: prende le righe rimaste senza
// corrispondenza esatta e propone coppie per somiglianza.
//  - score < soglia bassa  → nessuna coppia (le righe restano separate)
//  - bassa ≤ score < alta  → «da verificare»
//  - score ≥ soglia alta   → accettata in automatico
// Prima passata sulle colonne delle chiavi, poi (se attiva) quella ampia su
// tutte le colonne con ciò che resta.
export function fuzzyStage(unmatA: Row[], unmatB: Row[], keys: MatchKey[], fuzzy?: FuzzyOpts): { fuzzy: FuzzyPair[]; accepted: FuzzyPair[]; remainA: Row[]; remainB: Row[] } {
  // Interruttore PRINCIPALE del fuzzy: se spento non si propone nessuna coppia
  // «da verificare» — le righe senza match esatto restano solo-in-A/solo-in-B.
  if (fuzzy && fuzzy.enabled === false) {
    return { fuzzy: [], accepted: [], remainA: unmatA, remainB: unmatB }
  }
  const ignore = parseIgnoreWords(fuzzy?.ignoreWords)
  const { low, high } = clampThresholds(fuzzy?.thresholdLow, fuzzy?.thresholdHigh)
  const first = fuzzyPass(unmatA, unmatB, keys, fuzzy?.minOverlap, ignore, low)
  let pairs = first.pairs
  let remainA = first.remainA
  let remainB = first.remainB

  // Seconda passata, più ampia: OGNI colonna. Gira solo su ciò che resta.
  const broadEnabled = !fuzzy || fuzzy.broadEnabled !== false
  if (broadEnabled && remainA.length && remainB.length) {
    const broadN = fuzzy && Number.isInteger(fuzzy.broadMinOverlap) && (fuzzy.broadMinOverlap as number) >= 2 ? (fuzzy.broadMinOverlap as number) : 6
    const broad = broadFuzzyPass(remainA, remainB, broadN, ignore, low)
    pairs = pairs.concat(broad.pairs)
    remainA = broad.remainA
    remainB = broad.remainB
  }
  return {
    fuzzy: pairs.filter((p) => p.score < high),
    accepted: pairs.filter((p) => p.score >= high),
    remainA,
    remainB,
  }
}

/* ─── Somiglianza ────────────────────────────────────────────────────────── */
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Parole/sequenze da ignorare nel fuzzy ("totale, srl" → ['TOTALE','SRL']):
// vengono rimosse dai valori PRIMA del confronto, così un suffisso comune a
// tutte le righe (es. il «Totale» dei pivot Excel, «srl») non rende simili
// due righe a caso. Minimo 2 caratteri per voce.
export function parseIgnoreWords(raw?: string): string[] {
  return String(raw || '')
    .split(/[,;\n]/)
    .map((w) => alphanumOnly(w))
    .filter((w, i, arr) => w.length >= 2 && arr.indexOf(w) === i)
}

function stripIgnored(alphanum: string, ignore: string[]): string {
  let s = alphanum
  for (const w of ignore) s = s.split(w).join('')
  return s
}

function alphanumOnly(str: unknown): string {
  return stripAccents(String(str)).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function fuzzyText(val: unknown, ignore?: string[]): string {
  if (val == null) return ''
  const s = alphanumOnly(val)
  return ignore && ignore.length ? stripIgnored(s, ignore) : s
}

// Tratto comune più lungo tra a e b: [lunghezza, inizio in a, inizio in b].
function longestCommon(a: string, b: string): [number, number, number] {
  let best = 0, ai = 0, bj = 0
  const dp = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    let prev = 0
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? prev + 1 : 0
      if (dp[j] > best) { best = dp[j]; ai = i - best; bj = j - best }
      prev = tmp
    }
  }
  return [best, ai, bj]
}

// Lettere in comune contando SOLO i tratti di almeno n caratteri consecutivi:
// si prende il tratto comune più lungo, lo si toglie da entrambi i valori
// (al suo posto un separatore diverso per lato, così i pezzi rimasti non si
// saldano tra loro) e si ripete. L'ordine dei pezzi non conta: «Rossi Mario» e
// «Mario Rossi» hanno in comune tutte le lettere.
function sharedRuns(a: string, b: string, n: number): number {
  let x = a
  let y = b
  let total = 0
  while (x.length >= n && y.length >= n) {
    const [len, ai, bj] = longestCommon(x, y)
    if (len < n) break
    total += len
    x = x.slice(0, ai) + '\u0001' + x.slice(ai + len)
    y = y.slice(0, bj) + '\u0002' + y.slice(bj + len)
  }
  return total
}

// SOMIGLIANZA 0–100 tra due valori: quanta parte del valore PIÙ LUNGO è coperta
// da tratti di almeno n lettere/cifre consecutive presenti anche nell'altro.
// Maiuscole, spazi, punteggiatura e accenti non contano; le parole da ignorare
// si tolgono prima. «Antonio Giuseppe Maria» / «Giuseppe Maria» = 65 (13 lettere
// su 20), «Rossi Mario» / «Mario Rossi» = 100 con n ≤ 5.
export function similarity(a: unknown, b: unknown, n = 4, ignore?: string[]): number {
  const x = fuzzyText(a, ignore)
  const y = fuzzyText(b, ignore)
  const longest = Math.max(x.length, y.length)
  if (!longest) return 0
  const nn = Number.isInteger(n) && n >= 2 ? n : 4
  return Math.round((sharedRuns(x, y, nn) / longest) * 100)
}

// Sottostringhe di n caratteri: servono solo a TROVARE i candidati in fretta
// (indice), il punteggio vero lo dà similarity().
function grams(s: string, n: number): string[] {
  const out = new Set<string>()
  for (let i = 0; i <= s.length - n; i++) out.add(s.slice(i, i + n))
  return Array.from(out)
}

interface ScoredCell { text: string; }
interface Candidate { ai: number; bi: number; score: number }

// Assegnazione 1:1 per punteggio migliore: prima le coppie più simili, così una
// riga di B va alla riga di A che le somiglia di più e non alla prima trovata.
function assignBest(cands: Candidate[], unmatA: Row[], unmatB: Row[], kind: 'key' | 'broad'): { pairs: FuzzyPair[]; remainA: Row[]; remainB: Row[] } {
  cands.sort((p, q) => q.score - p.score || p.ai - q.ai || p.bi - q.bi)
  const usedA = new Set<number>()
  const usedB = new Set<number>()
  const chosen: Candidate[] = []
  for (const c of cands) {
    if (usedA.has(c.ai) || usedB.has(c.bi)) continue
    usedA.add(c.ai)
    usedB.add(c.bi)
    chosen.push(c)
  }
  // Ordine stabile per la UI: come le righe di A.
  chosen.sort((p, q) => p.ai - q.ai)
  const pairs = chosen.map((c) => ({ rowA: unmatA[c.ai], rowB: unmatB[c.bi], kind, score: c.score }))
  return { pairs, remainA: unmatA.filter((_, i) => !usedA.has(i)), remainB: unmatB.filter((_, i) => !usedB.has(i)) }
}

// Motore comune delle due passate. cellsA[ai][c] e cellsB[bi][c] sono i testi
// normalizzati delle colonne confrontabili; compatible(ca, cb) dice quali
// colonne di A si confrontano con quali di B. Ogni coppia di righe prende il
// punteggio MIGLIORE tra le sue coppie di colonne che condividono almeno un
// tratto di n caratteri.
function scoredPass(
  unmatA: Row[], unmatB: Row[], cellsA: ScoredCell[][], cellsB: ScoredCell[][],
  compatible: (ca: number, cb: number) => boolean, n: number, low: number, kind: 'key' | 'broad'
): { pairs: FuzzyPair[]; remainA: Row[]; remainB: Row[] } {
  const index = new Map<string, Array<[number, number]>>() // gram → [bi, colonna B]
  cellsB.forEach((cells, bi) => cells.forEach((cell, cb) => {
    if (cell.text.length < n) return
    for (const g of grams(cell.text, n)) {
      let list = index.get(g)
      if (!list) index.set(g, (list = []))
      list.push([bi, cb])
    }
  }))
  const cands: Candidate[] = []
  cellsA.forEach((cells, ai) => {
    const best = new Map<number, number>() // bi → score
    const tried = new Set<string>()
    cells.forEach((cell, ca) => {
      if (cell.text.length < n) return
      for (const g of grams(cell.text, n)) {
        const hits = index.get(g)
        if (!hits) continue
        for (const [bi, cb] of hits) {
          if (!compatible(ca, cb)) continue
          const k = bi + ':' + ca + ':' + cb
          if (tried.has(k)) continue
          tried.add(k)
          const other = cellsB[bi][cb].text
          const longest = Math.max(cell.text.length, other.length)
          const score = Math.round((sharedRuns(cell.text, other, n) / longest) * 100)
          if (score > (best.get(bi) ?? -1)) best.set(bi, score)
        }
      }
    })
    best.forEach((score, bi) => { if (score >= low) cands.push({ ai, bi, score }) })
  })
  return assignBest(cands, unmatA, unmatB, kind)
}

/* ─── Fuzzy per chiavi ───────────────────────────────────────────────────── */
// Confronta la colonna A di ogni chiave con la colonna B della STESSA chiave.
export function fuzzyPass(unmatA: Row[], unmatB: Row[], keys: MatchKey[], minOverlap?: number, ignore?: string[], low = DEFAULT_THRESHOLD_LOW): { pairs: FuzzyPair[]; remainA: Row[]; remainB: Row[] } {
  const n = Number.isInteger(minOverlap) && (minOverlap as number) >= 2 ? (minOverlap as number) : 4
  const colA = keys.map((k) => k.columnA ?? k.column ?? '')
  const colB = keys.map((k) => k.columnB ?? k.column ?? '')
  const cellsA = unmatA.map((r) => colA.map((c) => ({ text: fuzzyText(r[c], ignore) })))
  const cellsB = unmatB.map((r) => colB.map((c) => ({ text: fuzzyText(r[c], ignore) })))
  return scoredPass(unmatA, unmatB, cellsA, cellsB, (ca, cb) => ca === cb, n, low, 'key')
}

/* ─── Fuzzy ampio (tutte le colonne, solo lettere/cifre) ─────────────────── */
// Ogni colonna di A con ogni colonna di B, ma solo valori che contengono
// LETTERE: importi, date e contatori (tutti cifre) si ripetono tra righe
// diverse e darebbero somiglianze del 100% prive di senso.
export function broadFuzzyPass(unmatA: Row[], unmatB: Row[], minOverlap?: number, ignore?: string[], low = DEFAULT_THRESHOLD_LOW): { pairs: FuzzyPair[]; remainA: Row[]; remainB: Row[] } {
  const n = Number.isInteger(minOverlap) && (minOverlap as number) >= 2 ? (minOverlap as number) : 6
  const cells = (r: Row) => Object.keys(r).map((c) => {
    const t = fuzzyText(r[c], ignore)
    return { text: /[A-Z]/.test(t) ? t : '' }
  })
  return scoredPass(unmatA, unmatB, unmatA.map(cells), unmatB.map(cells), () => true, n, low, 'broad')
}

/* ─── Uguale a (A in B per chiavi) ───────────────────────────────────────── */
// «Uguale a» nella Comparazione: per ogni riga di A, le righe di B che hanno
// lo stesso valore su ALMENO UNA chiave attiva (condizioni «Uguale a» in O,
// come il Confronto righe). Le righe di A senza corrispondenza passano dalla
// stessa fase fuzzy della Comparazione, contro le righe di B mai abbinate.
export interface EqualResult {
  rows: BothRowResult[]
  fuzzy: FuzzyPair[]
  accepted: FuzzyPair[]
}

export function runEqualByKeys(dataA: Row[], dataB: Row[], keys: MatchKey[], fuzzy?: FuzzyOpts, maxPerRow = 20): EqualResult {
  const maps = keys.map((k) => {
    const m = new Map<string, number[]>()
    dataB.forEach((row, bi) => {
      const v = rowKeyB(row, k)
      if (!v) return
      let list = m.get(v)
      if (!list) m.set(v, (list = []))
      list.push(bi)
    })
    return m
  })
  const matchedB = new Set<number>()
  const unmatA: Row[] = []
  const rows: BothRowResult[] = dataA.map((rowA) => {
    const hit = new Set<number>()
    keys.forEach((k, i) => {
      const v = rowKeyA(rowA, k)
      if (!v) return
      maps[i].get(v)?.forEach((bi) => hit.add(bi))
    })
    const idx = Array.from(hit).sort((x, y) => x - y)
    idx.forEach((bi) => matchedB.add(bi))
    if (!idx.length) unmatA.push(rowA)
    return { rowA, matchCount: idx.length, matches: idx.slice(0, maxPerRow).map((bi) => dataB[bi]) }
  })
  const unmatB = dataB.filter((_, bi) => !matchedB.has(bi))
  const stage = fuzzyStage(unmatA, unmatB, keys, fuzzy)
  return { rows, fuzzy: stage.fuzzy, accepted: stage.accepted }
}

/* ─── Ricerca per inclusione ─────────────────────────────────────────────── */
export function evalSearchCondition(rowA: Row, rowB: Row, cond: Condition): boolean {
  const valA = normalise(rowA[cond.columnA], cond.transform)
  if (!valA) return false
  const valB = normalise(rowB[cond.columnB], cond.transform)
  if (!valB) return false
  return cond.mode === 'equals' ? valA === valB : valB.includes(valA)
}

export function evalSearchConditions(rowA: Row, rowB: Row, conditions: Condition[]): boolean {
  if (!conditions.length) return false
  let result = evalSearchCondition(rowA, rowB, conditions[0])
  for (let i = 1; i < conditions.length; i++) {
    const v = evalSearchCondition(rowA, rowB, conditions[i])
    result = conditions[i].connector === 'OR' ? result || v : result && v
  }
  return result
}

export function runInclusionSearch(dataA: Row[], dataB: Row[], conditions: Condition[]): Array<{ rowA: Row; matches: Row[] }> {
  if (!conditions.length) return dataA.map((rowA) => ({ rowA, matches: [] }))
  return dataA.map((rowA) => ({
    rowA,
    matches: dataB.filter((rowB) => evalSearchConditions(rowA, rowB, conditions)),
  }))
}

/* ─── In Entrambi ────────────────────────────────────────────────────────── */
export function evalBothCondition(rowA: Row, rowB: Row, cond: Condition): boolean {
  const valA = normalise(rowA[cond.columnA], cond.transform)
  const valB = normalise(rowB[cond.columnB], cond.transform)
  // Le celle vuote non soddisfano mai una condizione, nemmeno negativa.
  if (!valA || !valB) return false
  switch (cond.mode) {
    case 'equals':
      return valA === valB
    case 'not_equals':
      return valA !== valB
    case 'not_contains':
      return !valB.includes(valA)
    default:
      return valB.includes(valA) // 'contains'
  }
}

export function evalBothConditions(rowA: Row, rowB: Row, conditions: Condition[]): boolean {
  if (!conditions.length) return false
  let result = evalBothCondition(rowA, rowB, conditions[0])
  for (let i = 1; i < conditions.length; i++) {
    const v = evalBothCondition(rowA, rowB, conditions[i])
    result = conditions[i].connector === 'OR' ? result || v : result && v
  }
  return result
}

export function runBothMatch(dataA: Row[], dataB: Row[], matchConds: Condition[], filterConds: Condition[]): Array<{ rowA: Row; rowB: Row }> {
  const pairs: Array<{ rowA: Row; rowB: Row }> = []
  if (!matchConds.length) return pairs
  dataA.forEach((rowA) => {
    dataB.forEach((rowB) => {
      if (!evalBothConditions(rowA, rowB, matchConds)) return
      if (filterConds.length && !evalBothConditions(rowA, rowB, filterConds)) return
      pairs.push({ rowA, rowB })
    })
  })
  return pairs
}

// VERDETTO PER RIGA di A: "questa riga esiste in B?" — è la domanda vera di
// "In Entrambi". Il vecchio runBothMatch emetteva TUTTE le coppie (A×B) che
// soddisfacevano le condizioni: con una condizione debole o negativa
// esplodeva nella matrice NxM, e — peggio — le righe di A SENZA corrispondenza
// (l'informazione che serve) non comparivano da nessuna parte.
// `matches` è troncato a maxPerRow per non far esplodere la memoria sui
// portafogli grandi; `matchCount` è sempre il conteggio VERO.
export interface BothRowResult { rowA: Row; matchCount: number; matches: Row[] }

export function runBothByRow(
  dataA: Row[], dataB: Row[], matchConds: Condition[], filterConds: Condition[], maxPerRow = 20
): BothRowResult[] {
  if (!matchConds.length) return dataA.map((rowA) => ({ rowA, matchCount: 0, matches: [] }))
  return dataA.map((rowA) => {
    let matchCount = 0
    const matches: Row[] = []
    for (const rowB of dataB) {
      if (!evalBothConditions(rowA, rowB, matchConds)) continue
      if (filterConds.length && !evalBothConditions(rowA, rowB, filterConds)) continue
      matchCount++
      if (matches.length < maxPerRow) matches.push(rowB)
    }
    return { rowA, matchCount, matches }
  })
}

// true se TUTTE le condizioni di match sono negative (not_equals/not_contains):
// una condizione negativa è vera per quasi ogni coppia → ogni riga risulta
// "trovata" e il risultato non significa niente. La UI avvisa: i negativi
// hanno senso nei FILTRI (restringere coppie già abbinate), non nel match.
export function allNegativeConditions(conds: Condition[]): boolean {
  const active = (conds || []).filter((c) => c.columnA && c.columnB)
  return active.length > 0 && active.every((c) => c.mode === 'not_equals' || c.mode === 'not_contains')
}
