// ANAGRAFICHE RSM — tipi condivisi da store, route e pagine.

export interface RsmCategory {
  key: string
  label: string
  policy: string
  mode: 'nucleo' | 'persona'
  rank: number // ordine di carriera: una promozione va verso un rank più alto
  tariffs: { titolare?: number; quiescente?: number; coniuge?: number; figlio?: number }
  quota: number
}

export interface RsmConfig {
  periodStart: string // 'YYYY-MM-DD'
  periodEnd: string // escluso
  categories: RsmCategory[]
  rules: {
    firstSemesterEnd: string // 'MM-DD'
    secondSemesterPct: number
    prorata: 'giorni' | 'mesi'
    refundTaxPct: number
    notifyDays: number
    coverUntilPeriodEnd: boolean
  }
  mail: { cc: string; signature: string }
  // Chi può caricare e modificare (email). Vuoto = tutti; gli altri consultano.
  editors?: string[]
}

export interface RsmProgram {
  id: string
  name: string
  year: number
  config: RsmConfig
  createdBy: string
  createdAt: number
  updatedAt: number
}

export type Legame = 'TI' | 'CO' | 'FI'

export interface RsmMember {
  id: string
  programId: string
  category: string
  quiescente: boolean
  cf: string
  cognome: string
  nome: string
  birthDate: string | null
  legame: Legame
  cfTitolare: string | null
  entryDate: string | null
  entryKind: 'iniziale' | 'inclusione' | 'promozione'
  requestedDate: string | null
  communicatedDate: string | null
  entryForced: boolean
  exitDate: string | null
  exitKind: 'cessazione' | 'promozione' | null
  exitCommunicated: string | null
  promotionId: string | null
  source: string | null
  note: string | null
  createdBy: string
  createdAt: number
  updatedAt: number
}

export interface RsmCalc {
  annuo: number
  frazione: number
  rateo: number
  quota: number
  dovuto: number
  rimborso: number
  saldo: number
  calc: string
}

export interface RsmIssue { code: string; level: 'error' | 'warning' | 'info'; text: string }

/** Riga di un file di comunicazione pronta per la registrazione (prepareCommunication). */
export interface RsmPreparedRow {
  rowNumber: number
  cognome: string
  nome: string
  cf: string
  cfTitolare: string
  categoria: string
  action: 'entrata' | 'uscita'
  member: Partial<RsmMember>
  calc: RsmCalc | null
  issues: RsmIssue[]
  hasError: boolean
}

export const canEdit = (cfg: RsmConfig, email: string) =>
  !cfg.editors || cfg.editors.length === 0 || cfg.editors.map((e) => e.trim().toLowerCase()).includes(String(email).trim().toLowerCase())
