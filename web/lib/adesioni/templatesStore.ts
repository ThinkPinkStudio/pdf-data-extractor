// Libreria dei template HTML del modulo (server). Nel web un "template" è HTML
// per il rendering PDF: non c'è filesystem persistente, quindi la libreria vive
// nel DB (tabella `settings`, chiave `adesioniTemplates`) invece che in
// userData/template-lib come nell'app desktop (templatesStore.js). Ogni voce è
// un HTML nominato con il proprio inventario di segnaposto.
//
// Il modulo incluso (assets/adesioni/modulo_html/page-*.xhtml) resta sempre
// disponibile come predefinito (id 'default') e non è cancellabile.
import path from 'path'
import { readFileSync, readdirSync } from 'fs'
import { pool } from '../db'
import { scanPlaceholders, mergePlaceholders } from './templateScan.js'

const KEY = 'adesioniTemplates'
export const DEFAULT_TEMPLATE_ID = 'default'

export interface LibTemplate { id: string; name: string; html: string; placeholders: string[]; importedAt: string }
export interface TemplateEntry { id: string; name: string; builtin: boolean; placeholders: string[] }

// Cartella del modulo incluso. In dev la cwd è web/; nell'immagine standalone il
// Dockerfile copia assets/adesioni accanto a server.js (stessa logica di
// adesioniAssetPath in serverConfig, replicata qui per evitare cicli di import).
function moduloHtmlDir(): string {
  return path.join(process.cwd(), 'assets', 'adesioni', 'modulo_html')
}

/** Inventario dei segnaposto del modulo incluso (unione di tutte le pagine). */
export function bundledPlaceholders(): string[] {
  let texts: string[] = []
  try {
    const dir = moduloHtmlDir()
    texts = readdirSync(dir)
      .filter((f) => /^page-\d+\.xhtml$/.test(f))
      .sort((a, b) => parseInt(a.match(/\d+/)![0], 10) - parseInt(b.match(/\d+/)![0], 10))
      .map((f) => { try { return readFileSync(path.join(dir, f), 'utf8') } catch { return '' } })
  } catch { /* ignore */ }
  return mergePlaceholders(texts)
}

async function readLibrary(): Promise<LibTemplate[]> {
  const { rows } = await pool.query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [KEY])
  if (!rows[0]?.value) return []
  try {
    const raw = JSON.parse(rows[0].value)
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

async function writeLibrary(lib: LibTemplate[]): Promise<void> {
  await pool.query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [KEY, JSON.stringify(lib)]
  )
}

/** Elenco template: predefinito + libreria (ognuno con il proprio inventario). */
export async function listTemplates(): Promise<TemplateEntry[]> {
  const lib = await readLibrary()
  return [
    { id: DEFAULT_TEMPLATE_ID, name: 'Modulo CSA (predefinito)', builtin: true, placeholders: bundledPlaceholders() },
    ...lib.map((t) => ({ id: t.id, name: t.name, builtin: false, placeholders: t.placeholders })),
  ]
}

/**
 * Importa un template HTML nominato. Upsert per nome: se esiste già un template
 * con lo stesso nome ne aggiorna HTML/segnaposto mantenendone l'id (così la
 * scelta `templateId` resta valida); altrimenti crea una nuova voce.
 */
export async function importTemplate(name: string, html: string): Promise<TemplateEntry[]> {
  const nm = String(name || '').trim() || 'Template'
  const body = String(html || '')
  const lib = await readLibrary()
  const placeholders = scanPlaceholders(body)
  const idx = lib.findIndex((t) => t.name === nm)
  if (idx >= 0) {
    lib[idx] = { ...lib[idx], name: nm, html: body, placeholders, importedAt: new Date().toISOString() }
  } else {
    const id = `tpl_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    lib.push({ id, name: nm, html: body, placeholders, importedAt: new Date().toISOString() })
  }
  await writeLibrary(lib)
  return listTemplates()
}

/** Elimina un template di libreria (il predefinito non è cancellabile). */
export async function deleteTemplate(id: string): Promise<TemplateEntry[]> {
  if (!id || id === DEFAULT_TEMPLATE_ID) throw new Error('Il template predefinito non può essere eliminato')
  const lib = await readLibrary()
  await writeLibrary(lib.filter((t) => t.id !== id))
  return listTemplates()
}

/** HTML del template di libreria (stringa vuota se non trovato o predefinito). */
export async function getTemplateHtml(id: string): Promise<string> {
  if (!id || id === DEFAULT_TEMPLATE_ID) return ''
  const lib = await readLibrary()
  return lib.find((t) => t.id === id)?.html || ''
}

/** Inventario segnaposto del template attivo (default → bundle, custom → HTML inline, altrimenti libreria). */
export async function placeholdersForActive(templateId: string, customHtml: string): Promise<string[]> {
  if (!templateId || templateId === DEFAULT_TEMPLATE_ID) return bundledPlaceholders()
  if (templateId === 'custom') return scanPlaceholders(String(customHtml || ''))
  const lib = await readLibrary()
  const found = lib.find((t) => t.id === templateId)
  return found ? found.placeholders : bundledPlaceholders()
}
