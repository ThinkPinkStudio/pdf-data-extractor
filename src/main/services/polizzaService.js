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

import { readFileSync, writeFileSync } from 'fs'
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
  { id: 'rcp_massimale_mat',        label: 'Massimale danni materiali (RCP)',     sheet: 'RCP', description: 'Massimale RC Prodotti per danni materiali (compresi gli animali), es. 500.000,00', type: 'text' },
  { id: 'rcp_massimale_interr',     label: 'Massimale interruzione attività (RCP)', sheet: 'RCP', description: 'Massimale RC Prodotti per danni da interruzione o sospensione di attività, es. 5.000.000,00', type: 'text' },
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
      const text = execSync(cmd, { encoding: 'utf8', timeout: 30000, maxBuffer: 20 * 1024 * 1024 })
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

    const fullText = pageTexts.join('\n\n').trim()
    return fullText.length > 20 ? fullText : null
  } catch (err) {
    console.warn('[polizza] pdfjs extraction failed:', err.message)
    return null
  }
}

/**
 * Filtra le sezioni più rilevanti del testo per limitare i token inviati al LLM.
 * Con pdftotext il testo è già leggibile — manteniamo più contesto per ogni match.
 */
function extractRelevantSections(text, maxChars = 18000) {
  if (text.length <= maxChars) return text

  const KEYWORDS = [
    'POLIZZA N', 'CONTRAENTE', 'ASSICURATO', 'P. IVA', 'COD. FISC',
    'DECORRENZA', 'SCADENZA', 'DOMICILIO', 'INDIRIZZO',
    'MASSIMALE', 'PER SINISTRO', 'PER PERSONA', 'PER ANIMALI',
    'GARANZIA', 'SEZIONE R.C', 'R.C. VS', 'R.C. PRODOTTI',
    'RESPONSABILIT', 'TERZI', 'PRODOTTI', 'PRESTATORI',
    'PREMIO', 'IMPONIBILE', 'IMPOSTA', 'ANTICIPO DI SEZIONE',
    'TASSO', 'PARAMETRO', 'RETRIBUZION', 'SALARI', 'FATTURATO',
    'SCOPERTO', 'FRANCHIGIA', 'AGENZIA', 'PRODUTTORE',
    'ELEMENTI PER IL CONTEGGIO', 'REGOLAZIONE DEL PREMIO',
    'DESCRIZIONE DELL', 'ATTIVIT',
    'GENERALI', 'ALLIANZ', 'ZURICH', 'AXA', 'SARA', 'UNIPOL', 'CATTOLICA',
    'GENERAIMPRESA', 'GENERACOMMERCI'
  ]

  const lines = text.split('\n')
  const included = new Set()

  for (let i = 0; i < lines.length; i++) {
    const upper = lines[i].toUpperCase()
    if (KEYWORDS.some(kw => upper.includes(kw))) {
      // 4 righe di contesto prima e dopo (pdftotext produce testo più denso di informazioni)
      for (let j = Math.max(0, i - 4); j <= Math.min(lines.length - 1, i + 6); j++) {
        included.add(j)
      }
    }
  }

  const selected = [...included].sort((a, b) => a - b).map(i => lines[i]).join('\n')
  return (selected.length > 0 ? selected : text).slice(0, maxChars)
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
 * Estrae tutti i dati assicurativi da un set di PDF di polizza RC.
 * Strategia: pdftotext → regex (alta affidabilità) + LLM (campi liberi).
 */
export async function extractPolizzaFromPDFs(filePaths, settings) {
  // 1. Estrai testo da tutti i PDF con pdftotext, fallback pdf-parse
  const allTexts = []

  for (const fp of filePaths) {
    let text = extractTextWithPdftotext(fp)

    if (text) {
      console.log(`[polizza] pdftotext OK: ${fp.split('/').pop()} (${text.length} chars)`)
    } else {
      // Fallback 1: pdfjs spatial reconstruction (puro JS, nessuna dipendenza nativa)
      text = await extractTextWithPdfjsSpatial(fp)
      if (text) {
        console.log(`[polizza] pdfjs-spatial: ${fp.split('/').pop()} (${text.length} chars)`)
      } else {
        // Fallback 2: pdf-parse generico
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
      allTexts.push({ path: fp, text })
    }
  }

  if (allTexts.length === 0) {
    throw new Error(
      'Nessun testo estratto dai PDF. ' +
      'Verifica che i file siano PDF con testo selezionabile (non immagini scansionate).'
    )
  }

  // 2. Combina tutti i testi
  const combinedText = allTexts
    .map(({ path, text }) => `=== ${path.split('/').pop()} ===\n${text}`)
    .join('\n\n')

  // 3. Estrazione rapida con regex (alta affidabilità)
  const regexResult = extractFieldsWithRegex(combinedText)
  const regexFound = Object.keys(regexResult).filter(k => regexResult[k])
  console.log(`[polizza] Regex: ${regexFound.length} campi trovati:`, regexFound)

  // 4. Chiedi al LLM i campi ancora mancanti
  const allFields = ALL_POLIZZA_FIELDS.map(f => ({ ...f, enabled: true }))
  const missingFields = allFields.filter(f => !regexResult[f.id])

  let llmResult = {}
  if (missingFields.length > 0 && settings.llmProvider !== 'none') {
    // Aumenta il limite per sfruttare la qualità del testo pdftotext
    const relevantText = extractRelevantSections(combinedText, 18000)
    console.log(
      `[polizza] LLM: ${missingFields.length} campi da estrarre, ` +
      `${relevantText.length} chars testo rilevante`
    )
    try {
      llmResult = await extractPolizzaWithProvider(settings, missingFields, relevantText)
      const llmFound = Object.keys(llmResult).filter(k => llmResult[k])
      console.log(`[polizza] LLM: ${llmFound.length} campi trovati:`, llmFound)
    } catch (err) {
      console.warn('[polizza] Errore LLM (non fatale):', err.message)
    }
  }

  // 5. Merge: regex ha priorità, LLM completa il resto
  return { ...llmResult, ...regexResult }
}

// ─── Prompt specializzato per polizze RC ─────────────────────────────────────

async function extractPolizzaWithProvider(settings, fields, contextText) {
  if (fields.length === 0) return {}

  const provider = settings.llmProvider || 'ollama'

  // Template JSON vuoto che il modello deve riempire
  // Molto più semplice per i modelli locali rispetto a liste descrittive
  const jsonTemplate = '{\n' + fields.map(f => `  "${f.id}": null`).join(',\n') + '\n}'

  // Guida concisa ai campi (usata solo nei prompt cloud dove c'è più contesto)
  const fieldGuide = fields
    .map(f => `${f.id}: ${f.label} (es. ${f.description.match(/es\.\s*[^)]+/)?.[0] || f.description.slice(0, 60)})`)
    .join('\n')

  const systemPrompt =
    'Sei un estrattore di dati da polizze assicurative italiane. ' +
    'Rispondi SEMPRE e SOLO con un oggetto JSON valido. ' +
    'Zero testo aggiuntivo, zero markdown, zero spiegazioni.'

  // Prompt ottimizzato per Ollama: testo prima, template JSON dopo
  // Il modello deve solo sostituire i "null" con i valori trovati
  const ollamaPrompt =
`DOCUMENTO ASSICURATIVO:
${contextText}

Leggi il documento e compila il JSON seguente.
Sostituisci null con il valore trovato nel documento, lascia null se non presente.
Rispondi SOLO con il JSON compilato:

${jsonTemplate}`

  // Prompt più ricco per i provider cloud (maggiore capacità)
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
- null se il campo non è nel documento

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
        num_ctx:     32768,    // finestra di contesto ampliata
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
    } catch (e2) {
      console.warn('[polizza] JSON non parsabile:', cleaned.slice(0, 400))
      throw new Error(`JSON malformato dal LLM: ${e2.message}`)
    }
  }
}

