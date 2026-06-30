import { getSettings } from './settingsStore'

// Costruisce l'oggetto `settings` che il meccanismo esatto si aspetta, a partire
// dalle impostazioni del web (DB) + env. Provider di default: anthropic.
// `polizzaWholeDossier` true = flusso OCR Tesseract → testo → 1 chiamata (default).

export interface AlgoSettings {
  llmProvider: string
  anthropicApiKey: string
  openaiApiKey: string
  ollamaUrl?: string
  anthropicModel?: string
  anthropicVisionModel?: string
  openaiModel?: string
  polizzaWholeDossier: boolean
  polizzaOcrEnabled: boolean
  polizzaPromptExtra?: string
  polizzaWholeDossierModel?: string
  // polizzaFields lasciato indefinito → il meccanismo usa ALL_POLIZZA_FIELDS
  [k: string]: unknown
}

const bool = (v: string | undefined, def: boolean) =>
  v == null || v === '' ? def : v !== 'false' && v !== '0'

export async function buildAlgoSettings(): Promise<AlgoSettings> {
  const s = await getSettings()
  const env = process.env
  return {
    llmProvider: s.llmProvider || 'anthropic',
    anthropicApiKey: s.anthropicApiKey || env.ANTHROPIC_API_KEY || '',
    openaiApiKey: s.openaiApiKey || env.OPENAI_API_KEY || '',
    ollamaUrl: s.ollamaUrl || env.OLLAMA_URL,
    anthropicModel: env.ANTHROPIC_MODEL || s.llmModel || 'claude-haiku-4-5-20251001',
    anthropicVisionModel:
      env.ANTHROPIC_VISION_MODEL || env.ANTHROPIC_MODEL || s.llmModel || 'claude-haiku-4-5-20251001',
    openaiModel: env.OPENAI_MODEL || s.llmModel || 'gpt-4o-mini',
    polizzaWholeDossier: bool(env.POLIZZA_WHOLE_DOSSIER, true),
    polizzaOcrEnabled: bool(env.POLIZZA_OCR_ENABLED, true),
    polizzaPromptExtra: env.POLIZZA_PROMPT_EXTRA || '',
    polizzaWholeDossierModel: env.POLIZZA_WHOLE_DOSSIER_MODEL || undefined,
  }
}
