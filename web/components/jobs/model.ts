// Regole PURE della pagina Elaborazioni: stato di interfaccia, filtri,
// conteggi, segmenti della barra, nomi, riga di motivo. Nessun fetch, nessun
// JSX: si testano e si riusano da entrambe le viste (Tabella e Coda).
import type { BatchSummary, FilterKey, JobSnapshot, T, UiState } from './types'

export const FILTERS: FilterKey[] = ['all', 'active', 'matched', 'review', 'mismatch', 'setAside', 'done', 'error']

export const FILTER_LABEL_KEY: Record<FilterKey, string> = {
  all: 'jobsDash.chipAll', active: 'jobsDash.chipActive', matched: 'jobsDash.chipMatched', review: 'jobsDash.chipReview',
  mismatch: 'jobsDash.chipMismatch', setAside: 'jobsDash.chipSetAside', done: 'jobsDash.chipDone', error: 'jobsDash.chipError',
}

export const FILTER_COLOR: Record<FilterKey, string> = {
  all: 'var(--c-accent)', active: '#3b82f6', matched: '#22c55e', review: '#f59e0b', mismatch: '#fb923c',
  setAside: '#6a6a8a', done: '#22c55e', error: '#ef4444',
}

export function uiState(j: JobSnapshot): UiState {
  switch (j.status) {
    case 'running': return 'running'
    case 'queued': return 'queued'
    case 'matched': return 'matched'
    case 'review': return 'review'
    case 'mismatch': return (j.error || '').startsWith('Accantonato') ? 'setAside' : (j.error || '').startsWith('Scartato') ? 'discarded' : 'mismatch'
    case 'done': return 'done'
    case 'canceled': return 'canceled'
    default: return 'error'
  }
}

export function filterOf(j: JobSnapshot): Exclude<FilterKey, 'all'> {
  const st = uiState(j)
  if (st === 'running' || st === 'queued') return 'active'
  if (st === 'discarded') return 'mismatch'
  if (st === 'canceled') return 'error'
  return st
}

export function countByFilter(jobs: JobSnapshot[]): Record<FilterKey, number> {
  const c = Object.fromEntries(FILTERS.map((k) => [k, 0])) as Record<FilterKey, number>
  for (const j of jobs) { c.all++; c[filterOf(j)]++ }
  return c
}

export const isActive = (j: JobSnapshot) => j.status === 'running' || j.status === 'queued'
export const needsDecision = (j: JobSnapshot) => ['review', 'mismatch', 'setAside', 'discarded'].includes(uiState(j))
export const valuesCount = (j: JobSnapshot) => Object.keys(j.values || {}).length
export const hasValues = (j: JobSnapshot) => valuesCount(j) > 0
// Fascicolo identico a uno già completato: si possono copiare i risultati.
export const isReusable = (j: JobSnapshot) => !!j.duplicateOf && ['queued', 'error', 'canceled'].includes(j.status)
export const isTestRun = (j: JobSnapshot) => !!j.sourceJobId

export function fmtDate(epochSeconds: number) {
  return new Date(epochSeconds * 1000).toLocaleString()
}

