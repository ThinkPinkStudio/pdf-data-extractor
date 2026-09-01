import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getSettings } from '@/lib/settingsStore'
import { createTestJob, getJob } from '@/lib/polizzaJobStore'
import { startJob } from '@/lib/polizzaJobWorker'

export const runtime = 'nodejs'

// Run di TEST su un fascicolo già importato: crea un job COPIA (stessi PDF via
// source_job_id, zero ri-OCR grazie alla cache per hash) con profilo/modello/
// strategia scelti nel dialog — il job originale NON viene mai toccato: le run
// si confrontano fianco a fianco nella pagina Elaborazioni.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const src = await getJob(params.id)
  if (!src) return NextResponse.json({ error: 'Job non trovato' }, { status: 404 })
  if (src.status === 'running' || src.status === 'queued') {
    return NextResponse.json({ error: 'Il job sorgente è ancora in esecuzione o in coda' }, { status: 409 })
  }

  let body: { profileId?: string | null; model?: string; stagedCascade?: boolean; perField?: boolean; promptExtra?: string } = {}
  try { body = await req.json() } catch { /* body vuoto = tutti i default */ }

  const settings = await getSettings()
  // Profilo risolto lato server (autoritativo, come all'upload del batch): se
  // assente/sconosciuto si riusano i campi e il prompt CONGELATI del sorgente.
  const profile = body.profileId
    ? (settings.polizzaProfiles || []).find((p) => p.id === body.profileId) || null
    : null
  const fieldDefs = profile
    ? (profile.fields || []).filter((f) => f.enabled !== false).map((f) => ({ id: f.id, label: f.label, description: f.description, type: f.type, sheet: f.sheet }))
    : (src.field_defs || [])
  if (!fieldDefs.length) return NextResponse.json({ error: 'Nessun campo: né profilo valido né campi congelati nel job' }, { status: 400 })
  const promptExtra = body.promptExtra !== undefined
    ? (body.promptExtra || null)
    : (profile ? (profile.promptExtra || null) : src.prompt_extra)

  // Override SOLO whitelisted (la stessa lista è applicata dal worker). Il
  // modello va su ENTRAMBE le chiavi: il motore legge polizzaWholeDossierModel
  // con fallback su ollamaModel.
  // perField: senza questo, scegliere "gruppi/cascata" nel dialog NON disattivava
  // il motore per-campo (default on) e l'A/B girava sempre sul RAG.
  const settingsOverride: Record<string, unknown> = {}
  const model = (body.model || '').trim()
  if (model) { settingsOverride.ollamaModel = model; settingsOverride.polizzaWholeDossierModel = model }
  if (typeof body.stagedCascade === 'boolean') settingsOverride.polizzaStagedCascade = body.stagedCascade
  if (typeof body.perField === 'boolean') settingsOverride.polizzaPerField = body.perField

  const engineBit = typeof body.perField === 'boolean'
    ? (body.perField ? ' · per-campo' : (body.stagedCascade ? ' · cascata' : ' · gruppi'))
    : (typeof body.stagedCascade === 'boolean' ? (body.stagedCascade ? ' · cascata' : ' · gruppi') : '')
  const label = `TEST · ${src.dossier_name || (src.scanned_files || [])[0] || src.id.slice(0, 8)} · ${model || 'modello corrente'}${engineBit}`
  const job = await createTestJob({
    sourceJobId: src.id, email: session.email, fieldDefs, promptExtra, settingsOverride, label,
  })
  if (!job) return NextResponse.json({ error: 'Creazione run di test fallita' }, { status: 500 })

  startJob(job.id)
  await logAction({ email: session.email, action: 'polizza.job.test', resource: label, ip })
  return NextResponse.json({ jobId: job.id })
}
