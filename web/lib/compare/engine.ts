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
}

export interface FuzzyPair {
  rowA: Row
  rowB: Row
  kind: 'key' | 'broad'
}

export interface CompareResult {
  onlyA: Row[]
  onlyB: Row[]
  fuzzy: FuzzyPair[]
  diffA: Row[]
  diffB: Row[]
}

/* ─── Opzioni UI ─────────────────────────────────────────────────────────── */
export const TRANSFORM_OPTIONS: { value: Transform; label: string }[] = [
  { value: 'none', label: 'Nessuna' },
  { value: 'letters_only', label: 'Solo lettere (case-insensitive)' },
  { value: 'digits_only', label: 'Solo cifre' },
  { value: 'last6', label: 'Ultime 6 cifre' },
  { value: 'last4', label: 'Ultime 4 cifre' },
]

export const BOTH_MODE_OPTIONS: { value: CondMode; label: string }[] = [
  { value: 'contains', label: 'Contiene' },
  { value: 'equals', label: 'Uguale a' },
  { value: 'not_equals', label: 'Diverso da' },
  { value: 'not_contains', label: 'Non contiene' },
]

/* ─── Default ────────────────────────────────────────────────────────────── */
export function defaultMatchKeys(): MatchKey[] {
  return [
    { label: 'Numero Polizza', columnA: 'Numero Polizza', columnB: 'Numero Polizza', sheetA: '', sheetB: '', sameColumn: true, enabled: true, transform: 'none' },
    { label: 'Numero Polizza (solo cifre)', columnA: 'Numero Polizza', columnB: 'Numero Polizza', sheetA: '', sheetB: '', sameColumn: true, enabled: true, transform: 'digits_only' },
    { label: 'Ultime 6 cifre polizza', columnA: 'Numero Polizza', columnB: 'Numero Polizza', sheetA: '', sheetB: '', sameColumn: true, enabled: true, transform: 'last6' },
    { label: 'Ultime 4 cifre polizza', columnA: 'Numero Polizza', columnB: 'Numero Polizza', sheetA: '', sheetB: '', sameColumn: true, enabled: true, transform: 'last4' },
    { label: 'Targa Veicolo', columnA: 'Targa Veicolo', columnB: 'Targa Veicolo', sheetA: '', sheetB: '', sameColumn: true, enabled: true, transform: 'none' },
    { label: 'Veicolo', columnA: 'Veicolo', columnB: 'Veicolo', sheetA: '', sheetB: '', sameColumn: true, enabled: true, transform: 'none' },
  ]
}

export function defaultSearchConditions(): Condition[] {
  return [{ columnA: '', columnB: '', sheetA: '', sheetB: '', mode: 'contains', transform: 'none', connector: 'AND' }]
}

export function defaultBothMatchConditions(): Condition[] {
  return [{ columnA: '', columnB: '', sheetA: '', sheetB: '', mode: 'equals', transform: 'none', connector: 'AND' }]
}