// ─── Export Excel (nuovo file) ────────────────────────────────────────────────

/**
 * Crea un nuovo file Excel con due fogli: RCT_O e RCP.
 * @param {string} filePath - percorso di destinazione
 * @param {object} data - dati estratti (chiavi = id campi)
 */
export async function exportToNewExcel(filePath, data) {
  const XLSX = await import('xlsx')

  // Foglio RCT_O
  const rctRows = RCT_FIELDS.map(f => ({
    'Campo': f.label,
    'Valore': data[f.id] ?? ''
  }))

  // Foglio RCP
  const rcpRows = RCP_FIELDS.map(f => ({
    'Campo': f.label,
    'Valore': data[f.id] ?? ''
  }))

  // Dati comuni nell'header di entrambi i fogli
  const commonHeader = [
    { 'Campo': 'N° Polizza', 'Valore': data.polizza_numero ?? '' },
    { 'Campo': 'Contraente',  'Valore': data.contraente ?? '' },
    { 'Campo': 'Decorrenza',  'Valore': data.decorrenza ?? '' },
    { 'Campo': 'Scadenza',    'Valore': data.scadenza ?? '' },
    { 'Campo': '',            'Valore': '' }
  ]

  const wsRCT = XLSX.utils.json_to_sheet([...commonHeader, ...rctRows])
  const wsRCP = XLSX.utils.json_to_sheet([...commonHeader, ...rcpRows])

  // Larghezze colonne
  const colWidths = [{ wch: 45 }, { wch: 55 }]
  wsRCT['!cols'] = colWidths
  wsRCP['!cols'] = colWidths

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wsRCT, 'RCT_O')
  XLSX.utils.book_append_sheet(wb, wsRCP, 'RCP')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  writeFileSync(filePath, buf)
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
 */
