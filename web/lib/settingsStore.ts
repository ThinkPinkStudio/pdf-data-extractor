import { pool } from './db'
import type { MatchKey, Condition, CompareConfig, RowsProfile } from './compare/engine'

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
  // Parole (virgole/;/newline) cercate come sottostringa nel percorso/nome cartella
  // per il pre-filtro e l'auto-riconoscimento del tipo nel bulk. Vuoto = usa `name`.
  matchKeywords?: string
  // Parole chiave del CONTENUTO dei documenti (es. "responsabilità civile, RCT,
  // RCO, prestatori di lavoro") — DIVERSE da matchKeywords, che agisce solo sul
  // nome cartella: queste vengono cercate nel TESTO OCR dal pre-check di
  // pertinenza (modo 'keywords' dello switch polizzaPrecheckMode).
  contentKeywords?: string
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
  // JSON vincolato (schema/GBNF) su date, importi, P.IVA, tassi. false = format json libero.
  polizzaConstrainedJson?: boolean
  polizzaWholeDossierModel?: string
  // DEMO: se true, l'estrazione viene instradata al provider Anthropic (Claude)
  // invece che a Ollama. Pensato solo per le presentazioni; spento = tutto locale.
  polizzaUseClaude?: boolean
  polizzaPromptExtra?: string
  polizzaFields?: PolizzaField[]
  polizzaProfiles?: PolizzaProfile[]
  // Profilo attualmente applicato nell'editor campi polizza: "Salva campi polizza"
  // lo SOVRASCRIVE (i campi correnti diventano i campi del profilo).
  polizzaActiveProfileId?: string | null
  // Verifica/qualità polizza (usati dal servizio condiviso, polizzaService.js)
  polizzaVerificaCampi?: string
  polizzaVerificaModel?: string
  polizzaConsensusPasses?: number
  // Strategia del motore a stadi: false (default) = gruppi a copertura totale;
  // true = CASCATA dal documento più recente ("solo i buchi", con controprova
  // sulla polizza base) — sperimentale, confrontabile via Rielabora.
  polizzaStagedCascade?: boolean
  // Tetto di contesto (num_ctx) dei batch del motore a stadi. Default 24576 (stà
  // negli 8GB di VRAM di qwen2.5:7b Q4). Superarlo può far spillare il KV su CPU
  // e rallentare il modello: la UI avvisa, ma non blocca.
  polizzaBatchContext?: number
  // Pre-check di pertinenza profilo↔fascicolo (blocca il job in 'mismatch' con
  // "Procedi comunque" in UI). 'off' (default: il blocco non si attiva mai a
  // sorpresa), 'keywords' (contentKeywords del profilo nel testo OCR; senza
  // keywords degrada a semantic), 'semantic' (embeddings pagine↔descrizioni),
  // 'llm' (breve classificazione col modello). Switch per confronto sul campo.
  polizzaPrecheckMode?: 'off' | 'keywords' | 'semantic' | 'llm'
  // Auto-verifica zero-shot (FEATURE B): seconda chiamata LLM compatta sui campi
  // testuali senza checksum e con poca affidabilità. DEFAULT OFF (undefined/false):
  // non cambia il comportamento del motore. true = abilitata.
  polizzaAutoVerify?: boolean
  // Grounding rigoroso nel motore per-field (FEATURE G): finestre deterministiche
  // PRIMA della chiamata, citazione obbligatoria {doc,page,line} e verifica
  // automatica di supporto. false (default) = comportamento IDENTICO al passato.
  polizzaGrounding?: boolean
  // Contesto storico dall'archivio Qdrant (FEATURE E): blocco "ARCHIVIO (storico)"
  // per la stessa polizza. Solo supporto, mai precedenza sulla recency. DEFAULT OFF.
  polizzaArchivio?: boolean
  // Estrazione generica (pagina Estrattore)
  extractions?: GenericField[]
  profiles?: GenericProfile[]
  // Bulk (cartella intera di polizze): nomi di cartelle aggiuntivi da escludere
  // sempre dall'enumerazione, oltre alla baseline hardcoded (vedi bulkExclusions.ts).
  bulkExcludedFolderNames?: string
  // Parole cercate come sottostringa nell'intero percorso: da accettare (vuoto =
  // accetta tutto) e da scartare. Valori di partenza, ritoccabili nella pagina bulk.
  bulkIncludeKeywords?: string
  bulkExcludeKeywords?: string
  // Indice vettoriale (Qdrant locale + embeddings Ollama). Vuoto = disattivato.
  qdrantUrl?: string
  qdrantApiKey?: string
  qdrantCollection?: string
  embeddingModel?: string
  // Portafoglio Compare (sezione separata: confronto di due Excel). Nessun LLM.
  compareMatchKeys?: MatchKey[]
  compareFuzzyEnabled?: boolean
  compareFuzzyMinOverlap?: number
  compareFuzzyIgnoreWords?: string
  compareFuzzyBroadEnabled?: boolean
  compareFuzzyMinOverlapBroad?: number
  compareSearchConditions?: Condition[]
  compareBothMatchConditions?: Condition[]
  compareBothFilterConditions?: Condition[]
  // Profili delle DUE pagine, indipendenti: Comparazione (chiavi + fuzzy) e
  // Confronto righe (condizioni di abbinamento/filtro).
  compareProfiles?: Record<string, CompareConfig>
  compareBothProfiles?: Record<string, RowsProfile>
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
  // Template HTML del modulo ('default' | 'custom') + HTML personalizzato; allegati PDF.
  adesioniTemplateId?: string
  adesioniTemplateHtml?: string
  adesioniAttachments?: Array<{ name: string; dataBase64: string }>
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

