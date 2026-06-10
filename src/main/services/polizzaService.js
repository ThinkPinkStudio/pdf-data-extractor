/**
 * Servizio di estrazione dati da polizze RC (Responsabilità Civile)
 * Supporta la struttura GENERAIMPRESA (Generali Italia) e formati similari.
 *
 * Fogli Excel target: RCT_O e RCP
 *
 * Strategia di estrazione (in ordine di qualità):
 * 1. pdftotext (poppler-utils)  – migliore, ma richiede installazione esterna
 * 2. pdfjs-dist con ricostruzione spaziale – puro JS, funziona su Win/Mac/Linux
 * 3. pdf-parse – ultimo fallback generico
 */

import { readFileSync } from 'fs'
import { readFile } from 'fs/promises'
import { execSync } from 'child_process'
import { loadPDF } from './pdfService.js'

// ─── Mapping predefinito per il Gestionale CSA (Consulenze & Soluzioni Aziendali)
// Struttura rilevata dal file Gestionale_Clienti_CSA.xlsx
// Ogni entry: { sheet, cell } indica dove scrivere nel template
export const CSA_MAPPING = {
  // ─── Dati comuni (presenti in entrambi i fogli) ───────────────────────────
  // Nota: le chiavi comuni vengono scritte sia in RCT_O che in RCP
  polizza_numero:           [{ sheet: 'RCT_O', cell: 'C3'  }, { sheet: 'RCP', cell: 'C3'  }],
  contraente:               [{ sheet: 'RCT_O', cell: 'C4'  }, { sheet: 'RCT_O', cell: 'N17' },
                             { sheet: 'RCP',   cell: 'C4'  }, { sheet: 'RCP',   cell: 'N15' }],
  indirizzo:                [{ sheet: 'RCT_O', cell: 'C5'  }, { sheet: 'RCP', cell: 'C5'  }],
  codice_fiscale_iva:       [{ sheet: 'RCT_O', cell: 'F5'  }, { sheet: 'RCP', cell: 'F5'  }],
  compagnia:                [{ sheet: 'RCT_O', cell: 'C6'  }, { sheet: 'RCT_O', cell: 'N18' },
                             { sheet: 'RCP',   cell: 'C6'  }, { sheet: 'RCP',   cell: 'N16' }],
  decorrenza:               [{ sheet: 'RCT_O', cell: 'C7'  }, { sheet: 'RCT_O', cell: 'O21' },
                             { sheet: 'RCP',   cell: 'C7'  }, { sheet: 'RCP',   cell: 'O20' }],
  scadenza:                 [{ sheet: 'RCT_O', cell: 'E7'  }, { sheet: 'RCT_O', cell: 'Q21' },
                             { sheet: 'RCP',   cell: 'E7'  }, { sheet: 'RCP',   cell: 'Q20' }],
  attivita:                 [{ sheet: 'RCT_O', cell: 'A10' }, { sheet: 'RCP', cell: 'A10' }],
  agenzia:                  [],  // non presente come campo dedicato nel gestionale

  // ─── Sezione RCT_O ────────────────────────────────────────────────────────
  rct_massimale_sinistro:   [{ sheet: 'RCT_O', cell: 'D15' }],  // MAX SINISTRO R.C. TERZI
  rct_massimale_persona:    [{ sheet: 'RCT_O', cell: 'E15' }],  // MAX PERSONA R.C. TERZI
  rct_massimale_danni:      [{ sheet: 'RCT_O', cell: 'F15' }],  // MAX COSE/ANIMALI R.C. TERZI
  rct_massimale_prestatore: [{ sheet: 'RCT_O', cell: 'D16' }],  // MAX SINISTRO R.C. DIPENDENTI
  rct_parametro:            [],                                   // testo descrittivo, non ha cella dedicata
  rct_importo_preventivo:   [{ sheet: 'RCT_O', cell: 'D23' }],  // PREVENTIVO retribuzioni
  rct_tasso:                [{ sheet: 'RCT_O', cell: 'E23' }],  // TASSO (per mille)
  rct_premio_imponibile:    [{ sheet: 'RCT_O', cell: 'F28' }],  // IMPONIBILE polizza
  rct_imposta:              [{ sheet: 'RCT_O', cell: 'F29' }],  // TASSE polizza
  rct_premio_totale:        [{ sheet: 'RCT_O', cell: 'F30' }, { sheet: 'RCT_O', cell: 'F34' }], // TOTALE LORDO + PREMIO TOTALE

  // ─── Sezione RCP ─────────────────────────────────────────────────────────
  rcp_prodotti:             [],                                   // testo, non ha cella specifica
  rcp_qualifica:            [],                                   // testo, non ha cella specifica
  rcp_massimale_sinistro:   [{ sheet: 'RCP', cell: 'D14' }],    // MAX SINISTRO R.C. PRODOTTI
  rcp_massimale_annuo:      [{ sheet: 'RCP', cell: 'E14' }],    // (usiamo col E come max annuo)
  rcp_massimale_mat:        [{ sheet: 'RCP', cell: 'F14' }],    // MAX COSE ANIMALI
  rcp_massimale_interr:     [],                                   // non ha cella specifica
  rcp_scoperto_min_mondo:   [],                                   // non ha cella specifica
  rcp_scoperto_max_mondo:   [],
  rcp_scoperto_min_usa:     [],
  rcp_scoperto_max_usa:     [],
  rcp_parametro:            [],
  rcp_importo_preventivo:   [{ sheet: 'RCP', cell: 'D20' }],    // FATTURATO NO USA preventivo
  rcp_tasso:                [{ sheet: 'RCP', cell: 'E20' }],    // TASSO
  rcp_premio_imponibile:    [{ sheet: 'RCP', cell: 'F30' }],    // IMPONIBILE polizza
  rcp_imposta:              [{ sheet: 'RCP', cell: 'F31' }],    // TASSE polizza
  rcp_premio_totale:        [{ sheet: 'RCP', cell: 'F32' }, { sheet: 'RCP', cell: 'F37' }]  // TOTALE LORDO + PREMIO TOTALE
}

// ─── Campi per il foglio RCT_O ────────────────────────────────────────────────

export const RCT_FIELDS = [
  { id: 'polizza_numero',          label: 'N° Polizza',                         sheet: 'RCT_O', description: 'Numero di polizza (es. 410000880)', type: 'text' },
  { id: 'compagnia',               label: 'Compagnia',                           sheet: 'RCT_O', description: 'Nome della compagnia assicuratrice (es. Generali Italia S.p.A.)', type: 'text' },
  { id: 'contraente',              label: 'Contraente/Assicurato',               sheet: 'RCT_O', description: 'Ragione sociale del contraente/assicurato (es. ADAMANT BIONRG SRL)', type: 'text' },
  { id: 'codice_fiscale_iva',      label: 'P. IVA / Cod. Fiscale',              sheet: 'RCT_O', description: 'Partita IVA o codice fiscale del contraente', type: 'text' },
  { id: 'indirizzo',               label: 'Indirizzo',                           sheet: 'RCT_O', description: 'Indirizzo completo del domicilio/sede del contraente', type: 'text' },
  { id: 'agenzia',                 label: 'Agenzia',                             sheet: 'RCT_O', description: "Nome dell'agenzia assicurativa (es. ACQUI TERME)", type: 'text' },
  { id: 'decorrenza',              label: 'Decorrenza',                          sheet: 'RCT_O', description: 'Data di decorrenza della polizza (es. 31/12/2021)', type: 'date' },
  { id: 'scadenza',                label: 'Scadenza',                            sheet: 'RCT_O', description: 'Data di scadenza della polizza (es. 31/12/2022)', type: 'date' },
  { id: 'attivita',                label: 'Attività assicurata',                 sheet: 'RCT_O', description: "Descrizione dell'attività svolta dall'assicurato indicata in polizza", type: 'text' },
  { id: 'rct_massimale_sinistro',  label: 'Massimale per sinistro (RCT)',        sheet: 'RCT_O', description: 'Massimale RCT per ogni sinistro (RC verso Terzi e Prestatori di Lavoro), es. 3.000.000,00', type: 'text' },
  { id: 'rct_massimale_persona',   label: 'Massimale per persona (RCT)',         sheet: 'RCT_O', description: 'Massimale RCT per ogni persona che abbia subito lesioni personali (non prestatore di lavoro), es. 3.000.000,00', type: 'text' },
  { id: 'rct_massimale_danni',     label: 'Massimale danni materiali (RCT)',     sheet: 'RCT_O', description: 'Massimale RCT per danni materiali (compresi gli animali), es. 3.000.000,00', type: 'text' },
  { id: 'rct_massimale_prestatore',label: 'Massimale per prestatore (RCT)',      sheet: 'RCT_O', description: 'Massimale RCT per ogni prestatore di lavoro che abbia subito lesioni personali, es. 3.000.000,00', type: 'text' },
  { id: 'rct_parametro',           label: 'Parametro regolazione (RCT)',         sheet: 'RCT_O', description: 'Parametro utilizzato per la regolazione del premio RCT (es. Salari e stipendi + Quota TFR)', type: 'text' },
  { id: 'rct_importo_preventivo',  label: 'Importo preventivo parametro (RCT)', sheet: 'RCT_O', description: "Importo preventivo annuo del parametro di regolazione RCT (es. 450.000,00)", type: 'text' },
  { id: 'rct_tasso',               label: 'Tasso regolazione ‰ (RCT)',           sheet: 'RCT_O', description: 'Tasso di regolazione imponibile per mille della sezione RCT (es. 2,450)', type: 'text' },
  { id: 'rct_premio_imponibile',   label: 'Premio imponibile (RCT)',             sheet: 'RCT_O', description: "Premio/anticipo di sezione annuo imponibile della sezione RCT (es. 1.227,00)", type: 'text' },
  { id: 'rct_imposta',             label: 'Imposta (RCT)',                        sheet: 'RCT_O', description: "Imposta sul premio della sezione RCT (es. 273,00)", type: 'text' },
  { id: 'rct_premio_totale',       label: 'Premio totale (RCT)',                  sheet: 'RCT_O', description: "Premio/anticipo di sezione annuo totale della sezione RCT (es. 1.500,00)", type: 'text' }
]

