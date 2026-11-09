// Dati di PROVA della sezione Polizza Vita (nomi e codici fiscali inventati).
// Servono alle schermate finché la sezione non è collegata al database: stessi
// calcoli del motore (rules.js), tassi veri del foglio TASSI del file Amundi 2026.
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
export const TODAY = '2026-11-08'
export const RULES = DEFAULT_RULES
export const RATES = VITA_RATES_2026

type Seed = Omit<Insured, 'id' | 'cf' | 'entry' | 'doc'> & { belfiore: string; entry?: string; doc?: Partial<DocState> }
const none: DocState = { visit: false, ok: false, extra: false }

const SEEDS: Seed[] = [
  { company: 'sgr', cognome: 'Bianchi', nome: 'Laura', sex: 'F', birthDate: '1975-03-12', belfiore: 'F205', level: 'Quadro - Livello 4', ral: 78412.1, keyFigure: false, sovrPct: 0, ral2027: 80100 },
  { company: 'sgr', cognome: 'Colombo', nome: 'Andrea', sex: 'M', birthDate: '1963-11-02', belfiore: 'H501', level: 'Livello Dirigente', ral: 100000.16, keyFigure: false, sovrPct: 0, ral2027: 103000 },
  { company: 'sgr', cognome: 'Ferri', nome: 'Paolo', sex: 'M', birthDate: '1969-07-21', belfiore: 'L219', level: 'Livello Dirigente', ral: 185039.14, keyFigure: false, sovrPct: 0, doc: { visit: true, ok: true }, note: 'Documentazione fornita nel 2019', ral2027: 190500 },
  { company: 'sgr', cognome: 'Galli', nome: 'Sara', sex: 'F', birthDate: '1985-09-30', belfiore: 'A794', level: 'Area 3 - Livello 3', ral: 42061.44, keyFigure: false, sovrPct: 0, ral2027: null },
  { company: 'sgr', cognome: 'Moretti', nome: 'Luca', sex: 'M', birthDate: '1974-04-03', belfiore: 'F205', level: 'Livello Dirigente', ral: 272000.04, keyFigure: false, sovrPct: 0, note: 'Non intende fornire rapporto di visita medica', remindedOn: '2026-03-15', ral2027: 276000 },
  { company: 'sgr', cognome: 'Rinaldi', nome: 'Giorgio', sex: 'M', birthDate: '1968-12-15', belfiore: 'D612', level: 'Livello Dirigente', ral: 310000.21, keyFigure: true, sovrPct: 0, doc: { visit: true, ok: true }, note: 'Figura chiave: rapporto di visita accettato (capitale 800.000), accertamenti non ancora inviati', remindedOn: '2026-03-15', ral2027: 318000 },
  { company: 'sgr', cognome: 'Conti', nome: 'Elena', sex: 'F', birthDate: '1978-05-09', belfiore: 'A944', level: 'Quadro - Livello 2', ral: 64788.56, keyFigure: false, sovrPct: 0, ral2027: 168000 },
  { company: 'sgr', cognome: 'Villa', nome: 'Marta', sex: 'F', birthDate: '1980-02-14', belfiore: 'F205', level: 'Livello Dirigente', ral: 165000, keyFigure: false, sovrPct: 0, doc: { visit: true }, note: 'Rapporto di visita inviato il 02/10/2026, attende ok C.A. Vita', ral2027: 168500 },
  { company: 'sgr', cognome: 'Greco', nome: 'Stefano', sex: 'M', birthDate: '1990-10-05', belfiore: 'H501', level: 'Impiegato', ral: 36500, keyFigure: false, sovrPct: 0, ral2027: 37400 },
  { company: 'sgr', cognome: 'Fontana', nome: 'Chiara', sex: 'F', birthDate: '1996-06-18', belfiore: 'L219', level: 'Impiegato', ral: 39415.81, keyFigure: false, sovrPct: 0, ral2027: 40200 },
  { company: 'sgr', cognome: 'Bruno', nome: 'Matteo', sex: 'M', birthDate: '1955-01-20', belfiore: 'F205', level: 'Livello Dirigente', ral: 150000, keyFigure: false, sovrPct: 0, doc: { visit: true, ok: true }, note: 'Compie 71 anni: solo caso morte', ral2027: 150000 },
  { company: 'sgr', cognome: 'Neri', nome: 'Franco', sex: 'M', birthDate: '1971-05-06', belfiore: 'F205', level: 'Quadro - Livello 3', ral: 91000, keyFigure: false, sovrPct: 0, exit: '2026-05-01', note: 'Dimissioni, mail del 30/04/2026' },
  { company: 'sgr', cognome: 'Sala', nome: 'Anna', sex: 'F', birthDate: '1984-07-09', belfiore: 'A794', level: 'Quadro - Livello 3', ral: 60759.01, keyFigure: false, sovrPct: 0, exit: '2026-01-23', note: 'Passata in Amundi RE dal 23/01/2026' },
  { company: 'sgr', cognome: 'Parisi', nome: 'Giulia', sex: 'F', birthDate: '1988-03-03', belfiore: 'F205', level: 'Area 3 - Livello 4', ral: 52132.41, keyFigure: false, sovrPct: 0, ral2027: 53000 },
  { company: 'sgr', cognome: 'Leone', nome: 'Carlo', sex: 'M', birthDate: '1960-09-14', belfiore: 'F205', level: 'Livello Dirigente', ral: 210000, keyFigure: false, sovrPct: 0, doc: { visit: true, ok: true }, exit: '2026-09-30', note: 'Pensionamento, mail del 29/09/2026' },
  { company: 'sgr', cognome: 'Rizzo', nome: 'Elisa', sex: 'F', birthDate: '1992-12-01', belfiore: 'H501', level: 'Quadro - Livello 3', ral: 70000, keyFigure: false, sovrPct: 0, ral2027: 71500 },
  { company: 'sgr', cognome: 'Testa', nome: 'Gabriele', sex: 'M', birthDate: '1977-06-25', belfiore: 'F205', level: 'Livello Dirigente', ral: 195000, keyFigure: false, sovrPct: 25, doc: { visit: true, ok: true }, note: 'Sovrappremio 25% dopo visione della documentazione sanitaria', ral2027: 199000 },
  { company: 'sgr', cognome: 'Pellegrini', nome: 'Letizia', sex: 'F', birthDate: '1977-05-16', belfiore: 'F205', level: 'Quadro - Livello 3', ral: 82000, keyFigure: false, sovrPct: 0, entry: '2026-07-16', note: 'Inclusione, mail del 10/07/2026', ral2027: 83500 },
  { company: 'sgr', cognome: 'Marini', nome: 'Davide', sex: 'M', birthDate: '1992-09-07', belfiore: 'F839', level: 'Quadro - Livello 3', ral: 110000, keyFigure: false, sovrPct: 0, entry: '2026-09-01', note: 'Inclusione, mail del 07/09/2026', ral2027: 112000 },
  { company: 'sgr', cognome: 'Longo', nome: 'Elena', sex: 'F', birthDate: '2000-09-27', belfiore: 'A794', level: 'Quadro - Livello 3', ral: 55000, keyFigure: false, sovrPct: 0, entry: '2026-09-18', note: 'Inclusione, mail del 23/09/2026', ral2027: 56000 },
  { company: 're', cognome: 'Amato', nome: 'Valeria', sex: 'F', birthDate: '1979-10-22', belfiore: 'F205', level: 'Quadro - Livello 4', ral: 84000, keyFigure: false, sovrPct: 0, ral2027: 85500 },
  { company: 're', cognome: 'Barone', nome: 'Pietro', sex: 'M', birthDate: '1966-04-11', belfiore: 'F205', level: 'Livello Dirigente', ral: 140000, keyFigure: false, sovrPct: 0, ral2027: 143000 },
  { company: 're', cognome: 'Costa', nome: 'Irene', sex: 'F', birthDate: '1983-08-19', belfiore: 'L219', level: 'Area 3 - Livello 4', ral: 51000, keyFigure: false, sovrPct: 0, ral2027: 52000 },
  { company: 're', cognome: 'Donati', nome: 'Marco', sex: 'M', birthDate: '1972-02-08', belfiore: 'F205', level: 'Quadro - Livello 2', ral: 72500, keyFigure: false, sovrPct: 0, ral2027: 74000 },
  { company: 're', cognome: 'Esposito', nome: 'Lucia', sex: 'F', birthDate: '1987-01-30', belfiore: 'F839', level: 'Quadro - Livello 3', ral: 58000, keyFigure: false, sovrPct: 0, ral2027: 59000 },
  { company: 're', cognome: 'Sala', nome: 'Anna', sex: 'F', birthDate: '1984-07-09', belfiore: 'A794', level: 'Quadro - Livello 3', ral: 60759.01, keyFigure: false, sovrPct: 0, entry: '2026-01-23', transferFrom: 'sgr', note: 'Arriva da Amundi SGR dal 23/01/2026', ral2027: 62000 },
]

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
