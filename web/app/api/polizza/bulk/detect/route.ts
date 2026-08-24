import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSettings } from '@/lib/settingsStore'
import { importSharedService } from '@/lib/sharedServices'

export const runtime = 'nodejs'

/**
 * Pre-filtro profilo↔fascicolo per il bulk: assegna a ogni dossier il profilo
 * più pertinente in base al CONTENUTO (testo nativo/OCR in anteprima) con
 * fallback al percorso. Zero LLM — stesso algoritmo del worker (profileDetect.js).
 *
 * Body: { dossiers: [{ gid, label, text? }] }
 * Ritorna: { assignments: { [gid]: { profileId, via, matched, missing, score, source } } }
 */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const dossiers = Array.isArray(body.dossiers) ? body.dossiers : []
  if (!dossiers.length) return NextResponse.json({ assignments: {} })

  const settings = await getSettings()
  const profiles = settings.polizzaProfiles || []
  const detect = await importSharedService<{
    detectProfileForDossier: (p: { label: string; contentText?: string; profiles: unknown[] }) => {
      profileId: string; via: string | null; matched: string[]; missing: string[]; score: number | null; source: string | null
    }
  }>('profileDetect.js')

  const assignments: Record<string, {
    profileId: string; via: string | null; matched: string[]; missing: string[]; score: number | null; source: string | null
  }> = {}
  for (const d of dossiers) {
    const gid = String(d?.gid || '')
    if (!gid) continue
    assignments[gid] = detect.detectProfileForDossier({
      label: String(d.label || ''),
      contentText: d.text ? String(d.text) : '',
      profiles,
    })
  }
  return NextResponse.json({ assignments })
}
