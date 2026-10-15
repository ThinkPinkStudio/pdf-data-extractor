// RIEPILOGHI GENERALI (26/09/2026) — tipi condivisi tra server e interfaccia.
// Solo tipi: il client li importa con `import type` (nessun codice server nel
// bundle). La logica vive in src/services/summaryAggregate.js (modulo puro,
// caricato SOLO dal server con importSharedService) e in web/lib/summaryCompose.ts.

import type { JobLightRow, JobRunRow } from './polizzaJobStore'

// ─── Righe del database ──────────────────────────────────────────────────────

export type SummaryMode = 'live' | 'snapshot'
export type AmountOp = 'sum' | 'avg' | 'minmax'
export type TableRowsPref = 'amounts' | 'amountsCounts' | 'all'

/**
 * Classificazione di un campo CONGELATA in una fotografia (freezeField del
 * modulo puro): tipo, unità, natura e risposte di quando è stata scattata.
 */
export interface FrozenKind { kind: FieldKind; idKind?: 'vat' | 'document'; unit?: 'eur' | 'num'; structural?: boolean; answers?: string[] }

/** Definizione di un campo come la congela un job (mai letta per id/label per decidere un tipo). */
export interface SummaryFieldDef { id: string; label: string; description?: string; type?: string; frozen?: FrozenKind }

export interface SummarySnapshotEntry {
  values: Record<string, string>
  dossierName: string | null
  batchId: string | null
  batchLabel: string | null
  scannedFiles: string[]
  jobUpdatedAt: number | null
  forced: boolean
  /** Voce conservata dalla fotografia precedente: la polizza non era più disponibile all'aggiornamento. */
  kept?: boolean
}

export interface SummarySnapshot {
  takenAt: number
  fieldDefs: SummaryFieldDef[]
  removedFieldDefs: SummaryFieldDef[]
  jobs: Record<string, SummarySnapshotEntry>
}

/** Preferenze SALVATE (sparse): solo le scelte dell'utente. */
export interface SummaryPrefs {
  ops?: Record<string, AmountOp[]>
  highlights?: { fieldId: string; op: AmountOp }[]
  groupFieldId?: string | null
  distributionFieldId?: string | null
  dueDays?: number
  matchFieldIds?: string[]
  tableRows?: TableRowsPref
}

/** Preferenze EFFETTIVE (salvate valide sopra i default calcolati sui dati). */
export interface SummaryEffectivePrefs {
  ops: Record<string, AmountOp[]>
  highlights: { fieldId: string; op: AmountOp }[]
  groupFieldId: string | null
  distributionFieldId: string | null
  dueDays: number
  matchFieldIds: string[]
  tableRows: TableRowsPref
}

export interface SummaryRow {
  id: string
  name: string
  /** Chiave del profilo: id del profilo o 'campi:<sha1>' (estrazioni singole senza profilo). */
  profile_id: string
  profile_name: string | null
  year_field_id: string | null
  due_field_id: string | null
  mode: SummaryMode
  job_ids: string[]
  snapshot: SummarySnapshot | null
  prefs: SummaryPrefs
  /**
   * Firme dei campi (fieldSig) delle estrazioni singole ammesse: una singola
   * con una di queste firme resta del riepilogo anche se nelle Impostazioni
   * si copia un profilo o si toglie un campo.
   */
  field_sigs: string[]
  /** Versione della riga (PATCH ottimistico: +1 a ogni scrittura). */
  rev: number
  created_by: string
  created_at: number
  updated_at: number
}

// ─── Membri e ammissione ─────────────────────────────────────────────────────

export type RefusalReason = 'not-found' | 'not-done' | 'not-valid' | 'no-values' | 'test-run' | 'auto-profile' | 'other-profile' | 'duplicate'
export interface Refusal { jobId: string; name: string; reason: RefusalReason; detail?: string | null }

export interface Eligibility {
  key: string | null
  name: string | null
  eligible: { jobId: string; name: string }[]
  refused: Refusal[]
  already: string[]
  /** Firme dei campi delle estrazioni singole ammesse (da salvare nel riepilogo). */
  sigs: string[]
}

