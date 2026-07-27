import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getRenderConfig } from '@/lib/adesioni/serverConfig'
import { listTemplates, placeholdersForActive, importTemplate, deleteTemplate } from '@/lib/adesioni/templatesStore'

export const runtime = 'nodejs'

// Segnaposto noti del modulo .docx (template AXA fisso) — inventario per l'editor campi.
const DOCX_PLACEHOLDERS = ['cognome_nome', 'targa', 'residenza', 'citta', 'cap', 'provincia', 'codice_fiscale', 'email', 'tel', 'data_inizio', 'data_fine', 'premio', 'pacchetto']

// Stato completo: template attivo, libreria template e segnaposto del template attivo.
async function buildState() {
  const cfg = await getRenderConfig()
  const templates = await listTemplates()
  const htmlPlaceholders = await placeholdersForActive(cfg.templateId, cfg.templateHtml)
  return {
    templateId: cfg.templateId,
    templates,
    docxPlaceholders: DOCX_PLACEHOLDERS,
    htmlPlaceholders,
  }
}

export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await buildState())
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const action = String(body?.action || '')
  try {
    if (action === 'import') {
      await importTemplate(String(body?.name || ''), String(body?.html || ''))
    } else if (action === 'delete') {
      await deleteTemplate(String(body?.id || ''))
    } else {
      return NextResponse.json({ error: 'Bad action' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
  await logAction({ email: session.email, action: `adesioni.template.${action}` })
  return NextResponse.json(await buildState())
}