// ─── Campi per il foglio RCP ──────────────────────────────────────────────────

export const RCP_FIELDS = [
  { id: 'rcp_prodotti',             label: 'Prodotti assicurati',                 sheet: 'RCP', description: 'Prodotti per i quali è stipulata la RC Prodotti (es. OLII E GRASSI ANIMALI O VEGETALI, NON ALIMENTARI)', type: 'text' },
  { id: 'rcp_qualifica',            label: 'Qualifica assicurato',                sheet: 'RCP', description: "Qualifica dell'assicurato nella sezione RC Prodotti (es. Fabbricante)", type: 'text' },
  { id: 'rcp_massimale_sinistro',   label: 'Massimale per sinistro (RCP)',        sheet: 'RCP', description: 'Massimale RC Prodotti per ogni sinistro, es. 5.000.000,00', type: 'text' },
  { id: 'rcp_massimale_annuo',      label: 'Massimale annuo (RCP)',               sheet: 'RCP', description: 'Massimale RC Prodotti per più sinistri e per anno assicurativo, es. 5.000.000,00', type: 'text' },
  { id: 'rcp_massimale_mat',        label: 'Massimale danni materiali (RCP)',     sheet: 'RCP', description: 'Massimale RC Prodotti per danni materiali (compresi gli animali) anche se appartenenti a più persone, es. 5.000.000,00', type: 'text' },
  { id: 'rcp_massimale_interr',     label: 'Massimale interruzione attività (RCP)', sheet: 'RCP', description: 'Massimale RC Prodotti per danni da interruzione o sospensione di attività, es. 500.000,00', type: 'text' },
  { id: 'rcp_scoperto_min_mondo',   label: 'Scoperto minimo - Resto del mondo',   sheet: 'RCP', description: 'Minimo di scoperto per i danni avvenuti nel resto del mondo (esclusi USA/Canada/Messico), es. 6.000,00', type: 'text' },
  { id: 'rcp_scoperto_max_mondo',   label: 'Scoperto massimo - Resto del mondo',  sheet: 'RCP', description: 'Massimo di scoperto per i danni avvenuti nel resto del mondo (esclusi USA/Canada/Messico), es. 100.000,00', type: 'text' },
  { id: 'rcp_scoperto_min_usa',     label: 'Scoperto minimo - USA/Canada/Messico', sheet: 'RCP', description: 'Minimo di scoperto per i danni avvenuti in USA, Canada e Messico, es. 75.000,00', type: 'text' },
  { id: 'rcp_scoperto_max_usa',     label: 'Scoperto massimo - USA/Canada/Messico', sheet: 'RCP', description: 'Massimo di scoperto per i danni avvenuti in USA, Canada e Messico, es. 150.000,00', type: 'text' },
  { id: 'rcp_parametro',            label: 'Parametro regolazione (RCP)',         sheet: 'RCP', description: 'Parametro utilizzato per la regolazione del premio RCP (es. Ricavi delle vendite e delle prestazioni)', type: 'text' },
  { id: 'rcp_importo_preventivo',   label: 'Importo preventivo parametro (RCP)', sheet: 'RCP', description: "Importo preventivo annuo del parametro di regolazione RCP (es. 240.000.000,00)", type: 'text' },
  { id: 'rcp_tasso',                label: 'Tasso regolazione ‰ (RCP)',           sheet: 'RCP', description: 'Tasso di regolazione imponibile per mille della sezione RCP (es. 0,245)', type: 'text' },
  { id: 'rcp_premio_imponibile',    label: 'Premio imponibile (RCP)',             sheet: 'RCP', description: "Premio/anticipo di sezione annuo imponibile della sezione RC Prodotti (es. 58.799,99)", type: 'text' },
  { id: 'rcp_imposta',              label: 'Imposta (RCP)',                        sheet: 'RCP', description: "Imposta sul premio della sezione RC Prodotti (es. 13.082,99)", type: 'text' },
  { id: 'rcp_premio_totale',        label: 'Premio totale (RCP)',                  sheet: 'RCP', description: "Premio/anticipo di sezione annuo totale della sezione RC Prodotti (es. 71.882,98)", type: 'text' }
]

export const ALL_POLIZZA_FIELDS = [...RCT_FIELDS, ...RCP_FIELDS]

// ─── Estrazione testo via pdftotext (poppler-utils) ──────────────────────────

/**
 * Estrae il testo da un PDF con pdftotext -layout (poppler-utils).
 * Produce output eccellente per PDF-form. Cerca il binario in PATH e in
 * percorsi comuni su macOS (Homebrew Intel/ARM) e Linux.
 * @returns {string|null} testo estratto, null se poppler non installato
 */
function extractTextWithPdftotext(filePath) {
  const EXTRA_DIRS = [
    '/opt/homebrew/bin',    // macOS Homebrew ARM (Apple Silicon)
    '/usr/local/bin',       // macOS Homebrew Intel + Linux vari
    '/opt/local/bin',       // macOS MacPorts
    '/usr/bin'              // Linux standard
  ]
  const escaped = filePath.replace(/'/g, "'\\''")

  const candidates = [
    `pdftotext -layout '${escaped}' -`,
    ...EXTRA_DIRS.map(d => `'${d}/pdftotext' -layout '${escaped}' -`)
  ]

  for (const cmd of candidates) {
    try {
      // stdio: stderr 'ignore' → niente spam "pdftotext: command not found" in console
      // quando poppler non è installato (caso normale: si usa il fallback pdfjs).
      const text = execSync(cmd, {
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 20 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore']
      })
      if (text && text.trim().length > 10) return text
    } catch {
      // Prova il prossimo
    }
  }
  return null  // non disponibile — il chiamante usa il fallback pdfjs
}

// ─── Estrazione con pdfjs-dist (puro JS, cross-platform) ─────────────────────

/**
 * Estrae testo da PDF usando pdfjs-dist direttamente.
 * Funziona su Windows/Mac/Linux senza dipendenze native.
 * Usa l'ordine naturale del content stream (che per la maggior parte dei PDF
 * coincide con l'ordine di lettura) + marcatori hasEOL per le righe.
 * @returns {string|null}
 */
async function extractTextWithPdfjsSpatial(filePath) {
  try {
    const fileBuffer = readFileSync(filePath)

    // pdfjs-dist/legacy è la build Node.js-compatibile (nessun Web Worker)
    const pdfjsMod = await import('pdfjs-dist/legacy/build/pdf.js')
    const pdfjs = pdfjsMod.default || pdfjsMod
    if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = ''

    const doc = await pdfjs.getDocument({
      data: new Uint8Array(fileBuffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true
    }).promise

    const pageTexts = []
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum)
      const content = await page.getTextContent({ includeMarkedContent: false })

      let pageText = ''
      let prevX = null, prevY = null

      for (const item of content.items) {
        if (!('str' in item)) continue  // salta TextMarkedContent

        const x = item.transform[4], y = item.transform[5]

        // Nuova riga se Y cambia significativamente, o se hasEOL è true
        if (prevY !== null) {
          const dy = Math.abs(y - prevY)
          const fontSize = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 10
          if (item.hasEOL || dy > fontSize * 0.4) {
            pageText += '\n'
            prevX = null
          } else if (prevX !== null) {
            // Aggiunge spazio se c'è un gap orizzontale tra item consecutivi
            const gap = x - prevX
            const charW = (item.width > 0 && item.str.length > 0)
              ? item.width / item.str.length
              : fontSize * 0.5
            if (gap > charW * 0.3) pageText += ' '
          }
        }

        pageText += item.str
        prevX = x + (item.width || item.str.length * ((Math.abs(item.transform[0]) || 10) * 0.5))
        prevY = y
      }

      if (pageText.trim()) pageTexts.push(pageText.trim())
    }

    // Use \f (form feed) as page separator — same as pdftotext — so page numbers
    // can be reconstructed later by counting \f chars before a value's position.
    const fullText = pageTexts.join('\f').trim()
    return fullText.length > 20 ? fullText : null
  } catch (err) {
    console.warn('[polizza] pdfjs extraction failed:', err.message)
    return null
  }
}

/**
 * Riduce il testo di un documento CGA al minimo necessario.
 * Per tutti gli altri tipi, il testo viene inviato integro al LLM.
 *
 * Il CGA è l'unico caso filtrato perché:
 * - È boilerplate puro (200K+ chars) che monopolizzerebbe il contesto
 * - Contiene valori generici di ESEMPIO (massimali, importi) che potrebbero
 *   confondere il LLM portandolo ad estrarre dati sbagliati
 */
function filterCGA(text, maxChars = 600) {
  if (text.length <= maxChars) return text
  // Per il CGA bastano pochissimi char: vogliamo solo confermare nome compagnia/prodotto
  return text.slice(0, maxChars)
}

// ─── Estrazione regex per campi strutturati ───────────────────────────────────

/**
 * Estrae con regex SOLO i campi ultra-strutturati che cambiano raramente tra documenti:
 * N° polizza, P.IVA, date di decorrenza e scadenza.
 * Tutto il resto viene gestito dal modello LLM che riceve il testo pulito.
 */
