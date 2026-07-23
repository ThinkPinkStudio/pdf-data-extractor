// Tipi e default di CSA Adesioni — CLIENT-SAFE (nessun import server/DB/Node).
// I moduli server (getAdesioniConfig, adesioniAssetPath) vivono in serverConfig.ts.
// I moduli puri sono .js (allowJs): TS ne inferisce i tipi come any.
import { DEFAULT_FIELDS, DEFAULT_IDD, DEFAULT_PREZZI } from './tracciato.js'

export interface AdesioniOption { value: string; label: string }
export interface AdesioniField {
  id: string
  label: string
  group?: string
  type: string
  fixed?: string
  flussoCol?: string | null
  trackCol?: string | null
  docx?: string | null
  docxDateOffset?: boolean
  enabled?: boolean
  required?: boolean
  maxLength?: number
  options?: AdesioniOption[]
}
export interface IddQuestion { domanda: string; label: string; options: AdesioniOption[] }
export interface PrezzoRow { pacchetto: string; premio: string; formula?: string }

export interface AdesioniConfig {
  fields: AdesioniField[]
  idd: IddQuestion[]
  prezzi: Record<string, PrezzoRow>
  dateOffsetDays: number
}

// Default esposti al client (form) senza toccare il DB.
export function defaultAdesioniConfig(): AdesioniConfig {
  return {
    fields: DEFAULT_FIELDS as AdesioniField[],
    idd: DEFAULT_IDD as IddQuestion[],
    prezzi: DEFAULT_PREZZI as Record<string, PrezzoRow>,
    dateOffsetDays: 0,
  }
}
