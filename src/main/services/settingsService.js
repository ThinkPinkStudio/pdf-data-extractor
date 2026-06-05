import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

const defaultSettings = {
  theme: 'dark',
  language: 'it',
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: '',
  ollamaVisionModel: '',  // modello Ollama con supporto vision (es. llava, minicpm-v, llama3.2-vision)
  // Cloud LLM providers
  llmProvider: 'ollama',
  openaiApiKey: '',
  openaiModel: 'gpt-4o-mini',
  anthropicApiKey: '',
  anthropicModel: 'claude-haiku-4-5-20251001',
  // Extraction profiles
  profiles: [],
  // Accent color
  accentColor: '',
  // Webhook
  webhookEnabled: false,
  webhookPort: 3847,
  // Notifications
  notificationsEnabled: true,
  extractions: [
    {
      id: '1',
      label: 'Nome',
      description: 'Estrai il nome completo del cliente o della persona',
      enabled: true,
      type: 'text'
    },
    {
      id: '2',
      label: 'Tel',
      description: 'Estrai il numero di telefono del cliente',
      enabled: true,
      type: 'phone'
    },
    {
      id: '3',
      label: 'Email',
      description: "Estrai l'indirizzo email del cliente",
      enabled: true,
      type: 'email'
    },
    {
      id: '4',
      label: 'Indirizzo',
      description: "Estrai l'indirizzo completo",
      enabled: true,
      type: 'text'
    }
  ],
  // Polizza RC: extra prompt instructions appended to the LLM extraction prompt
  polizzaPromptExtra: '',
  // Polizza RC: tipi di polizza (tab nel pannello risultati)
  polizzaTypes: [
    { id: 'RCT_O', label: 'RC Terzi / Operai' },
    { id: 'RCP',   label: 'RC Prodotti' }
  ],
  // Polizza RC fields configuration
  polizzaFields: [
    { id: 'polizza_numero', label: 'N° Polizza', description: 'Numero di polizza (es. 410000880)', type: 'text', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'C3' }, { sheet: 'RCP', cell: 'C3' }] },
    { id: 'compagnia', label: 'Compagnia', description: 'Nome della compagnia assicuratrice (es. Generali Italia S.p.A.)', type: 'text', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'C6' }, { sheet: 'RCT_O', cell: 'N18' }, { sheet: 'RCP', cell: 'C6' }, { sheet: 'RCP', cell: 'N16' }] },
    { id: 'contraente', label: 'Contraente/Assicurato', description: 'Ragione sociale del contraente/assicurato (es. ADAMANT BIONRG SRL)', type: 'text', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'C4' }, { sheet: 'RCT_O', cell: 'N17' }, { sheet: 'RCP', cell: 'C4' }, { sheet: 'RCP', cell: 'N15' }] },
    { id: 'codice_fiscale_iva', label: 'P. IVA / Cod. Fiscale', description: 'Partita IVA o codice fiscale del contraente', type: 'text', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'F5' }, { sheet: 'RCP', cell: 'F5' }] },
    { id: 'indirizzo', label: 'Indirizzo', description: 'Indirizzo completo del domicilio/sede del contraente', type: 'text', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'C5' }, { sheet: 'RCP', cell: 'C5' }] },
    { id: 'agenzia', label: 'Agenzia', description: "Nome dell'agenzia assicurativa (es. ACQUI TERME)", type: 'text', sheet: 'RCT_O', enabled: true, cells: [] },
    { id: 'decorrenza', label: 'Decorrenza', description: 'Data di decorrenza della polizza (es. 31/12/2021)', type: 'date', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'C7' }, { sheet: 'RCT_O', cell: 'O21' }, { sheet: 'RCP', cell: 'C7' }, { sheet: 'RCP', cell: 'O20' }] },
    { id: 'scadenza', label: 'Scadenza', description: 'Data di scadenza della polizza (es. 31/12/2022)', type: 'date', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'E7' }, { sheet: 'RCT_O', cell: 'Q21' }, { sheet: 'RCP', cell: 'E7' }, { sheet: 'RCP', cell: 'Q20' }] },
    { id: 'attivita', label: 'Attività assicurata', description: "Descrizione dell'attività svolta dall'assicurato indicata in polizza", type: 'text', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'A10' }, { sheet: 'RCP', cell: 'A10' }] },
    { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro (RCT)', description: 'Massimale RCT per ogni sinistro (RC verso Terzi e Prestatori di Lavoro), es. 3.000.000,00', type: 'text', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'D15' }] },
    { id: 'rct_massimale_persona', label: 'Massimale per persona (RCT)', description: 'Massimale RCT per ogni persona che abbia subito lesioni personali, es. 3.000.000,00', type: 'text', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'E15' }] },
    { id: 'rct_massimale_danni', label: 'Massimale danni materiali (RCT)', description: 'Massimale RCT per danni materiali (compresi gli animali), es. 3.000.000,00', type: 'text', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'F15' }] },
    { id: 'rct_massimale_prestatore', label: 'Massimale per prestatore (RCT)', description: 'Massimale RCT per ogni prestatore di lavoro che abbia subito lesioni personali, es. 3.000.000,00', type: 'text', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'D16' }] },
    { id: 'rct_parametro', label: 'Parametro regolazione (RCT)', description: 'Parametro utilizzato per la regolazione del premio RCT (es. Salari e stipendi + Quota TFR)', type: 'text', sheet: 'RCT_O', enabled: true, cells: [] },
    { id: 'rct_importo_preventivo', label: 'Importo preventivo parametro (RCT)', description: "Importo preventivo annuo del parametro di regolazione RCT (es. 450.000,00)", type: 'text', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'D23' }] },
    { id: 'rct_tasso', label: 'Tasso regolazione ‰ (RCT)', description: 'Tasso di regolazione imponibile per mille della sezione RCT (es. 2,450)', type: 'text', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'E23' }] },
    { id: 'rct_premio_imponibile', label: 'Premio imponibile (RCT)', description: "Premio/anticipo di sezione annuo imponibile della sezione RCT (es. 1.227,00)", type: 'text', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'F28' }] },
    { id: 'rct_imposta', label: 'Imposta (RCT)', description: "Imposta sul premio della sezione RCT (es. 273,00)", type: 'text', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'F29' }] },
    { id: 'rct_premio_totale', label: 'Premio totale (RCT)', description: "Premio/anticipo di sezione annuo totale della sezione RCT (es. 1.500,00)", type: 'text', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'F30' }, { sheet: 'RCT_O', cell: 'F34' }] },
    { id: 'rcp_prodotti', label: 'Prodotti assicurati', description: 'Prodotti per i quali è stipulata la RC Prodotti (es. OLII E GRASSI ANIMALI O VEGETALI, NON ALIMENTARI)', type: 'text', sheet: 'RCP', enabled: true, cells: [] },
    { id: 'rcp_qualifica', label: 'Qualifica assicurato', description: "Qualifica dell'assicurato nella sezione RC Prodotti (es. Fabbricante)", type: 'text', sheet: 'RCP', enabled: true, cells: [] },
    { id: 'rcp_massimale_sinistro', label: 'Massimale per sinistro (RCP)', description: 'Massimale RC Prodotti per ogni sinistro, es. 5.000.000,00', type: 'text', sheet: 'RCP', enabled: true,
      cells: [{ sheet: 'RCP', cell: 'D14' }] },
    { id: 'rcp_massimale_annuo', label: 'Massimale annuo (RCP)', description: 'Massimale RC Prodotti per più sinistri e per anno assicurativo, es. 5.000.000,00', type: 'text', sheet: 'RCP', enabled: true,
      cells: [{ sheet: 'RCP', cell: 'E14' }] },
    { id: 'rcp_massimale_mat', label: 'Massimale danni materiali (RCP)', description: 'Massimale RC Prodotti per danni materiali (compresi gli animali) anche se appartenenti a più persone, es. 5.000.000,00', type: 'text', sheet: 'RCP', enabled: true,
      cells: [{ sheet: 'RCP', cell: 'F14' }] },
    { id: 'rcp_massimale_interr', label: 'Massimale interruzione attività (RCP)', description: 'Massimale RC Prodotti per danni da interruzione o sospensione di attività, es. 500.000,00', type: 'text', sheet: 'RCP', enabled: true, cells: [] },
    { id: 'rcp_scoperto_min_mondo', label: 'Scoperto minimo - Resto del mondo', description: 'Minimo di scoperto per i danni avvenuti nel resto del mondo (esclusi USA/Canada/Messico), es. 6.000,00', type: 'text', sheet: 'RCP', enabled: true, cells: [] },
    { id: 'rcp_scoperto_max_mondo', label: 'Scoperto massimo - Resto del mondo', description: 'Massimo di scoperto per i danni avvenuti nel resto del mondo (esclusi USA/Canada/Messico), es. 100.000,00', type: 'text', sheet: 'RCP', enabled: true, cells: [] },
    { id: 'rcp_scoperto_min_usa', label: 'Scoperto minimo - USA/Canada/Messico', description: 'Minimo di scoperto per i danni avvenuti in USA, Canada e Messico, es. 75.000,00', type: 'text', sheet: 'RCP', enabled: true, cells: [] },
    { id: 'rcp_scoperto_max_usa', label: 'Scoperto massimo - USA/Canada/Messico', description: 'Massimo di scoperto per i danni avvenuti in USA, Canada e Messico, es. 150.000,00', type: 'text', sheet: 'RCP', enabled: true, cells: [] },
    { id: 'rcp_parametro', label: 'Parametro regolazione (RCP)', description: 'Parametro utilizzato per la regolazione del premio RCP (es. Ricavi delle vendite e delle prestazioni)', type: 'text', sheet: 'RCP', enabled: true, cells: [] },
    { id: 'rcp_importo_preventivo', label: 'Importo preventivo parametro (RCP)', description: "Importo preventivo annuo del parametro di regolazione RCP (es. 240.000.000,00)", type: 'text', sheet: 'RCP', enabled: true,
      cells: [{ sheet: 'RCP', cell: 'D20' }] },
    { id: 'rcp_tasso', label: 'Tasso regolazione ‰ (RCP)', description: 'Tasso di regolazione imponibile per mille della sezione RCP (es. 0,245)', type: 'text', sheet: 'RCP', enabled: true,
      cells: [{ sheet: 'RCP', cell: 'E20' }] },
    { id: 'rcp_premio_imponibile', label: 'Premio imponibile (RCP)', description: "Premio/anticipo di sezione annuo imponibile della sezione RC Prodotti (es. 58.799,99)", type: 'text', sheet: 'RCP', enabled: true,
      cells: [{ sheet: 'RCP', cell: 'F30' }] },
    { id: 'rcp_imposta', label: 'Imposta (RCP)', description: "Imposta sul premio della sezione RC Prodotti (es. 13.082,99)", type: 'text', sheet: 'RCP', enabled: true,
      cells: [{ sheet: 'RCP', cell: 'F31' }] },
    { id: 'rcp_premio_totale', label: 'Premio totale (RCP)', description: "Premio/anticipo di sezione annuo totale della sezione RC Prodotti (es. 71.882,98)", type: 'text', sheet: 'RCP', enabled: true,
      cells: [{ sheet: 'RCP', cell: 'F32' }, { sheet: 'RCP', cell: 'F37' }] }
  ]
}

