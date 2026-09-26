import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { createSummary, listSummaries, profileKeyForJob } from '@/lib/summaryStore'

export const runtime = 'nodejs'

// Errore imprevisto: il dettaglio (anche del database) resta nel log del
// server, al client solo il codice (l'interfaccia lo traduce: rp.err.internal).
function internal(where: string, e: unknown) {
  console.error(`[riepiloghi] ${where}:`, e)
  return NextResponse.json({ error: 'Errore interno', code: 'internal' }, { status: 500 })
}

// RIEPILOGHI GENERALI (26/09/2026).
// GET  ?profileId=<chiave> | ?jobId=<id>  → elenco senza aggregati (il jobId
//      serve al menu «Aggiungi a un riepilogo»: il server risolve la chiave).
// POST { name, jobIds, yearFieldId?, mode } → 201 { id }; 409 not-eligible con
//      i rifiuti se una polizza non può entrare (solo job estratti, stesso profilo).
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const sp = req.nextUrl.searchParams
    const jobId = (sp.get('jobId') || '').trim()
    if (jobId) {
      const k = jobId.length <= 64 ? await profileKeyForJob(jobId) : null
      return NextResponse.json({ summaries: k ? await listSummaries({ profileId: k.key, fieldSig: k.sig }) : [] })
    }
    const profileId = (sp.get('profileId') || '').trim()
    return NextResponse.json({ summaries: await listSummaries(profileId ? { profileId } : {}) })
  } catch (e) {
    return internal('GET', e)
  }
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Richiesta non valida', code: 'bad-body' }, { status: 400 }) }
  try {
    const out = await createSummary(body, session.email)
    if (!out.ok) return NextResponse.json(out.body, { status: out.status })
    await logAction({
      email: session.email,
      action: 'polizza.summary.create',
      resource: out.row.name,
      ip,
      metadata: { id: out.row.id, jobs: out.row.job_ids.length, mode: out.row.mode, profileId: out.row.profile_id },
    })
    return NextResponse.json({ id: out.row.id }, { status: 201 })
  } catch (e) {
    return internal('POST', e)
  }
}
