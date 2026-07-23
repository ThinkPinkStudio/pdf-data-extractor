import { pool } from './db'
import type { MatchKey, Condition, CompareConfig } from './compare/engine'

export interface PolizzaField {
  id: string
  label: string
  description: string
  type?: string
  sheet?: string
  enabled?: boolean
  cells?: { sheet: string; cell: string }[]
}

export interface PolizzaProfile {
  id: string
  name: string
  fields: PolizzaField[]
  promptExtra?: string
  ocrEnabled?: boolean
  wholeDossier?: boolean
  wholeDossierModel?: string
  verificaCampi?: string
  verificaModel?: string
  consensusPasses?: number
}

// Campi/profili di estrazione generici (pagina Estrattore), come nel desktop.
export interface GenericField {
  id: string
  label: string
  description?: string
  type?: string
  enabled?: boolean
}
export interface GenericProfile {
  id: string
  name: string
  fields: GenericField[]
}

export interface WebSettings {
  llmProvider: string
  llmModel: string
  ollamaUrl: string
  openaiApiKey: string
  anthropicApiKey: string
  // Modelli per-provider (Impostazioni avanzate). Se non impostati, derivano da llmModel.
  openaiModel?: string
  anthropicModel?: string
  ollamaModel?: string
  ollamaVisionModel?: string
  anthropicVisionModel?: string
  // Configurazione Polizze
  polizzaOcrEnabled?: boolean
  polizzaWholeDossier?: boolean
  polizzaPerField?: boolean
  polizzaWholeDossierModel?: string
  polizzaPromptExtra?: string
  polizzaFields?: PolizzaField[]
  polizzaProfiles?: PolizzaProfile[]
  // Verifica/qualità polizza (usati dal servizio condiviso, polizzaService.js)
  polizzaVerificaCampi?: string
  polizzaVerificaModel?: string
  polizzaConsensusPasses?: number
  // Estrazione generica (pagina Estrattore)
  extractions?: GenericField[]
  profiles?: GenericProfile[]
  // Bulk (cartella intera di polizze): nomi di cartelle aggiuntivi da escludere
  // sempre dall'enumerazione, oltre alla baseline hardcoded (vedi bulkExclusions.ts).
  bulkExcludedFolderNames?: string
  // Indice vettoriale (Qdrant locale + embeddings Ollama). Vuoto = disattivato.
  qdrantUrl?: string
  qdrantCollection?: string
  embeddingModel?: string
  // Portafoglio Compare (sezione separata: confronto di due Excel). Nessun LLM.
  compareMatchKeys?: MatchKey[]
  compareFuzzyMinOverlap?: number
  compareFuzzyBroadEnabled?: boolean
  compareFuzzyMinOverlapBroad?: number
  compareSearchConditions?: Condition[]
  compareBothMatchConditions?: Condition[]
  compareBothFilterConditions?: Condition[]
  compareProfiles?: Record<string, CompareConfig>
  // CSA Adesioni (sezione separata: moduli AXA da Excel). Nessun LLM.
  // Campi/questionario/prezzi: se non impostati, si usano i default da tracciato.js.
  adesioniFields?: unknown[]
  adesioniIdd?: unknown[]
  adesioniPrezzi?: Record<string, unknown>
  adesioniDateOffsetDays?: number
  adesioniExportNotify?: Record<string, unknown>
  adesioniSmtp?: Record<string, unknown>
  adesioniFtpStaging?: Record<string, unknown>
  adesioniFtpProd?: Record<string, unknown>
  adesioniProfiles?: Record<string, unknown>
  // Aspetto
  theme?: string
  language?: string
  accentColor?: string
}

const DEFAULTS: WebSettings = {
  llmProvider: 'ollama',
  llmModel: '',
  ollamaUrl: 'http://localhost:11434',
  openaiApiKey: '',
  anthropicApiKey: '',
}

// Riconoscimento (euristico) dei nomi di modello cloud: serve a impedire che il
// legacy llmModel — campo unico condiviso tra i provider — contamini i campi
// per-provider (es. un modello Claude usato come modello Ollama → 404).
const isClaudeModel = (m?: string) => /^claude-/i.test(m || '')
const isGptModel = (m?: string) => /^(gpt-|o\d)/i.test(m || '')
const isCloudModel = (m?: string) => isClaudeModel(m) || isGptModel(m)

const BOOL_KEYS = new Set(['polizzaOcrEnabled', 'polizzaWholeDossier', 'polizzaPerField', 'compareFuzzyBroadEnabled'])
// Chiavi memorizzate come JSON (array/oggetti) nella tabella settings (value TEXT).
const JSON_KEYS = new Set([
  'polizzaFields', 'polizzaProfiles', 'extractions', 'profiles',
  'compareMatchKeys', 'compareSearchConditions', 'compareBothMatchConditions',
  'compareBothFilterConditions', 'compareProfiles',
  'adesioniFields', 'adesioniIdd', 'adesioniPrezzi', 'adesioniExportNotify',
  'adesioniSmtp', 'adesioniFtpStaging', 'adesioniFtpProd', 'adesioniProfiles',
])