export async function exportToTemplateExcel(templatePath, outputPath, data, userMapping = {}) {
  const XLSX = await import('xlsx')

  const templateBuf = readFileSync(templatePath)
  const wb = XLSX.read(templateBuf, { type: 'buffer' })

  // Decide se usare il mapping CSA predefinito o quello custom dell'utente
  const hasUserMapping = Object.keys(userMapping).some(k => userMapping[k]?.sheet && userMapping[k]?.cell)

  if (hasUserMapping) {
    // Mapping manuale (cella singola per campo)
    for (const [fieldId, target] of Object.entries(userMapping)) {
      if (!target?.sheet || !target?.cell) continue
      const value = data[fieldId]
      if (value == null) continue
      const ws = wb.Sheets[target.sheet]
      if (!ws) continue
      ws[target.cell] = { t: 's', v: String(value) }
    }
  } else {
    // Mapping predefinito CSA (multi-cella per campo)
    for (const [fieldId, targets] of Object.entries(CSA_MAPPING)) {
      if (!Array.isArray(targets) || targets.length === 0) continue
      const value = data[fieldId]
      if (value == null || value === '') continue
      for (const target of targets) {
        const ws = wb.Sheets[target.sheet]
        if (!ws) continue
        // Determina il tipo di cella: numeri se possibile (per le formule)
        const numVal = parseItalianNumber(value)
        if (numVal !== null) {
          ws[target.cell] = { t: 'n', v: numVal }
        } else {
          ws[target.cell] = { t: 's', v: String(value) }
        }
      }
    }
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  writeFileSync(outputPath, buf)
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
  const XLSX = await import('xlsx')
  const buf = readFileSync(templatePath)
  const wb = XLSX.read(buf, { type: 'buffer' })

  const structure = {}
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const ref = ws['!ref']
    if (!ref) continue
    const range = XLSX.utils.decode_range(ref)
    const cells = []
    for (let r = range.s.r; r <= Math.min(range.e.r, 49); r++) {
      for (let c = range.s.c; c <= Math.min(range.e.c, 25); c++) {
        const addr = XLSX.utils.encode_cell({ r, c })
        const cell = ws[addr]
        if (cell && cell.v !== undefined && cell.v !== '') {
          cells.push({ addr, value: String(cell.v).slice(0, 60) })
        }
      }
    }
    structure[sheetName] = cells
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
 * @returns {Array<{fieldId, label, sheet, cell, oldValue, newValue, type}>}
 */
export async function previewTemplateChanges(templatePath, data, userMapping = {}) {
  const XLSX = await import('xlsx')
  const buf = readFileSync(templatePath)
  const wb = XLSX.read(buf, { type: 'buffer' })

  const hasUserMapping = Object.keys(userMapping).some(k => userMapping[k]?.sheet && userMapping[k]?.cell)
  const changes = []
  const seen = new Set() // evita duplicati (stesso field → stessa cella)

  const fieldMeta = {}
  for (const f of ALL_POLIZZA_FIELDS) {
    fieldMeta[f.id] = f
  }

  if (hasUserMapping) {
    for (const [fieldId, target] of Object.entries(userMapping)) {
      if (!target?.sheet || !target?.cell) continue
      const newValue = data[fieldId]
      if (newValue == null || newValue === '') continue
      const ws = wb.Sheets[target.sheet]
      const cell = ws?.[target.cell]
      const oldValue = cell ? String(cell.v ?? '') : ''
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
    // CSA mapping predefinito
    for (const [fieldId, targets] of Object.entries(CSA_MAPPING)) {
      if (!Array.isArray(targets) || targets.length === 0) continue
      const newValue = data[fieldId]
      if (newValue == null || newValue === '') continue
      for (const target of targets) {
        const key = `${target.sheet}!${target.cell}`
        if (seen.has(key)) continue
        seen.add(key)
        const ws = wb.Sheets[target.sheet]
        const cell = ws?.[target.cell]
        const oldValue = cell ? formatCellValue(cell) : ''
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

/** Formatta il valore di una cella per la visualizzazione (numeri → stringa leggibile) */
function formatCellValue(cell) {
  if (!cell || cell.v === undefined || cell.v === null) return ''
  if (cell.t === 'n') {
    // Riconverti i numeri placeholder (0) come stringa vuota
    if (cell.v === 0) return ''
    return String(cell.v)
  }
  if (cell.t === 's') {
    const s = String(cell.v).trim()
    return s === '……….' ? '' : s
  }
  return String(cell.v)
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
  const XLSX = await import('xlsx')
  const templateBuf = readFileSync(templatePath)
  const wb = XLSX.read(templateBuf, { type: 'buffer' })

  for (const change of approvedChanges) {
    const ws = wb.Sheets[change.sheet]
    if (!ws) continue
    const numVal = parseItalianNumber(change.newValue)
    if (numVal !== null) {
      ws[change.cell] = { t: 'n', v: numVal }
    } else {
      ws[change.cell] = { t: 's', v: String(change.newValue) }
    }
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  writeFileSync(outputPath, buf)
}
