import { VITA_RATES_2026 } from './rates2026'

// POLIZZA VITA — tipi condivisi da store, route e pagine.
// Gli importi (capitale, premio, rimborso) NON stanno qui: si ricalcolano sempre
// dai fatti con rules.js, così un cambio di regola vale anche per il passato.

export interface VitaCompany {
  key: string // 'sgr' | 're' o altri, se il cliente ne aggiunge
  name: string
  policy: string
}

export interface VitaRules {
  multiplier: number // capitale = multiplier × RAL
  keyFigureCapital: number // capitale della figura chiave
  noDocUpTo: number // fino a qui nessun documento sanitario
  visitUpTo: number // col rapporto di visita (e l'ok della compagnia) si arriva a qui
  checkupMonths: number // validità del check-up
  rights: number // diritti per assicurato
  minAge: number
  deathMaxAge: number
  ipMaxAge: number
  refundBasis: 'start' | 'exit' // rimborso: dati pagati a inizio anno o età al giorno di uscita
}

export interface VitaConfig {
  periodStart: string // 'YYYY-MM-DD'
  periodEnd: string // escluso: la copertura termina il 31/12
  companies: VitaCompany[]
  rules: VitaRules
  /** Tassi ‰ per età: cambiano ogni anno, quindi stanno nel programma. */
  rates: Record<string, number>
  mail: { to: string; cc: string; signature: string }
  /** Chi può caricare e modificare (email). Vuoto = tutti; gli altri consultano. */
  editors?: string[]
}

export interface VitaProgram {
  id: string
  name: string
  year: number
  config: VitaConfig
  createdBy: string
  createdAt: number
  updatedAt: number
}

/** Stato della documentazione sanitaria di una persona (i fatti, non il giudizio). */
export interface VitaDoc {
  visit: boolean // rapporto di visita medica fornito
  extra: boolean // accertamenti sanitari o check-up
  ok: boolean // ok di C.A. Vita sul livello raggiunto
  checkupDate: string | null // data del check-up, per i 6 mesi di validità
}

export interface VitaInsured {
  id: string
  programId: string
  company: string
  cf: string
  cognome: string
  nome: string
  birthDate: string | null
  level: string
  ral: number
  keyFigure: boolean
  sovrPct: number
  doc: VitaDoc
  remindedOn: string | null // ultimo promemoria sulla documentazione
  entryDate: string | null
  entryKind: 'iniziale' | 'inclusione' | 'passaggio'
  communicatedDate: string | null
  exitDate: string | null
  exitKind: 'cessazione' | 'passaggio' | null
  exitCommunicated: string | null
  /** Le due righe di un passaggio fra polizze hanno lo stesso id: una lo apre, l'altra lo chiude. */
  transferId: string | null
  exitTransferId: string | null
  /** RAL comunicata per l'anno dopo, al rinnovo (null = non ancora comunicata). */
  nextRal: number | null
  source: string | null
  note: string | null
  createdBy: string
  createdAt: number
  updatedAt: number
}

export interface VitaOp {
  id: string
  kind: string
  label: string
  createdBy: string
  createdAt: number
  undoneAt: number | null
  undoneBy: string | null
  rows: number
}

/** Chi può modificare: la lista vuota (o assente) vuol dire tutti. */
export function canEdit(cfg: VitaConfig, email: string): boolean {
  const list = (cfg.editors || []).map((e) => e.trim().toLowerCase()).filter(Boolean)
  return list.length === 0 || list.includes(String(email || '').trim().toLowerCase())
}

export const companyOf = (cfg: VitaConfig, key: string): VitaCompany | null =>
  (cfg.companies || []).find((c) => c.key === key) || null

/**
 * Configurazione di partenza di un programma: contraenti e regole della polizza
 * Amundi, tassi dell'anno (quelli del 2026 come base, si cambiano da Impostazioni).
 */
export function defaultVitaConfig(year: number): VitaConfig {
  return {
    periodStart: `${year}-01-01`,
    periodEnd: `${year + 1}-01-01`, // escluso: la copertura termina il 31/12
    companies: [
      { key: 'sgr', name: 'Amundi SGR', policy: '' },
      { key: 're', name: 'Amundi Real Estate', policy: '' },
    ],
    rules: {
      multiplier: 2.5,
      keyFigureCapital: 1400000,
      noDocUpTo: 400000,
      visitUpTo: 800000,
      checkupMonths: 6,
      rights: 1.03,
      minAge: 18,
      deathMaxAge: 80,
      ipMaxAge: 70,
      refundBasis: 'start',
    },
    rates: Object.fromEntries(Object.entries(VITA_RATES_2026).map(([k, v]) => [String(k), v])),
    mail: { to: '', cc: '', signature: '' },
  }
}