export type MemberState = 'ok' | 'stale' | 'excluded' | 'missing'
export type MemberReason = 'notDone' | 'otherProfile' | 'notValid' | 'notPertinent' | 'review'

/** Uscita di resolveMember (modulo puro). */
export interface ResolvedMember {
  state: MemberState
  reason?: MemberReason
  values: Record<string, string>
  valuesAt: number | null
  forced: boolean
  fieldDefs: SummaryFieldDef[] | { id: string; label: string }[] | null
  status: string | null
}

/** Una polizza del riepilogo nel dettaglio (drawer «Modifica selezione»). */
export interface SummaryMember {
  jobId: string
  name: string
  path: string
  batchId: string | null
  batchLabel: string | null
  state: MemberState
  reason: MemberReason | null
  /** Stato attuale del job (live); null in fotografia o se il job non c'è più. */
  status: string | null
  forced: boolean
  valuesAt: number | null
  year: number | null
  /** Fotografia: valori conservati da quella precedente (la polizza non era più disponibile). */
  kept: boolean
}

export type SummaryWarningCode = 'missing' | 'stale' | 'excluded' | 'forced' | 'samePolicy' | 'keptOld'
export interface SummaryWarning {
  code: SummaryWarningCode
  jobIds: string[]
  byReason?: Partial<Record<MemberReason, string[]>>
  groups?: { value: string; year: number | null; jobIds: string[] }[]
}

// ─── Uscita di summarize ─────────────────────────────────────────────────────

export type FieldKind = 'identifier' | 'check' | 'date' | 'amount' | 'rate' | 'text'
export type FieldGroup = 'amount' | 'rate' | 'date' | 'check' | 'text' | 'identifier' | 'removed'

export interface SummaryField {
  id: string
  label: string
  kind: FieldKind
  idKind: 'vat' | 'document' | null
  unit: 'eur' | 'num' | null
  answers: string[] | null
  structural: boolean
  unique: boolean
  textLike: boolean
  group: FieldGroup
  filled: number
  empty: number
  numeric: number
  nonNumeric: number
}

export interface MinMax { min: number; max: number }
export type AggValue = number | MinMax | null
/** Copertura di un calcolo: n valori numerici su `of` polizze. */
export interface Cov { n: number; of: number }
export interface Delta {
  a: number | null
  b: number | null
  abs: number | null
  pct: number | null
  /** Copertura dei due lati (A, B) quando il delta confronta due anni. */
  cov?: { a: Cov; b: Cov }
  /** Somma con polizze senza valore in uno dei due anni: totali incompleti, non confrontabili a colpo d'occhio. */
  partial?: boolean
}

export interface SummaryPolicy {
  jobId: string
  batchId: string | null
  name: string
  path: string
  year: number | null
  /** Di default solo i campi «per polizza» (gruppo identifier); tutti con values: 'all'. */
  values: Record<string, string>
  state: 'ok' | 'stale'
  valuesAt: number | null
  groupLabel: string | null
}

export interface SummaryViewOut {
  year: number | 'none' | null
  group: string | null
  field: string | null
  refYear: number | null
  focusYear: number | null
  prevYear: number | null
  years: { year: number | null; count: number; inProgress: boolean }[]
  groupValues: { key: string; label: string | null; count: number }[]
}

export interface Buckets {
  mode: 'values' | 'bands'
  items: { from: number | null; to: number | null; open: 'below' | 'above' | null; count: number }[]
  empty: number
  other: number
}

