import { NextResponse } from 'next/server'
import { readFileSync, readdirSync } from 'fs'
import { getSession } from '@/lib/auth'
import { adesioniAssetPath, getRenderConfig } from '@/lib/adesioni/serverConfig'

export const runtime = 'nodejs'

// Segnaposto noti del modulo .docx (template AXA fisso) — inventario per l'editor campi.
const DOCX_PLACEHOLDERS = ['cognome_nome', 'targa', 'residenza', 'citta', 'cap', 'provincia', 'codice_fiscale', 'email', 'tel', 'data_inizio', 'data_fine', 'premio', 'pacchetto']

function scanPlaceholders(html: string): string[] {
  const set = new Set<string>()
  for (const m of html.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) set.add(m[1])
  return Array.from(set)
}

// Restituisce lo stato del template attivo e l'inventario dei segnaposto (docx + HTML).
export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cfg = await getRenderConfig()
  let html = ''
  if (cfg.templateId === 'custom' && cfg.templateHtml.trim()) {
    html = cfg.templateHtml
  } else {
    const dir = adesioniAssetPath('modulo_html')
    for (const f of readdirSync(dir).filter((x) => /^page-\d+\.xhtml$/.test(x))) {
      try { html += '\n' + readFileSync(`${dir}/${f}`, 'utf8') } catch { /* ignore */ }
    }
  }
  return NextResponse.json({
    templateId: cfg.templateId,
    hasCustom: !!cfg.templateHtml.trim(),
    docxPlaceholders: DOCX_PLACEHOLDERS,
    htmlPlaceholders: scanPlaceholders(html),
  })
}