function extractFieldsWithRegex(text) {
  const found = {}

  // ── N° Polizza: numero lungo dopo "POLIZZA N°", "POLIZZA No." ecc.
  const polMatch = text.match(/POLIZZA\s+N[°oO.]\s*(\d[\d\s]{4,15})/i)
  if (polMatch) {
    found.polizza_numero = polMatch[1].replace(/\s+/g, '').trim()
  }

  // ── P. IVA / Codice Fiscale: prima sequenza di 10+ cifre consecutive dopo il label
  const pivaLine = text.match(/P\.?\s*IVA[^\n]{0,80}/i)
  if (pivaLine) {
    const numRun = pivaLine[0].match(/\d{10,16}/)
    if (numRun) found.codice_fiscale_iva = numRun[0]
  }

  // ── Date decorrenza e scadenza (gestisce artefatti OCR "31 112 I 2021" → "31/12/2021")
  const decDate = parseDateFromContextLine(text, /DECORRENZA\b[^\n]{0,100}/i)
  if (decDate) found.decorrenza = decDate

  const scadDate = parseDateFromContextLine(text, /SCADENZA\b[^\n]{0,100}/i)
  if (scadDate) found.scadenza = scadDate

  return found
}

/**
 * Cerca una data in una riga di testo corrispondente al pattern.
 * Gestisce sia il formato standard "GG/MM/AAAA" sia gli artefatti pdftotext
 * tipo "31 112 I 2021" (→ "31/12/2021").
 */
function parseDateFromContextLine(fullText, linePattern) {
  const lineMatch = fullText.match(linePattern)
  if (!lineMatch) return null
  const line = lineMatch[0]

  // Formato standard
  const std = line.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/)
  if (std) {
    return `${std[1].padStart(2, '0')}/${std[2].padStart(2, '0')}/${std[3]}`
  }

  // Formato con artefatti OCR: cerca l'anno (20XX) e lavora all'indietro
  const yearMatch = line.match(/(20\d{2})/)
  if (!yearMatch) return null
  const year = yearMatch[1]
  const beforeYear = line.slice(0, line.indexOf(year))

  // Estrai numeri prima dell'anno; se un numero > 31, prendi le ultime 2 cifre
  const nums = [...beforeYear.matchAll(/\d+/g)].map(m => {
    const n = parseInt(m[0])
    if (n > 31 && m[0].length > 2) return parseInt(m[0].slice(-2))
    return n
  }).filter(n => n >= 1 && n <= 31)

  // Cerca mese (≤ 12) da destra, poi il giorno
  let month = null, day = null
  for (let i = nums.length - 1; i >= 0; i--) {
    if (month === null && nums[i] >= 1 && nums[i] <= 12) {
      month = nums[i]
    } else if (month !== null) {
      day = nums[i]
      break
    }
  }

  if (day && month) {
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
  }
  return null
}

// ─── Estrazione combinata da più PDF ─────────────────────────────────────────

/**
 * Restituisce la data più recente trovata nel testo del documento come timestamp
 * numerico (ms). Cerca nell'ordine: scadenza → decorrenza → prima data GG/MM/AAAA.
 * Usata per stabilire quale documento è il più recente quando ci sono più file.
 */
function extractDocumentDate(text) {
  const toTimestamp = (dateStr) => {
    if (!dateStr) return 0
    const [dd, mm, yyyy] = dateStr.split('/')
    if (!dd || !mm || !yyyy) return 0
    return new Date(+yyyy, +mm - 1, +dd).getTime()
  }

  // 1. Data di scadenza (es. "SCADENZA 31/12/2025") — la più indicativa
  const scad = parseDateFromContextLine(text, /SCADENZA\b[^\n]{0,100}/i)
  if (scad) return toTimestamp(scad)

  // 2. Data di decorrenza (es. "DECORRENZA 01/01/2024")
  const dec = parseDateFromContextLine(text, /DECORRENZA\b[^\n]{0,100}/i)
  if (dec) return toTimestamp(dec)

  // 3. Prima data GG/MM/AAAA trovata nel testo
  const any = text.match(/(\d{1,2})[/.](\d{1,2})[/.](20\d{2})/)
  if (any) {
    return toTimestamp(`${any[1].padStart(2,'0')}/${any[2].padStart(2,'0')}/${any[3]}`)
  }

  return 0
}

/**
 * Estrae tutti i dati assicurativi da un set di PDF di polizza RC.
 * Strategia: pdftotext → regex (alta affidabilità) + LLM (campi liberi).
 *
 * Regola "file più recente vince": quando un campo è presente in più file,
 * viene usato il valore del file con la data interna più recente (scadenza/decorrenza).
 *
 * @param {Array<string|{path:string,type:string}>} files
 *   Può essere un array di path (string) oppure oggetti { path, type }.
 *   type: 'polizza' | 'appendice' | 'allegato' | 'cga'
 */
export async function extractPolizzaFromPDFs(files, settings) {
  // Normalizza input: string → { path, type:'polizza' }
  const normalizedFiles = (files || []).map(f =>
    typeof f === 'string' ? { path: f, type: 'polizza' } : f
  )

  const provider = settings.llmProvider || 'ollama'
  const TOTAL_BUDGET = provider === 'anthropic' ? 180000
                     : provider === 'openai'    ? 100000
                     :                             60000
  const CGA_MAX    = 600
  const TYPE_ORDER = ['polizza', 'appendice', 'allegato', 'cga']

  // 1. Estrai testo da tutti i PDF, leggi la data interna del documento
  const allTexts = []

  for (const { path: fp, type = 'polizza' } of normalizedFiles) {
    let text = extractTextWithPdftotext(fp)

    if (text) {
      console.log(`[polizza] pdftotext OK: ${fp.split('/').pop()} (${text.length} chars)`)
    } else {
      text = await extractTextWithPdfjsSpatial(fp)
      if (text) {
        console.log(`[polizza] pdfjs-spatial: ${fp.split('/').pop()} (${text.length} chars)`)
      } else {
        try {
          const pdfData = await loadPDF(fp)
          text = pdfData.text || ''
          if (text.trim().length > 5) {
            console.log(`[polizza] pdf-parse fallback: ${fp.split('/').pop()} (${text.length} chars)`)
          }
        } catch (err) {
          console.warn(`[polizza] Impossibile leggere ${fp}:`, err.message)
        }
      }
    }

    if (text && text.trim().length > 5) {
      // Usa la data trovata nel contenuto del documento come indicatore di "recenza"
      // (es. la data di scadenza/decorrenza), non la data di modifica del file.
      const docDate = extractDocumentDate(text)
      allTexts.push({ path: fp, type: type || 'polizza', text, docDate })
    }
  }

  // Traccia i file senza testo estratto (PDF scansionati = solo immagini)
  const scannedFiles = normalizedFiles
    .filter(f => !allTexts.find(t => t.path === f.path))
    .map(f => ({ path: f.path, type: f.type || 'polizza' }))

  if (scannedFiles.length > 0) {
    console.log(
      `[polizza] ${scannedFiles.length} file scansionati (nessun testo estraibile → vision OCR):`,
      scannedFiles.map(f => f.path.split('/').pop())
    )
  }

  if (allTexts.length === 0) {
    return { data: {}, scannedFiles, sources: {} }
  }

  // 2. Ordina per tipo (priorità), poi per data interna crescente (documento più vecchio
  //    prima → documento più recente alla fine). Il LLM vede l'aggiornamento più recente
  //    per ultimo e tende a privilegiarlo in caso di valori contrastanti.
  allTexts.sort((a, b) => {
    const ai = TYPE_ORDER.indexOf(a.type)
    const bi = TYPE_ORDER.indexOf(b.type)
    const typeDiff = (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
    if (typeDiff !== 0) return typeDiff
    return (a.docDate || 0) - (b.docDate || 0)  // stesso tipo: data doc più vecchia prima
  })

  // 3. Costruisci il testo da inviare al LLM
  const excerpts = []
  let remainingBudget = TOTAL_BUDGET

  for (const { path: fp, type, text } of allTexts) {
    let excerpt
    if (type === 'cga') {
      excerpt = filterCGA(text, CGA_MAX)
    } else {
      if (remainingBudget <= 0) {
        console.log(`[polizza] skip [${type}] ${fp.split('/').pop()}: budget esaurito`)
        continue
      }
      excerpt = text.length <= remainingBudget ? text : text.slice(0, remainingBudget)
      remainingBudget -= excerpt.length
    }
    console.log(`[polizza] contesto [${type}] ${fp.split('/').pop()}: ${excerpt.length} chars${type === 'cga' ? '' : ` (budget residuo: ${remainingBudget})`}`)
    excerpts.push(`=== ${fp.split('/').pop()} [${type}] ===\n${excerpt}`)
  }

  const combinedText = excerpts.join('\n\n')

  // 4. Estrazione rapida con regex — eseguita per-file, mtime crescente → file più recente vince
  const regexResult = {}
  for (const { text } of allTexts) {
    const r = extractFieldsWithRegex(text)
    Object.assign(regexResult, r)  // file più recente (elaborato dopo) sovrascrive il precedente
  }
  const regexFound = Object.keys(regexResult).filter(k => regexResult[k])
  console.log(`[polizza] Regex: ${regexFound.length} campi trovati:`, regexFound)

  // 5. LLM per i campi ancora mancanti
  const configuredFields = (settings.polizzaFields && settings.polizzaFields.length > 0)
    ? settings.polizzaFields
    : ALL_POLIZZA_FIELDS
  const allFields = configuredFields.filter(f => f.enabled !== false)
  const missingFields = allFields.filter(f => !regexResult[f.id])

  let llmResult = {}
  if (missingFields.length > 0 && settings.llmProvider !== 'none') {
    console.log(
      `[polizza] LLM: ${missingFields.length} campi da estrarre, ` +
      `${combinedText.length} chars testo rilevante`
    )
    try {
      llmResult = await extractPolizzaWithProvider(settings, missingFields, combinedText)
      const llmFound = Object.keys(llmResult).filter(k => llmResult[k])
      console.log(`[polizza] LLM: ${llmFound.length} campi trovati:`, llmFound)
    } catch (err) {
      console.warn('[polizza] Errore LLM (non fatale):', err.message)
    }
  }

  // 6. Merge: regex ha priorità, LLM completa il resto
  const data = { ...llmResult, ...regexResult }

  // 7. Calcola sorgente (file + pagina) per ogni campo estratto
  const sources = {}
  for (const [fieldId, value] of Object.entries(data)) {
    if (value === null || value === undefined || value === '') continue
    const src = findValueSource(String(value), allTexts)
    if (src) sources[fieldId] = src
  }

  return { data, scannedFiles, sources }
}

/**
 * Cerca il valore estratto nei testi per-file e restituisce { file, page }.
 * Cerca dal file più recente (ultimo nell'array) verso il più vecchio in modo
 * che la sorgente riportata sia quella del documento con data più recente.
 */
function findValueSource(value, allTexts) {
  const needle = value.toLowerCase().trim()
  if (needle.length < 3) return null

  for (let i = allTexts.length - 1; i >= 0; i--) {
    const { path, text } = allTexts[i]
    const lower = text.toLowerCase()
    const pos = lower.indexOf(needle)
    if (pos === -1) continue

    // Conta i separatori di pagina prima della posizione trovata.
    // Sia pdftotext (\f) che pdfjs (\f dopo la modifica) usano lo stesso separatore.
    const before = text.slice(0, pos)
    const pageNum = (before.match(/\f/g) || []).length + 1

    return { file: path.split(/[\\/]/).pop(), page: pageNum }
  }
  return null
}

// ─── Prompt specializzato per polizze RC ─────────────────────────────────────

async function extractPolizzaWithProvider(settings, fields, contextText) {
  if (fields.length === 0) return {}

  const provider = settings.llmProvider || 'ollama'
  const promptExtra = (settings.polizzaPromptExtra || '').trim()

  const jsonTemplate = '{\n' + fields.map(f => `  "${f.id}": null`).join(',\n') + '\n}'

  const fieldGuide = fields
    .map(f => `${f.id}: ${f.label} (es. ${f.description.match(/es\.\s*[^)]+/)?.[0] || f.description.slice(0, 60)})`)
    .join('\n')

  const systemPrompt =
    'Sei un estrattore di dati da polizze assicurative italiane. ' +
    'Rispondi SEMPRE e SOLO con un oggetto JSON valido. ' +
    'Zero testo aggiuntivo, zero markdown, zero spiegazioni.'

  // Istruzione "file più recente vince" aggiunta ai prompt (i documenti sono
  // ordinati dal più vecchio al più recente nel testo sopra)
  const newestWinsRule =
    '- Se un dato appare in più documenti, usa il valore del documento più recente ' +
    '(quello riportato per ultimo nel testo sopra)\n'

  const extraSection = promptExtra ? `\nISTRUZIONI AGGIUNTIVE:\n${promptExtra}\n` : ''

  const ollamaPrompt =
`DOCUMENTO ASSICURATIVO:
${contextText}

Leggi il documento e compila il JSON seguente.
Sostituisci null con il valore trovato nel documento, lascia null se non presente.
${newestWinsRule}${extraSection}Rispondi SOLO con il JSON compilato:

${jsonTemplate}`

  const cloudPrompt =
`Estrai i dati dal documento assicurativo italiano e compila il JSON.

DOCUMENTO:
${contextText}

GUIDA AI CAMPI:
${fieldGuide}

Regole:
- Importi: formato italiano "3.000.000,00" (punto = migliaia, virgola = decimale)
- Date: formato GG/MM/AAAA
- RCT = sezione "RC verso Terzi e Prestatori di Lavoro"
- RCP = sezione "RC Prodotti"
- ${newestWinsRule}- null se il campo non è nel documento${extraSection}
Compila e restituisci SOLO questo JSON:
${jsonTemplate}`

  let raw

  if (provider === 'openai') {
    raw = await callOpenAI(settings, systemPrompt, cloudPrompt)
  } else if (provider === 'anthropic') {
    raw = await callAnthropic(settings, systemPrompt, cloudPrompt)
  } else {
    raw = await callOllama(settings, systemPrompt, ollamaPrompt)
  }

  return parseJsonResponse(raw)
}

async function callOpenAI(settings, systemPrompt, userPrompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.openaiApiKey}`
    },
    body: JSON.stringify({
      model: settings.openaiModel || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0,
      response_format: { type: 'json_object' }  // JSON mode nativo
    }),
    signal: AbortSignal.timeout(90000)
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`OpenAI error: ${res.status} ${err?.error?.message || ''}`)
  }
  const data = await res.json()
  return (data.choices?.[0]?.message?.content || '').trim()
}

async function callAnthropic(settings, systemPrompt, userPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.anthropicApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: settings.anthropicModel || 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    }),
    signal: AbortSignal.timeout(90000)
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Anthropic error: ${res.status} ${err?.error?.message || ''}`)
  }
  const data = await res.json()
  return (data.content?.[0]?.text || '').trim()
}

