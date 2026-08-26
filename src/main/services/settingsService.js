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
  // Polizza RC — OCR locale + verifica mirata (#1/#5/#6)
  polizzaOcrEnabled: true,                       // OCR Tesseract del testo come fonte primaria
  polizzaConsensusPasses: 3,                     // passate di lettura per i SOLI campi in verifica
  polizzaVerificaCampi: '',                      // id/etichette dei campi da verificare (CSV); vuoto = nessuno
  polizzaVerificaModel: 'claude-sonnet-4-6',     // modello di arbitraggio quando le passate discordano
  polizzaWholeDossier: false,                    // modalità "fascicolo intero": OCR di tutto → 1 sola chiamata
  polizzaPerField: true,                         // Ollama: motore "una domanda per campo" (RAG in memoria). Spento = motore a stadi.
  polizzaConstrainedJson: true,                  // Schema/GBNF su date-importi-P.IVA. false = format json libero.
  polizzaWholeDossierModel: 'claude-haiku-4-5-20251001', // modello per l'estrazione "fascicolo intero"
  // Extraction profiles
  profiles: [],
  // Accent color
  accentColor: '',
  // Webhook
  webhookEnabled: false,
  webhookPort: 3847,
  webhookToken: '',
  // Indice vettoriale (Qdrant locale + embeddings Ollama). Vuoto = disattivato.
  qdrantUrl: '',
  qdrantCollection: 'documenti',
  embeddingModel: 'bge-m3',
  // Privacy / data retention
  sessionRetentionDays: 90,
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
    { id: '1ec23911-3e7d-5549-b2e2-be3db9d06ee8', label: 'N° Polizza', description: 'Numero di polizza (es. 410000880)', type: 'number', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'C3' }, { sheet: 'RCP', cell: 'C3' }] },
    { id: '36b66bf8-bb9f-5c0e-a947-3d3858349b54', label: 'Compagnia', description: 'Nome della compagnia assicuratrice (es. Generali Italia S.p.A.)', type: 'text', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'C6' }, { sheet: 'RCT_O', cell: 'N18' }, { sheet: 'RCP', cell: 'C6' }, { sheet: 'RCP', cell: 'N16' }] },
    { id: '45c1347c-0b2e-52e8-96c7-7787644858d3', label: 'Contraente/Assicurato', description: 'Ragione sociale del contraente/assicurato (es. ADAMANT BIONRG SRL)', type: 'text', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'C4' }, { sheet: 'RCT_O', cell: 'N17' }, { sheet: 'RCP', cell: 'C4' }, { sheet: 'RCP', cell: 'N15' }] },
    { id: '6f260040-ae1d-56d8-a185-1eb178e384fb', label: 'P. IVA / Cod. Fiscale', description: 'Partita IVA o codice fiscale del contraente', type: 'fiscal', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'F5' }, { sheet: 'RCP', cell: 'F5' }] },
    { id: 'eb8525bc-e808-56a2-aa3d-cefb25da2b6f', label: 'Indirizzo', description: 'Indirizzo completo del domicilio/sede del contraente', type: 'text', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'C5' }, { sheet: 'RCP', cell: 'C5' }] },
    { id: '4ffc5b95-9f28-551a-b587-12f4ea740b12', label: 'Agenzia', description: "Nome dell'agenzia assicurativa (es. ACQUI TERME)", type: 'text', sheet: 'RCT_O', enabled: true, cells: [] },
    { id: '4dc720d8-8237-5084-b288-fd32bd1d19c6', label: 'Decorrenza', description: 'Data di decorrenza della polizza (es. 31/12/2021)', type: 'date', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'C7' }, { sheet: 'RCT_O', cell: 'O21' }, { sheet: 'RCP', cell: 'C7' }, { sheet: 'RCP', cell: 'O20' }] },
    { id: '22408456-185d-5803-b489-02af1a084911', label: 'Scadenza', description: 'Data di scadenza della polizza (es. 31/12/2022)', type: 'date', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'E7' }, { sheet: 'RCT_O', cell: 'Q21' }, { sheet: 'RCP', cell: 'E7' }, { sheet: 'RCP', cell: 'Q20' }] },
    { id: 'a5d4976c-6838-5083-b0cd-3aaf7f04f0e5', label: 'Attività assicurata', description: "Descrizione dell'attività svolta dall'assicurato indicata in polizza", type: 'text', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'A10' }, { sheet: 'RCP', cell: 'A10' }] },
    { id: '94cbee3c-f83b-5b95-87b8-8b68d02d6d59', label: 'Massimale per sinistro', description: 'Massimale RCT per ogni sinistro (RC verso Terzi e Prestatori di Lavoro), es. 3.000.000,00', type: 'number', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'D15' }] },
    { id: '71c0eafb-77ef-5751-92e9-9b4cb872b10a', label: 'Massimale per persona', description: 'Massimale RCT per ogni persona che abbia subito lesioni personali, es. 3.000.000,00', type: 'number', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'E15' }] },
    { id: '908191d5-de50-5902-a09a-0291efe0cec0', label: 'Massimale danni materiali', description: 'Massimale RCT per danni materiali (compresi gli animali), es. 3.000.000,00', type: 'number', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'F15' }] },
    { id: 'e326309b-15b4-5e64-97fd-5294914106de', label: 'Massimale per prestatore', description: 'Massimale RCT per ogni prestatore di lavoro che abbia subito lesioni personali, es. 3.000.000,00', type: 'number', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'D16' }] },
    { id: '28672974-6247-5654-a053-be29b408ffc1', label: 'Parametro regolazione', description: 'Parametro utilizzato per la regolazione del premio RCT (es. Salari e stipendi + Quota TFR)', type: 'text', sheet: 'RCT_O', enabled: true, cells: [] },
    { id: '9517aacb-987f-55c8-8737-2df19980c55f', label: 'Importo preventivo parametro', description: "Importo preventivo annuo del parametro di regolazione RCT (es. 450.000,00)", type: 'number', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'D23' }] },
    { id: '510b46d9-95dd-50f0-86b7-0636865f56ba', label: 'Tasso regolazione ‰', description: 'Tasso di regolazione imponibile per mille della sezione RCT (es. 2,450)', type: 'percent', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'E23' }] },
    { id: 'b9c59183-72a3-5aa1-b34c-1df8e80f28f3', label: 'Premio imponibile', description: "Premio/anticipo di sezione annuo imponibile della sezione RCT (es. 1.227,00)", type: 'number', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'F28' }] },
    { id: '37ab743b-316e-58a4-8fe4-3112bc6d2139', label: 'Imposta', description: "Imposta sul premio della sezione RCT (es. 273,00)", type: 'number', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'F29' }] },
    { id: '545374de-c000-5905-8c62-d36f9fdf7f43', label: 'Premio totale', description: "Premio/anticipo di sezione annuo totale della sezione RCT (es. 1.500,00)", type: 'number', sheet: 'RCT_O', enabled: true,
      cells: [{ sheet: 'RCT_O', cell: 'F30' }, { sheet: 'RCT_O', cell: 'F34' }] },
    { id: '705af6c0-721c-5374-9a65-46102baf95d5', label: 'Prodotti assicurati', description: 'Prodotti per i quali è stipulata la RC Prodotti (es. OLII E GRASSI ANIMALI O VEGETALI, NON ALIMENTARI)', type: 'text', sheet: 'RCP', enabled: true, cells: [] },
    { id: '2ff6a68b-ea2b-5937-a995-a94e8803001f', label: 'Qualifica assicurato', description: "Qualifica dell'assicurato nella sezione RC Prodotti (es. Fabbricante)", type: 'text', sheet: 'RCP', enabled: true, cells: [] },
    { id: '3b777244-559d-5a71-94a4-006ee2a48907', label: 'Massimale per sinistro', description: 'Massimale RC Prodotti per ogni sinistro, es. 5.000.000,00', type: 'number', sheet: 'RCP', enabled: true,
      cells: [{ sheet: 'RCP', cell: 'D14' }] },
    { id: 'ac724518-d10e-55c5-95b7-10c700365820', label: 'Massimale annuo', description: 'Massimale RC Prodotti per più sinistri e per anno assicurativo, es. 5.000.000,00', type: 'number', sheet: 'RCP', enabled: true,
      cells: [{ sheet: 'RCP', cell: 'E14' }] },
    { id: 'b8dc1951-82bb-5325-9550-8b0a1dbd40fd', label: 'Massimale danni materiali', description: 'Massimale RC Prodotti per danni materiali (compresi gli animali) anche se appartenenti a più persone, es. 5.000.000,00', type: 'number', sheet: 'RCP', enabled: true,
      cells: [{ sheet: 'RCP', cell: 'F14' }] },
    { id: '5d3907ba-6a51-58d9-b8b7-789d18c72877', label: 'Massimale interruzione attività', description: 'Massimale RC Prodotti per danni da interruzione o sospensione di attività, es. 500.000,00', type: 'number', sheet: 'RCP', enabled: true, cells: [] },
    { id: 'b7b45f99-50c2-5de4-b977-c8850014464f', label: 'Scoperto minimo - Resto del mondo', description: 'Minimo di scoperto per i danni avvenuti nel resto del mondo (esclusi USA/Canada/Messico), es. 6.000,00', type: 'number', sheet: 'RCP', enabled: true, cells: [] },
    { id: 'aadee5e8-1df4-51eb-97be-9a122ea6a6bd', label: 'Scoperto massimo - Resto del mondo', description: 'Massimo di scoperto per i danni avvenuti nel resto del mondo (esclusi USA/Canada/Messico), es. 100.000,00', type: 'number', sheet: 'RCP', enabled: true, cells: [] },
    { id: '1536ea6d-08f7-5756-9888-1e823e37ebff', label: 'Scoperto minimo - USA/Canada/Messico', description: 'Minimo di scoperto per i danni avvenuti in USA, Canada e Messico, es. 75.000,00', type: 'number', sheet: 'RCP', enabled: true, cells: [] },
    { id: '7557bb00-8501-5e3a-bf9a-c46930d78d3a', label: 'Scoperto massimo - USA/Canada/Messico', description: 'Massimo di scoperto per i danni avvenuti in USA, Canada e Messico, es. 150.000,00', type: 'number', sheet: 'RCP', enabled: true, cells: [] },
    { id: '4efb7f66-c811-50ef-a345-81d07f9328c0', label: 'Parametro regolazione', description: 'Parametro utilizzato per la regolazione del premio RCP (es. Ricavi delle vendite e delle prestazioni)', type: 'text', sheet: 'RCP', enabled: true, cells: [] },
    { id: 'e61884dd-4f2d-54cf-ae3b-83e35316e88f', label: 'Importo preventivo parametro', description: "Importo preventivo annuo del parametro di regolazione RCP (es. 240.000.000,00)", type: 'number', sheet: 'RCP', enabled: true,
      cells: [{ sheet: 'RCP', cell: 'D20' }] },
    { id: '9cf66993-245c-52ff-b0d0-1832fce74eae', label: 'Tasso regolazione ‰', description: 'Tasso di regolazione imponibile per mille della sezione RCP (es. 0,245)', type: 'percent', sheet: 'RCP', enabled: true,
      cells: [{ sheet: 'RCP', cell: 'E20' }] },
    { id: '510c0f10-6135-5957-a42c-8ccf1b0226de', label: 'Premio imponibile', description: "Premio/anticipo di sezione annuo imponibile della sezione RC Prodotti (es. 58.799,99)", type: 'number', sheet: 'RCP', enabled: true,
      cells: [{ sheet: 'RCP', cell: 'F30' }] },
    { id: '4d22a044-eec5-599f-974d-f27efbeac4d9', label: 'Imposta', description: "Imposta sul premio della sezione RC Prodotti (es. 13.082,99)", type: 'number', sheet: 'RCP', enabled: true,
      cells: [{ sheet: 'RCP', cell: 'F31' }] },
    { id: '99c9ad06-8441-54c4-bfe2-ddf440faf11c', label: 'Premio totale', description: "Premio/anticipo di sezione annuo totale della sezione RC Prodotti (es. 71.882,98)", type: 'number', sheet: 'RCP', enabled: true,
      cells: [{ sheet: 'RCP', cell: 'F32' }, { sheet: 'RCP', cell: 'F37' }] }
  ],
  polizzaProfiles: [],
  // Grounding rigoroso nel motore per-field (FEATURE G): finestre deterministiche
  // + verifica di supporto. false = comportamento IDENTICO al passato.
  polizzaGrounding: false,
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
        'b8dc1951-82bb-5325-9550-8b0a1dbd40fd':   'Massimale RC Prodotti per danni materiali (compresi gli animali) anche se appartenenti a più persone, es. 5.000.000,00',
        '5d3907ba-6a51-58d9-b8b7-789d18c72877':'Massimale RC Prodotti per danni da interruzione o sospensione di attività, es. 500.000,00'
      }
      merged.polizzaFields = merged.polizzaFields.map(f =>
        FIELD_DESC_FIXES[f.id] ? { ...f, description: FIELD_DESC_FIXES[f.id] } : f
      )
      // Migrate: rimuovi le sigle (RCT)/(RCP)/(RCT_O) dalle etichette dei campi —
      // i dati di polizza non sono più suddivisi per tipologia (elenco unico).
      const SIGLA_RE = /\s*\((?:RCT_O|RCTOP|RCT|RCP|RCO)\)\s*$/i
      merged.polizzaFields = merged.polizzaFields.map(f =>
        (typeof f.label === 'string' && SIGLA_RE.test(f.label))
          ? { ...f, label: f.label.replace(SIGLA_RE, '').trim() }
          : f
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