export function defaultCompareConfig(): CompareConfig {
  return {
    matchKeys: defaultMatchKeys(),
    fuzzyEnabled: true,
    fuzzyMinOverlap: 4,
    fuzzyIgnoreWords: '',
    fuzzyBroadEnabled: true,
    fuzzyMinOverlapBroad: 6,
    searchConditions: defaultSearchConditions(),
    bothMatchConditions: defaultBothMatchConditions(),
    bothFilterConditions: [],
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
  const upper = raw.toUpperCase()
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

  // Interruttore PRINCIPALE del fuzzy: se spento non si propone nessuna coppia
  // «da verificare» — le righe senza match esatto restano solo-in-A/solo-in-B.
  // (Storicamente la passata sulle chiavi girava sempre: l'unico checkbox
  // spegneva solo quella ampia, da qui i «da verificare» con fuzzy disattivato.)
  if (fuzzy && fuzzy.enabled === false) {
    return { onlyA: unmatA, onlyB: unmatB, fuzzy: [], diffA: [], diffB: [] }
  }

  const ignore = parseIgnoreWords(fuzzy?.ignoreWords)
  const { pairs, remainA, remainB } = fuzzyPass(unmatA, unmatB, keys, fuzzy?.minOverlap, ignore)

  // Seconda passata fuzzy, più ampia: scansiona OGNI colonna dopo aver rimosso
  // tutto ciò che non è lettera o cifra. Gira solo su ciò che resta non abbinato.
  let allPairs = pairs
  let finalRemainA = remainA
  let finalRemainB = remainB

  const broadEnabled = !fuzzy || fuzzy.broadEnabled !== false
  if (broadEnabled && remainA.length && remainB.length) {
    const broadN = fuzzy && Number.isInteger(fuzzy.broadMinOverlap) && (fuzzy.broadMinOverlap as number) >= 2 ? (fuzzy.broadMinOverlap as number) : 6
    const broadResult = broadFuzzyPass(remainA, remainB, broadN, ignore)
    allPairs = pairs.concat(broadResult.pairs)
    finalRemainA = broadResult.remainA
    finalRemainB = broadResult.remainB
  }

  return { onlyA: finalRemainA, onlyB: finalRemainB, fuzzy: allPairs, diffA: [], diffB: [] }
}

/* ─── Fuzzy per chiavi ───────────────────────────────────────────────────── */
// Parole/sequenze da ignorare nel fuzzy ("totale, srl" → ['TOTALE','SRL']):
// vengono rimosse dai valori PRIMA di generare le sottostringhe, così un
// suffisso comune a tutte le righe (es. il « Totale» dei pivot Excel) non
// genera coppie «da verificare» a caso. Minimo 2 caratteri per voce.
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

function alphanumSubs(str: unknown, n: number, ignore?: string[]): Set<string> {
  let s = String(str).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (ignore && ignore.length) s = stripIgnored(s, ignore)
  const subs = new Set<string>()
  for (let i = 0; i <= s.length - n; i++) subs.add(s.slice(i, i + n))
  return subs
}

function rowSubs(row: Row, keys: MatchKey[], file: 'a' | 'b', n: number, ignore?: string[]): Set<string> {
  const all = new Set<string>()
  keys.forEach((k) => {
    const col = file === 'a' ? (k.columnA ?? k.column ?? '') : (k.columnB ?? k.column ?? '')
    const val = row[col]
    if (val == null) return
    alphanumSubs(val, n, ignore).forEach((s) => all.add(s))
  })
  return all
}

export function fuzzyPass(unmatA: Row[], unmatB: Row[], keys: MatchKey[], minOverlap?: number, ignore?: string[]): { pairs: FuzzyPair[]; remainA: Row[]; remainB: Row[] } {
  const n = Number.isInteger(minOverlap) && (minOverlap as number) >= 2 ? (minOverlap as number) : 4
  const mapB = new Map<string, Set<number>>()
  unmatB.forEach((row, bi) => {
    rowSubs(row, keys, 'b', n, ignore).forEach((s) => {
      if (!mapB.has(s)) mapB.set(s, new Set())
      mapB.get(s)!.add(bi)
    })
  })

  const usedA = new Set<number>()
  const usedB = new Set<number>()
  const pairs: FuzzyPair[] = []

  unmatA.forEach((rowA, ai) => {
    if (usedA.has(ai)) return
    const candidatesB = new Set<number>()
    rowSubs(rowA, keys, 'a', n, ignore).forEach((s) => {
      if (mapB.has(s)) mapB.get(s)!.forEach((bi) => candidatesB.add(bi))
    })
    for (const bi of candidatesB) {
      if (!usedB.has(bi)) {
        usedA.add(ai)
        usedB.add(bi)
        pairs.push({ rowA, rowB: unmatB[bi], kind: 'key' })
        break
      }
    }
  })

  const remainA = unmatA.filter((_, i) => !usedA.has(i))
  const remainB = unmatB.filter((_, i) => !usedB.has(i))
  return { pairs, remainA, remainB }
}

/* ─── Fuzzy ampio (tutte le colonne, solo lettere/cifre) ─────────────────── */
function alphanumOnly(str: unknown): string {
  return String(str).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function broadSubsForRow(row: Row, n: number, ignore?: string[]): Set<string> {
  const all = new Set<string>()
  Object.keys(row).forEach((col) => {
    const val = row[col]
    if (val == null) return
    let s = alphanumOnly(val)
    if (ignore && ignore.length) s = stripIgnored(s, ignore)
    for (let i = 0; i <= s.length - n; i++) all.add(s.slice(i, i + n))
  })
  return all
}

export function broadFuzzyPass(unmatA: Row[], unmatB: Row[], minOverlap?: number, ignore?: string[]): { pairs: FuzzyPair[]; remainA: Row[]; remainB: Row[] } {
  const n = Number.isInteger(minOverlap) && (minOverlap as number) >= 2 ? (minOverlap as number) : 6
  const mapB = new Map<string, Set<number>>()
  unmatB.forEach((row, bi) => {
    broadSubsForRow(row, n, ignore).forEach((s) => {
      if (!mapB.has(s)) mapB.set(s, new Set())
      mapB.get(s)!.add(bi)
    })
  })

  const usedA = new Set<number>()
  const usedB = new Set<number>()
  const pairs: FuzzyPair[] = []

  unmatA.forEach((rowA, ai) => {
    if (usedA.has(ai)) return
    const candidatesB = new Set<number>()
    broadSubsForRow(rowA, n, ignore).forEach((s) => {
      if (mapB.has(s)) mapB.get(s)!.forEach((bi) => candidatesB.add(bi))
    })
    for (const bi of candidatesB) {
      if (!usedB.has(bi)) {
        usedA.add(ai)
        usedB.add(bi)
        pairs.push({ rowA, rowB: unmatB[bi], kind: 'broad' })
        break
      }
    }
  })

  const remainA = unmatA.filter((_, i) => !usedA.has(i))
  const remainB = unmatB.filter((_, i) => !usedB.has(i))
  return { pairs, remainA, remainB }
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
