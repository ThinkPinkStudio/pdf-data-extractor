// Parte SERVER-ONLY della configurazione CSA Adesioni: legge dai settings
// (Postgres) e risolve i path degli asset. Non importare dai componenti client.
import path from 'path'
import { getSettings } from '../settingsStore'
import { DEFAULT_FIELDS, DEFAULT_IDD, DEFAULT_PREZZI } from './tracciato.js'
import { getTemplateHtml } from './templatesStore'
import type { AdesioniConfig, AdesioniField, IddQuestion, PrezzoRow } from './config'

export async function getAdesioniConfig(): Promise<AdesioniConfig> {
  const s = await getSettings()
  return {
    fields: (s.adesioniFields as AdesioniField[] | undefined) ?? (DEFAULT_FIELDS as AdesioniField[]),
    idd: (s.adesioniIdd as IddQuestion[] | undefined) ?? (DEFAULT_IDD as IddQuestion[]),
    prezzi: (s.adesioniPrezzi as Record<string, PrezzoRow> | undefined) ?? (DEFAULT_PREZZI as Record<string, PrezzoRow>),
    dateOffsetDays: s.adesioniDateOffsetDays ?? 0,
  }
}

// Path degli asset (template docx, DIP, template HTML). In dev la cwd è web/;
// nell'immagine standalone il Dockerfile copia assets/adesioni accanto a server.js.
export function adesioniAssetPath(...parts: string[]): string {
  return path.join(process.cwd(), 'assets', 'adesioni', ...parts)
}

// Config di rendering (template HTML + allegati) — server-only, usata da pdfRender.
// `templateHtml` è l'HTML EFFETTIVO risolto: 'custom' → HTML inline; id libreria
// → HTML del template; 'default' → '' (si usa il bundle assets/modulo_html).
export interface RenderConfig {
  templateId: string
  templateHtml: string
  attachments: Array<{ name: string; dataBase64: string }>
}
export async function getRenderConfig(): Promise<RenderConfig> {
  const s = await getSettings()
  const templateId = s.adesioniTemplateId || 'default'
  let templateHtml = ''
  if (templateId === 'custom') templateHtml = s.adesioniTemplateHtml || ''
  else if (templateId !== 'default') templateHtml = await getTemplateHtml(templateId)
  return {
    templateId,
    templateHtml,
    attachments: Array.isArray(s.adesioniAttachments) ? s.adesioniAttachments : [],
  }
}