export async function getSettings(): Promise<WebSettings> {
  const { rows } = await pool.query<{ key: string; value: string }>(
    'SELECT key, value FROM settings'
  )
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const bool = (k: string, def: boolean) => (map[k] === undefined ? def : map[k] === 'true')
  const json = <T>(k: string): T | undefined => {
    if (map[k] === undefined) return undefined
    try { return JSON.parse(map[k]) as T } catch { return undefined }
  }

  // Default dall'ambiente (env di Coolify/docker) per i parametri LLM: il valore
  // salvato nelle Impostazioni (UI) vince SEMPRE; l'env fa da default quando il DB
  // non ha ancora un valore per quella chiave. Rispecchia il pattern di QDRANT_URL
  // più sotto. Senza questo, OLLAMA_URL/LLM_PROVIDER/LLM_MODEL (documentati in
  // DEPLOY.md e .env.example) venivano ignorati e si usava sempre localhost:11434.
  const llmModel = map.llmModel ?? (process.env.LLM_MODEL || DEFAULTS.llmModel)

  return {
    llmProvider: map.llmProvider ?? (process.env.LLM_PROVIDER || DEFAULTS.llmProvider),
    llmModel,
    ollamaUrl: map.ollamaUrl ?? (process.env.OLLAMA_URL || DEFAULTS.ollamaUrl),
    openaiApiKey: map.openaiApiKey ?? (process.env.OPENAI_API_KEY || DEFAULTS.openaiApiKey),
    anthropicApiKey: map.anthropicApiKey ?? (process.env.ANTHROPIC_API_KEY || DEFAULTS.anthropicApiKey),
    // Fallback dal legacy llmModel SOLO se il nome è compatibile col provider:
    // llmModel è condiviso tra i provider nella UI, quindi può contenere un nome
    // Claude/GPT che, passato a Ollama, produce 404 "model not found" (e viceversa).
    openaiModel: map.openaiModel || (isGptModel(llmModel) ? llmModel : '') || '',
    anthropicModel: map.anthropicModel || (isClaudeModel(llmModel) ? llmModel : '') || '',
    ollamaModel: map.ollamaModel || (isCloudModel(llmModel) ? '' : llmModel) || '',
    ollamaVisionModel: map.ollamaVisionModel || (isCloudModel(llmModel) ? '' : llmModel) || '',
    anthropicVisionModel: map.anthropicVisionModel || map.anthropicModel || (isClaudeModel(llmModel) ? llmModel : '') || '',
    polizzaOcrEnabled: bool('polizzaOcrEnabled', true),
    polizzaWholeDossier: bool('polizzaWholeDossier', false),
    polizzaPerField: bool('polizzaPerField', true),
    polizzaWholeDossierModel: map.polizzaWholeDossierModel || '',
    polizzaPromptExtra: map.polizzaPromptExtra ?? '',
    polizzaFields: json<PolizzaField[]>('polizzaFields'),
    polizzaProfiles: json<PolizzaProfile[]>('polizzaProfiles'),
    polizzaVerificaCampi: map.polizzaVerificaCampi ?? '',
    polizzaVerificaModel: map.polizzaVerificaModel ?? '',
    polizzaConsensusPasses: map.polizzaConsensusPasses ? parseInt(map.polizzaConsensusPasses, 10) || 3 : 3,
    extractions: json<GenericField[]>('extractions'),
    profiles: json<GenericProfile[]>('profiles'),
    bulkExcludedFolderNames: map.bulkExcludedFolderNames ?? '',
    // Default dall'ambiente (docker-compose imposta QDRANT_URL); il valore
    // salvato nelle Impostazioni vince sempre.
    qdrantUrl: map.qdrantUrl ?? (process.env.QDRANT_URL || ''),
    qdrantCollection: map.qdrantCollection || 'documenti',
    embeddingModel: map.embeddingModel || 'bge-m3',
    // Portafoglio Compare — tutta configurazione persistita nel DB (nessun default env).
    compareMatchKeys: json<MatchKey[]>('compareMatchKeys'),
    compareFuzzyMinOverlap: map.compareFuzzyMinOverlap ? parseInt(map.compareFuzzyMinOverlap, 10) || 4 : 4,
    compareFuzzyBroadEnabled: bool('compareFuzzyBroadEnabled', true),
    compareFuzzyMinOverlapBroad: map.compareFuzzyMinOverlapBroad ? parseInt(map.compareFuzzyMinOverlapBroad, 10) || 6 : 6,
    compareSearchConditions: json<Condition[]>('compareSearchConditions'),
    compareBothMatchConditions: json<Condition[]>('compareBothMatchConditions'),
    compareBothFilterConditions: json<Condition[]>('compareBothFilterConditions'),
    compareProfiles: json<Record<string, CompareConfig>>('compareProfiles'),
    // CSA Adesioni — configurazione persistita nel DB (default applicati lato config.ts).
    adesioniFields: json<unknown[]>('adesioniFields'),
    adesioniIdd: json<unknown[]>('adesioniIdd'),
    adesioniPrezzi: json<Record<string, unknown>>('adesioniPrezzi'),
    adesioniDateOffsetDays: map.adesioniDateOffsetDays ? parseInt(map.adesioniDateOffsetDays, 10) || 0 : 0,
    adesioniExportNotify: json<Record<string, unknown>>('adesioniExportNotify'),
    adesioniSmtp: json<Record<string, unknown>>('adesioniSmtp'),
    adesioniFtpStaging: json<Record<string, unknown>>('adesioniFtpStaging'),
    adesioniFtpProd: json<Record<string, unknown>>('adesioniFtpProd'),
    adesioniProfiles: json<Record<string, unknown>>('adesioniProfiles'),
    theme: map.theme,
    language: map.language,
    accentColor: map.accentColor,
  }
}

export async function saveSettings(s: Partial<WebSettings>) {
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined) continue
    let value: string
    if (JSON_KEYS.has(k)) value = JSON.stringify(v)
    else if (BOOL_KEYS.has(k)) value = String(!!v)
    else value = String(v)
    await pool.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [k, value]
    )
  }
}
