import { VITA_RATES_2026 } from './rates2026'

// POLIZZA VITA — tipi condivisi da store, route e pagine.
// Gli importi (capitale, premio, rimborso) NON stanno qui: si ricalcolano sempre
// dai fatti con rules.js, così un cambio di regola vale anche per il passato.

export interface VitaCompany {
  key: string // 'sgr' | 're' o altri, se il cliente ne aggiunge
  name: string
  policy: string
  /** Codice della società nel file mensile del cliente (colonna «Soc»: Agos = 300); più codici con la virgola. */
  hrCode?: string
}

/** Categoria con capitale e premio fissi (modo «categoria»: Agos LTC e Vita Quadri e Dirigenti). */
export interface VitaCategory {
  key: string
  name: string // come compare nel file del cliente: «QUADRO», «DIRIGENTE», «DIPENDENTI»
  capital: number
  /** Tasso ‰ sul capitale (LTC: 1,96) … */
  rate: number
  /** … oppure premio annuo fisso (Vita Quadri: 110,41): se c'è vince sul tasso. */
  premium?: number
  /** Parole del livello che portano in questa categoria («quadro»); vuoto = il nome. */
  match: string
}

export interface VitaRules {
  multiplier: number // capitale = multiplier × RAL
  keyFigureCapital: number // capitale della figura chiave
  noDocUpTo: number // fino a qui nessun documento sanitario
  visitUpTo: number // col rapporto di visita (e l'ok della compagnia) si arriva a qui
  checkupMonths: number // validità del check-up
  rights: number | { mode: 'fisso'; value: number } | { mode: 'percentuale' | 'permille'; value: number; of: string[] } // diritti: fissi o % del premio netto / ‰ del capitale
  minAge: number
  deathMaxAge: number
  ipMaxAge: number
  refundBasis: 'start' | 'exit' // rimborso: dati pagati a inizio anno o età al giorno di uscita
  /** 'ral' = capitale da RAL e documentazione (Amundi); 'categoria' = capitale e premio fissi per categoria (Agos). */
  capitalMode?: 'ral' | 'categoria'
  categories?: VitaCategory[]
  /** Premio annuo: 'eccesso' (ROUNDUP, Amundi), 'normale' (al centesimo), 'nessuno' (decimali pieni, come i fogli Agos). */
  grossRounding?: 'eccesso' | 'normale' | 'nessuno'
  /** Inclusione: diritti anche loro in pro-rata (Agos) invece che interi (Amundi). */
  rightsProRata?: boolean
  /** pro-rata: '365' (di sempre), 'reali' (giorni veri), '360' */
  yearDays?: '365' | 'reali' | '360'
  /** età: 'computabile' (+1 oltre `ageHalfMonths` mesi dal compleanno) o 'compiuti' */
  ageMode?: 'computabile' | 'compiuti'
  ageHalfMonths?: number
  /** accertamenti/check-up validi solo entro `checkupMonths` mesi */
  checkupExpiry?: boolean
  /** fasce sanitarie: fino a quale capitale (null = oltre) e quali documenti servono */
  medicalBands?: { upTo: number | null; needs: ('visita' | 'accertamenti')[] }[]
  /** Pro-rata fino al 01/01 dell'anno dopo (LTC Agos) invece che al 31/12. */
  countLastDay?: boolean
  /** File mensile: il cliente scrive l'ultimo giorno di lavoro, l'uscita è dal giorno dopo. */
  exitNextDay?: boolean
  /** File mensile: decorrenza dei passaggi di livello (data del file, 1° del mese, giorno dopo, 1° del mese dopo). */
  transferDate?: 'file' | 'inizioMese' | 'giornoDopo' | 'meseDopo'
}

/** Colonne dei file del cliente, per rifare l'Excel con le stesse intestazioni. */
export interface VitaFileLayout {
  stato?: string[] | null
  mov?: string[] | null
}

export interface VitaConfig {
  /** compagnia che dà l'ok sanitario e firma la polizza (mail, avvisi): default «Credit Agricole Vita» */
  insurer?: string
  /** parole del file mensile e dei file del cliente (si aggiungono a quelle di sempre) */
  words?: { hrEntry?: string; hrExit?: string; hrLevel?: string; hrExtension?: string; heads?: Record<string, string> }
  /** testi degli Excel rinominati: «testo di sempre = testo nuovo», uno per riga */
  excelLabels?: string
  /** testi della mail per la documentazione sanitaria (vuoto = di sempre) */
  mailTexts?: { greeting?: string; ask?: string; closing?: string }
  periodStart: string // 'YYYY-MM-DD'
  periodEnd: string // escluso: la copertura termina il 31/12
  companies: VitaCompany[]
  rules: VitaRules
  /** Tassi ‰ per età: cambiano ogni anno, quindi stanno nel programma. */
  rates: Record<string, number>
  mail: { to: string; cc: string; signature: string }
  /** Chi può caricare e modificare (email). Vuoto = tutti; gli altri consultano. */
  editors?: string[]
  /** Il programma si aggiorna col file mensile del cliente (assunti, cessati, passaggi). */
  hrMonthly?: boolean
  fileLayout?: VitaFileLayout
}

export interface VitaProgram {
  id: string
  name: string
  /** Cliente (Amundi, Agos…): le schede in cima alle pagine. Vuoto nei programmi vecchi. */
  company: string
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
  /** Colonne del file del cliente che il programma non usa ma conserva (matricola, comune…). */
  extra?: Record<string, string> | null
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

/** Cliente del programma: il campo salvato o, nei programmi vecchi, il nome senza anno e «Polizza Vita». */
export function clientOf(p: Pick<VitaProgram, 'company' | 'name' | 'year'>): string {
  const c = String(p.company || '').trim()
  if (c) return c
  const n = String(p.name || '').replace(new RegExp(`\\b${p.year}\\b`), '').replace(/polizza vita/i, '').replace(/[-–·\s]+$/, '').replace(/^[-–·\s]+/, '').trim()
  return n || 'Amundi'
}

/** Il programma calcola per categoria (capitale e premio fissi)? */
export const byCategory = (cfg: VitaConfig | null | undefined) => cfg?.rules?.capitalMode === 'categoria'

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

/** Nome della compagnia (ok sanitario, mail): configurabile, default Credit Agricole Vita. */
export const insurerOf = (cfg: { insurer?: string } | null | undefined) => (cfg && typeof cfg.insurer === 'string' && cfg.insurer.trim()) || 'Credit Agricole Vita'
