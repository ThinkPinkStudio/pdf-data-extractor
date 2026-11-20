// ANAGRAFICHE RSM — tipi condivisi da store, route e pagine.

/** Importo fisso, o percentuale / per mille della somma di altri campi (web/lib/configValue.js). */
export type ConfigValue = number | { mode: 'fisso'; value: number } | { mode: 'percentuale' | 'permille'; value: number; of: string[] }

/** Legame del nucleo (TI = titolare, fisso; gli altri si aggiungono). */
export interface RsmLegame { key: string; label: string; tariff: string; words: string; maxAge?: number | null }

export interface RsmCategory {
  key: string
  label: string
  policy: string
  mode: 'nucleo' | 'persona'
  rank: number // ordine di carriera: una promozione va verso un rank più alto
  tariffs: RsmTariffs
  quota: ConfigValue // fissa o percentuale del premio annuo del titolare
  // Tariffe per fascia d'età (17/11/2026): 'eta' usa `ageBands` al posto di `tariffs`.
  tariffBy?: 'unica' | 'eta'
  ageBands?: (RsmTariffs & { upTo: number | null })[] // «fino a» anni; null = oltre l'ultima
  // Nomi del foglio o della categoria nei file (20/11/2026): «SGR Dipendenti, RE Dipendenti»
  words?: string
  // Coperture con un premio diverso (colonna COPERTURA del file: «SOLO IPM»); tariffe vuote = come la categoria
  variants?: RsmVariant[]
}

export interface RsmVariant { key: string; label: string; words: string; tariffs: RsmTariffs }

/** Tariffe di una categoria: titolare, quiescente e una per legame; ognuna fissa o percentuale di altre. */
export type RsmTariffs = { [k: string]: ConfigValue | null | undefined }

/** Tracciato del file di una società: colonne, codici, ordine (import ed Excel in uscita). */
export interface RsmFileLayout {
  sheet: string
  columns: Record<string, string> // intestazione normalizzata → campo | 'extra' | 'skip'
  categoryCodes: Record<string, string> // codice → chiave categoria ('|Q' = quiescente)
  legameCodes: Record<string, string>
  order: string[] // intestazioni del cliente, nel suo ordine
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
    maxAge?: number // limite d'età: al rinnovo un avviso, mai un'esclusione (default 80)
    entryMode?: 'semestri' | 'prorata' | 'intero' // chi entra in corso d'anno
    decorrenzaMode?: 'data' | 'mese' // 'mese' = 1° giorno del mese successivo
    exitMode?: 'fineAnno' | 'rimborso' // chi cessa: coperto fino a fine anno, o rimborso pro-rata
    childMaxAge?: number // età massima dei figli (0 = nessuna): solo avviso — sostituita da RsmLegame.maxAge
    /** scaglioni d'entrata: fino a quale giorno (MM-DD) quanto si paga (fisso o % del premio) */
    entrySteps?: { until: string; value: ConfigValue }[]
    /** trattenuta sul rimborso: % = imposta da scorporare, fisso = importo da togliere (sostituisce refundTaxPct) */
    refundTax?: ConfigValue
    /** quota associativa: chi la paga, intera o con la frazione del premio, se torna col rimborso */
    quotaWho?: 'titolare' | 'tutti'
    quotaMode?: 'intera' | 'comePremio'
    quotaRefund?: boolean
    /** chi entra per promozione: pro-rata (default) o come le altre entrate */
    promotionEntry?: 'prorata' | 'comeEntrata'
  }
  /** parole con cui il cliente scrive «sì», le note, i fogli e le colonne (si aggiungono a quelle di sempre) */
  /** testi degli Excel rinominati: «testo di sempre = testo nuovo», uno per riga */
  excelLabels?: string
  words?: { yes?: string; promoNotes?: string; cessNotes?: string; varSheet?: string; heads?: Record<string, string> }
  /** legami del nucleo; assente = titolare, coniuge, figlio, altro familiare */
  legami?: RsmLegame[]
  fileLayout?: RsmFileLayout | null
  mail: { cc: string; signature: string; subject?: string; greeting?: string; intro?: string; askAll?: string; askSome?: string; closing?: string }
  // Chi può caricare e modificare (email). Vuoto = tutti; gli altri consultano.
  editors?: string[]
  // Come la società è scritta nei file del cliente (colonna AZIENDA: «C.A.
  // VITA»), ricordato all'import: il file dopo si riconosce da solo.
  fileCompany?: string
}

export interface RsmProgram {
  id: string
  // Società assicurata (17/11/2026): un programma = una società per un anno.
  // Le pagine raggruppano i programmi per società e passano dall'una
  // all'altra con un clic.
  company: string
  name: string
  year: number
  config: RsmConfig
  createdBy: string
  createdAt: number
  updatedAt: number
}

export type Legame = string

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
  promotionId: string | null // promozione che ha creato la riga
  exitPromotionId: string | null // promozione che l'ha chiusa
  source: string | null
  note: string | null
  extra?: Record<string, string> | null // colonne del file della società che non servono al calcolo
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

export interface RsmIssue {
  code: string
  level: 'error' | 'warning' | 'info'
  text: string
  mail?: false // errore interno: blocca la riga ma non va nella mail a chi ha mandato il file
  promote?: { memberId: string; to: string; date: string | null } // da registrare come promozione
}

/** Anomalia dell'import: il file non dice in modo coerente se è una promozione. */
export interface RsmAnomaly {
  key: string
  type: 'non-segnata' | 'senza-entrata' | 'senza-uscita'
  from: string | null
  to: string | null
  date: string
  cf: string
  people: string[]
  text: string
  options: string[]
  choice: string | null
  suggest: string | null // risposta proposta dalle note del file
  suggestNote: string | null
}

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

/**
 * Società di un programma: quella salvata, altrimenti ricavata dal nome dei
 * programmi creati prima che esistesse (anno e «RSM» tolti:
 * «Crédit Agricole Vita · RSM 2026» → «Crédit Agricole Vita»).
 */
export function companyOf(p: { company?: string | null; name: string }): string {
  const c = String(p.company || '').trim()
  if (c) return c
  const n = p.name
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\bRSM\b/gi, ' ')
    .replace(/[\s·\-–—]+$/g, '')
    .replace(/^[\s·\-–—]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return n || p.name.trim()
}

/** Nome di default di un programma: «Società · RSM anno». */
export const programName = (company: string, year: number) => `${company.trim()} · RSM ${year}`