export interface SummaryDashboard {
  total: number
  focusYear: number | null
  focusYearCount: number | null
  kpis: {
    fieldId: string
    op: AmountOp
    value: AggValue
    delta: (Delta & { yearA: number; yearB: number }) | null
    range: MinMax | null
    /** Valori numerici, su `of` polizze; `empty` = senza valore (né numero né testo). */
    n: number
    of: number
    nonNumeric: number
    empty: number
  }[]
  byYear: { fieldId: string; op: 'sum' | 'avg'; bars: { year: number; inProgress: boolean; ref: boolean; value: number | null; count: number; n: number }[] } | null
  group: {
    fieldId: string
    amountFieldId: string | null
    op: AmountOp | null
    total: number
    rows: { key: string; label: string | null; count: number; amount: AggValue }[]
    other: { count: number; distinct: number; amount: AggValue }
    empty: { count: number; amount: AggValue }
  } | null
  due: { fieldId: string | null; days: number; items: { jobId: string; date: string; days: number; name: string; batchId: string | null; group: string | null }[] }
  distribution: (Buckets & { fieldId: string; kind: 'amount' | 'rate'; unit: 'eur' | 'num' | null; nonNumeric: number }) | null
  completeness: { filled: number; total: number; pct: number | null; mostEmpty: { fieldId: string; empty: number; of: number }[] }
}

export type TableGroupKey = 'portfolio' | 'amounts' | 'conditions' | 'rates' | 'checks' | 'group'
export interface SummaryTableRow {
  fieldId: string | null
  op: 'count' | AmountOp | 'pct'
  /** Righe del gruppo: chiave del valore (OTHER_KEY «__other», EMPTY_KEY «__empty»). */
  key?: string
  /** Righe del gruppo: grafia del valore (null per altri/vuoto); verifiche: la risposta contata. */
  label?: string | null
  cells: Record<string, AggValue>
  /** Righe numeriche: copertura per colonna e del totale. */
  cov?: Record<string, Cov>
  totalCov?: Cov
  total: AggValue
  delta: Delta | null
  strong: boolean
}
export interface SummaryTable {
  columns: { key: string; year: number | null; inProgress: boolean; ref: boolean }[]
  deltaYears: { a: number; b: number } | null
  groups: { key: TableGroupKey; fieldId?: string; rows: SummaryTableRow[] }[]
}

export interface NumericFieldStats {
  kind: 'amount' | 'rate'
  n: number
  empty: number
  nonNumeric: { value: string; count: number }[]
  sum?: number | null
  avg: number | null
  median: number | null
  min: number | null
  max: number | null
  buckets: Buckets
  byYear: { year: number | null; n: number; of: number; avg: number | null; sum?: number | null; ref: boolean }[]
  sorted?: { jobId: string; value: number }[]
}
export interface TextFieldStats {
  kind: FieldKind
  n: number
  empty: number
  distinct: number
  unique: boolean
  values: { key: string; label: string; count: number }[]
  other: { count: number; distinct: number }
  textLike?: boolean
  nonNumeric?: { value: string; count: number }[]
}
export interface DateFieldStats { kind: 'date'; n: number; empty: number; invalid: number; first: string | null; last: string | null; byYear: { year: number; n: number }[] }
export interface CheckFieldStats {
  kind: 'check'
  n: number
  empty: number
  answers: { answer: string; count: number; pct: number | null }[]
  other: number
  first: string
  byYear: { year: number | null; n: number; pctFirst: number | null; ref: boolean }[]
}
export interface IdentifierFieldStats { kind: 'identifier'; n: number; empty: number; distinct: number }
export type SummaryFieldStats = NumericFieldStats | TextFieldStats | DateFieldStats | CheckFieldStats | IdentifierFieldStats

export interface SummaryCompareRow {
  kind: 'renewed' | 'added' | 'lost'
  jobA: string | null
  jobB: string | null
  name: string
  batchId: string | null
  matchedBy: string | null
  /** changed: cambio per CHIAVE (textKey), non per grafia. */
  group: { a: string | null; b: string | null; changed: boolean }
  amounts: { fieldId: string; a: number | null; b: number | null; diff: number | null }[]
  changed: string[]
}
export interface SummaryCompareOk {
  yearA: number
  yearB: number
  years: number[]
  matchFieldIds: string[]
  cards: { fieldId: string | null; op: 'count' | AmountOp; a: AggValue; b: AggValue; cov?: { a: Cov; b: Cov }; delta: Delta | null }[]
  continuity: { renewed: number; added: number; lost: number; matchedBy: Record<string, number> }
  groupShift: { fieldId: string; rows: { key: string; label: string | null; a: number; b: number; diff: number }[] } | null
  rows: SummaryCompareRow[]
}
export interface SummaryCompareError { error: 'need-two-years' | 'same-year'; years: number[]; yearA?: number; yearB?: number }
export type SummaryCompare = SummaryCompareOk | SummaryCompareError