async function callOllama(settings, systemPrompt, userPrompt) {
  const url = settings.ollamaUrl || 'http://127.0.0.1:11434'
  // Usiamo /api/chat (non /api/generate) + format:"json" che forza JSON
  // a livello grammaticale — il modello non può rispondere con testo libero
  const res = await fetch(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.ollamaModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   }
      ],
      stream: false,
      format: 'json',          // ← grammar-constrained JSON output
      options: {
        num_ctx:     65536,    // 64K token context → gestisce ~60K chars di testo polizza
        temperature: 0,        // output deterministico
        num_predict: 2048      // max token risposta
      }
    }),
    signal: AbortSignal.timeout(180000) // 3 min per modelli locali lenti
  })
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`)
  const data = await res.json()
  return (data.message?.content || '').trim()
}

function parseJsonResponse(raw) {
  if (!raw) throw new Error('Risposta vuota dal modello LLM')

  // Cerca il blocco JSON anche se il modello aggiunge testo prima/dopo
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    // Nessun '}' di chiusura → probabile output troncato: tenta una riparazione.
    const repaired = repairTruncatedJson(raw)
    if (repaired) {
      try { return JSON.parse(repaired) } catch { /* cade nell'errore sotto */ }
    }
    console.warn('[polizza] Risposta LLM senza JSON:', raw.slice(0, 300))
    throw new Error('Il modello LLM non ha restituito un JSON valido')
  }

  try {
    return JSON.parse(jsonMatch[0])
  } catch (_e) {
    // Prova a riparare il JSON (trailing commas, commenti)
    const cleaned = jsonMatch[0]
      .replace(/\/\/[^\n]*/g, '')   // rimuovi commenti //
      .replace(/,(\s*[}\]])/g, '$1') // rimuovi trailing commas
    try {
      return JSON.parse(cleaned)
    } catch (_e2) {
      // Ultimo tentativo: ribilancia un JSON eventualmente troncato dal limite token
      const repaired = repairTruncatedJson(raw)
      if (repaired) {
        try { return JSON.parse(repaired) } catch { /* niente */ }
      }
      console.warn('[polizza] JSON non parsabile:', cleaned.slice(0, 400))
      throw new Error(`JSON malformato dal LLM: ${_e2.message}`)
    }
  }
}

/**
 * Tenta di recuperare un oggetto JSON da output potenzialmente troncato
 * (modelli locali che esauriscono i token a metà risposta).
 * Trova il primo '{' e, scandendo graffe e stringhe, restituisce il più grande
 * prefisso bilanciato; se l'output è troncato chiude stringa/graffe aperte SENZA
 * inventare valori. Restituisce null se non c'è alcun '{'.
 */
function repairTruncatedJson(s) {
  if (typeof s !== 'string') return null
  const start = s.indexOf('{')
  if (start < 0) return null

  let depth = 0, inStr = false, esc = false, lastBalanced = -1
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
    } else if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) { lastBalanced = i; break } }
  }

  if (lastBalanced >= 0) return s.slice(start, lastBalanced + 1)

  // Troncato: chiudi stringa aperta, rimuovi coda penzolante, bilancia le graffe.
  let fixed = s.slice(start)
  if (inStr) fixed += '"'
  fixed = fixed
    .replace(/\\$/, '')                    // backslash penzolante
    .replace(/[,:]\s*$/, '')               // virgola/duepunti finali
    .replace(/,\s*"[^"]*"\s*$/, '')        // chiave senza valore in coda
    .replace(/,(\s*)$/, '$1')              // virgola finale
  fixed += '}'.repeat(Math.max(depth, 1))
  return fixed
}

// ─── Estrazione vision (PDF scansionati) ─────────────────────────────────────

/**
 * Estrae dati da polizza tramite Vision LLM su pagine rese come immagini.
 * Usato quando i PDF sono scansionati e non contengono testo selezionabile.
 *
 * @param {Array<{name:string, type:string, pages:string[]}>} imageFiles
 * @param {object} settings
 */
export async function extractPolizzaFromImages(imageFiles, settings) {
  const configuredFields = (settings.polizzaFields?.length > 0)
    ? settings.polizzaFields : ALL_POLIZZA_FIELDS
  const allFields = configuredFields.filter(f => f.enabled !== false)

  const TYPE_ORDER = ['polizza', 'appendice', 'allegato', 'cga']
  const sorted = [...imageFiles].sort((a, b) => {
    const ai = TYPE_ORDER.indexOf(a.type); const bi = TYPE_ORDER.indexOf(b.type)
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
  })

  // Budget pagine per tipo (troppo tante pagine = LLM lento o errore)
  const PAGE_BUDGET = { polizza: 5, appendice: 3, allegato: 2, cga: 1 }
  const pages = []
  for (const { type, pages: docPages } of sorted) {
    const budget = PAGE_BUDGET[type] || 2
    pages.push(...docPages.slice(0, budget))
    if (pages.length >= 10) break
  }

  console.log(`[polizza] Vision: ${pages.length} pagine da ${imageFiles.length} file, ${allFields.length} campi`)

  const result = await callVisionProvider(settings, allFields, pages)
  const found = Object.keys(result).filter(k => result[k])
  console.log(`[polizza] Vision: ${found.length} campi trovati:`, found)
  return result
}

async function callVisionProvider(settings, fields, pages) {
  const jsonTemplate = '{\n' + fields.map(f => `  "${f.id}": null`).join(',\n') + '\n}'

  const systemPrompt =
    'Sei un estrattore di dati da polizze assicurative italiane. ' +
    'Rispondi SEMPRE e SOLO con un oggetto JSON valido. ' +
    'Zero testo aggiuntivo, zero markdown, zero spiegazioni.'

  const userPrompt =
`Queste sono pagine di una polizza assicurativa RC italiana.
Leggi il testo nelle immagini ed estrai i valori nel JSON.
Sostituisci null con il valore trovato, lascia null se non presente.
Importi formato italiano (es. 3.000.000,00). Date: GG/MM/AAAA.
Rispondi SOLO con il JSON:

