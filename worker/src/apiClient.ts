import { readFile } from 'fs/promises'
import { basename } from 'path'
import { loadConfig } from './config'
import type { ExtractProgress, ErrorKind } from './types'

const cfg = loadConfig()

export interface JobStatus {
  status: 'queued' | 'running' | 'done' | 'error'
  progress: ExtractProgress | null
  error: { message: string; kind: ErrorKind } | null
}

/** Errore arricchito con la classe (transient/deterministic) e flag notFound. */
export class ApiError extends Error {
  kind: ErrorKind
  notFound: boolean
  constructor(message: string, kind: ErrorKind = 'transient', notFound = false) {
    super(message)
    this.kind = kind
    this.notFound = notFound
  }
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${cfg.serviceToken}` }
}

/** Sottomette i PDF di una polizza (bytes, multipart). Ritorna il jobId. */
export async function submitPolicy(pdfPaths: string[], name: string): Promise<string> {
  const form = new FormData()
  for (const p of pdfPaths) {
    const buf = await readFile(p)
    form.append('pdf', new Blob([buf], { type: 'application/pdf' }), basename(p))
  }
  form.append('name', name)

  const res = await fetch(`${cfg.apiUrl}/api/extract-jobs`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
  if (res.status !== 202 && !res.ok) {
    throw new ApiError(`submit HTTP ${res.status}`, 'transient')
  }
  const data = (await res.json()) as { jobId?: string }
  if (!data.jobId) throw new ApiError('submit: jobId mancante', 'transient')
  return data.jobId
}

/** Legge stato + avanzamento di un job. 404 → notFound (job evicato/riavvio API). */
export async function pollJob(jobId: string): Promise<JobStatus> {
  const res = await fetch(`${cfg.apiUrl}/api/extract-jobs/${encodeURIComponent(jobId)}`, {
    headers: authHeaders(),
  })
  if (res.status === 404) throw new ApiError(`job ${jobId} non trovato`, 'transient', true)
  if (!res.ok) throw new ApiError(`poll HTTP ${res.status}`, 'transient')
  return (await res.json()) as JobStatus
}

/** Scarica l'XLS (bytes) di un job concluso. */
export async function downloadResult(jobId: string): Promise<Buffer> {
  const res = await fetch(`${cfg.apiUrl}/api/extract-jobs/${encodeURIComponent(jobId)}/result`, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new ApiError(`download HTTP ${res.status}`, 'transient')
  const ab = await res.arrayBuffer()
  return Buffer.from(ab)
}
