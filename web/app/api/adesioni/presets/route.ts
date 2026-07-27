import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import {
  listPresets,
  saveCurrentAsPreset,
  applyPreset,
  deletePreset,
  getPresetForExport,
  importPreset,
} from '@/lib/adesioni/presetsStore'

export const runtime = 'nodejs'

// GET (nessun param) → elenco preset + attivo.
// GET ?export=<name> → download JSON del preset con i segreti azzerati.
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const exportName = req.nextUrl.searchParams.get('export')
  if (exportName) {
    const data = await getPresetForExport(exportName)
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const slug = exportName.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'preset'
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="preset_${slug}.json"`,
      },
    })
  }
  return NextResponse.json(await listPresets())
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const action = String(body?.action || '')
  const name = String(body?.name || '')
  try {
    if (action === 'save') {
      await saveCurrentAsPreset(name)
    } else if (action === 'apply') {
      const settings = await applyPreset(name)
      await logAction({ email: session.email, action: 'adesioni.presets.apply' })
      return NextResponse.json({ ...(await listPresets()), settings })
    } else if (action === 'delete') {
      await deletePreset(name)
    } else if (action === 'import') {
      await importPreset(body?.preset || {})
    } else {
      return NextResponse.json({ error: 'Bad action' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
  await logAction({ email: session.email, action: `adesioni.presets.${action}` })
  return NextResponse.json(await listPresets())
}