const BOOL_KEYS = new Set(['polizzaOcrEnabled', 'polizzaWholeDossier', 'polizzaPerField', 'polizzaConstrainedJson', 'polizzaUseClaude', 'polizzaStagedCascade', 'polizzaAutoVerify', 'polizzaArchivio', 'polizzaGrounding', 'compareFuzzyEnabled', 'compareFuzzyBroadEnabled'])
// Chiavi memorizzate come JSON (array/oggetti) nella tabella settings (value TEXT).
const JSON_KEYS = new Set([
  'polizzaFields', 'polizzaProfiles', 'extractions', 'profiles',
  'compareMatchKeys', 'compareSearchConditions', 'compareBothMatchConditions',
  'compareBothFilterConditions', 'compareProfiles', 'compareBothProfiles',
  'adesioniFields', 'adesioniIdd', 'adesioniPrezzi', 'adesioniExportNotify',
  'adesioniSmtp', 'adesioniFtpStaging', 'adesioniFtpProd', 'adesioniProfiles',
  'adesioniAttachments',
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

  // DEMO — "Usa modello Claude": interruttore che instrada l'estrazione al provider
  // Anthropic invece di Ollama. È l'UNICO caso in cui il provider non è forzato a
  // 'ollama'. Pensato per le presentazioni; di default spento (tutto locale).
  const useClaude = bool('polizzaUseClaude', false)

  return {
    // Solo Ollama, TRANNE quando lo switch demo "Usa modello Claude" è attivo: in
    // quel caso il provider passa ad 'anthropic' e i rami cloud vengono eseguiti.
    // Con lo switch spento resta forzato 'ollama' (nessun ramo cloud), a
    // prescindere da valori legacy salvati o env.
    llmProvider: useClaude ? 'anthropic' : 'ollama',
    polizzaUseClaude: useClaude,
    llmModel,
    ollamaUrl: map.ollamaUrl ?? (process.env.OLLAMA_URL || DEFAULTS.ollamaUrl),
    openaiApiKey: map.openaiApiKey ?? (process.env.OPENAI_API_KEY || DEFAULTS.openaiApiKey),
    anthropicApiKey: map.anthropicApiKey ?? (process.env.ANTHROPIC_API_KEY || DEFAULTS.anthropicApiKey),
    // Fallback dal legacy llmModel SOLO se il nome è compatibile col provider:
    // llmModel è condiviso tra i provider nella UI, quindi può contenere un nome
    // Claude/GPT che, passato a Ollama, produce 404 "model not found" (e viceversa).
    openaiModel: map.openaiModel || (isGptModel(llmModel) ? llmModel : '') || '',
    // Demo Claude: se attivo e nessun modello impostato, usa un default Claude
    // sensato (env ANTHROPIC_MODEL o Haiku) così l'estrazione parte senza altra config.
    anthropicModel: map.anthropicModel || (isClaudeModel(llmModel) ? llmModel : '')
      || (useClaude ? (process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001') : '') || '',
    ollamaModel: map.ollamaModel || (isCloudModel(llmModel) ? '' : llmModel) || '',
    ollamaVisionModel: map.ollamaVisionModel || (isCloudModel(llmModel) ? '' : llmModel) || '',
    anthropicVisionModel: map.anthropicVisionModel || map.anthropicModel || (isClaudeModel(llmModel) ? llmModel : '') || '',
    polizzaOcrEnabled: bool('polizzaOcrEnabled', true),
    polizzaWholeDossier: bool('polizzaWholeDossier', false),
    polizzaPerField: bool('polizzaPerField', true),
    polizzaConstrainedJson: bool('polizzaConstrainedJson', true),
    polizzaWholeDossierModel: map.polizzaWholeDossierModel || '',
    polizzaPromptExtra: map.polizzaPromptExtra ?? '',
    polizzaFields: json<PolizzaField[]>('polizzaFields'),
    polizzaProfiles: json<PolizzaProfile[]>('polizzaProfiles'),
    polizzaActiveProfileId: map.polizzaActiveProfileId || null,
    polizzaVerificaCampi: map.polizzaVerificaCampi ?? '',
    polizzaVerificaModel: map.polizzaVerificaModel ?? '',
    polizzaConsensusPasses: map.polizzaConsensusPasses ? parseInt(map.polizzaConsensusPasses, 10) || 3 : 3,
    polizzaStagedCascade: bool('polizzaStagedCascade', false),
    polizzaBatchContext: map.polizzaBatchContext ? parseInt(map.polizzaBatchContext, 10) || 24576 : 24576,
    polizzaAutoVerify: bool('polizzaAutoVerify', false),
    polizzaArchivio: bool('polizzaArchivio', false),
    polizzaGrounding: bool('polizzaGrounding', false),
    polizzaPrecheckMode: (['off', 'keywords', 'semantic', 'llm'].includes(map.polizzaPrecheckMode) ? map.polizzaPrecheckMode : 'off') as WebSettings['polizzaPrecheckMode'],
    extractions: json<GenericField[]>('extractions'),
    profiles: json<GenericProfile[]>('profiles'),
    bulkExcludedFolderNames: map.bulkExcludedFolderNames ?? '',
    bulkIncludeKeywords: map.bulkIncludeKeywords ?? '',
    bulkExcludeKeywords: map.bulkExcludeKeywords ?? '',
    // Default dall'ambiente (docker-compose imposta QDRANT_URL); il valore
    // salvato nelle Impostazioni vince sempre.
    qdrantUrl: map.qdrantUrl ?? (process.env.QDRANT_URL || ''),
    // API key di Qdrant (QDRANT__SERVICE__API_KEY sul server, es. deploy Coolify):
    // senza, ogni richiesta riceve 401. Env QDRANT_API_KEY come default.
    qdrantApiKey: map.qdrantApiKey ?? (process.env.QDRANT_API_KEY || ''),
    qdrantCollection: map.qdrantCollection || 'documenti',
    embeddingModel: map.embeddingModel || 'bge-m3',
    // Portafoglio Compare — tutta configurazione persistita nel DB (nessun default env).
    compareMatchKeys: json<MatchKey[]>('compareMatchKeys'),
    compareFuzzyEnabled: bool('compareFuzzyEnabled', true),
    compareFuzzyMinOverlap: map.compareFuzzyMinOverlap ? parseInt(map.compareFuzzyMinOverlap, 10) || 4 : 4,
    compareFuzzyIgnoreWords: map.compareFuzzyIgnoreWords || '',
    compareFuzzyBroadEnabled: bool('compareFuzzyBroadEnabled', true),
    compareFuzzyMinOverlapBroad: map.compareFuzzyMinOverlapBroad ? parseInt(map.compareFuzzyMinOverlapBroad, 10) || 6 : 6,
    compareSearchConditions: json<Condition[]>('compareSearchConditions'),
    compareBothMatchConditions: json<Condition[]>('compareBothMatchConditions'),
    compareBothFilterConditions: json<Condition[]>('compareBothFilterConditions'),
    compareProfiles: json<Record<string, CompareConfig>>('compareProfiles'),
    compareBothProfiles: json<Record<string, RowsProfile>>('compareBothProfiles'),
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
    adesioniTemplateId: map.adesioniTemplateId || 'default',
    adesioniTemplateHtml: map.adesioniTemplateHtml ?? '',
    adesioniAttachments: json<Array<{ name: string; dataBase64: string }>>('adesioniAttachments'),
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