// Minuti dall'ultimo aggiornamento (indicatore di stallo).
export function minutesSince(epochSeconds?: number): number | null {
  if (!epochSeconds) return null
  return Math.floor((Date.now() / 1000 - epochSeconds) / 60)
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

// Il testo errore del worker ripete l'etichetta di stato («Da verificare — …»,
// «Non pertinente al profilo "X" — …»): via il prefisso, lo stato ha la sua pillola.
const ERROR_PREFIX = /^(?:Accantonato|Scartato|Da verificare|Non pertinente al profilo "[^"]*")\s+—\s+/
export function errorText(j: JobSnapshot): string {
  return (j.error || '').replace(ERROR_PREFIX, '')
}

// URL del PDF originale (l'ordine di scanned_files coincide con l'idx dei file).
export function fileUrl(j: JobSnapshot, name: string, page?: number | string): string | null {
  const idx = (j.scannedFiles || []).indexOf(name)
  if (idx < 0) return null
  return `/api/polizza/job/${j.jobId}/file/${idx}${page ? `#page=${page}` : ''}`
}

// Nome della polizza SENZA il prefisso della cartella del batch (che sta già
// nella testata); fallback stabile sul primo file in ordine alfabetico.
export function shortName(j: JobSnapshot, batchLabel?: string | null): string {
  let name = j.dossierName || ''
  if (name && batchLabel && name.startsWith(batchLabel + '/')) name = name.slice(batchLabel.length + 1)
  if (!name) {
    const sorted = [...(j.scannedFiles || [])].sort((a, b) => a.localeCompare(b))
    name = sorted.length ? `${sorted[0]}${sorted.length > 1 ? ` (+${sorted.length - 1})` : ''}` : j.jobId.slice(0, 8)
  }
  return name
}

// Le run di TEST stanno sotto il loro job sorgente, così le varianti si
// confrontano a colpo d'occhio; un test il cui sorgente non è in lista resta riga normale.
export function orderWithTests(jobs: JobSnapshot[]): JobSnapshot[] {
  const byId = new Set(jobs.map((x) => x.jobId))
  const testsOf = new Map<string, JobSnapshot[]>()
  for (const x of jobs) {
    if (x.sourceJobId && byId.has(x.sourceJobId)) {
      const arr = testsOf.get(x.sourceJobId) || []
      arr.push(x)
      testsOf.set(x.sourceJobId, arr)
    }
  }
  const ordered: JobSnapshot[] = []
  for (const x of jobs) {
    if (x.sourceJobId && byId.has(x.sourceJobId)) continue
    ordered.push(x)
    for (const tst of testsOf.get(x.jobId) || []) ordered.push(tst)
  }
  return ordered
}

export interface Segment { key: FilterKey; n: number; color: string; opacity?: number }

// Segmenti della barra di avanzamento: estratte, abbinate, da verificare, non
// pertinenti, accantonate, errori, in corso. Solo quelli con conteggio > 0.
export function segmentsFromCounts(c: Partial<Record<FilterKey, number>>): Segment[] {
  const order: [FilterKey, number][] = [['done', 1], ['matched', 0.55], ['review', 1], ['mismatch', 1], ['setAside', 1], ['error', 1], ['active', 0.55]]
  return order.filter(([k]) => (c[k] || 0) > 0).map(([k, o]) => ({ key: k, n: c[k] || 0, color: FILTER_COLOR[k], opacity: o }))
}

// Conteggi dal riepilogo del batch (listBatches): 'mismatch' comprende anche
// accantonate e scartate, che il riepilogo non distingue.
export function countsFromBatch(b: BatchSummary): Record<FilterKey, number> {
  return {
    all: b.total, active: (b.queued || 0) + (b.running || 0), matched: b.matched || 0, review: b.review || 0,
    mismatch: b.mismatch || 0, setAside: 0, done: b.done || 0, error: (b.error || 0) + (b.canceled || 0),
  }
}

export const batchProcessed = (b: BatchSummary) => (b.done || 0) + (b.error || 0) + (b.canceled || 0) + (b.mismatch || 0) + (b.matched || 0) + (b.review || 0)
export const decisionCount = (b: BatchSummary) => (b.review || 0) + (b.mismatch || 0) + (b.matched || 0)

export type BatchState = 'running' | 'error' | 'done' | 'queued' | 'mismatch' | 'review' | 'matched'
export function batchStatus(b: BatchSummary): BatchState {
  if (b.running > 0 || (b.queued > 0 && b.done + b.error + b.canceled + (b.matched || 0) + (b.review || 0) > 0)) return 'running'
  if (b.queued > 0 && b.done === 0 && b.error === 0) return 'queued'
  if (b.error > 0) return 'error'
  // Dossier fermi: «da verificare» prima di «da confermare», poi gli abbinati in attesa del ▶.
  if ((b.review || 0) > 0) return 'review'
  if ((b.mismatch || 0) > 0) return 'mismatch'
  if ((b.matched || 0) > 0) return 'matched'
  return 'done'
}

export const BATCH_STATE_LABEL_KEY: Record<BatchState, string> = {
  running: 'jobsDash.bRunning', queued: 'jobsDash.bQueued', error: 'jobsDash.bError', done: 'jobsDash.bDone',
  mismatch: 'jobsDash.bMismatch', review: 'jobsDash.bReview', matched: 'jobsDash.bMatched',
}

export function opEsitoKey(esito?: string | null): string {
  return esito === 'operante' ? 'jobsDash.opOperante' : esito === 'non operante' ? 'jobsDash.opNonOperante' : 'jobsDash.opDubbio'
}

export function progressText(j: JobSnapshot, t: T): string {
  const p = j.progress
  if (!p || !p.docName) return ''
  const parts = [p.docName]
  if (p.pageTotal) parts.push(t('jobsDash.progressPage', { i: p.pageIndex, n: p.pageTotal }))
  if (p.docTotal) parts.push(t('jobsDash.progressDoc', { i: p.docIndex + 1, n: p.docTotal }))
  return parts.join(' · ')
}

// UNA riga di motivo per la tabella e la lista: testa in grassetto (esito del
// controllo) e corpo (documento/pagina e prova citata, oppure il motivo).
export function reasonLine(j: JobSnapshot, t: T): { head: string; body: string } {
  const st = uiState(j)
  const pc = j.precheck || null
  const op = pc?.operativita || null
  if (st === 'running') return { head: '', body: progressText(j, t) }
  // In coda ma letto dalla riconciliazione del batch (numero di polizza): si vede cosa sta leggendo.
  if (st === 'queued') return { head: '', body: progressText(j, t) || t('jobsDash.stQueued') }
  if (st === 'error') return { head: '', body: j.error || '' }
  if (st === 'canceled') return { head: '', body: t('jobsDash.stCanceled') }
  if (op && op.esito) {
    const rejected = pc?.verdict !== 'ok' && op.esito === 'operante'
    const head = rejected ? t('jobsDash.proofRejected') : t(opEsitoKey(op.esito))
    const where = op.documento ? (op.pagina ? t('jobsDash.docPage', { doc: String(op.documento), page: String(op.pagina) }) : t('jobsDash.docOnly', { doc: String(op.documento) })) : ''
    const quote = op.evidenza ? `«${String(op.evidenza).slice(0, 140)}»` : String(op.motivo || '').slice(0, 140)
    const body = [where, quote].filter(Boolean).join(': ')
    return { head, body: st === 'done' && !body ? t('jobsDash.valuesCount', { n: valuesCount(j) }) : body }
  }
  if (st === 'done') return { head: '', body: t('jobsDash.valuesCount', { n: valuesCount(j) }) }
  if (pc?.reason) return { head: '', body: pc.reason }
  return { head: '', body: errorText(j) || pc?.summary || '' }
}

// Riepilogo in forma di BatchSummary calcolato dagli snapshot (pagina del
// batch e batch virtuale delle estrazioni singole, che non hanno listBatches).
export function summarizeJobs(jobs: JobSnapshot[], id = '', label = '', email = ''): BatchSummary {
  const s: BatchSummary = { id, label, email, created_at: 0, total: jobs.length, queued: 0, running: 0, done: 0, error: 0, canceled: 0, mismatch: 0, matched: 0, review: 0 }
  for (const j of jobs) {
    if (j.status === 'queued') s.queued++
    else if (j.status === 'running') s.running++
    else if (j.status === 'done') s.done++
    else if (j.status === 'canceled') s.canceled++
    else if (j.status === 'mismatch') s.mismatch++
    else if (j.status === 'matched') s.matched++
    else if (j.status === 'review') s.review++
    else s.error++
  }
  return s
}

export const BATCH_STATE_PILL: Record<BatchState, string> = {
  running: 'info', queued: 'muted', error: 'err', done: 'ok', review: 'warn', mismatch: 'orange', matched: 'ok outline',
}

// Nome della polizza = CARTELLA FINALE (quella che dà il nome al job); il
// resto del percorso (senza la cartella del batch) è il contesto, su una
// riga a parte. `segments` serve alla vista Albero.
export function splitName(j: JobSnapshot, batchLabel?: string | null): { name: string; path: string; segments: string[] } {
  const full = shortName(j, batchLabel)
  const segments = full.split('/').map((x) => x.trim()).filter(Boolean)
  if (!segments.length) return { name: full, path: '', segments: [full] }
  return { name: segments[segments.length - 1], path: segments.slice(0, -1).join(' / '), segments }
}
