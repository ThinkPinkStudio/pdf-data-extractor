// Tipi condivisi della pagina Elaborazioni (lista batch, pagina batch, viste
// Tabella e Coda, dettaglio polizza). Gli snapshot arrivano da
// /api/polizza/batch/[id] e /api/polizza/job (jobSnapshot in polizzaJobStore).

export interface BatchSummary {
  id: string
  label: string
  email: string
  created_at: number
  total: number
  queued: number
  running: number
  done: number
  error: number
  canceled: number
  mismatch: number
  matched: number
  review: number
}

// Esito del controllo di pertinenza/operatività scritto dal worker (precheck).
export interface JobPrecheck {
  verdict?: string
  mode?: string
  reason?: string
  summary?: string
  setAside?: boolean
  matched?: string[]
  missing?: string[]
  excludeMatched?: string[]
  suggestion?: { id: string; name: string; signal?: string | null } | null
  ranking?: { id: string; name: string; score: number | null }[]
  operativita?: { esito?: string; documento?: string | number | null; pagina?: string | number | null; evidenza?: string; motivo?: string } | null
  operativitaTried?: { id?: string; name: string; verdict: string }[]
  detected?: { type: string | null; keywords: string[] } | null
  override?: boolean
  confirmed?: boolean
  matchOnly?: boolean
  auto?: boolean
  at?: number
}

export interface JobSnapshot {
  jobId: string
  batchId?: string | null
  owner?: string
  dossierName: string | null
  status: string
  scannedFiles?: string[]
  values: Record<string, string>
  sources?: Record<string, { file: string; page: number | string }>
  fieldDefs?: { id: string; label: string }[]
  progress?: { docIndex: number; docTotal: number; pageIndex: number; pageTotal: number; docName: string } | null
  duplicateOf?: string | null
  sourceJobId?: string | null
  profileId?: string | null
  profileName?: string | null
  promptExtra?: string | null
  logs?: string[]
  updatedAt?: number
  precheck?: JobPrecheck | null
  error: string | null
}

// Stato "di interfaccia" di una polizza: lo status del DB più le sfumature
// di 'mismatch' (accantonata / scartata) che il worker scrive nel testo errore.
export type UiState = 'running' | 'queued' | 'matched' | 'review' | 'mismatch' | 'setAside' | 'discarded' | 'done' | 'error' | 'canceled'

// Filtro (striscia KPI / chip): un gruppo di stati.
export type FilterKey = 'all' | 'active' | 'matched' | 'review' | 'mismatch' | 'setAside' | 'done' | 'error'

export type ViewMode = 'tabella' | 'coda'
export type DetailTab = 'precheck' | 'values' | 'files' | 'log'

// Batch VIRTUALE delle estrazioni singole (fuori batch): stessa pagina dei batch.
export const SINGLES_ID = 'singole'

export type ReprofileMode = 'test' | 'reprofile' | 'reprofileBatch' | 'rematch' | 'rematchBatch'

export type T = (key: string, params?: Record<string, string | number>) => string