function getSettingsPath() {
  const userDataPath = app.getPath('userData')
  mkdirSync(userDataPath, { recursive: true })
  return join(userDataPath, 'settings.json')
}

export function getSettings() {
  try {
    const raw = readFileSync(getSettingsPath(), 'utf-8')
    const saved = JSON.parse(raw)
    const merged = { ...defaultSettings, ...saved }
    // Migrate legacy localhost URLs to 127.0.0.1 to avoid IPv6 resolution failures
    if (merged.ollamaUrl === 'http://localhost:11434') {
      merged.ollamaUrl = 'http://127.0.0.1:11434'
    }
    // Ensure extractions have type field
    if (Array.isArray(merged.extractions)) {
      merged.extractions = merged.extractions.map(f => ({ type: 'text', ...f }))
    }
    // Migrate: populate polizzaTypes if missing or empty
    if (!merged.polizzaTypes || merged.polizzaTypes.length === 0) {
      merged.polizzaTypes = defaultSettings.polizzaTypes
    }
    // Migrate: populate polizzaFields if missing or empty
    if (!merged.polizzaFields || merged.polizzaFields.length === 0) {
      merged.polizzaFields = defaultSettings.polizzaFields
    }
    // Migrate: fix swapped example values in rcp_massimale_mat / rcp_massimale_interr
    if (Array.isArray(merged.polizzaFields)) {
      const FIELD_DESC_FIXES = {
        'rcp_massimale_mat':   'Massimale RC Prodotti per danni materiali (compresi gli animali) anche se appartenenti a più persone, es. 5.000.000,00',
        'rcp_massimale_interr':'Massimale RC Prodotti per danni da interruzione o sospensione di attività, es. 500.000,00'
      }
      merged.polizzaFields = merged.polizzaFields.map(f =>
        FIELD_DESC_FIXES[f.id] ? { ...f, description: FIELD_DESC_FIXES[f.id] } : f
      )
    }
    return merged
  } catch {
    return { ...defaultSettings }
  }
}

export function saveSettings(settings) {
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
  return settings
}