${jsonTemplate}`

  const provider = settings.llmProvider || 'ollama'
  let raw
  if (provider === 'openai') raw = await callOpenAIVision(settings, systemPrompt, userPrompt, pages)
  else if (provider === 'anthropic') raw = await callAnthropicVision(settings, systemPrompt, userPrompt, pages)
  else raw = await callOllamaVision(settings, systemPrompt, userPrompt, pages)

  return parseJsonResponse(raw)
}

async function callOllamaVision(settings, systemPrompt, userPrompt, pages) {
  const url = settings.ollamaUrl || 'http://127.0.0.1:11434'
  const model = settings.ollamaVisionModel || settings.ollamaModel
  if (!model) throw new Error('Nessun modello Ollama configurato. Imposta un modello vision (es. llava, minicpm-v) nelle impostazioni.')

  // Ollama: immagini come base64 senza il prefisso data:image/...
  const images = pages.map(p => p.replace(/^data:image\/[^;]+;base64,/, ''))

  const res = await fetch(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt, images }
      ],
      stream: false,
      format: 'json',
      options: { temperature: 0, num_ctx: 8192, num_predict: 3000 }
    }),
    signal: AbortSignal.timeout(300000)  // 5 min — vision è più lento
  })
  if (!res.ok) throw new Error(`Ollama vision error: ${res.status}`)
  const data = await res.json()
  return (data.message?.content || '').trim()
}

async function callOpenAIVision(settings, systemPrompt, userPrompt, pages) {
  const imageContent = pages.map(p => ({
    type: 'image_url',
    image_url: { url: p, detail: 'high' }
  }))

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.openaiApiKey}`
    },
    body: JSON.stringify({
      model: settings.openaiModel || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [{ type: 'text', text: userPrompt }, ...imageContent] }
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: 4096
    }),
    signal: AbortSignal.timeout(120000)
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`OpenAI vision error: ${res.status} ${err?.error?.message || ''}`)
  }
  const data = await res.json()
  return (data.choices?.[0]?.message?.content || '').trim()
}

