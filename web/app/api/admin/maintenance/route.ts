import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getSettings } from '@/lib/settingsStore'
import { importSharedService } from '@/lib/sharedServices'
import {
  dataStats, deleteJob, deleteBatch, clearOcrCache, listBatches, listJobsForChat,
} from '@/lib/polizzaJobStore'

export const runtime = 'nodejs'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface VectorSvc {
  isVectorIndexEnabled: (s: unknown) => boolean
  collectionStats: (s: unknown) => Promise<{ exists: boolean; points: number; collection?: string }>
  deletePointsByFilter: (f: { jobId?: string | null; dossier?: string | null; polizzaNumero?: string | null }, s: unknown) => Promise<{ ok: boolean }>
  dropCollection: (s: unknown) => Promise<{ ok: boolean }>
}

// ─── Pannello "Manutenzione dati": stato di Postgres e Qdrant ────────────────
export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const settings = await getSettings()
  const vec = await importSharedService<VectorSvc>('vectorIndexService.js')

  const [pg, batches, jobs] = await Promise.all([dataStats(), listBatches(), listJobsForChat(500)])
  let qdrant: any = { enabled: false }
  if (vec.isVectorIndexEnabled(settings)) {
    try { qdrant = { enabled: true, ...(await vec.collectionStats(settings)) } }
    catch (err) { qdrant = { enabled: true, error: (err as Error).message } }
  }
  return NextResponse.json({
    pg,
    qdrant,
    batches: batches.map((b) => ({ id: b.id, label: b.label, email: b.email, total: b.total, running: b.running + b.queued })),
    jobs,
  })
}

// ─── Azioni di manutenzione ──────────────────────────────────────────────────
// delete-job / delete-batch: eliminano da Postgres (PDF inclusi, cascade) e
// puliscono anche i punti Qdrant dei fascicoli (best-effort, mai bloccante).
// clear-ocr-cache: svuota la cache OCR. qdrant-delete: cancella punti per
// fascicolo/polizza/dossier. qdrant-drop: svuota l'INTERA collezione.
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const settings = await getSettings()
  const vec = await importSharedService<VectorSvc>('vectorIndexService.js')

  const cleanQdrant = async (jobIds: string[]) => {
    if (!vec.isVectorIndexEnabled(settings)) return
    for (const id of jobIds) {
      try { await vec.deletePointsByFilter({ jobId: id }, settings) } catch { /* best-effort */ }
    }
  }

  try {
    if (action === 'delete-job') {
      const job = await deleteJob(String(body.jobId || ''))
      if (!job) return NextResponse.json({ error: 'Job non trovato o ancora in esecuzione: annullalo prima di eliminarlo.' }, { status: 409 })
      await cleanQdrant([job.id])
      await logAction({ email: session.email, action: 'data.delete-job', resource: job.dossier_name || job.id, ip })
      return NextResponse.json({ ok: true })
    }
    if (action === 'delete-batch') {
      const jobIds = await deleteBatch(String(body.batchId || ''))
      if (jobIds === null) return NextResponse.json({ error: 'Batch con job in esecuzione: annullali prima di eliminarlo.' }, { status: 409 })
      await cleanQdrant(jobIds)
      await logAction({ email: session.email, action: 'data.delete-batch', resource: String(body.batchId), ip, metadata: { jobs: jobIds.length } })
      return NextResponse.json({ ok: true, jobs: jobIds.length })
    }
    if (action === 'clear-ocr-cache') {
      const n = await clearOcrCache()
      await logAction({ email: session.email, action: 'data.clear-ocr-cache', resource: `${n} voci`, ip })
      return NextResponse.json({ ok: true, deleted: n })
    }
    if (action === 'qdrant-delete') {
      await vec.deletePointsByFilter({
        jobId: body.jobId || null,
        polizzaNumero: body.polizzaNumero || null,
        dossier: body.dossier || null,
      }, settings)
      await logAction({ email: session.email, action: 'data.qdrant-delete', resource: body.jobId || body.polizzaNumero || body.dossier || '', ip })
      return NextResponse.json({ ok: true })
    }
    if (action === 'qdrant-drop') {
      await vec.dropCollection(settings)
      await logAction({ email: session.email, action: 'data.qdrant-drop', resource: 'collezione intera', ip })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: `Azione sconosciuta: ${action}` }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
