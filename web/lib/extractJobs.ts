import { randomUUID } from 'crypto'

// ─── Job store in memoria (decisione di design §4) ───────────────────────────
// Stato dei job di estrazione tenuto in un Map singleton di processo. Con
// elaborazione sequenziale c'è un solo job attivo per volta: la durabilità la
// fornisce l'orchestratore (ri-sottomissione su poll fallito), non questo store.
// I job conclusi vengono evicati dopo un TTL. Nessuna persistenza necessaria.

export type JobStatus = 'queued' | 'running' | 'done' | 'error'
export type ErrorKind = 'transient' | 'deterministic'

/** Forma canonica del progress — identica a `rollingProgress` (vedi contratto §4). */
export interface ExtractProgress {
  docIndex: number
  docTotal: number
  pageIndex: number
  pageTotal: number
  docName: string
  totalPagesProcessed: number
}

export interface JobError {
  message: string
  kind: ErrorKind
}

export interface Job {
  jobId: string
  name: string
  status: JobStatus
  progress: ExtractProgress | null
  error: JobError | null
  result: Buffer | null // bytes XLS quando status === 'done'
  createdAt: number
  updatedAt: number
}

const TTL_MS = parseInt(process.env.EXTRACT_JOB_TTL_MS || '600000', 10) // 10 min

// Singleton resiliente all'HMR di sviluppo (in produzione il modulo è stabile).
const g = globalThis as unknown as { __extractJobs?: Map<string, Job> }
const jobs: Map<string, Job> = g.__extractJobs ?? (g.__extractJobs = new Map())

export function createJob(name: string): Job {
  const now = Date.now()
  const job: Job = {
    jobId: randomUUID(),
    name: name || 'polizza',
    status: 'queued',
    progress: null,
    error: null,
    result: null,
    createdAt: now,
    updatedAt: now,
  }
  jobs.set(job.jobId, job)
  return job
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id)
}

export function markRunning(id: string): void {
  const j = jobs.get(id)
  if (!j) return
  j.status = 'running'
  j.updatedAt = Date.now()
}

export function setProgress(id: string, progress: ExtractProgress): void {
  const j = jobs.get(id)
  if (!j) return
  j.status = 'running'
  j.progress = progress
  j.updatedAt = Date.now()
}

export function setDone(id: string, result: Buffer): void {
  const j = jobs.get(id)
  if (!j) return
  j.status = 'done'
  j.result = result
  j.updatedAt = Date.now()
  scheduleEviction(id)
}

export function setError(id: string, error: JobError): void {
  const j = jobs.get(id)
  if (!j) return
  j.status = 'error'
  j.error = error
  j.updatedAt = Date.now()
  scheduleEviction(id)
}

/** Vista pubblica: stato senza i bytes del result. */
export function toPublic(job: Job) {
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}

function scheduleEviction(id: string): void {
  const t = setTimeout(() => {
    const j = jobs.get(id)
    if (j && (j.status === 'done' || j.status === 'error') && Date.now() - j.updatedAt >= TTL_MS) {
      jobs.delete(id)
    }
  }, TTL_MS + 1000)
  // Non tenere vivo il processo solo per l'eviction.
  ;(t as unknown as { unref?: () => void }).unref?.()
}