async function callAnthropicVision(settings, systemPrompt, userPrompt, pages) {
  const imageContent = pages.map(p => {
    const mediaType = p.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'
    const base64 = p.replace(/^data:image\/[^;]+;base64,/, '')
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }
  })

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.anthropicApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: settings.anthropicModel || 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: [...imageContent, { type: 'text', text: userPrompt }] }]
    }),
    signal: AbortSignal.timeout(120000)
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Anthropic vision error: ${res.status} ${err?.error?.message || ''}`)
  }
  const data = await res.json()
  return (data.content?.[0]?.text || '').trim()
}

// ─── Rolling state extraction ─────────────────────────────────────────────────

/**
 * Async generator: itera le pagine di un PDF con pdfjs-dist restituendo il testo
 * di ogni pagina singolarmente. Carica il buffer UNA sola volta, poi elabora una
 * pagina per volta liberando le risorse dopo ogni pagina.
 *
 * @yields {{ text: string, pageNum: number, totalPages: number }}
 */
async function* iteratePdfjsPages(filePath) {
  const fileBuffer = await readFile(filePath)

  const pdfjsMod = await import('pdfjs-dist/legacy/build/pdf.js')
  const pdfjs = pdfjsMod.default || pdfjsMod
  if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = ''

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fileBuffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true
  }).promise

  const totalPages = doc.numPages

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const content = await page.getTextContent({ includeMarkedContent: false })

    let pageText = ''
    let prevX = null, prevY = null

    for (const item of content.items) {
      if (!('str' in item)) continue
      const x = item.transform[4], y = item.transform[5]

      if (prevY !== null) {
        const dy = Math.abs(y - prevY)
        const fontSize = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 10
        if (item.hasEOL || dy > fontSize * 0.4) {
          pageText += '\n'
          prevX = null
        } else if (prevX !== null) {
          const gap = x - prevX
          const charW = (item.width > 0 && item.str.length > 0)
            ? item.width / item.str.length
            : fontSize * 0.5
          if (gap > charW * 0.3) pageText += ' '
        }
      }

      pageText += item.str
      prevX = x + (item.width || item.str.length * ((Math.abs(item.transform[0]) || 10) * 0.5))
      prevY = y
    }

    page.cleanup()
    yield { text: pageText.trim(), pageNum, totalPages }
  }
}

/**
 * Inizializza lo stato rolling: un entry per ogni campo configurato,
 * tutti con valore null e data_validita null.
 */
function initRollingState(configuredFields) {
  const state = {}
  for (const f of configuredFields) {
    state[f.id] = { valore: null, data_validita: null }
  }
  return state
}

/**
 * Appiattisce lo stato rolling in { fieldId: valore } per compatibilità
 * con il resto del codice (export Excel, UI, ecc.).
 * Tollerante: accetta sia la forma annidata {valore, data_validita} sia un
 * valore scalare diretto (alcuni modelli locali restituiscono il valore "piatto").
 */
function flattenRollingState(state) {
  const flat = {}
  for (const [key, entry] of Object.entries(state || {})) {
    const val = coerceScalar(entry)
    if (val != null && val !== '') flat[key] = val
  }
  return flat
}

/**
 * Restituisce l'elenco dei campi polizza attivi a partire dalle impostazioni.
 */
function getActivePolizzaFields(settings) {
  const configured = (settings?.polizzaFields?.length > 0)
    ? settings.polizzaFields : ALL_POLIZZA_FIELDS
  return configured.filter(f => f.enabled !== false)
}

/**
 * Costruisce l'elenco "id: etichetta — descrizione" da mostrare al modello,
 * così sa COSA cercare per ogni campo (gli ID snake_case da soli non bastano).
 * Gli esempi "(es. ...)" vengono rimossi per non indurre il modello a copiarli.
 */
function buildFieldSchema(fields) {
  return fields.map(f => {
    const desc = (f.description || '')
      .replace(/\(\s*es\.[^)]*\)/gi, '')   // rimuove "(es. ...)" tra parentesi
      .replace(/[,;]\s*es\.\s.*$/i, '')    // rimuove ", es. ..." fino a fine descrizione
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,;])/g, '$1')
      .trim()
    return `- ${f.id}: ${f.label}${desc ? ` — ${desc}` : ''}`
  }).join('\n')
}

/**
 * Riduce un valore (scalare, annidato {valore}, array) a una stringa pulita.
 * Tollera tutte le forme che un modello locale può restituire.
 * @returns {string|null}
 */
function coerceScalar(val) {
  if (val == null) return null
  if (typeof val === 'string') {
    const t = val.trim()
    return (t === '' || t.toLowerCase() === 'null' || t === '-' || t === '—') ? null : t
  }
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : null
  if (typeof val === 'boolean') return null
  if (Array.isArray(val)) {
    const parts = val.map(coerceScalar).filter(Boolean)
    return parts.length ? parts.join(', ') : null
  }
  if (typeof val === 'object') {
    // Forma annidata {valore, data_validita} o varianti {value}
    if ('valore' in val) return coerceScalar(val.valore)
    if ('value' in val) return coerceScalar(val.value)
  }
  return null
}

/**
 * Converte una data italiana "GG/MM/AAAA" (anche con . o - come separatori,
 * e anno a 2 cifre) in un intero confrontabile AAAAMMGG, o null se non valida.
 */
function parseItalianDateToNum(str) {
  if (str == null) return null
  const m = String(str).match(/(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{2,4})/)
  if (!m) return null
  let d = parseInt(m[1], 10), mo = parseInt(m[2], 10), y = parseInt(m[3], 10)
  if (y < 100) y += 2000
  if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 1900 || y > 2100) return null
  return y * 10000 + mo * 100 + d
}

/**
 * Estrae la DATA DI EFFICACIA di un documento (una sola per file): decorrenza per
 * la polizza, "data di effetto / a decorrere dal" per appendici e allegati.
 * Le CGA sono trattate come SENZA data (boilerplate): possono solo riempire i vuoti.
 * @returns {{str:string, num:number}|null}
 */
function extractDocEffectiveDate(text, docType) {
  if (!text || docType === 'cga') return null

  const DATE = /(\d{1,2}\s*[/.\-]\s*\d{1,2}\s*[/.\-]\s*\d{2,4})/
  const byKeyword = new RegExp(
    '(?:effetto\\s+(?:dal|dalle)|con\\s+effetto|a\\s+(?:partire|decorrere)\\s+dal|' +
    'data\\s+(?:di\\s+)?effetto|data\\s+di\\s+decorrenza|\\bdecorrenza\\b)' +
    '[^\\n]{0,60}?' + DATE.source, 'i')
  const byDuration = new RegExp('\\bdalle\\s+ore\\b[^\\n]{0,40}?\\bdel\\s+' + DATE.source, 'i')

  // Per la polizza la decorrenza coincide con l'inizio durata ("dalle ore … del …");
  // per appendici/allegati conta la data di effetto/decorrenza esplicita.
  const order = docType === 'polizza' ? [byDuration, byKeyword] : [byKeyword, byDuration]
  for (const re of order) {
    const m = text.match(re)
    if (m) {
      const num = parseItalianDateToNum(m[1])
      if (num) return { str: m[1].replace(/\s+/g, ''), num }
    }
  }
  return null
}

/**
 * Estrae valore + eventuale data dichiarata dal modello per un singolo campo.
 * Accetta sia il valore piatto ("3.000.000,00") sia la forma annidata con data
 * ({valore|value, data|data_validita|data_efficacia|decorrenza}).
 * @returns {{value:string|null, date:string|null}}
 */
function extractValueAndDate(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const value = coerceScalar(raw.valore ?? raw.value ?? null)
    const d = raw.data ?? raw.data_validita ?? raw.data_efficacia ?? raw.decorrenza ?? null
    return { value, date: typeof d === 'string' ? d : null }
  }
  return { value: coerceScalar(raw), date: null }
}

/**
 * Decide se sovrascrivere un valore esistente con uno nuovo, in base alla data
 * di efficacia (AAAAMMGG) e, a parità, all'ordine di documento.
 * - entrambi senza data → primo vince (non sovrascrive)
 * - datato batte non-datato; non-datato non sovrascrive mai un datato
 * - tra due datati → vince la data più recente; a parità, il documento successivo
 */
function shouldOverride(curEff, curIdx, inEff, inIdx) {
  if (curEff == null && inEff == null) return false
  if (curEff == null) return true          // inEff != null
  if (inEff == null) return false          // curEff != null
  if (inEff > curEff) return true
  if (inEff < curEff) return false
  return inIdx > curIdx
}

/**
 * Unisce nello stato i campi trovati in un batch con logica DATE-AWARE "vince il più
 * recente", interamente lato JS (i modelli locali non devono mantenere stato).
 *
 * Per ogni campo la data di efficacia è quella per-campo dichiarata dal modello
 * (forma annidata {valore,data} o mappa opzionale found._date), altrimenti la data
 * del documento (ctx.docDate). Un campo già valorizzato viene sostituito solo se il
 * nuovo valore ha una data di efficacia più recente. Valori null/vuoti non cancellano
 * mai nulla; documenti senza data (es. CGA) possono solo riempire i campi vuoti.
 *
 * @param {object} state  stato rolling { id: {valore, data_validita, _eff, _docIdx} }
 * @param {object} found  risposta LLM { id: "valore" } o { id: {valore, data} } (+ _date opzionale)
 * @param {{docDate?:{str,num}|null, docIdx?:number}} ctx
 * @returns {object} stato aggiornato (nuovo oggetto)
 */
function mergeFoundFields(state, found, ctx = {}) {
  const merged = { ...state }
  if (!found || typeof found !== 'object') return merged

  const docNum = ctx.docDate?.num ?? null
  const docStr = ctx.docDate?.str ?? null
  const docIdx = typeof ctx.docIdx === 'number' ? ctx.docIdx : 0
  const dmap = (found._date && typeof found._date === 'object') ? found._date : {}

  for (const [key, raw] of Object.entries(found)) {
    if (key.startsWith('_')) continue   // chiavi meta (_date, _doc_date, …) non sono campi
    const { value, date: inlineDate } = extractValueAndDate(raw)
    if (value == null || value === '') continue

    const fieldDateStr = (typeof dmap[key] === 'string' ? dmap[key] : null) || inlineDate
    const fieldNum = parseItalianDateToNum(fieldDateStr)
    const effNum = fieldNum ?? docNum
    const effStr = fieldDateStr || docStr

    const cur = merged[key]
    const curVal = coerceScalar(cur)
    const isObj = cur && typeof cur === 'object'

    if (curVal == null || curVal === '') {
      merged[key] = { valore: value, data_validita: effStr, _eff: effNum, _docIdx: docIdx }
      continue
    }
    const curEff = isObj && typeof cur._eff === 'number' ? cur._eff : null
    const curIdx = isObj && typeof cur._docIdx === 'number' ? cur._docIdx : -1
    if (shouldOverride(curEff, curIdx, effNum, docIdx)) {
      merged[key] = { valore: value, data_validita: effStr, _eff: effNum, _docIdx: docIdx }
    }
  }
  return merged
}

/**
 * Prompt di sistema condiviso (testo e vision). Estrazione stateless di un singolo
 * batch: il modello riceve l'elenco dei campi + il testo e restituisce un JSON PIATTO
 * con i soli campi trovati. La logica di accumulo/merge è gestita lato JS in modo
 * deterministico (vedi mergeFoundFields), così i modelli locali non devono mantenere
 * uno stato complesso tra una chiamata e l'altra.
 */
const ROLLING_SYSTEM_PROMPT =
  'Sei un estrattore di dati da polizze assicurative italiane (Responsabilità Civile).\n' +
  'Ricevi un ELENCO DI CAMPI (con descrizione) e un TESTO estratto da una o più pagine.\n' +
  'Il tuo compito è trovare nel testo il valore di ciascun campo.\n\n' +
  'REGOLE TASSATIVE:\n' +
  '1. Estrai SOLO valori presenti ESPLICITAMENTE nel testo. NON inventare, NON dedurre.\n' +
  '2. Copia i valori ESATTAMENTE come scritti (importi formato italiano es. 3.000.000,00; date GG/MM/AAAA).\n' +
  '3. Includi nel JSON SOLO i campi di cui hai trovato il valore nel testo. Ometti tutti gli altri.\n' +
  '4. Usa ESATTAMENTE gli id campo forniti come chiavi JSON.\n' +
  '5. Formato NORMALE: piatto {"id_campo": "valore"}.\n' +
  '6. SOLO se accanto a un valore è indicata ESPLICITAMENTE una data di decorrenza/effetto/modifica\n' +
  '   propria di quel valore, usa per QUEL campo: {"id_campo": {"valore": "...", "data": "GG/MM/AAAA"}}.\n' +
  '   Negli altri casi resta piatto. Non inventare date.\n' +
  '7. Rispondi SEMPRE e SOLO con un unico oggetto JSON. Zero testo, zero markdown.'

/**
 * Variante Ollama ottimizzata per rolling: num_ctx 8192 (vs 65536 standard).
 * Ogni batch è piccolo → contesto ridotto → risparmio RAM massiccio su macchine 8-16 GB.
 */
async function callOllamaRolling(settings, systemPrompt, userPrompt) {
  const url = settings.ollamaUrl || 'http://127.0.0.1:11434'
  const res = await fetch(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.ollamaModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   }
      ],
      stream: false,
      format: 'json',
      options: {
        num_ctx:     8192,  // batch piccoli non richiedono contesto grande
        temperature: 0,
        num_predict: 3000   // abbastanza per lo stato completo
      }
    }),
    signal: AbortSignal.timeout(60000)  // 60s: batch piccoli = risposte veloci
  })
  if (!res.ok) throw new Error(`Ollama rolling error: ${res.status}`)
  const data = await res.json()
  return (data.message?.content || '').trim()
}

async function callOllamaVisionRolling(settings, systemPrompt, userPrompt, base64Image) {
  const url = settings.ollamaUrl || 'http://127.0.0.1:11434'
  const model = settings.ollamaVisionModel || settings.ollamaModel
  if (!model) throw new Error('Nessun modello vision Ollama configurato.')

  const res = await fetch(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt, images: [base64Image] }
      ],
      stream: false,
      format: 'json',
      options: {
        num_ctx:     8192,
        temperature: 0,
        num_predict: 3000
      }
    }),
    signal: AbortSignal.timeout(120000)  // vision è più lento
  })
  if (!res.ok) throw new Error(`Ollama vision rolling error: ${res.status}`)
  const data = await res.json()
  return (data.message?.content || '').trim()
}

/**
 * Estrae i campi presenti in un batch di testo (fino a 3 pagine + coda precedente).
 * Chiamata STATELESS: al modello non viene passato alcuno stato, solo l'elenco campi
 * e il testo. Restituisce un oggetto PIATTO { id: "valore" } con i soli campi trovati.
 * Su errore/JSON non valido restituisce {} (nessun campo) senza intaccare lo stato.
 */
async function extractBatchFieldsText(settings, fields, docType, batchText) {
  const userPrompt =
`CAMPI DA ESTRARRE:
${buildFieldSchema(fields)}

TIPO DOCUMENTO: ${docType}

TESTO:
${batchText}

Restituisci il JSON piatto dei soli campi trovati:`

  const provider = settings.llmProvider || 'ollama'

  try {
    let raw
    if (provider === 'openai') {
      raw = await callOpenAI(settings, ROLLING_SYSTEM_PROMPT, userPrompt)
    } else if (provider === 'anthropic') {
      raw = await callAnthropic(settings, ROLLING_SYSTEM_PROMPT, userPrompt)
    } else {
      raw = await callOllamaRolling(settings, ROLLING_SYSTEM_PROMPT, userPrompt)
    }
    return parseJsonResponse(raw)
  } catch (err) {
    console.warn('[polizza:rolling] Batch ignorato per errore LLM:', err.message)
    return {}
  }
}

/**
 * Estrae i campi presenti in una singola immagine di pagina (PDF scansionato).
 * Chiamata STATELESS come la variante testo: restituisce un oggetto PIATTO
 * { id: "valore" } con i soli campi trovati, {} su errore.
 */
async function extractBatchFieldsVision(settings, fields, docType, imageBase64, pageNum, totalPages) {
  const userPrompt =
`CAMPI DA ESTRARRE:
${buildFieldSchema(fields)}

TIPO DOCUMENTO: ${docType} — Pagina ${pageNum}/${totalPages}