export interface SummarizeOutput {
  fields: SummaryField[]
  removedFields: SummaryField[]
  prefs: SummaryEffectivePrefs
  policies: SummaryPolicy[]
  view: SummaryViewOut
  dashboard: SummaryDashboard
  table: SummaryTable
  fieldStats: Record<string, SummaryFieldStats>
  compare: SummaryCompare
  warnings: SummaryWarning[]
}

// ─── Risposte dell'API ───────────────────────────────────────────────────────

/** Voce di GET /api/polizza/summaries. */
export interface SummaryListItem {
  id: string
  name: string
  profileId: string
  profileName: string | null
  mode: SummaryMode
  jobCount: number
  snapshotAt: number | null
  createdBy: string
  createdAt: number
  updatedAt: number
}

/** Testata del dettaglio. yearFieldId/dueFieldId sono quelli EFFETTIVI (validati sui campi). */
export interface SummaryInfo extends SummaryListItem {
  yearFieldId: string | null
  dueFieldId: string | null
  /** Numero di campi del profilo di riferimento (N della Regola 4). */
  fieldCount: number
}

/** GET /api/polizza/summaries/[id] (e PATCH, con `result`). */
export interface SummaryDetail extends Omit<SummarizeOutput, 'warnings'> {
  summary: SummaryInfo
  members: SummaryMember[]
  warnings: SummaryWarning[]
}

export interface SummaryPatchResult {
  added: string[]
  already: string[]
  removed: string[]
  /** Fotografia: polizze tolte perché non più disponibili (Non valide, o senza voce precedente). */
  dropped: string[]
  /** Fotografia: polizze che hanno tenuto la voce precedente. */
  keptOld: string[]
  /** Aggiunta: polizze non entrate, col motivo (le altre entrano lo stesso). */
  refused: Refusal[]
}

/** POST /api/polizza/summaries/preview. */
export interface SummaryPreview {
  profileId: string | null
  profileName: string | null
  fieldCount: number
  eligible: { jobId: string; name: string }[]
  refused: Refusal[]
  dateFields: { id: string; label: string; filled: number }[]
  defaults: { yearFieldId: string | null; dueFieldId: string | null }
  inherited: boolean
}

/** Corpo del PATCH: una o più voci. */
export interface SummaryPatchBody {
  name?: string
  prefs?: SummaryPrefs | null
  yearFieldId?: string
  dueFieldId?: string | null
  addJobIds?: string[]
  removeJobIds?: string[]
  mode?: SummaryMode
  refreshSnapshot?: boolean
}

export interface SummaryCreateBody {
  name: string
  jobIds: string[]
  yearFieldId?: string | null
  mode: SummaryMode
}

/** Parametri di vista (query ?anno=&gruppo=&a=&b=&campo=). */
export interface SummaryViewQuery {
  year?: number | 'none'
  group?: string
  yearA?: number
  yearB?: number
  field?: string
}

// ─── Modulo puro caricato dal server (src/services/summaryAggregate.js) ─────

/** Profilo come lo usa profileKeyOf (sottoinsieme di PolizzaProfile). */
export interface ProfileLike { id: string; name?: string; enabled?: boolean; fields?: { id: string; label?: string; description?: string; type?: string; enabled?: boolean }[] }

export interface SnapshotMemberInput {
  jobId: string
  state: MemberState
  reason?: MemberReason
  values: Record<string, string>
  valuesAt: number | null
  forced: boolean
  dossierName: string | null
  batchId: string | null
  batchLabel: string | null
  scannedFiles: string[]
}

