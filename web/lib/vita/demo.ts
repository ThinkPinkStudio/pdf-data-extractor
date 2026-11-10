// Dati della sezione Polizza Vita: finché non è collegata al database l'elenco è
// VUOTO (nessun dato inventato in produzione). Qui restano le cose vere: contraenti
// e polizze, tassi del foglio TASSI del file Amundi 2026, regole e calcoli del motore.
// `SEEDS` si riempie solo in locale, per le prove.
import { DEFAULT_RULES, computeInsured, fmtDate, makeCf, movementOf } from './rules.js'
import { VITA_RATES_2026 } from './rates2026'

export type CompanyKey = 'sgr' | 're'
export const COMPANIES: Record<CompanyKey, { name: string; policy: string }> = {
  sgr: { name: 'Amundi SGR', policy: '60037' },
  re: { name: 'Amundi Real Estate', policy: '60038' },
}

export interface DocState { visit: boolean; ok: boolean; extra: boolean }
export interface Insured {
  id: string
  company: CompanyKey
  cognome: string
  nome: string
  sex: 'M' | 'F'
  birthDate: string
  cf: string
  level: string
  ral: number
  keyFigure: boolean
  sovrPct: number
  doc: DocState
  entry: string
  exit?: string
  transferFrom?: CompanyKey
  note?: string
  remindedOn?: string // data dell'ultimo promemoria sulla documentazione
  ral2027?: number | null
}

export const YEAR_START = '2026-01-01'
export const YEAR_END = '2026-12-31'
// Oggi, per lo stato degli assicurati. Con l'elenco vuoto non si vede da nessuna
// parte; quando la sezione leggerà il database la data arriverà da lì.
export const TODAY = new Date().toISOString().slice(0, 10)
export const RULES = DEFAULT_RULES
export const RATES = VITA_RATES_2026

type Seed = Omit<Insured, 'id' | 'cf' | 'entry' | 'doc'> & { belfiore: string; entry?: string; doc?: Partial<DocState> }
const none: DocState = { visit: false, ok: false, extra: false }

const SEEDS: Seed[] = []

export const PEOPLE: Insured[] = SEEDS.map((s, i) => {
  const { belfiore, entry, doc, ...rest } = s
  return { ...rest, id: `p${i + 1}`, cf: makeCf(s.cognome, s.nome, s.birthDate, s.sex, belfiore), entry: entry || YEAR_START, doc: { ...none, ...doc } }
})

export interface Computed extends Insured {
  age: number | null
  rate: number | null
  target: number
  band: string
  capital: number
  scopertura: number
  net: number | null
  gross: number | null
  cover: string
}

/** Calcolo di una persona alla sua data di decorrenza (01/01 o data del movimento). */
export function calc(p: Insured, rules = RULES): Computed {
  const c = computeInsured(p, RATES, p.entry, rules)
  return { ...p, ...c } as Computed
}

export const ROWS: Computed[] = PEOPLE.map((p) => calc(p))

export function statusAt(p: Insured, at: string): 'attivo' | 'uscito' | 'futuro' {
  if (p.entry > at) return 'futuro'
  if (p.exit && p.exit <= at) return 'uscito'
  return 'attivo'
}

export interface Movement {
  key: string
  date: string
  kind: 'INCLUSIONE' | 'ESCLUSIONE'
  row: Computed
  title: string
  source: string
  days: number
  gross: number | null
  capital: number
  transfer?: string
}

/** La stessa persona che entra nell'altra polizza il giorno in cui esce da questa. */
export function transferTarget(r: Insured): Computed | undefined {
  if (!r.exit) return undefined
  return ROWS.find((o) => o.cf === r.cf && o.id !== r.id && o.entry === r.exit && o.transferFrom === r.company)
}

/** Movimenti dell'anno: inclusioni dalle date di entrata, esclusioni dalle date di uscita. */
export function movements(rules = RULES): Movement[] {
  const out: Movement[] = []
  for (const r of ROWS) {
    if (r.entry > YEAR_START) {
      const m = movementOf({ kind: 'INCLUSIONE', date: r.entry, capital: r.capital, rate: r.rate, sovrPct: r.sovrPct }, YEAR_END, rules)
      out.push({ key: `${r.id}-in`, date: r.entry, kind: 'INCLUSIONE', row: r, title: r.transferFrom ? `Passaggio da ${COMPANIES[r.transferFrom].name}` : 'Inclusione', source: r.note || '', days: m.days, gross: m.gross, capital: r.capital, transfer: r.transferFrom })
    }
    if (r.exit) {
      // Il rimborso usa il capitale e il tasso pagati alla decorrenza, non ricalcolati alla data di uscita.
      const m = movementOf({ kind: 'ESCLUSIONE', date: r.exit, capital: r.capital, rate: r.rate, sovrPct: r.sovrPct, paid: { capital: r.capital, rate: r.rate as number } }, YEAR_END, rules)
      const to = transferTarget(r)
      out.push({ key: `${r.id}-out`, date: r.exit, kind: 'ESCLUSIONE', row: r, title: to ? `Passaggio ad ${COMPANIES[to.company].name}` : 'Esclusione', source: r.note || '', days: m.days, gross: m.gross, capital: r.capital, transfer: to ? to.company : undefined })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'ESCLUSIONE' ? -1 : 1))
}

export const eur = (n: number | null | undefined) => {
  if (n == null) return '—'
  const [int, dec] = Math.abs(n).toFixed(2).split('.')
  return `${n < 0 ? '−' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`
}
export const rate4 = (n: number | null) => (n == null ? '—' : n.toFixed(4).replace('.', ','))
export { fmtDate }