Leggi il testo nell'immagine e restituisci il JSON piatto dei soli campi trovati.
Se nell'immagine è indicata la data di decorrenza/effetto del documento, aggiungi "_doc_date": "GG/MM/AAAA".`

  const provider = settings.llmProvider || 'ollama'
  let raw

  try {
    if (provider === 'openai') {
      const imageContent = [{ type: 'image_url', image_url: { url: imageBase64, detail: 'high' } }]
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.openaiApiKey}` },
        body: JSON.stringify({
          model: settings.openaiModel || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: ROLLING_SYSTEM_PROMPT },
            { role: 'user', content: [{ type: 'text', text: userPrompt }, ...imageContent] }
          ],
          temperature: 0,
          response_format: { type: 'json_object' },
          max_tokens: 4096
        }),
        signal: AbortSignal.timeout(90000)
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(`OpenAI vision: ${res.status} ${e?.error?.message || ''}`) }
      raw = ((await res.json()).choices?.[0]?.message?.content || '').trim()
    } else if (provider === 'anthropic') {
      const mediaType = imageBase64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'
      const base64Data = imageBase64.replace(/^data:image\/[^;]+;base64,/, '')
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': settings.anthropicApiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: settings.anthropicModel || 'claude-haiku-4-5-20251001',
          max_tokens: 4096,
          system: ROLLING_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
            { type: 'text', text: userPrompt }
          ]}]
        }),
        signal: AbortSignal.timeout(90000)
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(`Anthropic vision: ${res.status} ${e?.error?.message || ''}`) }
      raw = ((await res.json()).content?.[0]?.text || '').trim()
    } else {
      const base64Data = imageBase64.replace(/^data:image\/[^;]+;base64,/, '')
      raw = await callOllamaVisionRolling(settings, ROLLING_SYSTEM_PROMPT, userPrompt, base64Data)
    }

    return parseJsonResponse(raw)
  } catch (err) {
    console.warn('[polizza:rolling] Pagina vision ignorata per errore LLM:', err.message)
    return {}
  }
}

/**
 * Estrazione polizza in modalità rolling state.
 *
 * Processa i documenti uno alla volta nell'ordine corretto (polizza → appendice →
 * allegato → CGA), ogni documento pagina per pagina in batch da 3 + coda di 300 chars.
 * Ogni chiamata LLM è STATELESS (riceve solo elenco campi + testo del batch) e
 * restituisce i soli campi trovati; l'accumulo avviene lato JS con mergeFoundFields
 * (primo valore non vuoto vince, secondo l'ordine di processamento dei documenti).
 *
 * @param {Array<string|{path,type}>} files
 * @param {object} settings
 * @param {Function|null} onProgress  callback({ docIndex, docTotal, pageIndex, pageTotal, docName, state })
 * @returns {{ data, scannedFiles, sources, rollingState }}
 */
export async function extractPolizzaRolling(files, settings, onProgress = null) {
  const activeFields = getActivePolizzaFields(settings)

  const TYPE_ORDER = ['polizza', 'appendice', 'allegato', 'cga']
  const BATCH_SIZE = 3

  const normalizedFiles = (files || []).map(f =>
    typeof f === 'string' ? { path: f, type: 'polizza' } : f
  ).sort((a, b) => {
    const ai = TYPE_ORDER.indexOf(a.type)
    const bi = TYPE_ORDER.indexOf(b.type)
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
  })

  let state = initRollingState(activeFields)
  const scannedFiles = []
  let totalPagesProcessed = 0

  const notify = (extra) => onProgress?.({ state, totalPagesProcessed, ...extra })

  for (let docIdx = 0; docIdx < normalizedFiles.length; docIdx++) {
    const { path: filePath, type: docType } = normalizedFiles[docIdx]
    const docName = filePath.split(/[\\/]/).pop()

    console.log(`[polizza:rolling] ${docIdx + 1}/${normalizedFiles.length}: ${docName} [${docType}]`)
    notify({ docIndex: docIdx, docTotal: normalizedFiles.length, pageIndex: 0, pageTotal: 0, docName })

    // Tentativo 1: pdftotext (subprocess, non carica nulla in JS memory)
    const pdftotextText = extractTextWithPdftotext(filePath)

    if (pdftotextText) {
      const pages = pdftotextText.split('\f').map(p => p.trim()).filter(p => p.length > 0)
      const totalPages = pages.length
      let tail = ''

      // Data di efficacia del documento (per il merge date-aware): è sulle prime pagine.
      const docDate = extractDocEffectiveDate(pages.slice(0, 3).join('\n'), docType)
      if (docDate) console.log(`[polizza:rolling]   data efficacia doc: ${docDate.str}`)

      for (let i = 0; i < pages.length; i += BATCH_SIZE) {
        const batch = pages.slice(i, i + BATCH_SIZE)
        const batchText = tail ? `${tail}\n---\n${batch.join('\n---\n')}` : batch.join('\n---\n')
        tail = batch[batch.length - 1].slice(-300)

        const pageEnd = Math.min(i + BATCH_SIZE, totalPages)
        totalPagesProcessed += batch.length
        notify({ docIndex: docIdx, docTotal: normalizedFiles.length, pageIndex: pageEnd, pageTotal: totalPages, docName })

        const found = await extractBatchFieldsText(settings, activeFields, docType, batchText)
        state = mergeFoundFields(state, found, { docDate, docIdx })
        console.log(`[polizza:rolling]   pg ${i + 1}-${pageEnd}/${totalPages} → +${Object.keys(found || {}).length} campi nel batch`)
      }
      continue
    }

    // Tentativo 2: pdfjs pagina per pagina (async generator)
    let hasText = false
    let pageBatch = []
    let tail = ''
    let docDate = null   // calcolata dal primo batch (la data è sulle prime pagine)

    try {
      for await (const { text, pageNum, totalPages } of iteratePdfjsPages(filePath)) {
        if (text.length > 5) {
          hasText = true
          pageBatch.push(text)

          if (pageBatch.length === BATCH_SIZE || pageNum === totalPages) {
            const batchText = tail ? `${tail}\n---\n${pageBatch.join('\n---\n')}` : pageBatch.join('\n---\n')
            tail = pageBatch[pageBatch.length - 1].slice(-300)

            // Finché non trovata, cerca la data di efficacia nelle prime pagine
            // (robusto a pagine iniziali vuote/cover che vengono saltate).
            if (docDate === null) {
              docDate = extractDocEffectiveDate(batchText, docType)
              if (docDate) console.log(`[polizza:rolling]   data efficacia doc: ${docDate.str}`)
            }

            totalPagesProcessed += pageBatch.length
            notify({ docIndex: docIdx, docTotal: normalizedFiles.length, pageIndex: pageNum, pageTotal: totalPages, docName })

            const found = await extractBatchFieldsText(settings, activeFields, docType, batchText)
            state = mergeFoundFields(state, found, { docDate, docIdx })
            console.log(`[polizza:rolling]   pg ${pageNum - pageBatch.length + 1}-${pageNum}/${totalPages} → +${Object.keys(found || {}).length} campi nel batch`)
            pageBatch = []
          }
        }
      }
    } catch (err) {
      console.warn(`[polizza:rolling] pdfjs error su ${docName}:`, err.message)
    }

    if (!hasText) {
      // PDF scansionato: nessun testo estraibile, gestione vision dal frontend
      console.log(`[polizza:rolling] ${docName}: scansionato → vision`)
      scannedFiles.push({ path: filePath, type: docType })
    }
  }

  const data = flattenRollingState(state)
  console.log(`[polizza:rolling] Completato: ${Object.keys(data).length} campi estratti`,
    Object.keys(data).length ? Object.keys(data).join(', ') : '(nessuno)')

  return { data, scannedFiles, sources: {}, rollingState: state }
}

/**
 * Aggiorna lo stato rolling con una singola pagina vision (base64).
 * Chiamato dal frontend per i PDF scansionati, pagina per pagina.
 *
 * @param {object} state           stato rolling corrente (con {valore, data_validita})
 * @param {string} imageBase64     immagine della pagina in formato data:image/...;base64,...
 * @param {string} docType         'polizza'|'appendice'|'allegato'|'cga'
 * @param {number} pageNum         pagina corrente (1-based)
 * @param {number} totalPages      totale pagine del documento
 * @param {object} settings
 * @returns {object} stato aggiornato
 */
export async function updateStateWithVisionPage(state, imageBase64, docType, pageNum, totalPages, settings) {
  const activeFields = getActivePolizzaFields(settings)
  // Se lo stato arriva "piatto" o vuoto dal frontend, garantiamo comunque le chiavi attese.
  const baseState = (state && Object.keys(state).length) ? state : initRollingState(activeFields)
  const found = await extractBatchFieldsVision(settings, activeFields, docType, imageBase64, pageNum, totalPages)

  // Data efficacia: la CGA resta senza data; per gli altri si usa l'eventuale
  // _doc_date riconosciuta dal modello. I doc scansionati sono concettualmente
  // successivi a quelli testuali → docIdx alto, così a parità di data prevalgono.
  const docDate = docType === 'cga' ? null
    : (parseItalianDateToNum(found?._doc_date) ? { str: String(found._doc_date), num: parseItalianDateToNum(found._doc_date) } : null)
  return mergeFoundFields(baseState, found, { docDate, docIdx: 1000 })
}

// ─── Utilità ExcelJS ──────────────────────────────────────────────────────────

/**
 * Restituisce il valore display di una cella ExcelJS come stringa leggibile.
 * Gestisce numeri, date, formule con risultato, richText e placeholder vuoti.
 */
function getCellDisplayValue(cell) {
  if (!cell) return ''
  const v = cell.value
  if (v == null) return ''
  if (v instanceof Date) {
    const d = v.getDate(), m = v.getMonth() + 1, y = v.getFullYear()
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
  }
  if (typeof v === 'object') {
    if (v.formula !== undefined || v.sharedFormula !== undefined) return v.result != null ? String(v.result) : ''
    if (Array.isArray(v.richText)) return v.richText.map(rt => rt.text || '').join('')
  }
  if (typeof v === 'number' && v === 0) return ''
  if (typeof v === 'string' && v.trim() === '……….') return ''
  return String(v)
}

// ─── Export Excel (nuovo file) ────────────────────────────────────────────────

/**
 * Crea un nuovo file Excel con due fogli: RCT_O e RCP.
 * @param {string} filePath - percorso di destinazione
 * @param {object} data - dati estratti (chiavi = id campi)
 * @param {Array|null} [fieldsConfig] - configurazione campi opzionale (default: RCT_FIELDS + RCP_FIELDS)
 */
export async function exportToNewExcel(filePath, data, fieldsConfig = null) {
  const { default: ExcelJS } = await import('exceljs')

  const fields = fieldsConfig || [...RCT_FIELDS, ...RCP_FIELDS]
  const wb = new ExcelJS.Workbook()

  const sheetNames = [...new Set(fields.map(f => f.sheet).filter(Boolean))]
  if (sheetNames.length === 0) sheetNames.push('RCT_O', 'RCP')

  for (const sheetName of sheetNames) {
    const ws = wb.addWorksheet(sheetName)
    ws.columns = [
      { header: 'Campo',  key: 'campo',  width: 45 },
      { header: 'Valore', key: 'valore', width: 55 }
    ]
    for (const f of fields.filter(f => f.sheet === sheetName)) {
      ws.addRow({ campo: f.label, valore: data[f.id] ?? '' })
    }
  }

  await wb.xlsx.writeFile(filePath)
}

// ─── Export su template Excel esistente ──────────────────────────────────────

/**
 * Popola un Excel template esistente con i dati estratti usando il mapping CSA predefinito.
 * Se viene fornito un mapping personalizzato (dall'UI), lo usa al posto di quello predefinito.
 *
 * @param {string} templatePath - percorso del template Excel da leggere
 * @param {string} outputPath   - percorso del file Excel da salvare
 * @param {object} data         - dati estratti (chiavi = field id)
 * @param {object} [userMapping] - { fieldId: { sheet, cell } } — mapping personalizzato (opzionale)
 * @param {Array|null} [fieldsConfig] - configurazione campi opzionale
 */
export async function exportToTemplateExcel(templatePath, outputPath, data, userMapping = {}, fieldsConfig = null) {
  const { default: ExcelJS } = await import('exceljs')

  const templateBuf = readFileSync(templatePath)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(templateBuf)

  const hasUserMapping = Object.keys(userMapping).some(k => userMapping[k]?.sheet && userMapping[k]?.cell)

  if (hasUserMapping) {
    for (const [fieldId, target] of Object.entries(userMapping)) {
      if (!target?.sheet || !target?.cell) continue
      const value = data[fieldId]
      if (value == null) continue
      const ws = wb.getWorksheet(target.sheet)
      if (!ws) continue
      const numVal = parseItalianNumber(String(value))
      ws.getCell(target.cell).value = numVal !== null ? numVal : String(value)
    }
  } else {
    const mapping = fieldsConfig ? buildMappingFromFields(fieldsConfig) : CSA_MAPPING
    for (const [fieldId, targets] of Object.entries(mapping)) {
      if (!Array.isArray(targets) || targets.length === 0) continue
      const value = data[fieldId]
      if (value == null || value === '') continue
      const numVal = parseItalianNumber(String(value))
      for (const target of targets) {
        const ws = wb.getWorksheet(target.sheet)
        if (!ws) continue
        ws.getCell(target.cell).value = numVal !== null ? numVal : String(value)
      }
    }
  }

  await wb.xlsx.writeFile(outputPath)
}

/**
 * Converte un valore in numero quando opportuno (es. "1.500,00" → 1500).
 * Lascia come stringa: date, codici fiscali/P.IVA, testi con lettere.
 * @returns {number|null} - null se non è un numero monetario/percentuale
 */
function parseItalianNumber(val) {
  if (typeof val !== 'string') return null
  const trimmed = val.trim()

  // Non convertire: date (GG/MM/AAAA), P.IVA/CF (contengono lettere o iniziano per 0+cifre),
  // valori con '/' (date), valori alfanumerici
  if (/\//.test(trimmed)) return null               // date tipo 31/12/2021
  if (/[a-zA-Z]/.test(trimmed)) return null         // testi con lettere
  if (/^0\d/.test(trimmed)) return null             // inizia con 0 (CF, P.IVA, numeri polizza)

  // Formato italiano: migliaia con punto, decimali con virgola → es. "3.000.000,00"
  // oppure solo con virgola → es. "2,450"
  const hasDotThousands = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(trimmed)
  const hasCommaDecimal  = /^\d+(,\d+)$/.test(trimmed)

  if (!hasDotThousands && !hasCommaDecimal) return null

  const cleaned = trimmed.replace(/\./g, '').replace(',', '.')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

/**
 * Legge i fogli e le celle occupate di un Excel template per mostrare
 * all'utente dove mappare i campi.
 */
export async function readExcelStructure(templatePath) {
  const { default: ExcelJS } = await import('exceljs')

  const buf = readFileSync(templatePath)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)

  const structure = {}
  for (const ws of wb.worksheets) {
    const cells = []
    const rowLimit = Math.min(ws.rowCount, 50)
    const colLimit = Math.min(ws.columnCount, 26)
    for (let r = 1; r <= rowLimit; r++) {
      for (let c = 1; c <= colLimit; c++) {
        const cell = ws.getCell(r, c)
        const v = getCellDisplayValue(cell)
        if (v) cells.push({ addr: cell.address, value: v.slice(0, 60) })
      }
    }
    structure[ws.name] = cells
  }
  return structure
}

// ─── Preview modifiche (vecchio → nuovo) prima dell'export ───────────────────

/**
 * Legge i valori correnti del template nelle celle target e li confronta con
 * i nuovi valori estratti. Restituisce un array di diff per la review.
 *
 * @param {string} templatePath
 * @param {object} data          - dati estratti { fieldId: newValue }
 * @param {object} userMapping   - mapping personalizzato (vuoto = usa CSA predefinito)
 * @param {Array|null} [fieldsConfig] - configurazione campi opzionale
 * @returns {Array<{fieldId, label, sheet, cell, oldValue, newValue, type}>}
 */
export async function previewTemplateChanges(templatePath, data, userMapping = {}, fieldsConfig = null) {
  const { default: ExcelJS } = await import('exceljs')

  const buf = readFileSync(templatePath)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)

  const hasUserMapping = Object.keys(userMapping).some(k => userMapping[k]?.sheet && userMapping[k]?.cell)
  const changes = []
  const seen = new Set()

  const allFields = fieldsConfig || ALL_POLIZZA_FIELDS
  const fieldMeta = {}
  for (const f of allFields) { fieldMeta[f.id] = f }

  const defaultMapping = fieldsConfig ? buildMappingFromFields(fieldsConfig) : CSA_MAPPING

  if (hasUserMapping) {
    for (const [fieldId, target] of Object.entries(userMapping)) {
      if (!target?.sheet || !target?.cell) continue
      const newValue = data[fieldId]
      if (newValue == null || newValue === '') continue
      const ws = wb.getWorksheet(target.sheet)
      const oldValue = ws ? getCellDisplayValue(ws.getCell(target.cell)) : ''
      const key = `${target.sheet}!${target.cell}`
      if (seen.has(key)) continue
      seen.add(key)
      changes.push({
        fieldId,
        label: fieldMeta[fieldId]?.label ?? fieldId,
        sheet: target.sheet,
        cell: target.cell,
        oldValue,
        newValue: String(newValue)
      })
    }
  } else {
    for (const [fieldId, targets] of Object.entries(defaultMapping)) {
      if (!Array.isArray(targets) || targets.length === 0) continue
      const newValue = data[fieldId]
      if (newValue == null || newValue === '') continue
      for (const target of targets) {
        const key = `${target.sheet}!${target.cell}`
        if (seen.has(key)) continue
        seen.add(key)
        const ws = wb.getWorksheet(target.sheet)
        const oldValue = ws ? getCellDisplayValue(ws.getCell(target.cell)) : ''
        changes.push({
          fieldId,
          label: fieldMeta[fieldId]?.label ?? fieldId,
          sheet: target.sheet,
          cell: target.cell,
          oldValue,
          newValue: String(newValue)
        })
      }
    }
  }

  return changes
}

// ─── Mapping dinamico da configurazione campi ─────────────────────────────────

/**
 * Costruisce il mapping fieldId → [{sheet, cell}] a partire dall'array di fields configurato.
 * Equivalente dinamico di CSA_MAPPING.
 */
export function buildMappingFromFields(fields) {
  const mapping = {}
  for (const f of fields) {
    mapping[f.id] = Array.isArray(f.cells) ? f.cells : []
  }
  return mapping
}

// ─── Export selettivo (solo campi approvati) ──────────────────────────────────

/**
 * Scrive nel template solo le modifiche approvate dall'utente.
 *
 * @param {string} templatePath
 * @param {string} outputPath
 * @param {Array<{sheet, cell, newValue}>} approvedChanges
 */
export async function exportApprovedChanges(templatePath, outputPath, approvedChanges) {
  const { default: ExcelJS } = await import('exceljs')

  const templateBuf = readFileSync(templatePath)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(templateBuf)

  for (const change of approvedChanges) {
    const ws = wb.getWorksheet(change.sheet)
    if (!ws) continue
    const numVal = parseItalianNumber(change.newValue)
    ws.getCell(change.cell).value = numVal !== null ? numVal : String(change.newValue)
  }

  await wb.xlsx.writeFile(outputPath)
}