export interface SummarySvc {
  MAX_SUMMARY_JOBS: number
  OTHER_KEY: string
  EMPTY_KEY: string
  DOSSIER_KEY: string
  isEmpty(raw: unknown): boolean
  parseAmount(raw: unknown): number | null
  parseRate(raw: unknown): number | null
  parseDate(raw: unknown): { str: string; y: number; m: number; d: number; day: number } | null
  flattenValues(state: unknown): Record<string, string>
  classifyField(field: SummaryFieldDef): { kind: FieldKind; idKind?: 'vat' | 'document'; unit?: 'eur' | 'num'; structural?: boolean; answers?: string[] }
  freezeField(field: SummaryFieldDef): SummaryFieldDef
  fieldSig(fieldDefs: { id: string }[] | null | undefined): string
  yearOf(policy: { values?: Record<string, string> }, yearFieldId: string | null): number | null
  defaultYearFieldId(fields: SummaryFieldDef[]): string | null
  defaultDueFieldId(fields: SummaryFieldDef[], policies: { values?: Record<string, string> }[], yearFieldId: string | null): string | null
  sanitizePrefs(raw: unknown, fields: SummaryFieldDef[]): { prefs: SummaryPrefs; errors: { key: string; reason: string; fieldId?: string }[] }
  mergePrefs(saved: unknown, patch: unknown, fields: SummaryFieldDef[]): { prefs: SummaryPrefs; errors: { key: string; reason: string; fieldId?: string }[] }
  sanitizeJobIds(raw: unknown, max?: number): { ids: string[]; error: null | 'not-array' | 'empty' | 'bad-id' | 'too-many' }
  policyName(x: { dossierName?: string | null; batchLabel?: string | null; scannedFiles?: string[] | null; jobId?: string }): { name: string; path: string }
  profileKeyOf(
    job: { profile_id?: string | null; profile_name?: string | null; field_defs?: { id: string }[] | null; status?: string },
    profiles: ProfileLike[],
    opts?: { preferKey?: string | null; acceptedSigs?: string[] },
  ): { key: string; name: string | null; sig: string | null } | { error: 'auto-profile' }
  checkEligible(input: {
    requestedIds: string[]
    jobs: (JobLightRow & { notValid: boolean })[]
    profiles: ProfileLike[]
    summaryKey: string | null
    members: { jobId: string; name: string }[]
    hashesByJob: Record<string, (string | null)[]>
    acceptedSigs?: string[]
  }): Eligibility
  resolveMember(input: {
    mode: SummaryMode
    job: JobLightRow | null
    lastDoneRun?: JobRunRow | null
    snapshotEntry?: SummarySnapshotEntry | null
    summaryKey?: string
    jobKey?: string | null
    runKey?: string | null
    notValid?: boolean
    forced?: boolean
  }): ResolvedMember
  memberWarnings(members: { jobId: string; state: MemberState; reason?: MemberReason; forced: boolean }[]): SummaryWarning[]
  referenceFields(sources: { fieldDefs: SummaryFieldDef[] | { id: string; label: string }[] | null | undefined; at: number | null }[]): { fields: SummaryFieldDef[]; removed: SummaryFieldDef[] }
  buildSnapshot(input: { takenAt: number; fields: SummaryFieldDef[]; removedFields?: SummaryFieldDef[]; members: SnapshotMemberInput[]; previous?: SummarySnapshot | null }): { snapshot: SummarySnapshot; dropped: string[]; keptOld: string[] }
  summarize(input: {
    fields: SummaryFieldDef[]
    removedFields?: SummaryFieldDef[]
    policies: { jobId: string; batchId: string | null; name: string; path: string; values: Record<string, string>; state: 'ok' | 'stale'; valuesAt: number | null }[]
    yearFieldId: string | null
    dueFieldId: string | null
    prefs: SummaryPrefs | null | undefined
    today: string
    view?: SummaryViewQuery
    values?: 'all'
  }): SummarizeOutput
}
