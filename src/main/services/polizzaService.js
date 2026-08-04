/**
 * Servizio di estrazione dati da polizze RC (Responsabilità Civile)
 * Supporta la struttura GENERAIMPRESA (Generali Italia) e formati similari.
 *
 * Fogli Excel target: RCT_O e RCP
 *
 * Strategia di estrazione (in ordine di qualità):
 * 1. pdfjs-dist con ricostruzione spaziale – puro JS, funziona su Win/Mac/Linux
 * 2. pdf-parse – ultimo fallback generico
 */

import { readFileSync, existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
// Electron solo nel desktop: nell'app web (Node puro) electron NON deve esistere.
// `app` serve unicamente a trovare ita.traineddata per l'OCR offline ed è già usato
// con guardie; qui lo carichiamo in modo opzionale (in ESM `require` non esiste → catch).
let app
try { app = require('electron').app } catch { /* non-Electron (web) */ }
import { resilientFetch, ollamaThinkOpts } from './netFetch.js'
import { embedTexts, chunkText, classifyDocType, detectDocYear } from './vectorIndexService.js'
// Modulo date PURO e testato (test/polizzaDates.test.mjs): datazione dei documenti
// per PERIODO DI COPERTURA (mai per data di emissione — era il bug dei duplicati
// privati rimossi da questo file) + regola "il valore più recente vince".
import {
  parseDateFromContextLine, parseLastDateFromContextLine, latestDateExcludingEmission,
  extractDocumentDateString, extractDocumentDate,
  normalizeDateValue, dateStrToTs, shouldReplaceValue,
} from './polizzaDates.js'
// Validazione pura (test/polizzaChecksums.test.mjs): placeholder, checksum
// P.IVA/CF, partizione campi, verifica di evidenza, recenza dei candidati.
import {
  parsePureAmount, isPlaceholderValue, validateCodiceFiscaleIva,
  isStructuralField, isPeriodicEconomicField, isPeriodicDocName,
  partitionFields, normForMatch, passesStagedEvidence, pickMoreRecentCandidate,
  isSuspectStructuralOverride, isRinvioAttivita, isCompanyNameAsAgency, isInsurerFooterPIva,
  hasLabelEvidenceNear, pickSemanticCandidate,
  stripFieldExamples, findValueWindow, buildNormIndex, matchFieldKey,
} from './polizzaValidation.js'
import { buildSpatialPage, collapseSpatial, usefulLength } from './ocrLayout.js'
import { loadPDF } from './pdfService.js'
import { writeTemplatePreservingStyles } from './xlsxTemplateWriter.js'
import { readTemplateCells, readTemplateStructure } from './xlsxTemplateReader.js'

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
  { id: 'rct_massimale_sinistro',  label: 'Massimale per sinistro',        sheet: 'RCT_O', description: 'Massimale RCT per ogni sinistro (RC verso Terzi e Prestatori di Lavoro), es. 3.000.000,00', type: 'text' },
  { id: 'rct_massimale_persona',   label: 'Massimale per persona',         sheet: 'RCT_O', description: 'Massimale RCT per ogni persona che abbia subito lesioni personali (non prestatore di lavoro), es. 3.000.000,00', type: 'text' },
  { id: 'rct_massimale_danni',     label: 'Massimale danni materiali',     sheet: 'RCT_O', description: 'Massimale RCT per danni materiali (compresi gli animali), es. 3.000.000,00', type: 'text' },
  { id: 'rct_massimale_prestatore',label: 'Massimale per prestatore',      sheet: 'RCT_O', description: 'Massimale RCT per ogni prestatore di lavoro che abbia subito lesioni personali, es. 3.000.000,00', type: 'text' },
  { id: 'rct_parametro',           label: 'Parametro regolazione',         sheet: 'RCT_O', description: 'Parametro utilizzato per la regolazione del premio RCT (es. Salari e stipendi + Quota TFR)', type: 'text' },
  { id: 'rct_importo_preventivo',  label: 'Importo preventivo parametro', sheet: 'RCT_O', description: "Importo preventivo annuo del parametro di regolazione RCT (es. 450.000,00)", type: 'text' },
  { id: 'rct_tasso',               label: 'Tasso regolazione ‰',           sheet: 'RCT_O', description: 'Tasso di regolazione imponibile per mille della sezione RCT (es. 2,450)', type: 'text' },
  { id: 'rct_premio_imponibile',   label: 'Premio imponibile',             sheet: 'RCT_O', description: "Premio/anticipo di sezione annuo imponibile della sezione RCT (es. 1.227,00)", type: 'text' },
  { id: 'rct_imposta',             label: 'Imposta',                        sheet: 'RCT_O', description: "Imposta sul premio della sezione RCT (es. 273,00)", type: 'text' },
  { id: 'rct_premio_totale',       label: 'Premio totale',                  sheet: 'RCT_O', description: "Premio/anticipo di sezione annuo totale della sezione RCT (es. 1.500,00)", type: 'text' }
]

// ─── Campi per il foglio RCP ──────────────────────────────────────────────────

export const RCP_FIELDS = [
  { id: 'rcp_prodotti',             label: 'Prodotti assicurati',                 sheet: 'RCP', description: 'Prodotti per i quali è stipulata la RC Prodotti (es. OLII E GRASSI ANIMALI O VEGETALI, NON ALIMENTARI)', type: 'text' },
  { id: 'rcp_qualifica',            label: 'Qualifica assicurato',                sheet: 'RCP', description: "Qualifica dell'assicurato nella sezione RC Prodotti (es. Fabbricante)", type: 'text' },
  { id: 'rcp_massimale_sinistro',   label: 'Massimale per sinistro',        sheet: 'RCP', description: 'Massimale RC Prodotti per ogni sinistro, es. 5.000.000,00', type: 'text' },
  { id: 'rcp_massimale_annuo',      label: 'Massimale annuo',               sheet: 'RCP', description: 'Massimale RC Prodotti per più sinistri e per anno assicurativo, es. 5.000.000,00', type: 'text' },
  { id: 'rcp_massimale_mat',        label: 'Massimale danni materiali',     sheet: 'RCP', description: 'Massimale RC Prodotti per danni materiali (compresi gli animali) anche se appartenenti a più persone, es. 5.000.000,00', type: 'text' },
  { id: 'rcp_massimale_interr',     label: 'Massimale interruzione attività', sheet: 'RCP', description: 'Massimale RC Prodotti per danni da interruzione o sospensione di attività, es. 500.000,00', type: 'text' },
  { id: 'rcp_scoperto_min_mondo',   label: 'Scoperto minimo - Resto del mondo',   sheet: 'RCP', description: 'Minimo di scoperto per i danni avvenuti nel resto del mondo (esclusi USA/Canada/Messico), es. 6.000,00', type: 'text' },
  { id: 'rcp_scoperto_max_mondo',   label: 'Scoperto massimo - Resto del mondo',  sheet: 'RCP', description: 'Massimo di scoperto per i danni avvenuti nel resto del mondo (esclusi USA/Canada/Messico), es. 100.000,00', type: 'text' },
  { id: 'rcp_scoperto_min_usa',     label: 'Scoperto minimo - USA/Canada/Messico', sheet: 'RCP', description: 'Minimo di scoperto per i danni avvenuti in USA, Canada e Messico, es. 75.000,00', type: 'text' },
  { id: 'rcp_scoperto_max_usa',     label: 'Scoperto massimo - USA/Canada/Messico', sheet: 'RCP', description: 'Massimo di scoperto per i danni avvenuti in USA, Canada e Messico, es. 150.000,00', type: 'text' },
  { id: 'rcp_parametro',            label: 'Parametro regolazione',         sheet: 'RCP', description: 'Parametro utilizzato per la regolazione del premio RCP (es. Ricavi delle vendite e delle prestazioni)', type: 'text' },
  { id: 'rcp_importo_preventivo',   label: 'Importo preventivo parametro', sheet: 'RCP', description: "Importo preventivo annuo del parametro di regolazione RCP (es. 240.000.000,00)", type: 'text' },
  { id: 'rcp_tasso',                label: 'Tasso regolazione ‰',           sheet: 'RCP', description: 'Tasso di regolazione imponibile per mille della sezione RCP (es. 0,245)', type: 'text' },
  { id: 'rcp_premio_imponibile',    label: 'Premio imponibile',             sheet: 'RCP', description: "Premio/anticipo di sezione annuo imponibile della sezione RC Prodotti (es. 58.799,99)", type: 'text' },
  { id: 'rcp_imposta',              label: 'Imposta',                        sheet: 'RCP', description: "Imposta sul premio della sezione RC Prodotti (es. 13.082,99)", type: 'text' },
  { id: 'rcp_premio_totale',        label: 'Premio totale',                  sheet: 'RCP', description: "Premio/anticipo di sezione annuo totale della sezione RC Prodotti (es. 71.882,98)", type: 'text' }
]

export const ALL_POLIZZA_FIELDS = [...RCT_FIELDS, ...RCP_FIELDS]

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

    // Use \f (form feed) as page separator so page numbers can be
    // reconstructed later by counting \f chars before a value's position.
    const fullText = pageTexts.join('\f').trim()
    return fullText.length > 20 ? fullText : null
  } catch (err) {
    console.warn('[polizza] pdfjs extraction failed:', err.message)
    return null
  }
}

// ─── Estrazione regex per campi strutturati ───────────────────────────────────

/**
 * Estrae con regex SOLO i campi ultra-strutturati che cambiano raramente tra documenti:
 * N° polizza, P.IVA, date di decorrenza e scadenza.
 * Tutto il resto viene gestito dal modello LLM che riceve il testo pulito.
 */
function extractFieldsWithRegex(text) {
  // Le regex sono scritte per testo PIATTO (finestre [^\n]{0,80} sulla riga):
  // il testo OCR ora è SPAZIALE (griglia a colonne) — si collassa sempre qui,
  // così ogni call-site (staged, rolling desktop, legacy) resta corretto.
  text = collapseSpatial(text)
  const found = {}

  // ── N° Polizza: dopo "POLIZZA", "POLIZZA N°", "POLIZZA R.C. N." ecc.
  // Accetta anche numerazioni alfanumeriche con prefisso lettere (es. ILI0003005).
  // Tra le cifre al più UNO spazio: il vecchio [\d\s]{3,15} inghiottiva run di
  // spazi e CONCATENAVA cifre di colonne diverse → numero inventato plausibile.
  const polMatch = text.match(/POLIZZA\s+(?:R\.?C\.?\s+)?(?:N[°oO.\s]{0,3})?([A-Z]{0,5}\d(?: ?\d){3,15})/i)
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

// ─── Estrazione combinata da più PDF ─────────────────────────────────────────
// parseDateFromContextLine / extractDocumentDateString / extractDocumentDate ora
// arrivano da polizzaDates.js (versione testata, che data per periodo di
// copertura ed esclude le righe di emissione/stampa).

/**
 * Estrae tutti i dati assicurativi da un set di PDF di polizza RC.
 * Strategia: pdfjs → regex (alta affidabilità) + LLM (campi liberi).
 *
 * Regola "file più recente vince": quando un campo è presente in più file,
 * viene usato il valore del file con la data interna più recente (scadenza/decorrenza).
 *
 * @param {Array<string|{path:string}>} files
 *   Può essere un array di path (string) oppure oggetti { path }.
 */
export async function extractPolizzaFromPDFs(files, settings) {
  // Normalizza input: string → { path }
  const normalizedFiles = (files || []).map(f =>
    typeof f === 'string' ? { path: f } : f
  )

  const provider = settings.llmProvider || 'ollama'
  const TOTAL_BUDGET = provider === 'anthropic' ? 180000
                     : provider === 'openai'    ? 100000
                     :                             60000

  // 1. Estrai testo da tutti i PDF, leggi la data interna del documento
  const allTexts = []

  for (const { path: fp } of normalizedFiles) {
    let text = await extractTextWithPdfjsSpatial(fp)
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

    if (text && text.trim().length > 5) {
      // Usa la data trovata nel contenuto del documento come indicatore di "recenza"
      // (es. la data di scadenza/decorrenza), non la data di modifica del file.
      const docDate = extractDocumentDate(text)
      allTexts.push({ path: fp, text, docDate })
    }
  }

  // Traccia i file senza testo estratto (PDF scansionati = solo immagini)
  const scannedFiles = normalizedFiles
    .filter(f => !allTexts.find(t => t.path === f.path))
    .map(f => ({ path: f.path }))

  if (scannedFiles.length > 0) {
    console.log(
      `[polizza] ${scannedFiles.length} file scansionati (nessun testo estraibile → vision OCR):`,
      scannedFiles.map(f => f.path.split('/').pop())
    )
  }

  if (allTexts.length === 0) {
    return { data: {}, scannedFiles, sources: {} }
  }

  // 2. Ordina per data interna crescente (documento più vecchio prima → più recente alla fine).
  //    Il LLM vede l'aggiornamento più recente per ultimo e tende a privilegiarlo.
  allTexts.sort((a, b) => (a.docDate || 0) - (b.docDate || 0))

  // 3. Costruisci il testo da inviare al LLM
  const excerpts = []
  let remainingBudget = TOTAL_BUDGET

  for (const { path: fp, text } of allTexts) {
    if (remainingBudget <= 0) {
      console.log(`[polizza] skip ${fp.split('/').pop()}: budget esaurito`)
      continue
    }
    const excerpt = text.length <= remainingBudget ? text : text.slice(0, remainingBudget)
    remainingBudget -= excerpt.length
    console.log(`[polizza] contesto ${fp.split('/').pop()}: ${excerpt.length} chars (budget residuo: ${remainingBudget})`)
    excerpts.push(`=== ${fp.split('/').pop()} ===\n${excerpt}`)
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
      console.warn('[polizza] Errore LLM (non fatale):', classifyLlmError(err, settings).message)
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

    // Conta i separatori di pagina (\f) prima della posizione trovata.
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

  // La DESCRIZIONE è la specifica di cosa estrarre: va sempre inviata al modello
  // (l'id del campo è solo una chiave arbitraria)
  const fieldGuide = fields
    .map(f => `${f.id} — ${f.label}: ${(f.description || f.label || '')}`)
    .join('\n')

  const systemPrompt =
    'Sei un estrattore di dati da documenti di qualsiasi tipo. ' +
    'Estrai i campi richiesti da qualunque documento, senza presupporne il tipo. ' +
    'Rispondi SEMPRE e SOLO con un oggetto JSON valido. ' +
    'Zero testo aggiuntivo, zero markdown, zero spiegazioni.'

  // Istruzione "file più recente vince" aggiunta ai prompt (i documenti sono
  // ordinati dal più vecchio al più recente nel testo sopra)
  const newestWinsRule =
    '- Se un dato appare in più documenti, usa il valore del documento più recente ' +
    '(quello riportato per ultimo nel testo sopra)\n'

  const extraSection = promptExtra ? `\nISTRUZIONI AGGIUNTIVE:\n${promptExtra}\n` : ''

  const ollamaPrompt =
`DOCUMENTO:
${contextText}

GUIDA AI CAMPI (la descrizione definisce cosa estrarre per ogni campo):
${fieldGuide}

Leggi il documento e compila il JSON seguente.
Sostituisci null con il valore trovato nel documento, lascia null se non presente.
${newestWinsRule}${extraSection}Rispondi SOLO con il JSON compilato:

${jsonTemplate}`

  const cloudPrompt =
`Estrai i dati dal documento e compila il JSON.

DOCUMENTO:
${contextText}

GUIDA AI CAMPI:
${fieldGuide}

Regole:
- Estrai i campi richiesti da qualunque tipo di documento, seguendo la descrizione di ciascun campo
- Importi: formato italiano "3.000.000,00" (punto = migliaia, virgola = decimale)
- Date: formato GG/MM/AAAA
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
  const res = await resilientFetch('https://api.openai.com/v1/chat/completions', {
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
  const res = await resilientFetch('https://api.anthropic.com/v1/messages', {
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
  // num_ctx dimensionato sul prompt e LIMITATO per hardware consumer (8GB VRAM):
  // un tetto fisso di 65536 token significa una KV-cache che su un modello 7-8B
  // non entra in 8GB → Ollama scarica i layer su CPU (10+ minuti) oppure va in
  // OOM; se poi riduce num_ctx sotto la lunghezza del prompt, TRONCA in silenzio
  // e il modello risponde spazzatura senza errori. Quindi: stimiamo i token del
  // prompt, lasciamo margine per la risposta, e limitiamo a 16K (sicuro su 8GB).
  // Sovrascrivibile con settings.ollamaNumCtx per chi ha più VRAM.
  const NUM_PREDICT = 2048
  const promptTokens = estimateOllamaTokens((systemPrompt?.length || 0) + (userPrompt?.length || 0))
  const capCtx = Math.max(8192, parseInt(settings.ollamaNumCtx, 10) || 16384)
  const numCtx = Math.min(capCtx, Math.max(8192, Math.ceil((promptTokens + NUM_PREDICT + 512) / 1024) * 1024))
  // Streaming + watchdog per token (vedi ollamaChatStream): lento ≠ morto.
  const { content } = await ollamaChatStream(url, {
    model: settings.ollamaModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   }
    ],
    format: 'json',          // ← grammar-constrained JSON output
    ...ollamaThinkOpts(settings.ollamaModel), // qwen3 & co.: thinking OFF
    options: {
      num_ctx:     numCtx,   // dinamico, ≤16K di default → sicuro su 8GB VRAM
      temperature: 0,        // output deterministico
      num_predict: NUM_PREDICT // max token risposta
    }
  }, { cancelFlag: settings.__cancelFlag || null })
  return content.trim()
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

/**
 * Traduce gli errori di rete/timeout delle chiamate LLM in messaggi azionabili
 * e li marca con flag (isLlmConnectionError / isLlmTimeout) così i chiamanti
 * possono decidere se interrompere subito l'estrazione.
 */
function classifyLlmError(err, settings) {
  if (err?.isLlmConnectionError !== undefined) return err  // già classificato

  const provider = settings.llmProvider || 'ollama'
  const cause = err?.cause
  const code = cause?.code || cause?.errors?.[0]?.code || ''
  const isTimeout = err?.name === 'TimeoutError' || /aborted due to timeout/i.test(err?.message || '')
  const isConnection = !isTimeout && (
    err?.message === 'fetch failed' ||
    ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EHOSTUNREACH', 'ETIMEDOUT',
     'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(code)
  )

  let message
  if (isConnection && provider === 'ollama') {
    const url = settings.ollamaUrl || 'http://127.0.0.1:11434'
    message = `Ollama non raggiungibile su ${url}. Avvia l'app Ollama (o "ollama serve") e riprova.`
  } else if (isConnection) {
    message = `Connessione al provider LLM (${provider}) fallita: verifica la rete. (${err.message})`
  } else if (isTimeout && provider === 'ollama') {
    message = 'Timeout: Ollama non ha risposto entro il limite. Il modello potrebbe essere troppo grande o lento per questa macchina.'
  } else if (isTimeout) {
    message = `Timeout: il provider LLM (${provider}) non ha risposto entro il limite.`
  } else {
    return err
  }

  const classified = new Error(message)
  classified.isLlmConnectionError = isConnection
  classified.isLlmTimeout = isTimeout
  classified.cause = err
  return classified
}

// ─── Estrazione vision (PDF scansionati) ─────────────────────────────────────

/**
 * Estrae dati da polizza tramite Vision LLM su pagine rese come immagini.
 * Usato quando i PDF sono scansionati e non contengono testo selezionabile.
 *
 * @param {Array<{name:string, pages:string[]}>} imageFiles
 * @param {object} settings
 */
export async function extractPolizzaFromImages(imageFiles, settings) {
  const configuredFields = (settings.polizzaFields?.length > 0)
    ? settings.polizzaFields : ALL_POLIZZA_FIELDS
  const allFields = configuredFields.filter(f => f.enabled !== false)

  const pages = []
  for (const { pages: docPages } of imageFiles) {
    pages.push(...docPages.slice(0, 5))
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

  const fieldGuide = fields
    .map(f => `${f.id} — ${f.label}: ${(f.description || f.label || '')}`)
    .join('\n')

  const systemPrompt =
    'Sei un estrattore di dati da documenti di qualsiasi tipo. ' +
    'Estrai i campi richiesti da qualunque documento, senza presupporne il tipo. ' +
    'Rispondi SEMPRE e SOLO con un oggetto JSON valido. ' +
    'Zero testo aggiuntivo, zero markdown, zero spiegazioni.'

  const userPrompt =
`Queste sono pagine di un documento.
Leggi il testo nelle immagini ed estrai i valori nel JSON.

GUIDA AI CAMPI (la descrizione definisce cosa estrarre per ogni campo):
${fieldGuide}

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

  const res = await resilientFetch(`${url}/api/chat`, {
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
      ...ollamaThinkOpts(model), // qwen3 & co.: thinking OFF
      options: { temperature: 0, num_ctx: 8192, num_predict: 3000 }
    }),
    signal: AbortSignal.timeout(300000)  // 5 min — vision è più lento
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`Ollama vision error ${res.status}${errBody ? `: ${errBody.slice(0, 200)}` : ''}`)
  }
  const data = await res.json()
  return (data.message?.content || '').trim()
}

async function callOpenAIVision(settings, systemPrompt, userPrompt, pages) {
  const imageContent = pages.map(p => ({
    type: 'image_url',
    image_url: { url: p, detail: 'high' }
  }))

  const res = await resilientFetch('https://api.openai.com/v1/chat/completions', {
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

  const res = await resilientFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.anthropicApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: settings.anthropicVisionModel || settings.anthropicModel || 'claude-haiku-4-5-20251001',
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

  try {
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
  } finally {
    try { await doc.destroy() } catch { /* già distrutto */ }
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
 */
function flattenRollingState(state) {
  const flat = {}
  for (const [key, entry] of Object.entries(state)) {
    if (entry?.valore != null && entry.valore !== '') {
      flat[key] = entry.valore
    }
  }
  return flat
}

// normalizeDateValue: importata da polizzaDates.js.

// Id dei campi del set predefinito: le regole di sanitizzazione per-id si
// applicano SOLO a questi. I campi personalizzati dell'utente passano intatti
// (a parte la normalizzazione date se l'utente ha scelto type 'date').
const KNOWN_DEFAULT_IDS = new Set(ALL_POLIZZA_FIELDS.map(f => f.id))

/**
 * Valida/ripulisce un valore proposto dal LLM per un campo.
 * Restituisce il valore normalizzato, oppure null se il valore è palesemente
 * incompatibile con la definizione del campo (es. una percentuale come importo
 * di imposta, un numero come "parametro di regolazione", una P.IVA di 4 cifre).
 * @returns {string|number|null}
 */
function sanitizeFieldValue(field, rawValue) {
  let v = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue)
  if (!v) return null

  // Placeholder di assenza-dato ("non specificato", "null", "n/d", "-"…): i
  // modelli piccoli li scrivono al posto di omettere il campo. Meglio vuoto
  // che spazzatura in Excel.
  if (isPlaceholderValue(v)) return null

  // Modello che fa ECO al campo: valore identico (normalizzato) alla label o
  // all'id del campo stesso → non è un dato estratto.
  if (field) {
    const nv = normForMatch(v)
    if (nv && (nv === normForMatch(field.label || '') || nv === normForMatch(field.id || ''))) return null
  }

  // "€ 3.000.000,00" / "EUR 3.000.000,00" → "3.000.000,00"
  // (coerente con gli esempi e con l'export numerico su Excel)
  const euroMatch = v.match(/^(?:€|EUR)\s*([\d.,]+)$/i)
  if (euroMatch) v = euroMatch[1]

  // Campi data (per type configurato): accetta solo date riconoscibili
  if (field?.type === 'date') return normalizeDateValue(v)

  if (!field || !KNOWN_DEFAULT_IDS.has(field.id)) return v
  const id = field.id

  // P.IVA (11 cifre) o Codice Fiscale (16 char): validazione con CHECKSUM
  // ufficiale (+ riparazione OCR per la P.IVA). Una sequenza plausibile ma con
  // cifra di controllo sbagliata è rumore OCR o allucinazione → null.
  if (id === 'codice_fiscale_iva') {
    return validateCodiceFiscaleIva(v)
  }

  // "Parametro di regolazione" è una descrizione testuale (es. "Fatturato",
  // "Salari e stipendi + Quota TFR"), mai un numero o un tasso
  if (/_parametro$/.test(id) && /^[\d\s.,]+[%‰]?$/.test(v)) return null

  // Il tasso è un numero per mille: togli l'eventuale simbolo
  if (/_tasso$/.test(id)) return v.replace(/\s*[‰%]\s*$/, '')

  // Massimali, premi, imposte e importi sono SOMME, non aliquote percentuali
  if (/massimale|premio|imposta|importo|scoperto/.test(id) && /[%‰]\s*$/.test(v)) return null

  return v
}

// dateStrToTs: importata da polizzaDates.js.

/**
 * Fonde la risposta del LLM nello stato rolling in modo difensivo:
 * - accetta SOLO chiavi già presenti nello stato (il modello non può inventare
 *   campi che la UI non mostrerebbe mai);
 * - normalizza risposte "piatte" ("campo": "valore") nel formato {valore, data_validita};
 * - valida i valori rispetto alla definizione del campo (sanitizeFieldValue);
 * - non sovrascrive MAI un valore esistente con null/vuoto (niente regressioni);
 * - VINCE SEMPRE il valore temporalmente più recente, indipendentemente
 *   dall'ordine di lettura dei documenti. La data effettiva di un valore è:
 *   data_validita dichiarata dal modello → il valore stesso se è una data
 *   (es. scadenza) → la data del documento letta nel contenuto (fonte_data).
 *   Un valore con data nota non viene mai sostituito da uno più vecchio o
 *   senza data.
 *
 * @param {object} fieldsById  { fieldId: fieldDef } per la validazione per-campo
 * @param {string|null} docDate  data GG/MM/AAAA del documento corrente (letta nel testo)
 */
// parsePureAmount: importata da polizzaValidation.js.

function mergeRollingState(state, updated, fieldsById = {}, docDate = null, source = null) {
  if (!updated || typeof updated !== 'object' || Array.isArray(updated)) return state

  const merged = { ...state }
  for (const [key, rawEntry] of Object.entries(updated)) {
    if (!(key in merged)) continue

    let entry = rawEntry
    if (typeof entry === 'string' || typeof entry === 'number') {
      entry = { valore: entry, data_validita: null }
    }
    if (!entry || typeof entry !== 'object' || !('valore' in entry)) continue

    const val = entry.valore
    if (typeof val !== 'string' && typeof val !== 'number') continue
    if (val == null || String(val).trim() === '') continue

    const cleaned = sanitizeFieldValue(fieldsById[key], val)
    if (cleaned == null || cleaned === '') continue

    // Anti-allucinazione (AGNOSTICA, nessuna logica di dominio): se il valore è un
    // importo "puro" e il modello ha fornito un'evidenza testuale, ma le cifre della
    // parte intera NON compaiono in quell'evidenza, il numero è inventato → scarta.
    // Senza evidenza non si scarta nulla (retro-compatibile).
    const evidenza = typeof entry.evidenza === 'string' ? entry.evidenza : null
    const cleanedAmount = parsePureAmount(cleaned)
    if (cleanedAmount != null && evidenza) {
      const intDigits = String(Math.trunc(Math.abs(cleanedAmount)))
      const evDigits = evidenza.replace(/\D/g, '')
      if (intDigits.length >= 4 && !evDigits.includes(intDigits)) continue
    }

    const validita = typeof entry.data_validita === 'string'
      ? normalizeDateValue(entry.data_validita)
      : null

    // Data effettiva del nuovo valore (per i campi data il valore stesso è la
    // miglior data disponibile: una scadenza 2026 è più recente di una 2022)
    const newEffective = validita
      || (fieldsById[key]?.type === 'date' ? cleaned : null)
      || docDate
      || null

    const existing = merged[key]
    if (existing && existing.valore != null && existing.valore !== '') {
      // Regola di STABILITÀ del dato (AGNOSTICA, nessuna logica di dominio o tipo
      // documento): confronta due importi "puri" (solo cifre/separatori). Se il
      // divario è di ordine di grandezza estremo (≥20×), vince il PIÙ GRANDE,
      // ignorando la data. Motivo: un importo enormemente più piccolo è quasi
      // sempre un sotto-valore mappato per errore (franchigia/scoperto/sotto-limite/
      // minimo), mentre uno enormemente più grande è la correzione verso il valore
      // reale (es. il massimale di polizza che deve scavalcare un sotto-limite letto
      // da un'appendice con data più recente). Entro lo stesso ordine di grandezza
      // resta valida la regola per-data sottostante.
      if (fieldsById[key]?.type !== 'date') {
        const oldNum = parsePureAmount(existing.valore)
        const newNum = parsePureAmount(cleaned)
        if (oldNum != null && newNum != null && oldNum > 0 && newNum > 0) {
          if (newNum <= oldNum * 0.05) continue   // downgrade estremo → tieni il valore esistente
          if (newNum >= oldNum * 20) {            // upgrade estremo → prendi il nuovo, ignora la data
            merged[key] = { valore: cleaned, data_validita: validita, fonte_data: newEffective, fonte: source || existing?.fonte || null }
            continue
          }
        }
      }
      const oldTs = dateStrToTs(existing.data_validita || existing.fonte_data)
      const newTs = dateStrToTs(newEffective)
      // Il valore datato vince: niente sostituzioni con valori più vecchi o senza data
      if (oldTs != null && (newTs == null || newTs < oldTs)) continue
    }

    // Traccia la SORGENTE (file + pagina) da cui arriva il valore vincente, così
    // si può verificare in UI da dove è stato preso ogni dato.
    merged[key] = { valore: cleaned, data_validita: validita, fonte_data: newEffective, fonte: source || existing?.fonte || null }
  }
  return merged
}

/**
 * Costruisce l'elenco campi per il prompt rolling: id, label, DESCRIZIONE
 * (è la descrizione a definire COSA estrarre — l'id è solo una chiave) e
 * valore attuale. Una riga per campo.
 */
function buildRollingFieldLines(fields, state) {
  return fields.map(f => {
    // Nessun troncamento: la descrizione è la guida principale per il modello,
    // l'utente deve poterci scrivere quanto serve per essere preciso.
    const desc = (f.description || f.label || f.id)
    const entry = state[f.id]
    const effDate = entry?.data_validita || entry?.fonte_data
    const current = entry?.valore != null && entry.valore !== ''
      ? `[attuale: "${entry.valore}"${effDate ? ` — validità ${effDate}` : ''}]`
      : '[DA ESTRARRE]'
    return `- ${f.id} — ${f.label}: ${desc} ${current}`
  }).join('\n')
}

// Prompt di sistema condiviso per tutte le chiamate rolling (testo e vision).
// Chiede SOLO i campi da aggiornare (delta): risposte brevi = più veloci,
// meno timeout e nessuna possibilità di azzerare campi già estratti.
const ROLLING_SYSTEM_PROMPT =
  'Sei un estrattore di dati da documenti di qualsiasi tipo (tipicamente in italiano).\n' +
  'Il documento può essere di qualunque natura (polizza, bolletta, fattura, contratto, ecc.):\n' +
  'estrai SEMPRE i campi richiesti basandoti solo sulla loro descrizione, senza presupporre il\n' +
  'tipo di documento e senza saltare l\'estrazione se non è una polizza.\n' +
  'Ricevi un elenco di CAMPI (id, nome, descrizione, valore attuale) e nuovo contenuto da analizzare.\n\n' +
  'REGOLE TASSATIVE:\n' +
  '1. La DESCRIZIONE di ogni campo definisce esattamente cosa estrarre. L\'id è solo\n' +
  '   una chiave: non dedurre il significato dal nome del campo, segui la descrizione.\n' +
  '2. Rispondi SOLO con i campi da aggiornare, come oggetto JSON. La maggior parte\n' +
  '   delle pagine NON contiene la maggior parte dei campi: rispondere {} è il caso\n' +
  '   NORMALE e corretto. Non forzare un valore pur di riempire un campo.\n' +
  '3. Usa ESCLUSIVAMENTE gli id elencati. NON inventare campi nuovi.\n' +
  '4. Compila un campo SOLO se nel contenuto è presente un valore ESPLICITAMENTE\n' +
  '   etichettato/associato al significato della sua descrizione. Ogni numero del\n' +
  '   documento ha la propria voce (etichetta): usalo solo per il campo la cui\n' +
  '   descrizione corrisponde a QUELLA voce. NON assegnare un numero a un campo\n' +
  '   perché è l\'unico presente, perché sembra plausibile, o perché altrove nella\n' +
  '   pagina compare una parola simile al nome del campo. Un valore etichettato come\n' +
  '   una cosa diversa da ciò che il campo chiede NON va usato per quel campo.\n' +
  '   Nel dubbio, ometti il campo.\n' +
  '5. Un campo con valore [attuale: ...] va incluso SOLO se il nuovo valore è\n' +
  '   temporalmente più recente di quello attuale (in base alla data riportata nel\n' +
  '   documento). Conta la data scritta NEL documento, mai l\'ordine di lettura.\n' +
  '6. Indica SEMPRE "data_validita" quando il documento riporta una data\n' +
  '   (emissione, validità, decorrenza o modifica) riferibile al dato estratto.\n' +
  '7. Importi in formato italiano (es. 3.000.000,00). Date in formato GG/MM/AAAA.\n' +
  '8. Non includere mai campi con valore null. Zero testo extra, zero markdown.\n' +
  '9. Per OGNI campo restituito includi "evidenza": il frammento di testo ESATTO,\n' +
  '   copiato letteralmente dal documento, in cui compare il valore. Se NON riesci a\n' +
  '   citare il valore copiandolo dal documento, allora lo stai inventando: NON\n' +
  '   restituire quel campo.\n\n' +
  'FORMATO di ogni campo restituito:\n' +
  '{"nome_campo": {"valore": "valore_estratto", "data_validita": "GG/MM/AAAA o null", "evidenza": "testo esatto copiato dal documento"}}'

// Stima token per testo italiano/OCR con i tokenizer dei modelli locali.
// Misurato sul campo: 164.472 char = 64.402 token reali → ~2,55 char/token.
// Il vecchio /3 sottostimava e faceva credere che il prompt entrasse nel contesto.
function estimateOllamaTokens(chars) {
  return Math.ceil(chars / 2.5)
}

// Limite di contesto REALE del modello (n_ctx_train), da /api/show. Se num_ctx lo
// supera, Ollama lo riduce e TRONCA il prompt in silenzio tenendo la coda: la
// guida dei campi (in testa) si perde e il modello risponde spazzatura. Quindi il
// limite va letto PRIMA di dimensionare la chiamata. Cache per url|modello.
const ollamaCtxLimitCache = new Map()
async function getOllamaContextLimit(settings, model) {
  const url = settings.ollamaUrl || 'http://127.0.0.1:11434'
  const key = `${url}|${model}`
  if (ollamaCtxLimitCache.has(key)) return ollamaCtxLimitCache.get(key)
  let limit = null
  try {
    const res = await resilientFetch(`${url}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(10000)
    })
    if (res.ok) {
      const info = (await res.json())?.model_info || {}
      // La chiave è prefissata dall'architettura (es. "qwen2.context_length")
      for (const [k, v] of Object.entries(info)) {
        if (k.endsWith('.context_length') && Number.isFinite(v) && v > 0) { limit = v; break }
      }
    }
  } catch { /* server datato o modello mancante: si procede senza limite noto */ }
  ollamaCtxLimitCache.set(key, limit)
  return limit
}

// ─── Streaming NDJSON con watchdog per token ─────────────────────────────────
// stream:true è ciò che rende i timeout VERI: chiudere la connessione fa
// cancellare a Ollama la generazione lato server (con stream:false continuava
// per conto suo → generazioni-zombie che tenevano la GPU per ore e "Stopping…"
// infiniti). Il watchdog distingue LENTO da MORTO:
//   - primo chunk: attesa generosa (caricamento modello da disco + lettura del
//     prompt non producono token — su modelli che sbordano su CPU sono minuti);
//   - poi: se nessun token arriva per stallMs il run è morto → abort;
//   - hardCapMs: tetto assoluto contro i loop infiniti.
// Finché i token arrivano, NESSUN timeout: un batch legittimo può durare 15 min.
async function ollamaChatStream(url, payload, { firstChunkMs = 480000, stallMs = 120000, hardCapMs = 1800000, cancelFlag = null } = {}) {
  const ac = new AbortController()
  const startedAt = Date.now()
  let lastChunkAt = null // null = primo chunk non ancora arrivato
  let abortReason = null
  const watchdog = setInterval(() => {
    const now = Date.now()
    // ANNULLA dell'utente: chiudere la connessione fa cancellare a Ollama la
    // generazione in corso — il job si ferma in secondi, non a fine risposta.
    if (cancelFlag?.canceled) {
      abortReason = 'annullato dall\'utente'
      ac.abort()
      return
    }
    const sinceChunk = now - (lastChunkAt ?? startedAt)
    const budget = lastChunkAt == null ? firstChunkMs : stallMs
    if (sinceChunk > budget) {
      abortReason = lastChunkAt == null
        ? `nessuna risposta dal modello entro ${Math.round(firstChunkMs / 60000)} min (caricamento/prompt)`
        : `nessun token per ${Math.round(stallMs / 1000)}s (generazione in stallo)`
      ac.abort()
    } else if (now - startedAt > hardCapMs) {
      abortReason = `superato il tetto di ${Math.round(hardCapMs / 60000)} min`
      ac.abort()
    }
  }, 5000)
  try {
    const res = await resilientFetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, stream: true }),
      signal: ac.signal
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new Error(`Ollama error ${res.status}${errBody ? `: ${errBody.slice(0, 200)}` : ''}`)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = '', content = '', promptEval = null, evalCount = null
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      lastChunkAt = Date.now()
      buf += decoder.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        try {
          const j = JSON.parse(line)
          if (j.message?.content) content += j.message.content
          if (j.done) { promptEval = j.prompt_eval_count ?? null; evalCount = j.eval_count ?? null }
        } catch { /* riga NDJSON parziale: completata al prossimo chunk */ }
      }
    }
    return { content, promptEval, evalCount }
  } catch (err) {
    // L'abort chiude la connessione → Ollama CANCELLA la generazione (niente zombie).
    if (abortReason) throw new Error(`Ollama interrotto: ${abortReason}`)
    throw err
  } finally {
    clearInterval(watchdog)
  }
}

/**
 * Variante Ollama ottimizzata per rolling: num_ctx 8192 (vs 65536 standard).
 * Ogni batch è piccolo → contesto ridotto → risparmio RAM massiccio su macchine 8-16 GB.
 */
async function callOllamaRolling(settings, systemPrompt, userPrompt, opts = {}) {
  const url = settings.ollamaUrl || 'http://127.0.0.1:11434'
  // num_ctx/timeout sovrascrivibili: il "fascicolo intero" invia prompt molto più
  // grandi di un batch da 3 pagine e ha bisogno di contesto e tempi maggiori.
  const numCtx = opts.numCtx || 16384    // default: batch (3 pagine) + guida campi + risposta delta
  const timeoutMs = opts.timeoutMs || 180000
  // opts.diag: collettore di righe di diagnostica leggibili (finisce nel log
  // "Salva diagnostica" del renderer/web). Le statistiche di Ollama sono l'unico
  // modo per PROVARE un troncamento del prompt: prompt_eval_count = token davvero
  // letti dal server.
  const diag = Array.isArray(opts.diag) ? opts.diag : null
  const startedAt = Date.now()
  // Streaming + watchdog per token: LENTO va avanti (anche 15+ min se i token
  // arrivano), MORTO viene tagliato e la generazione cancellata lato server.
  // Il vecchio timeoutMs cieco sopravvive solo come componente del tetto duro.
  const { content, promptEval, evalCount } = await ollamaChatStream(url, {
    model: settings.ollamaModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   }
    ],
    format: 'json',
    ...ollamaThinkOpts(settings.ollamaModel), // qwen3 & co.: thinking OFF
    options: {
      num_ctx:     numCtx,
      temperature: 0,
      num_predict: opts.numPredict || 3000
    }
  }, { hardCapMs: Math.max(timeoutMs * 4, 1800000), cancelFlag: settings.__cancelFlag || null })
  if (diag) {
    const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
    diag.push(`Ollama: modello ${settings.ollamaModel} · num_ctx ${numCtx} · durata ${secs}s` +
      (promptEval != null ? ` · token letti dal server: ${promptEval}` : '') +
      (evalCount != null ? ` · token generati: ${evalCount}` : ''))
    // Stima dei token del prompt inviato (~2,5 char/token per italiano/OCR):
    // se il server ne ha letti molti meno, il prompt è stato troncato in silenzio
    // (la guida dei campi o parte del testo NON sono mai arrivate al modello).
    const estPromptTokens = estimateOllamaTokens(systemPrompt.length + userPrompt.length)
    if (promptEval != null && estPromptTokens > 2048 && promptEval < estPromptTokens * 0.7) {
      diag.push(`ATTENZIONE: prompt probabilmente TRONCATO dal server Ollama ` +
        `(letti ${promptEval} token su ~${estPromptTokens} stimati). ` +
        `Aumenta num_ctx o riduci i documenti per chiamata.`)
    }
  }
  return content.trim()
}

async function callOllamaVisionRolling(settings, systemPrompt, userPrompt, base64Image) {
  const url = settings.ollamaUrl || 'http://127.0.0.1:11434'
  const model = settings.ollamaVisionModel || settings.ollamaModel
  if (!model) throw new Error('Nessun modello vision Ollama configurato.')

  const res = await resilientFetch(`${url}/api/chat`, {
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
      ...ollamaThinkOpts(model), // qwen3 & co.: thinking OFF
      options: {
        num_ctx:     8192,
        temperature: 0,
        num_predict: 3000
      }
    }),
    // 5 min: l'encoding dell'immagine + inferenza vision su hardware consumer
    // può superare abbondantemente i 2 minuti per pagina
    signal: AbortSignal.timeout(300000)
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`Ollama vision rolling error ${res.status}${errBody ? `: ${errBody.slice(0, 200)}` : ''}`)
  }
  const data = await res.json()
  return (data.message?.content || '').trim()
}

/**
 * Aggiorna lo stato rolling con un batch di testo (fino a 3 pagine + coda precedente).
 * Il prompt include la GUIDA dei campi (label + descrizione): è la descrizione a
 * definire cosa estrarre, l'id da solo non basta.
 * Lancia un errore classificato (vedi classifyLlmError) se la chiamata LLM fallisce:
 * è il chiamante a decidere se proseguire o interrompere l'estrazione.
 */
async function callRollingLLMText(settings, state, batchText, fields, docDate = null, source = null) {
  const promptExtra = (settings.polizzaPromptExtra || '').trim()
  const userPrompt =
`CAMPI (id — nome: descrizione [valore attuale]):
${buildRollingFieldLines(fields, state)}
${promptExtra ? `\nISTRUZIONI AGGIUNTIVE (priorità massima, prevalgono in caso di dubbio):\n${promptExtra}\n` : ''}${docDate ? `\nDATA DOCUMENTO: ${docDate}\n` : ''}
TESTO PAGINE:
${batchText}

Rispondi SOLO con i campi da aggiornare (oggetto JSON, {} se nessuno):`

  const provider = settings.llmProvider || 'ollama'
  let raw

  try {
    if (provider === 'openai') {
      raw = await callOpenAI(settings, ROLLING_SYSTEM_PROMPT, userPrompt)
    } else if (provider === 'anthropic') {
      raw = await callAnthropic(settings, ROLLING_SYSTEM_PROMPT, userPrompt)
    } else {
      raw = await callOllamaRolling(settings, ROLLING_SYSTEM_PROMPT, userPrompt)
    }
  } catch (err) {
    throw classifyLlmError(err, settings)
  }

  const updated = parseJsonResponse(raw)
  const fieldsById = Object.fromEntries(fields.map(f => [f.id, f]))
  return mergeRollingState(state, updated, fieldsById, docDate, source)
}

/**
 * Aggiorna lo stato rolling con una singola immagine di pagina (PDF scansionato).
 * Anche qui il prompt include la GUIDA dei campi (label + descrizione).
 * Lancia un errore classificato se la chiamata LLM fallisce.
 */
// ─── OCR locale (Tesseract.js) — opzionale e ADDITIVO ────────────────────────
// Se 'tesseract.js' è installato, estrae il TESTO della pagina dall'immagine e lo
// affianca all'immagine nel prompt: il modello mappa testo pulito invece di fare
// OCR sui pixel (meno letture sbagliate, meno allucinazioni). Import dinamico +
// try/catch: se il pacchetto non c'è o fallisce, torna '' e il flusso prosegue con
// la sola immagine — non può rompere l'estrazione.
//
// OFFLINE: dietro firewall/VPN il default di tesseract.js scaricherebbe la lingua
// 'ita' da cdn.jsdelivr.net e fallirebbe in silenzio. Se troviamo 'ita.traineddata'
// in locale lo usiamo come langPath (gzip:false: è il file NON compresso) e
// disattiviamo la cache di rete → OCR 100% offline. In dev il file sta nella root del
// progetto; nel build pacchettizzato in process.resourcesPath (build.extraResources).
// Se manca, torniamo {} e resta il default (CDN): non peggioriamo chi è online. Il
// core WASM, in Node, è già caricato via require da node_modules — niente rete.
function tessLangOptions() {
  try {
    // Desktop: app.getAppPath()/resourcesPath. Web (no electron): TESSERACT_DATA_DIR
    // o cwd e la sua parent (nel container ita.traineddata sta in /app, cwd=/app/web).
    const candidates = [
      process.env.TESSERACT_DATA_DIR,
      app && app.isPackaged ? process.resourcesPath : (app && app.getAppPath ? app.getAppPath() : null),
      process.cwd(),
      join(process.cwd(), '..'),
    ].filter(Boolean)
    for (const base of candidates) {
      if (existsSync(join(base, 'ita.traineddata'))) {
        return { langPath: base, gzip: false, cacheMethod: 'none' }
      }
    }
  } catch (_) { /* fallback CDN */ }
  return {}
}
let _ocrWorker = null
let _ocrUnavailable = false
async function ocrImageToText(base64DataUrl, lang = 'ita') {
  if (_ocrUnavailable) return ''
  try {
    const tesseract = await import('tesseract.js')
    const createWorker = tesseract.createWorker || tesseract.default?.createWorker
    if (!createWorker) { _ocrUnavailable = true; return '' }
    if (!_ocrWorker) {
      _ocrWorker = await createWorker(lang, undefined, tessLangOptions())
      // Migliora l'allineamento anche del testo piatto di fallback (data.text).
      try { await _ocrWorker.setParameters({ preserve_interword_spaces: '1' }) } catch { /* parametro opzionale */ }
    }
    // blocks: le COORDINATE parola escono dalla stessa chiamata (zero OCR in
    // più) e permettono di ricostruire la pagina come griglia a colonne — i
    // layout tabellari restano incolonnati invece di venire "srotolati".
    const { data } = await _ocrWorker.recognize(base64DataUrl, {}, { text: true, blocks: true })
    const spatial = buildSpatialPage(data?.blocks)
    if (spatial.trim()) return spatial
    return (data?.text || '').trim()
  } catch (e) {
    console.warn('[ocr] non disponibile/fallita, proseguo con sola immagine:', e.message)
    _ocrUnavailable = true
    return ''
  }
}

// Verifica UNA volta sola se l'OCR (Tesseract) è davvero utilizzabile su questo
// computer: prova a importare il pacchetto e a creare il worker. Serve a evitare la
// "morte silenziosa" della modalità fascicolo intero (OCR fallito su ogni pagina →
// testo vuoto → nessun campo, senza errori). Non solleva mai: ritorna lo stato.
export async function probeOcr(settings = {}) {
  if (settings && settings.polizzaOcrEnabled === false) {
    return { available: false, reason: 'OCR disattivato nelle impostazioni (serve per il fascicolo intero)' }
  }
  if (_ocrUnavailable) {
    return { available: false, reason: 'Tesseract non disponibile (un tentativo precedente è fallito)' }
  }
  try {
    const tesseract = await import('tesseract.js')
    const createWorker = tesseract.createWorker || tesseract.default?.createWorker
    if (!createWorker) { _ocrUnavailable = true; return { available: false, reason: "pacchetto 'tesseract.js' non installato (createWorker mancante)" } }
    if (!_ocrWorker) _ocrWorker = await createWorker('ita', undefined, tessLangOptions())
    return { available: true }
  } catch (e) {
    _ocrUnavailable = true
    return { available: false, reason: 'inizializzazione OCR fallita: ' + e.message }
  }
}

// #5 — Consenso: dato un array di delta (uno per passata di lettura), per ogni
// campo tiene il valore che ricorre di più (a parità, il primo apparso). Cancella
// la non-determinatezza del modello tra una passata e l'altra.
function consensusDelta(deltas) {
  const byField = {}
  for (const d of deltas) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) continue
    for (const [k, e] of Object.entries(d)) {
      const val = (e && typeof e === 'object') ? e.valore : e
      if (val == null || String(val).trim() === '') continue
      const norm = String(val).toLowerCase().replace(/\s+/g, ' ').trim()
      ;(byField[k] = byField[k] || []).push({ norm, entry: e })
    }
  }
  const out = {}
  for (const [k, list] of Object.entries(byField)) {
    const counts = {}
    for (const it of list) counts[it.norm] = (counts[it.norm] || 0) + 1
    let best = null, bestC = 0
    for (const it of list) { if (counts[it.norm] > bestC) { bestC = counts[it.norm]; best = it } }
    if (best) out[k] = best.entry
  }
  return out
}

async function callRollingLLMVision(settings, state, imageBase64, pageNum, totalPages, fields, source = null) {
  const promptExtra = (settings.polizzaPromptExtra || '').trim()
  // #1 — OCR del testo (fonte primaria) affiancato all'immagine. Additivo: se l'OCR
  // non è disponibile, ocrBlock resta vuoto e si usa la sola immagine come prima.
  const ocrText = settings.polizzaOcrEnabled === false ? '' : await ocrImageToText(imageBase64)
  // ANCORAGGIO AL PERIODO: dal testo OCR ricavo (regex deterministica) il periodo a
  // cui il documento si riferisce (scadenza/periodo/decorrenza). Datando ogni valore
  // con questo periodo, per i campi che cambiano nel tempo vince sempre il documento
  // più recente (es. importo preventivo 2024 batte quello 2019), in modo deterministico.
  const docDate = ocrText ? (extractDocumentDateString(ocrText) || null) : null
  const ocrBlock = ocrText
    ? `\nTESTO OCR DELLA PAGINA (FONTE PRIMARIA — ogni valore che riporti DEVE comparire qui dentro; l'immagine serve solo per capire il layout/tabelle):\n"""\n${ocrText.slice(0, 8000)}\n"""\n`
    : ''
  const userPrompt =
`CAMPI (id — nome: descrizione [valore attuale]):
${buildRollingFieldLines(fields, state)}
${promptExtra ? `\nISTRUZIONI AGGIUNTIVE (priorità massima, prevalgono in caso di dubbio):\n${promptExtra}\n` : ''}${ocrBlock}
Pagina ${pageNum}/${totalPages}

Leggi il contenuto (TESTO OCR + immagine) e rispondi SOLO con i campi da aggiornare (oggetto JSON, {} se nessuno):`

  const provider = settings.llmProvider || 'ollama'

  const callModelOnce = async (modelOverride) => {
    let raw
    try {
    if (provider === 'openai') {
      const imageContent = [{ type: 'image_url', image_url: { url: imageBase64, detail: 'high' } }]
      const res = await resilientFetch('https://api.openai.com/v1/chat/completions', {
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
      const res = await resilientFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': settings.anthropicApiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: modelOverride || settings.anthropicVisionModel || settings.anthropicModel || 'claude-haiku-4-5-20251001',
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
    } catch (err) {
      throw classifyLlmError(err, settings)
    }
    return raw
  }

  const fieldsById = Object.fromEntries(fields.map(f => [f.id, f]))
  const hasVal = e => { const v = (e && typeof e === 'object') ? e.valore : e; return v != null && String(v).trim() !== '' }

  // Prima passata col modello base (Haiku/vision)
  const delta1 = parseJsonResponse(await callModelOnce())

  // #5/#6 — VERIFICA MIRATA (selettiva): scatta SOLO se l'utente ha indicato dei
  // campi da verificare (CSV di id/etichette in settings.polizzaVerificaCampi) e uno
  // di essi è stato letto in questa pagina. Negli altri casi → comportamento invariato.
  const verList = String(settings.polizzaVerificaCampi || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const flaggedFields = verList.length ? fields.filter(f => {
    const id = String(f.id).toLowerCase(), lbl = String(f.label || '').toLowerCase()
    return verList.some(v => v === id || v === lbl || (v.length >= 3 && lbl.includes(v)))
  }) : []
  const flaggedHit = flaggedFields.some(f => hasVal(delta1[f.id]))
  if (!flaggedHit) return mergeRollingState(state, delta1, fieldsById, docDate, source)

  // Fase di verifica PROTETTA: qualunque errore qui → si ricade sul risultato di
  // pass 1 (l'estrazione non si rompe mai).
  let updated = delta1
  try {
    // Consenso Haiku ×N sulla pagina
    const passes = Math.max(2, Math.min(5, parseInt(settings.polizzaConsensusPasses, 10) || 3))
    const deltas = [delta1]
    for (let p = 1; p < passes; p++) deltas.push(parseJsonResponse(await callModelOnce()))
    updated = consensusDelta(deltas)
    // Arbitraggio col modello forte SOLO sui campi flaggati ancora discordi tra le passate
    const verModel = String(settings.polizzaVerificaModel || '').trim()
    const norm = e => { const v = (e && typeof e === 'object') ? e.valore : e; return v == null ? '' : String(v).toLowerCase().replace(/\s+/g, ' ').trim() }
    const discordant = flaggedFields.filter(f => new Set(deltas.map(d => norm(d && d[f.id]))).size > 1)
    if (verModel && provider === 'anthropic' && discordant.length) {
      const arb = parseJsonResponse(await callModelOnce(verModel))
      for (const f of discordant) if (hasVal(arb[f.id])) updated[f.id] = arb[f.id]
    }
  } catch (e) {
    console.warn('[verifica mirata] fallita, uso il risultato della prima passata:', e.message)
    updated = delta1
  }
  return mergeRollingState(state, updated, fieldsById, docDate, source)
}

/**
 * Estrazione polizza in modalità rolling state.
 *
 * Processa i documenti uno alla volta nell'ordine in cui sono stati caricati,
 * ogni documento pagina per pagina in batch da 3 + coda di 300 chars.
 * Ogni chiamata LLM riceve al massimo ~8-10K token. Lo stato accumula i valori
 * in modo date-aware: l'LLM aggiorna un campo solo se il nuovo valore è più recente.
 *
 * @param {Array<string|{path}>} files
 * @param {object} settings
 * @param {Function|null} onProgress  callback({ docIndex, docTotal, pageIndex, pageTotal, docName, state })
 * @returns {{ data, scannedFiles, sources, rollingState }}
 */
export async function extractPolizzaRolling(files, settings, onProgress = null) {
  const configuredFields = (settings.polizzaFields?.length > 0)
    ? settings.polizzaFields : ALL_POLIZZA_FIELDS
  const activeFields = configuredFields.filter(f => f.enabled !== false)

  const BATCH_SIZE = 3

  const normalizedFiles = (files || []).map(f =>
    typeof f === 'string' ? { path: f } : f
  )

  let state = initRollingState(activeFields)
  const scannedFiles = []
  let totalPagesProcessed = 0
  let consecutiveLlmErrors = 0

  const notify = (extra) => onProgress?.({ state, totalPagesProcessed, ...extra })

  // Pre-seed con regex: i campi ultra-strutturati (n° polizza, P.IVA, date)
  // vengono estratti in modo deterministico prima della chiamata LLM, così il
  // modello li vede già compilati e non può inventarli (es. codici broker
  // scambiati per P.IVA).
  const seedFromRegex = (batchText, docDate) => {
    const regexFound = extractFieldsWithRegex(batchText)
    for (const [k, v] of Object.entries(regexFound)) {
      if (v && k in state && (state[k]?.valore == null || state[k].valore === '')) {
        // Se il valore stesso è una data (decorrenza/scadenza) è anche la sua validità
        const selfDate = normalizeDateValue(v)
        state[k] = { valore: v, data_validita: selfDate, fonte_data: selfDate || docDate || null }
      }
    }
  }

  // Aggiorna lo stato con un batch. Se Ollama/il provider è irraggiungibile, o se
  // gli errori LLM si accumulano, interrompe TUTTA l'estrazione invece di macinare
  // inutilmente le pagine restanti a vuoto.
  const applyTextBatch = async (batchText, docDate) => {
    seedFromRegex(batchText, docDate)
    try {
      state = await callRollingLLMText(settings, state, batchText, activeFields, docDate)
      consecutiveLlmErrors = 0
    } catch (err) {
      consecutiveLlmErrors++
      console.warn('[polizza:rolling] Stato invariato per errore LLM:', err.message)
      if (err.isLlmConnectionError || consecutiveLlmErrors >= 3) {
        const fatal = new Error(
          err.isLlmConnectionError
            ? err.message
            : `Estrazione interrotta dopo ${consecutiveLlmErrors} errori LLM consecutivi. Ultimo errore: ${err.message}`
        )
        fatal.isLlmFatal = true
        throw fatal
      }
    }
  }

  for (let docIdx = 0; docIdx < normalizedFiles.length; docIdx++) {
    const { path: filePath } = normalizedFiles[docIdx]
    const docName = filePath.split(/[\\/]/).pop()

    console.log(`[polizza:rolling] ${docIdx + 1}/${normalizedFiles.length}: ${docName}`)
    notify({ docIndex: docIdx, docTotal: normalizedFiles.length, pageIndex: 0, pageTotal: 0, docName })

    // Il layer di testo dei PDF può essere OCR-spazzatura (scansioni con un testo
    // embedded corrotto/illeggibile). Non possiamo fidarci del testo, né stabilire
    // in modo affidabile se è "buono" — qualunque file può arrivare. Quindi NON
    // usiamo il testo embedded: ogni documento viene letto via OCR dall'IMMAGINE
    // della pagina (fonte sempre affidabile), gestito dal frontend pagina per pagina.
    console.log(`[polizza:rolling] ${docName}: OCR immagine (testo non affidabile)`)
    scannedFiles.push({ path: filePath })
  }

  const data = flattenRollingState(state)
  console.log(`[polizza:rolling] Completato: ${Object.keys(data).length} campi estratti:`, Object.keys(data))

  return { data, scannedFiles, sources: {}, rollingState: state }
}

/**
 * Aggiorna lo stato rolling con una singola pagina vision (base64).
 * Chiamato dal frontend per i PDF scansionati, pagina per pagina.
 *
 * @param {object} state           stato rolling corrente (con {valore, data_validita})
 * @param {string} imageBase64     immagine della pagina in formato data:image/...;base64,...
 * @param {number} pageNum         pagina corrente (1-based)
 * @param {number} totalPages      totale pagine del documento
 * @param {object} settings
 * @returns {object} stato aggiornato
 */
export async function updateStateWithVisionPage(state, imageBase64, pageNum, totalPages, settings, source = null) {
  const configuredFields = (settings.polizzaFields?.length > 0)
    ? settings.polizzaFields : ALL_POLIZZA_FIELDS
  const activeFields = configuredFields.filter(f => f.enabled !== false)
  return callRollingLLMVision(settings, state, imageBase64, pageNum, totalPages, activeFields, source)
}

// ─── FASCICOLO INTERO — estrazione in UNA sola chiamata ──────────────────────
// Il modello vede il testo OCR di TUTTI i documenti insieme e fa la selezione-fonte
// (periodo più recente per i campi che cambiano, valore coerente per gli anagrafici,
// preventivo vs consuntivo). Espone anche l'OCR di una singola pagina, riusato dal
// renderer per costruire il testo completo del fascicolo.

export async function ocrPageText(imageBase64, settings = {}) {
  if (settings && settings.polizzaOcrEnabled === false) return ''
  return ocrImageToText(imageBase64)
}

const WHOLE_DOSSIER_SYSTEM =
  'Sei un estrattore esperto di dati da fascicoli assicurativi italiani (RC).\n' +
  'Ricevi il TESTO (OCR) di TUTTI i documenti di UNA pratica, etichettati per nome file\n' +
  '(polizza base, appendici, rinnovi, quietanze, regolazioni premio, condizioni).\n' +
  'Compila i campi richiesti scegliendo, per OGNI campo, il valore corretto CONFRONTANDO\n' +
  'tutti i documenti. REGOLE:\n' +
  '1. Estrai un valore SOLO se è esplicitamente presente nel testo. Non inventare. Se un\n' +
  '   campo non c\'è in nessun documento, OMETTILO (mai scrivere "non specificato"/"n/d").\n' +
  '2. Campi che CAMBIANO nel tempo (scadenza, decorrenza, premi, importi, tassi, contraente,\n' +
  '   indirizzo): usa il valore del documento col PERIODO più recente.\n' +
  '3. Massimali/garanzie: quelli della polizza base/condizioni; NON confondere un massimale\n' +
  '   (importo grande) con franchigie, scoperti, sotto-limiti o minimi.\n' +
  '4. PREVENTIVO ≠ CONSUNTIVO: per i campi "preventivo/preventivato" usa il preventivo, non\n' +
  '   il consuntivo della regolazione.\n' +
  '5. Anagrafici stabili (n. polizza, P.IVA/CF, contraente): usa il valore COERENTE nella\n' +
  '   maggioranza dei documenti; ignora refusi OCR isolati.\n' +
  '6. Importi in formato italiano (3.000.000,00). Date GG/MM/AAAA.\n' +
  '7. Per OGNI campo includi "evidenza": il frammento di testo ESATTO, copiato\n' +
  '   letteralmente dal documento, in cui compare il valore. Se NON riesci a citare\n' +
  '   il valore copiandolo dal documento, lo stai inventando: NON restituire quel\n' +
  '   campo. NON usare MAI valori presi dalla guida campi o da esempi.\n' +
  'FORMATO: un solo oggetto JSON\n' +
  '{"id_campo": {"valore": "...", "documento": "nome file", "data_validita": "GG/MM/AAAA o null", "evidenza": "testo esatto copiato dal documento"}}\n' +
  'dove "data_validita" è la data (emissione/decorrenza/periodo) del documento da cui\n' +
  'hai preso il valore, se presente nel testo. Zero testo extra, zero markdown.'

// Campi STRUTTURALI: definiti dalla polizza base/appendici/condizioni (massimali,
// franchigie, scoperti, attività, prodotti, qualifica, garanzie). Una quietanza o
// una regolazione premio NON li contiene: valori attribuiti dal modello a quei
// documenti sono misletture (importi di premio spacciati per massimali).
// isStructuralField: importata da polizzaValidation.js.

// Rimuove le clausole d'esempio dalle descrizioni dei campi ("es. 3.000.000,00",
// "(es. 410000880)"). I modelli locali piccoli COPIANO gli esempi dal prompt
// invece di leggere i documenti (visto sul campo: massimali "3.000.000,00" e
// importi "240.000.000,00" identici agli esempi delle descrizioni). Per i
// provider cloud gli esempi restano: lì aiutano e non vengono copiati.
// stripFieldExamples: importata da polizzaValidation.js (taglia SOLO l'esempio,
// non tutto ciò che l'utente ha scritto dopo — vedi il bug del "VIETATO …").

// Check anti-allucinazione sugli importi (stessa logica di mergeRollingState):
// se il valore è un importo "puro", le sue cifre devono comparire nell'evidenza
// citata dal modello. In modalità severa (Ollama) un importo SENZA evidenza è
// considerato inventato: meglio un campo vuoto da compilare a mano che un numero
// sbagliato esportato in Excel.
function passesEvidenceCheck(cleaned, entry, strict) {
  const amount = parsePureAmount(cleaned)
  if (amount == null) return true // non è un importo puro: testo/date passano
  const evidenza = (entry && typeof entry === 'object' && typeof entry.evidenza === 'string' && entry.evidenza.trim())
    ? entry.evidenza : null
  if (!evidenza) return !strict
  const intDigits = String(Math.trunc(Math.abs(amount)))
  if (intDigits.length < 4) return true // importi corti: troppi falsi positivi
  return evidenza.replace(/\D/g, '').includes(intDigits)
}

// isPeriodicDocName: importata da polizzaValidation.js (documenti "periodici" =
// quietanze/regolazioni premio, ricchi di dati economici ma privi di massimali).

/**
 * Fascicoli che NON entrano nel contesto massimo del modello Ollama: il testo
 * viene spezzato in BATCH di documenti interi (separatori "===== DOCUMENTO: nome
 * =====" prodotti dai chiamanti), ogni batch passa dallo STESSO prompt whole-
 * dossier (che attribuisce già il documento sorgente e la data), e i batch
 * vengono uniti campo per campo: vince la data_validita più recente; senza date
 * il primo valore trovato resta. Guardrail: i campi strutturali sono accettati
 * solo da documenti non periodici. Ritorna la shape della chiamata singola.
 */
async function extractWholeDossierOllamaBatched(fullText, settings, activeFields, buildUserPrompt, batchCtx, diag = [], onProgress = null, consCtx = 32768) {
  const rawParts = String(fullText).split(/^===== DOCUMENTO: (.+?) =====$/m)
  const docs = []
  for (let i = 1; i < rawParts.length; i += 2) {
    docs.push({ name: rawParts[i].trim(), text: (rawParts[i + 1] || '').trim() })
  }
  if (!docs.length) docs.push({ name: 'documento', text: String(fullText) })

  // ORDINE: prima per VALORE INFORMATIVO, poi per data.
  //   Gruppo 1: polizza base / appendici / condizioni / altro — le uniche fonti dei
  //             campi strutturali: vanno lette per prime, sempre.
  //   Gruppo 2: regolazioni + quietanze — dati economici e date, dal più recente
  //             (il merge per data li fa comunque vincere sui valori più vecchi).
  // Data per documento: dal testo (regex) o dall'anno nel nome file; non databili
  // in coda al proprio gruppo, mantenendo l'ordine relativo.
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i]
    let ts = dateStrToTs(extractDocumentDateString(d.text) || null)
    if (ts == null) {
      const yearMatch = (d.name || '').match(/\b(19|20)\d{2}\b/)
      if (yearMatch) ts = Date.UTC(parseInt(yearMatch[0], 10), 6, 1)
    }
    d.ts = ts
    d.pos = i
    d.periodic = isPeriodicDocName(d.name)
  }
  // Data di copertura per nome documento: usata nel merge per datare i valori
  // che il modello attribuisce a un documento senza dichiararne la data_validita.
  const docTsByName = new Map(docs.map(d => [d.name, d.ts]))
  docs.sort((a, b) => {
    if (a.periodic !== b.periodic) return a.periodic ? 1 : -1
    if (a.ts != null && b.ts != null) return b.ts - a.ts
    if (a.ts != null) return -1
    if (b.ts != null) return 1
    return a.pos - b.pos
  })
  diag.push(`Ordine: prima polizza/appendici/condizioni, poi regolazioni/quietanze (dal più recente): ${docs.slice(0, 5).map(d => d.name).join(', ')}${docs.length > 5 ? ', …' : ''}`)

  // Budget di testo per batch: contesto del modello meno guida campi + system +
  // risposta (num_predict 3000) + margine, riconvertito in caratteri (~2,5/token).
  const reserveTokens = estimateOllamaTokens(WHOLE_DOSSIER_SYSTEM.length + buildUserPrompt('').length) + 3000 + 512
  const budgetChars = Math.max(4000, Math.floor((batchCtx - reserveTokens) * 2.5))

  // Pezzi = documenti interi (con la loro intestazione); i documenti più grandi
  // del budget vengono spezzati mantenendo l'intestazione, così l'attribuzione
  // "documento" del modello resta corretta.
  const pieces = []
  for (const doc of docs) {
    if (!doc.text) continue
    for (let off = 0; off < doc.text.length; off += budgetChars) {
      pieces.push({ text: `\n===== DOCUMENTO: ${doc.name} =====\n${doc.text.slice(off, off + budgetChars)}`, periodic: doc.periodic })
    }
  }
  const batches = []  // { text, allPeriodic }
  let current = null
  for (const piece of pieces) {
    if (current && current.text.length + piece.text.length > budgetChars) { batches.push(current); current = null }
    if (!current) current = { text: '', allPeriodic: true }
    current.text += piece.text
    if (!piece.periodic) current.allPeriodic = false
  }
  if (current) batches.push(current)
  // Indice dell'ultimo batch che contiene documenti del gruppo 1: prima di quel
  // punto l'uscita anticipata è vietata (i campi strutturali arrivano da lì).
  let lastStructuralBatch = -1
  for (let i = 0; i < batches.length; i++) if (!batches[i].allPeriodic) lastStructuralBatch = i
  diag.push(`Batch: ${docs.length} documenti in ${batches.length} chiamate (budget ~${budgetChars} char/batch, num_ctx ${batchCtx})`)

  const fieldsById = Object.fromEntries(activeFields.map(f => [f.id, f]))
  // best[id] = { valore, documento, ts } — vince la data più recente tra i batch
  const best = {}
  let consecutiveErrors = 0
  let guardrailDiscards = 0
  // MAI PIÙ "zero dopo un'attesa": se gli errori costringono a fermarsi ma
  // qualche campo è già stato raccolto, si restituisce il parziale con avviso.
  const partialOrThrow = (err) => {
    if (Object.keys(best).length > 0) {
      diag.push(`INTERROTTO per errori ripetuti: restituisco i ${Object.keys(best).length} campi raccolti finora. Ultimo errore: ${err.message}`)
      return true
    }
    return false
  }

  // Il consolidamento finale (una chiamata col sottoinsieme più informativo) è
  // previsto quando il fascicolo è stato spezzato: entra nel conteggio progresso.
  const willConsolidate = batches.length > 1
  const progressTotal = batches.length + (willConsolidate ? 1 : 0)
  let abortedByErrors = false

  let stopped = false
  for (let b = 0; b < batches.length && !stopped; b++) {
    onProgress?.({ batch: b + 1, batchTotal: progressTotal })
    // Batch di sole quietanze/regolazioni: il modello va avvisato esplicitamente
    // di NON inventare campi strutturali da questi documenti.
    const batchText = batches[b].allPeriodic
      ? `[NOTA: i documenti di questo blocco sono quietanze/regolazioni premio. NON contengono massimali, franchigie, scoperti né descrizioni di attività: NON compilare quei campi da questi documenti.]\n${batches[b].text}`
      : batches[b].text
    let parsed
    try {
      const raw = await callOllamaRolling(settings, WHOLE_DOSSIER_SYSTEM, buildUserPrompt(batchText),
        { numCtx: batchCtx, timeoutMs: 600000, diag })
      parsed = parseJsonResponse(raw)
      consecutiveErrors = 0
    } catch (err) {
      consecutiveErrors++
      console.warn(`[polizza:fascicolo] batch ${b + 1}/${batches.length} fallito:`, err.message)
      diag.push(`Batch ${b + 1}/${batches.length} FALLITO (si prosegue): ${err.message}`)
      // Provider giù o errori a raffica: inutile macinare i batch restanti.
      if (err.isLlmConnectionError || consecutiveErrors >= 3) {
        if (partialOrThrow(err)) { abortedByErrors = true; break }
        throw err
      }
      continue
    }

    let added = 0
    let discarded = 0
    let evidenceDiscarded = 0
    for (const [k, e] of Object.entries(parsed || {})) {
      if (!(k in fieldsById)) continue
      const val = (e && typeof e === 'object') ? e.valore : e
      const cleaned = sanitizeFieldValue(fieldsById[k], val)
      if (cleaned == null || cleaned === '') continue
      // ANTI-ALLUCINAZIONE (severo, siamo su Ollama): importi solo con evidenza
      // citata dal documento e coerente con le cifre del valore.
      if (!passesEvidenceCheck(cleaned, e, true)) { evidenceDiscarded++; continue }
      const documento = (e && typeof e === 'object' && e.documento) ? String(e.documento) : null
      // GUARDRAIL: un campo strutturale non può venire da una quietanza/regolazione
      // (né da un batch fatto solo di quelle, se il modello non attribuisce il doc).
      if (isStructuralField(fieldsById[k])) {
        const fromPeriodic = documento ? isPeriodicDocName(documento) : batches[b].allPeriodic
        if (fromPeriodic) { discarded++; continue }
      }
      const validita = (e && typeof e === 'object' && typeof e.data_validita === 'string')
        ? normalizeDateValue(e.data_validita) : null
      // Data EFFETTIVA del candidato: la data_validita del modello oppure la data
      // di copertura del documento attribuito ("i dati nuovi sovrascrivono i
      // vecchi" vale anche quando il modello non data il singolo valore).
      const ts = dateStrToTs(validita) ?? (documento ? (docTsByName.get(documento) ?? null) : null)
      const existing = best[k]
      // Il valore con data effettiva più recente vince. Tra valori entrambi SENZA
      // data resta il primo trovato: i batch sono già in ordine informativo
      // (polizza/appendici prima, poi periodici dal più recente) → spareggio
      // deterministico documentato, non un caso silenzioso.
      if (!existing || (ts != null && (existing.ts == null || ts > existing.ts))) {
        if (!existing) added++
        best[k] = { valore: cleaned, documento, ts }
      }
    }
    guardrailDiscards += discarded
    diag.push(`Batch ${b + 1}/${batches.length}: ${batches[b].text.length} char → +${added} campi (totale ${Object.keys(best).length})` +
      (discarded ? ` — guardrail: ${discarded} valori strutturali scartati (attribuiti a quietanze/regolazioni)` : '') +
      (evidenceDiscarded ? ` — ${evidenceDiscarded} importi scartati senza evidenza dal documento` : ''))

    // USCITA ANTICIPATA: solo DOPO aver letto tutti i batch con documenti del
    // gruppo 1 (le fonti dei campi strutturali). Da lì in poi i batch restanti
    // sono quietanze/regolazioni in ordine cronologico discendente: un campo
    // pieno non può essere migliorato da un documento più vecchio.
    if (b >= lastStructuralBatch && activeFields.every(f => f.id in best)) {
      const skipped = batches.length - (b + 1)
      if (skipped > 0) {
        diag.push(`Tutti i ${activeFields.length} campi valorizzati dopo il batch ${b + 1}/${batches.length}: salto i ${skipped} batch rimanenti (quietanze/regolazioni più vecchie).`)
      }
      stopped = true
    }
  }

  if (guardrailDiscards) {
    diag.push(`Guardrail totale: ${guardrailDiscards} valori strutturali scartati perché attribuiti a quietanze/regolazioni (non possono contenerli).`)
  }

  // ── CONSOLIDAMENTO FINALE ────────────────────────────────────────────────────
  // I batch non hanno visione d'insieme: un modello piccolo può leggere male un
  // valore anche da un documento legittimo (es. un premio da un'appendice
  // spacciato per massimale). Un'ultima chiamata con il sottoinsieme PIÙ
  // INFORMATIVO del fascicolo (polizza/appendici prima, poi i periodici più
  // recenti, fino a ~32K) e i valori candidati da verificare dà al modello il
  // quadro (semi-)completo — la modalità in cui i provider cloud producono il
  // risultato corretto. Mai fatale: se fallisce restano i risultati dei batch.
  if (willConsolidate && !abortedByErrors && Object.keys(best).length > 0) {
    onProgress?.({ batch: progressTotal, batchTotal: progressTotal })
    try {
      const candidateLines = Object.entries(best)
        .map(([k, e]) => `- ${k}: "${e.valore}"${e.documento ? ` ← ${e.documento}` : ''}`)
        .join('\n')
      const consHeader =
        `[VERIFICA FINALE: qui sotto trovi i VALORI CANDIDATI raccolti in una prima passata e i documenti ` +
        `PIÙ IMPORTANTI del fascicolo. Verifica ogni candidato sui documenti: se è corretto confermalo, se è ` +
        `sbagliato correggilo (stesso formato JSON), ometti i campi di cui questi documenti non parlano. ` +
        `NON inventare: massimali/franchigie/scoperti/attività SOLO da polizza/appendici/condizioni; ` +
        `preventivo ≠ consuntivo; per i valori che cambiano nel tempo vince il periodo più recente.]\n\n` +
        `VALORI CANDIDATI (da verificare):\n${candidateLines}\n`
      // Corpus: documenti interi nell'ordine informativo già calcolato, finché
      // stanno nel budget; se il primo documento da solo sfora, se ne prende l'inizio.
      const reserveCons = estimateOllamaTokens(WHOLE_DOSSIER_SYSTEM.length + buildUserPrompt('').length + consHeader.length) + 3000 + 512
      const consBudgetChars = Math.max(4000, Math.floor((consCtx - reserveCons) * 2.5))
      let corpus = ''
      const consDocs = []
      for (const doc of docs) {
        if (!doc.text) continue
        const piece = `\n===== DOCUMENTO: ${doc.name} =====\n${doc.text}`
        if (corpus.length + piece.length <= consBudgetChars) {
          corpus += piece
          consDocs.push(doc.name)
        } else if (!corpus) {
          corpus = piece.slice(0, consBudgetChars)
          consDocs.push(`${doc.name} (parziale)`)
        }
      }
      diag.push(`Consolidamento finale: ${consDocs.length} documenti (~${estimateOllamaTokens(corpus.length)} token, num_ctx ${consCtx}): ${consDocs.slice(0, 6).join(', ')}${consDocs.length > 6 ? ', …' : ''}`)

      const raw = await callOllamaRolling(settings, WHOLE_DOSSIER_SYSTEM, buildUserPrompt(consHeader + corpus),
        { numCtx: consCtx, timeoutMs: 600000, diag })
      const parsed = parseJsonResponse(raw)

      let corrected = 0, confirmed = 0, rejected = 0
      for (const [k, e] of Object.entries(parsed || {})) {
        if (!(k in fieldsById) || !(k in best)) continue // il consolidamento verifica, non aggiunge
        const val = (e && typeof e === 'object') ? e.valore : e
        const cleaned = sanitizeFieldValue(fieldsById[k], val)
        if (cleaned == null || cleaned === '') continue // anti-regressione: mai svuotare un candidato
        if (cleaned === best[k].valore) { // conferma: nessun check evidenza (il valore era già passato)
          confirmed++
          const documento = (e && typeof e === 'object' && e.documento) ? String(e.documento) : null
          if (documento && !(isStructuralField(fieldsById[k]) && isPeriodicDocName(documento))) best[k].documento = documento
          continue
        }
        // Una CORREZIONE deve superare gli stessi controlli dei batch: evidenza
        // per gli importi e guardrail strutturale.
        if (!passesEvidenceCheck(cleaned, e, true)) { rejected++; continue }
        const documento = (e && typeof e === 'object' && e.documento) ? String(e.documento) : null
        if (isStructuralField(fieldsById[k]) && documento && isPeriodicDocName(documento)) { rejected++; continue }
        corrected++
        const validita = (e && typeof e === 'object' && typeof e.data_validita === 'string')
          ? normalizeDateValue(e.data_validita) : null
        // Data effettiva della correzione: data_validita → data di copertura del
        // documento attribuito → data del candidato precedente (mai regressioni).
        const effTs = dateStrToTs(validita) ?? (documento ? (docTsByName.get(documento) ?? null) : null) ?? best[k].ts
        best[k] = { valore: cleaned, documento: documento || best[k].documento, ts: effTs }
      }
      diag.push(`Consolidamento: ${corrected} campi corretti, ${confirmed} confermati` +
        (rejected ? `, ${rejected} correzioni respinte (guardrail/evidenza)` : ''))
    } catch (err) {
      console.warn('[polizza:fascicolo] consolidamento fallito:', err.message)
      diag.push(`Consolidamento FALLITO (si tengono i risultati dei batch): ${err.message}`)
    }
  }

  const data = {}, sources = {}
  for (const [k, e] of Object.entries(best)) {
    data[k] = e.valore
    if (e.documento) sources[k] = { file: e.documento, page: '' }
  }
  diag.push(`Elaborazione a batch completata: ${Object.keys(data).length} campi validi`)
  return { data, sources, diag }
}

// ─── MOTORE "UNA DOMANDA PER CAMPO" (RAG per-campo, Ollama locale) ───────────
//
// Cambio di paradigma: invece di chiedere a un modello piccolo di compilare 24
// campi leggendo 45 documenti (compito in cui annega: copia esempi, spaccia
// premi per massimali, inventa), si recuperano i pochi frammenti pertinenti a
// OGNI campo e si pone UNA domanda focalizzata. I modelli locali sono affidabili
// sul compito piccolo. La FONTE (file+pagina) viene dai metadati del chunk
// recuperato, non dal modello → attribuzioni non inventabili, colonna "pag."
// finalmente popolata.

// isPeriodicEconomicField: importata da polizzaValidation.js (campi economici che
// cambiano nel tempo: il valore giusto è quello del documento più recente).

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

// Recupero top-k per coseno, con filtro opzionale sui tipi documento e boost
// (piccolo) per l'anno recente sui campi economici.
function cosineTopK(queryVec, chunks, { docTypes = null, k = 6, recencyBoost = false } = {}) {
  const maxYear = recencyBoost
    ? chunks.reduce((m, c) => Math.max(m, c.doc_year || 0), 0)
    : 0
  const scored = []
  for (const c of chunks) {
    if (docTypes && !docTypes.includes(c.doc_type)) continue
    let score = cosineSim(queryVec, c.vector)
    if (recencyBoost && c.doc_year && maxYear) {
      // fino a +0,05 per il documento più recente: separa i pari-merito senza
      // scavalcare un match semantico forte.
      score += 0.05 * (c.doc_year / maxYear)
    }
    scored.push({ c, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k).map(s => s.c)
}

const PERFIELD_SYSTEM =
  'Sei un estrattore di UN SINGOLO dato da documenti assicurativi italiani.\n' +
  'Ricevi il NOME e la DESCRIZIONE di un campo e alcuni ESTRATTI di documenti.\n' +
  'REGOLE TASSATIVE:\n' +
  '1. Restituisci il valore del campo SOLO se è ESPLICITAMENTE presente negli estratti.\n' +
  '2. Se gli estratti non contengono il valore, rispondi esattamente {} — è il caso\n' +
  '   NORMALE e corretto. Non forzare, non dedurre, NON inventare.\n' +
  '3. NON usare MAI numeri o testi presi dalla descrizione del campo o da esempi:\n' +
  '   devono provenire dagli estratti dei documenti.\n' +
  '4. "evidenza" = il frammento di testo ESATTO, copiato letteralmente dagli\n' +
  '   estratti, in cui compare il valore. Se non riesci a citarlo, stai inventando:\n' +
  '   rispondi {}.\n' +
  '5. Importi in formato italiano (es. 3.000.000,00). Date in GG/MM/AAAA.\n' +
  'FORMATO: un solo oggetto JSON {"valore": "...", "evidenza": "testo esatto copiato"}\n' +
  'oppure {} se il valore non è presente. Zero testo extra, zero markdown.'

/**
 * Estrazione "per campo": indice in memoria (embeddings locali via Ollama) +
 * una domanda focalizzata per ogni campo. Ritorna la stessa shape della chiamata
 * singola { data, sources, diag }. Ripiega su extractPolizzaFromFullText se gli
 * embeddings non sono disponibili.
 */
export async function extractPolizzaPerField(docs, fullText, settings, onProgress = null) {
  const configuredFields = (settings.polizzaFields?.length > 0) ? settings.polizzaFields : ALL_POLIZZA_FIELDS
  const activeFields = configuredFields.filter(f => f.enabled !== false)
  const diag = []
  diag.push(`Motore per-campo: ${activeFields.length} campi, ${docs.length} documenti`)

  // 1. Indice in memoria: chunk di ogni pagina con metadati (file, pagina, tipo, anno).
  // Pagine COLLASSATE (collapseSpatial): i chunk sono frammenti a cap fisso
  // (1200 char) — il padding della griglia spaziale li diluirebbe.
  const chunks = []
  for (const d of docs || []) {
    const name = d?.name || 'documento.pdf'
    const docType = classifyDocType(name)
    const docYear = detectDocYear(name, (d?.pages || []).join('\n'))
    ;(d?.pages || []).forEach((pageText, pIdx) => {
      for (const t of chunkText(collapseSpatial(pageText))) {
        chunks.push({ text: t, file: name, page: pIdx + 1, doc_type: docType, doc_year: docYear })
      }
    })
  }
  if (!chunks.length) {
    diag.push('Nessun testo OCR: ripiego su fascicolo intero')
    return extractPolizzaFromFullText(fullText, settings, onProgress)
  }

  // 2. Embedding dei chunk (una passata a lotti) + delle query dei campi.
  const EMBED_BATCH = 32
  try {
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH)
      const vecs = await embedTexts(settings, batch.map(c => c.text))
      batch.forEach((c, j) => { c.vector = vecs[j] })
    }
  } catch (err) {
    diag.push(`Embeddings non disponibili (${err.message}): ripiego sul motore a stadi. Suggerimento: «ollama pull ${settings.embeddingModel || 'bge-m3'}».`)
    const fb = await extractPolizzaStaged(docs, settings, onProgress)
    return { ...fb, diag: [...diag, ...(fb.diag || [])] }
  }
  diag.push(`Indice in memoria: ${chunks.length} chunk (modello embeddings ${settings.embeddingModel || 'bge-m3'})`)

  const queries = activeFields.map(f => `${f.label}. ${stripFieldExamples(f.description || f.label || f.id)}`)
  let queryVecs
  try {
    queryVecs = []
    for (let i = 0; i < queries.length; i += EMBED_BATCH) {
      queryVecs.push(...await embedTexts(settings, queries.slice(i, i + EMBED_BATCH)))
    }
  } catch (err) {
    diag.push(`Embedding query fallito (${err.message}): ripiego sul motore a stadi.`)
    const fb = await extractPolizzaStaged(docs, settings, onProgress)
    return { ...fb, diag: [...diag, ...(fb.diag || [])] }
  }

  // 3-6. Una domanda per campo.
  const STRUCT_DOCTYPES = ['polizza', 'appendice', 'condizioni', 'altro']
  const CONTEXT_CHARS = 2500
  const data = {}, sources = {}
  let valued = 0, evidenceDropped = 0, absent = 0
  let consecutiveErrors = 0
  const verList = String(settings.polizzaVerificaCampi || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const isFlagged = (f) => verList.some(v => v === String(f.id).toLowerCase() || v === String(f.label || '').toLowerCase() || (v.length >= 3 && String(f.label || '').toLowerCase().includes(v)))

  for (let i = 0; i < activeFields.length; i++) {
    const f = activeFields[i]
    onProgress?.({ field: i + 1, fieldTotal: activeFields.length })

    const opts = isStructuralField(f)
      ? { docTypes: STRUCT_DOCTYPES, k: 6 }
      : { docTypes: null, k: 6, recencyBoost: isPeriodicEconomicField(f) }
    let hits = cosineTopK(queryVecs[i], chunks, opts)
    // Campo strutturale senza hit tra i documenti "buoni": nessun ripiego sulle
    // quietanze/regolazioni (è proprio ciò che vogliamo evitare) → campo assente.
    if (!hits.length) { absent++; continue }

    let ctx = '', used = []
    for (const h of hits) {
      const block = `[${h.file} · pag. ${h.page}]\n${h.text}`
      if (ctx.length + block.length > CONTEXT_CHARS && ctx) break
      ctx += (ctx ? '\n---\n' : '') + block
      used.push(h)
    }
    const desc = stripFieldExamples(f.description || f.label || f.id)
    const userPrompt =
`CAMPO: ${f.label}
DESCRIZIONE: ${desc}

ESTRATTI DEI DOCUMENTI:
${ctx}

Restituisci SOLO il JSON {"valore":"...","evidenza":"frammento esatto copiato"} oppure {} se gli estratti non contengono il valore.`

    const askOnce = async () => parseJsonResponse(
      await callOllamaRolling(settings, PERFIELD_SYSTEM, userPrompt, { numCtx: 8192, timeoutMs: 120000 })
    )

    let entry
    try {
      entry = await askOnce()
      // Consenso opzionale per i campi flaggati (stesso contesto, voto di maggioranza).
      if (isFlagged(f)) {
        const passes = Math.max(2, Math.min(5, parseInt(settings.polizzaConsensusPasses, 10) || 3))
        const deltas = [{ [f.id]: entry }]
        for (let p = 1; p < passes; p++) deltas.push({ [f.id]: await askOnce() })
        entry = consensusDelta(deltas)[f.id] || {}
      }
      consecutiveErrors = 0
    } catch (err) {
      consecutiveErrors++
      diag.push(`Campo "${f.id}": errore (${err.message})`)
      if (err.isLlmConnectionError || consecutiveErrors >= 3) {
        diag.push(`INTERROTTO per errori ripetuti: ${Object.keys(data).length} campi raccolti finora.`)
        break
      }
      continue
    }

    const val = (entry && typeof entry === 'object') ? entry.valore : entry
    const cleaned = sanitizeFieldValue(f, val)
    if (cleaned == null || cleaned === '') { absent++; continue }
    if (!passesEvidenceCheck(cleaned, entry, true)) { evidenceDropped++; continue }

    data[f.id] = cleaned
    // Fonte dai METADATI del chunk che contiene l'evidenza (non dal modello).
    const evid = (entry && typeof entry.evidenza === 'string') ? entry.evidenza.replace(/\s+/g, ' ').trim() : ''
    const src = (evid && used.find(h => h.text.replace(/\s+/g, ' ').includes(evid.slice(0, 40)))) || used[0]
    if (src) sources[f.id] = { file: src.file, page: src.page }
    valued++
  }

  diag.push(`Per-campo: ${valued} valorizzati, ${evidenceDropped} scartati senza evidenza, ${absent} assenti su ${activeFields.length}`)
  return { data, sources, diag }
}

// ═════════════════════════════════════════════════════════════════════════════
// MOTORE A STADI (Ollama su hardware debole: 7B / 8GB VRAM)
//
// Un'unica chiamata gigante su un fascicolo di 45 documenti diluisce la polizza
// base e fa allucinare i modelli piccoli. Qui il lavoro è spezzato in PASSAGGI
// piccoli e mirati, ciascuno dentro il contesto che il modello regge davvero:
//   A. analisi deterministica (classificazione+datazione documenti, seed regex);
//   B. una chiamata per GRUPPO di campi (strutturali/economici/anagrafica), con
//      SOLO i documenti pertinenti a quel gruppo;
//   C. validazione dura (placeholder, checksum, evidenza nel testo);
//   D. merge "il documento più recente vince" + fonti reali (file+pagina cercando
//      l'evidenza nelle pagine, non il "documento" asserito dal modello);
//   E. recupero mirato: seconda passata focalizzata sui campi ancora vuoti.
// Politica: MEGLIO VUOTO CHE SBAGLIATO — ciò che non supera la validazione
// viene scartato, mai mostrato.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Modello Ollama effettivo: l'override polizzaWholeDossierModel vale solo se non
 * è palesemente un modello cloud (claude-… / gpt-… → 404 sul server locale).
 */
function resolveOllamaModel(settings) {
  const override = String(settings.polizzaWholeDossierModel || '').trim()
  const model = (override && !/^(claude|gpt)-/i.test(override)) ? override : (settings.ollamaModel || '')
  if (!model) {
    throw new Error('Nessun modello Ollama configurato: imposta il "Modello" nella sezione Ollama delle Impostazioni.')
  }
  return model
}

const APPENDIX_ORD_RE = /appendice\s*(?:n[°.\s]*)?(\d{1,3})/i

/**
 * Stage A — analisi deterministica dei documenti (nessuna chiamata LLM).
 * Datazione = MASSIMA data di copertura, CONTENUTO-prima:
 *   1. latestDateExcludingEmission sull'intero testo: le quietanze ristampano in
 *      testa la SCADENZA CONTRATTUALE originale (es. 31/12/2008) — prendere la
 *      "prima SCADENZA" daterebbe tutte le quietanze come la polizza base,
 *      neutralizzando la regola "il più recente vince". La massima data
 *      non-di-emissione cattura invece la fine del periodo di rata/regolazione.
 *   2. anno nel nome file → 01/07/AAAA; vince il MAX tra contenuto e nome file
 *      (un OCR cieco non deve retrodatare una "quietanza 2025.pdf");
 *   3. ordinale d'appendice ("appendice 12" > "appendice 8") come spareggio;
 *   4. nessuna data → il candidato non potrà mai scavalcare un valore datato.
 */
function analyzeStagedDocs(docs) {
  return (docs || []).map((d, i) => {
    const name = d?.name || `documento_${i + 1}.pdf`
    // DOPPIO TESTO. Le pagine arrivano SPAZIALI (griglia a colonne dall'OCR):
    // - spatialPages → i PROMPT al modello (l'allineamento è l'informazione);
    // - pages/text (PIATTI, derivati con collapseSpatial) → regex di Stadio A,
    //   datazione, embeddings, chunk RAG, finestre di contesto: tutte cose
    //   scritte per righe corte, che il padding romperebbe (la regex del n°
    //   polizza arrivava a CONCATENARE cifre di colonne diverse).
    const spatialPages = Array.isArray(d?.pages) ? d.pages.map((p) => String(p || '')) : []
    const pages = spatialPages.map(collapseSpatial)
    const text = pages.join('\n')
    let dateStr = latestDateExcludingEmission(text) || null
    const ym = name.match(/\b(19|20)\d{2}\b/)
    if (ym) {
      const fromName = `01/07/${ym[0]}`
      if (!dateStr || (dateStrToTs(fromName) ?? -Infinity) > (dateStrToTs(dateStr) ?? -Infinity)) {
        dateStr = fromName
      }
    }
    const om = name.match(APPENDIX_ORD_RE)
    return {
      name, pages, spatialPages, text,
      normPages: pages.map((p) => normForMatch(p)),
      type: classifyDocType(name),
      dateStr,
      ts: dateStrToTs(dateStr),
      appendixOrd: om ? parseInt(om[1], 10) : null,
      pos: i,
    }
  }).filter((d) => d.text.trim().length > 0)
}

// Ordinamento "più recente prima": data di copertura, poi ordinale appendice,
// poi posizione originale (deterministico).
function byStagedRecency(a, b) {
  if (a.ts != null || b.ts != null) {
    if (a.ts == null) return 1
    if (b.ts == null) return -1
    if (a.ts !== b.ts) return b.ts - a.ts
  }
  if ((a.appendixOrd ?? -1) !== (b.appendixOrd ?? -1)) return (b.appendixOrd ?? -1) - (a.appendixOrd ?? -1)
  return a.pos - b.pos
}

/**
 * Documenti pertinenti per un gruppo di campi, in ordine di priorità informativa.
 * I campi strutturali NON vedono mai quietanze/regolazioni (guardrail per
 * costruzione, non per prompt).
 */
function selectGroupDocs(kind, analyzed) {
  // DECISIONE DEFINITIVA — documenti TUTTI UGUALI: ogni dato può stare in
  // qualsiasi tipologia di file, quindi OGNI gruppo legge TUTTI i documenti
  // (copertura totale garantita dai batch), ordinati dal più recente al più
  // vecchio. Niente più fette per tipo: erano loro a tagliare fuori i
  // documenti coi candidati giusti (es. l'appendice di rinnovo col preventivo
  // aggiornato non veniva mai letta dal gruppo economici).
  void kind
  return [...analyzed].sort(byStagedRecency)
}

/**
 * Batch di contesto di un gruppo: COPERTURA TOTALE, mai troncamenti.
 * Blocchi "[file · pag. N]" in ordine di priorità documenti (pagine in ordine
 * naturale), impacchettati in QUANTI BATCH SERVONO perché OGNI pagina di OGNI
 * documento del gruppo venga letta dal modello: se il fascicolo non sta in una
 * chiamata se ne fanno di più, e il merge per recency ricompone i risultati.
 * (Il vecchio schema quota-e-taglia lasciava fuori proprio le pagine coi dati:
 * attività a pag. 23, P.IVA del contraente a pag. 10 — mai più.)
 */
function buildGroupBatches(docList, budgetChars) {
  const batches = []
  let parts = []
  let used = 0
  let names = new Set()
  const flush = () => {
    if (parts.length) batches.push({ text: parts.join('\n\n'), usedNames: names })
    parts = []; used = 0; names = new Set()
  }
  for (const d of docList) {
    // Ai PROMPT va il testo SPAZIALE (colonne preservate); il budget si misura
    // in caratteri UTILI (usefulLength): le run di spazi del padding costano
    // quasi zero token ma 1:1 in char — contarle piene rimpiccioliva i batch
    // e separava etichetta e valore, l'esatto contrario dello scopo.
    const promptPages = d.spatialPages?.length === d.pages.length ? d.spatialPages : d.pages
    for (let p = 0; p < promptPages.length; p++) {
      const t = promptPages[p]?.trim()
      if (!t) continue
      let block = `[${d.name} · pag. ${p + 1}]\n${t}`
      let cost = usefulLength(block)
      if (cost > budgetChars) { block = block.slice(0, budgetChars * 2); cost = usefulLength(block) } // pagina singola oltre il budget: caso limite
      if (used + cost + 2 > budgetChars) flush()
      parts.push(block)
      names.add(d.name)
      used += cost + 2
    }
  }
  flush()
  return batches
}

// Prompt di sistema condiviso dei passaggi per gruppo + note specifiche.
const STAGED_GROUP_NOTES = {
  strutturali:
    'NOTA: questi campi (massimali, franchigie, scoperti, attività, prodotti, qualifica, garanzie)\n' +
    'esistono SOLO in polizza/appendici/condizioni. NON confondere un massimale (importo grande)\n' +
    'con franchigie, scoperti, sotto-limiti, minimi o premi. Un\'appendice di variazione più\n' +
    'recente prevale sulla polizza base.',
  economici:
    'NOTA: premi, tassi, imposte e importi cambiano ogni anno: usa il documento di regolazione/\n' +
    'quietanza con il PERIODO più recente. PREVENTIVO ≠ CONSUNTIVO: per i campi "preventivo"\n' +
    'usa il valore preventivato, non il consuntivo della regolazione.',
  anagrafica:
    'NOTA: dati anagrafici e date di copertura. Se un\'appendice di variazione (cambio contraenza,\n' +
    'cambio indirizzo) o una quietanza recente riporta un dato aggiornato, quel valore prevale\n' +
    'sulla polizza base. Per decorrenza/scadenza usa il periodo di copertura più RECENTE.\n' +
    'P.IVA/Codice Fiscale: SEMPRE quello del CONTRAENTE/assicurato, MAI quello della compagnia\n' +
    'assicuratrice (la P.IVA nell\'intestazione della compagnia non va usata).\n' +
    'Agenzia: è quella indicata come "AGENZIA DI …"/"Agenzia" che gestisce la polizza — una\n' +
    'PIAZZA/località, spesso accanto a "COD. AGENZIA" in testa a quietanze/regolazioni (es.\n' +
    '"001 00 ACQUI TERME" → "ACQUI TERME"). Se l\'agenzia è cambiata negli anni riporta la più\n' +
    'RECENTE. MAI il nome della compagnia, la sede legale o la direzione.',
}

function stagedSystemPrompt(kind) {
  return (
    'Sei un estrattore di dati da un fascicolo assicurativo italiano (polizze RC).\n' +
    'Ricevi ALCUNI documenti del fascicolo e un ELENCO RIDOTTO di campi.\n' +
    'REGOLE TASSATIVE:\n' +
    '1. Estrai un valore SOLO se è ESPLICITAMENTE presente nel testo. Se un campo non c\'è,\n' +
    '   OMETTILO. MAI scrivere "non specificato", "n/d", "null" o simili.\n' +
    '2. Se lo stesso dato compare in più documenti, usa SEMPRE quello con il PERIODO più\n' +
    '   recente (un\'appendice o quietanza recente prevale sulla polizza base).\n' +
    '3. Per OGNI campo includi "evidenza": il frammento ESATTO copiato dal documento in cui\n' +
    '   compare il valore. Se non riesci a copiarlo, lo stai inventando: ometti il campo.\n' +
    '4. Importi in formato italiano (es. 3.000.000,00). Date in GG/MM/AAAA.\n' +
    '5. Il testo conserva l\'IMPAGINAZIONE originale: le colonne sono allineate in verticale con gli spazi,\nun valore può stare INCOLONNATO sotto la propria etichetta anche a righe di distanza.\n' +
    `${STAGED_GROUP_NOTES[kind] || ''}\n` +
    'FORMATO: un solo oggetto JSON\n' +
    '{"id_campo": {"valore":"...", "documento":"nome file", "data_validita":"GG/MM/AAAA o null", "evidenza":"testo esatto copiato"}}\n' +
    'Zero testo extra, zero markdown.'
  )
}

// Stopword del dominio per il ranking lessicale del recupero: parole presenti in
// quasi ogni pagina di una polizza — usarle come segnale renderebbe il punteggio
// puro rumore da boilerplate (header, footer, diciture standard).
const STAGED_STOPWORDS = new Set([
  'polizza', 'polizze', 'assicurato', 'assicurata', 'assicurati', 'assicurativa', 'assicurazione',
  'assicurazioni', 'contraente', 'compagnia', 'documento', 'documenti', 'descrizione', 'indicato',
  'indicata', 'valore', 'campo', 'campi', 'della', 'delle', 'dello', 'degli', 'dalla', 'dalle',
  'nella', 'nelle', 'come', 'ogni', 'sono', 'viene', 'vengono', 'quanto', 'quale', 'quali',
  'presente', 'presenti', 'relativo', 'relativa', 'esempio', 'oppure', 'anche', 'condizioni',
  'generali', 'articolo', 'articoli', 'pagina', 'numero', 'data', 'dati', 'euro', 'importo',
])

// NB: la versione precedente permetteva "rispondi {} se nessuno c'è" — a
// temperatura 0 il modello prendeva SEMPRE quella scorciatoia (4 run reali di
// fila: 2 token generati, "{}", 0 recuperi). Ora una voce per OGNI campo è
// OBBLIGATORIA: per dichiarare un campo assente serve {"valore": null} — il
// modello deve comunque cercarlo, e la pigrizia non produce più un JSON valido.
const STAGED_RECOVERY_SYSTEM =
  'Sei un estrattore di POCHI dati specifici da estratti di documenti assicurativi italiani.\n' +
  'REGOLE TASSATIVE:\n' +
  '1. Rispondi con UNA voce per OGNI campo richiesto: nessun campo può mancare dalla risposta.\n' +
  '2. Se il valore di un campo è presente negli estratti: {"valore":"...", "evidenza":"frammento ESATTO copiato"}.\n' +
  '3. Se NON è presente: {"valore": null} — è un esito normale. Non forzare, non dedurre, NON inventare.\n' +
  '4. "evidenza" = il frammento ESATTO copiato dagli estratti in cui compare il valore.\n' +
  '   Se non riesci a citarlo, stai inventando: usa {"valore": null}.\n' +
  '5. Importi in formato italiano (es. 3.000.000,00). Date in GG/MM/AAAA.\n' +
  '6. Il testo conserva l\'IMPAGINAZIONE originale: le colonne sono allineate in verticale con gli spazi,\nun valore può stare INCOLONNATO sotto la propria etichetta anche a righe di distanza.\n' +
  'FORMATO: un solo oggetto JSON {"id_campo": {"valore":"…"|null, "evidenza":"…"}}.\n' +
  'Zero testo extra, zero markdown.'

// Stadio B a CASCATA: un documento alla volta, dal più recente al più vecchio,
// chiedendo SOLO i campi ancora vuoti. Il contratto per-campo con null
// obbligatorio è lo stesso del recupero (la pigrizia non produce JSON valido).
const STAGED_CASCADE_SYSTEM =
  'Sei un estrattore di dati da UN documento assicurativo italiano alla volta.\n' +
  'REGOLE TASSATIVE:\n' +
  '1. Rispondi con UNA voce per OGNI campo richiesto: nessun campo può mancare dalla risposta.\n' +
  '2. Se il valore del campo è presente in QUESTO documento: {"valore":"...", "evidenza":"frammento ESATTO copiato"}.\n' +
  '3. Se NON è presente in questo documento: {"valore": null} — è un esito NORMALE e frequente\n' +
  '   (ogni documento contiene solo alcuni dati). Non forzare, non dedurre, NON inventare.\n' +
  '4. Un numero va assegnato a un campo SOLO se il testo attorno dice che è quel dato:\n' +
  '   mai "è l\'unico numero della pagina" o "c\'è una parola simile vicino".\n' +
  '5. "evidenza" = frammento ESATTO copiato dal documento. Se non riesci a citarlo, usa {"valore": null}.\n' +
  '6. Importi in formato italiano (es. 3.000.000,00). Date in GG/MM/AAAA.\n' +
  '7. Il testo conserva l\'IMPAGINAZIONE originale: le colonne sono allineate in verticale con gli spazi,\nun valore può stare INCOLONNATO sotto la propria etichetta anche a righe di distanza.\n' +
  'FORMATO: un solo oggetto JSON {"id_campo": {"valore":"…"|null, "evidenza":"…"}}.\n' +
  'Zero testo extra, zero markdown.'

/**
 * Fonte REALE di un valore: cerca l'evidenza (poi il valore) normalizzata nelle
 * pagine dei documenti — prima quelli usati nel contesto della chiamata, poi
 * tutti. Il "documento" asserito dal modello è solo l'ultimo fallback, e solo
 * se combacia con un file reale del fascicolo.
 */
function findStagedSource(analyzed, evidenza, cleaned, preferredNames = null) {
  const ordered = preferredNames
    ? [...analyzed].sort((a, b) => (preferredNames.has(a.name) ? 0 : 1) - (preferredNames.has(b.name) ? 0 : 1))
    : analyzed
  const tryNeedle = (needle, docs) => {
    if (!needle || needle.length < 4) return null
    for (const d of docs) {
      for (let p = 0; p < d.normPages.length; p++) {
        if (d.normPages[p].includes(needle)) return { file: d.name, page: p + 1, doc: d }
      }
    }
    // evidenza a cavallo di due pagine: match a livello documento, pagina ignota
    for (const d of docs) {
      if (d.normPages.join('').includes(needle)) return { file: d.name, page: '', doc: d }
    }
    return null
  }
  const ne = evidenza ? normForMatch(evidenza).slice(0, 40) : ''
  const nv = cleaned != null ? normForMatch(String(cleaned)) : ''
  // Il fallback sul VALORE nudo (un numero puro, una data) è ristretto ai
  // documenti del CONTESTO della chiamata: cifre come "3000000" compaiono
  // ovunque nel fascicolo e attribuirle a un documento arbitrario inquinerebbe
  // docType/effDate — cioè le decisioni di recenza del merge.
  const preferredOnly = preferredNames ? ordered.filter((d) => preferredNames.has(d.name)) : ordered
  return tryNeedle(ne, ordered) || tryNeedle(nv, preferredOnly)
}

// "documento" asserito dal modello → documento reale del fascicolo, se combacia
// (esatto → case-insensitive → senza estensione). Altrimenti null.
function matchRealDoc(analyzed, docName) {
  const n = String(docName || '').trim()
  if (!n) return null
  return analyzed.find((d) => d.name === n)
    || analyzed.find((d) => d.name.toLowerCase() === n.toLowerCase())
    || analyzed.find((d) => d.name.toLowerCase().replace(/\.pdf$/i, '') === n.toLowerCase().replace(/\.pdf$/i, ''))
    || null
}

/**
 * Stage C+D per un blocco di risposte: valida ogni entry (scala completa) e la
 * fonde in `best`. Il merge è AGNOSTICO rispetto ai campi: niente classi a
 * parole chiave — decide l'arbitro semantico (affinità descrizione↔contesto,
 * calcolata dal chiamante via `affinityFor`) e, tra candidati comparabili, la
 * recency ("i dati nuovi sovrascrivono i vecchi").
 * @param {Function|null} affinityFor  async (field, cleaned, evidenza, srcDoc) → number|null
 * @returns {number} candidati che hanno superato la validazione (arrivati al merge)
 */
async function absorbStagedEntries(parsed, groupFields, best, kindOf, analyzed, normCtx, usedNames, counters, report = null, affinityFor = null) {
  const byId = Object.fromEntries(groupFields.map((f) => [f.id, f]))
  // report (opzionale): esito PER CAMPO per la diagnostica — i soli conteggi
  // aggregati rendevano ogni run un tirare a indovinare su CHI fosse stato
  // scartato e con quale valore.
  const note = (id, outcome, value, aff) => {
    if (report) report.push({ id, outcome, value: value == null ? '' : String(value).slice(0, 28), aff: typeof aff === 'number' ? aff : null })
  }
  let accepted = 0
  for (const [k0, e] of Object.entries(parsed || {})) {
    // Chiave storpiata dal modello (visto in produzione: "311ac411-…" per il
    // campo "311ac415-…"): i modelli piccoli ricopiano male gli id lunghi.
    // Fuzzy SOLO se univoco e se l'id vero non è già presente ESATTO nella
    // risposta (altrimenti sarebbe un duplicato, non un refuso).
    const k = byId[k0] ? k0 : (matchFieldKey(k0, Object.keys(byId).filter((id) => !(id in (parsed || {})))) || k0)
    const field = byId[k]
    if (!field) { counters.unknown++; continue }
    if (k !== k0) note(k, 'chiave-corretta', k0)
    const val = (e && typeof e === 'object') ? e.valore : e
    if (val == null || String(val).trim() === '') { counters.sanitized++; note(k, 'vuoto/null'); continue }
    if (isPlaceholderValue(val)) { counters.placeholders++; note(k, 'placeholder', val); continue }
    const cleaned = sanitizeFieldValue(field, val)
    if (cleaned == null || cleaned === '') { counters.sanitized++; note(k, 'sanitizzato', val); continue }
    if (!passesStagedEvidence(field, cleaned, e, normCtx)) { counters.noEvidence++; note(k, 'senza-evidenza', cleaned); continue }
    const modelDoc = (e && typeof e === 'object' && typeof e.documento === 'string') ? e.documento : ''

    // Guardie di VALORE (non tassonomia dei campi): riconoscono un concetto nel
    // testo configurato del campo (id+etichetta+descrizione) e sono inerti nei
    // profili che non lo contengono. Il footer societario è un obbligo normativo
    // (vale per ogni compagnia), i rinvii non sono descrizioni, una S.p.A. non è
    // una piazza di agenzia.
    const fieldText = `${field.id || ''} ${field.label || ''} ${field.description || ''}`
    if (/attivit/i.test(fieldText) && isRinvioAttivita(cleaned)) { counters.guardrail++; note(k, 'guardrail:rinvio-attivita', cleaned); continue }
    if (/agenzia/i.test(fieldText) && isCompanyNameAsAgency(cleaned)) { counters.guardrail++; note(k, 'guardrail:agenzia=compagnia', cleaned); continue }

    const evidenza = (e && typeof e === 'object' && typeof e.evidenza === 'string') ? e.evidenza : ''
    const source = findStagedSource(analyzed, evidenza, cleaned, usedNames)
    const srcDoc = source?.doc || matchRealDoc(analyzed, modelDoc)
    if (/fiscale|iva|\bcf\b/i.test(fieldText) && srcDoc?.text && isInsurerFooterPIva(srcDoc.text, cleaned)) { counters.guardrail++; note(k, 'guardrail:piva-assicuratore', cleaned); continue }

    // data_validita è output libero del modello: vale SOLO se quella data compare
    // davvero nel contesto inviato — altrimenti una data allucinata scavalcherebbe
    // candidati datati correttamente.
    const rawValidita = (e && typeof e === 'object' && typeof e.data_validita === 'string')
      ? normalizeDateValue(e.data_validita) : null
    const validita = (rawValidita && normCtx.includes(rawValidita.replace(/\//g, ''))) ? rawValidita : null
    const effDate = validita
      || (field.type === 'date' ? cleaned : null)
      || srcDoc?.dateStr
      || null
    const affPair = affinityFor ? await affinityFor(field, cleaned, evidenza, srcDoc) : null
    const cand = {
      valore: cleaned,
      effDate,
      affinity: affPair && typeof affPair === 'object' ? affPair.aff : affPair,
      // lex: somiglianza LESSICALE deterministica tra il contesto attorno al
      // valore e la descrizione del campo — è l'UNICO spareggio a pari data
      // (documenti tutti uguali: nessuna logica per tipo, decisione definitiva).
      lex: affPair && typeof affPair === 'object' ? affPair.lex : null,
      docType: srcDoc?.type ?? null,
      appendixOrd: srcDoc?.appendixOrd ?? null,
      docPos: srcDoc?.pos ?? null,
      file: source?.file || srcDoc?.name || null,
      page: source?.page ?? '',
    }
    // ARBITRO SEMANTICO: affinità nettamente diversa → vince la più alta;
    // collasso numerico >80% solo con affinità superiore; comparabili → recency
    // (a pari data: spareggio lessicale sulla descrizione, mai il tipo file).
    const won = pickSemanticCandidate(best[k], cand, kindOf[k])
    note(k, won === cand ? 'ok' : 'ok-ma-perde-merge', cleaned, cand.affinity)
    best[k] = won
    accepted++
  }
  return accepted
}

/**
 * Motore a stadi: estrazione Ollama in passaggi piccoli e mirati.
 * Stessa shape degli altri motori: { data, sources, diag }.
 */
export async function extractPolizzaStaged(docs, settings, onProgress = null) {
  const configuredFields = (settings.polizzaFields?.length > 0) ? settings.polizzaFields : ALL_POLIZZA_FIELDS
  const activeFields = configuredFields.filter(f => f.enabled !== false)
  const fieldsById = Object.fromEntries(activeFields.map(f => [f.id, f]))
  const diag = []
  const best = {}   // id → candidato vincente { valore, effDate, docType, file, page, … }

  const ollamaModel = resolveOllamaModel(settings)
  const s2 = { ...settings, ollamaModel }
  const modelLimit = await getOllamaContextLimit(s2, ollamaModel)
  diag.push(`Motore a stadi (Ollama): ${activeFields.length} campi, ${docs?.length || 0} documenti, modello ${ollamaModel} (limite contesto ${modelLimit || 'sconosciuto'})`)

  // ── Stage A: analisi deterministica ────────────────────────────────────────
  const analyzed = analyzeStagedDocs(docs)
  if (!analyzed.length) {
    diag.push('Nessun testo utilizzabile nei documenti.')
    return { data: {}, sources: {}, diag }
  }
  const typeCounts = {}
  let undated = 0
  for (const d of analyzed) {
    typeCounts[d.type] = (typeCounts[d.type] || 0) + 1
    if (!d.dateStr) undated++
  }
  diag.push(`Stadio A: ${Object.entries(typeCounts).map(([t, n]) => `${n} ${t}`).join(', ')} — ${undated} senza data (datazione per periodo di copertura, mai per emissione)`)

  // Partizione dei campi + mappa id → genere (per priorità documenti e merge)
  const partition = partitionFields(activeFields)
  const kindOf = {}
  for (const [kind, list] of Object.entries(partition)) for (const f of list) kindOf[f.id] = kind

  // ── Stage A: seed regex (deterministici, checksum-validati) ────────────────
  const basePool = (analyzed.filter((d) => d.type === 'polizza').length
    ? analyzed.filter((d) => d.type === 'polizza')
    : analyzed.filter((d) => !isPeriodicDocName(d.name))).sort(byStagedRecency)
  const seedNotes = []
  if ('polizza_numero' in fieldsById) {
    const numCount = new Map()
    for (const d of basePool) {
      const rx = extractFieldsWithRegex(d.text)
      if (rx.polizza_numero) {
        const cur = numCount.get(rx.polizza_numero) || { n: 0, doc: d }
        numCount.set(rx.polizza_numero, { n: cur.n + 1, doc: cur.doc })
      }
    }
    if (numCount.size) {
      // Preferisci il numero presente in più documenti base; a parità il più recente
      const [num, info] = [...numCount.entries()].sort((a, b) => b[1].n - a[1].n)[0]
      // Fonte cercata PRIMA nel documento del seed (mai attribuzioni ad altri file)
      const src = findStagedSource(analyzed, null, num, new Set([info.doc.name]))
      best.polizza_numero = { valore: num, effDate: info.doc.dateStr, docType: info.doc.type, appendixOrd: info.doc.appendixOrd, docPos: info.doc.pos, file: src?.file || info.doc.name, page: src?.page ?? '' }
      seedNotes.push(`polizza_numero="${num}" (in ${info.n} documento/i base)`)
    }
  }
  // P.IVA/CF: nei documenti compaiono ALMENO due soggetti (compagnia e contraente),
  // e la prima riga "P.IVA" è quasi sempre l'intestazione della COMPAGNIA. Quindi:
  // si raccolgono TUTTI i candidati checksum-validi dal pool base; se ce n'è UNO
  // solo distinto lo si propone come seed (sovrascrivibile dal gruppo anagrafica
  // via merge per recency — MAI blindato); se ce ne sono ≥2 il campo resta al
  // modello, che ha l'istruzione "P.IVA del CONTRAENTE, mai della compagnia".
  if ('codice_fiscale_iva' in fieldsById) {
    const vatSeen = new Map() // valore valido → doc del primo avvistamento
    for (const d of basePool) {
      // Finestra label→valore anche A CAVALLO di riga: sul campo la P.IVA del
      // contraente sta spesso sulla riga SOTTO l'etichetta ("Partita IVA\n00151…")
      // e il matcher a riga singola vedeva solo quella della compagnia in testata.
      for (const m of d.text.matchAll(/(?:P\.?\s*I\.?V\.?A\.?|PARTITA\s+IVA|COD(?:ICE)?\s*\.?\s*FISC(?:ALE)?\.?|C\.?\s*F\.?\s*\/?\s*P\.?\s*IVA)[^\n]{0,80}(?:\n[^\n]{0,60})?/gi)) {
        const run = m[0].match(/[A-Z0-9]{10,16}/i)
        if (!run) continue
        const valid = validateCodiceFiscaleIva(run[0])
        if (!valid || vatSeen.has(valid)) continue
        // Il candidato che vive nel FOOTER SOCIETARIO della compagnia ("Sede
        // legale… Registro Imprese… Capitale Sociale… IVASS") è la P.IVA
        // dell'ASSICURATORE, non del contraente: va scartato dal seed. I marcatori
        // sono SOLO quelli del footer: parole come "ASSICURAZIONE" da sole no —
        // sono il titolo di ogni frontespizio, anche accanto al blocco contraente.
        const around = d.text.slice(Math.max(0, m.index - 150), m.index + m[0].length + 80)
        if (/sede\s+legale|capitale\s+sociale|impresa\s+autorizzata|registro\s+(?:delle\s+)?imprese|ivass|direzione\s+e\s+coordinamento|r\.?\s*e\.?\s*a\.?\s*n/i.test(around)) continue
        vatSeen.set(valid, d)
      }
    }
    if (vatSeen.size === 1) {
      const [valid, d] = [...vatSeen.entries()][0]
      const src = findStagedSource(analyzed, null, valid, new Set([d.name]))
      best.codice_fiscale_iva = { valore: valid, effDate: d.dateStr, docType: d.type, appendixOrd: d.appendixOrd, docPos: d.pos, file: src?.file || d.name, page: src?.page ?? '' }
      seedNotes.push(`codice_fiscale_iva="${valid}" (unico candidato checksum-valido)`)
    } else if (vatSeen.size >= 2) {
      seedNotes.push(`P.IVA/CF: ${vatSeen.size} candidati distinti checksum-validi (${[...vatSeen.keys()].join(', ')}) → nessun seed, decide il modello (contraente ≠ compagnia)`)
    }
  }
  // Date: da TUTTI i documenti, prendendo per ogni etichetta la data MASSIMA del
  // documento (le quietanze ristampano la scadenza contrattuale originale PRIMA
  // del periodo di rata: la "prima SCADENZA" sarebbe sistematicamente quella
  // vecchia). Ogni hit è auto-datato dal valore → nel merge vince il più recente.
  const maxLabeledDate = (text, labelRe) => {
    let bestDate = null
    for (const m of text.matchAll(labelRe)) {
      const d = parseDateFromContextLine(m[0], /[\s\S]+/)
      if (d && (dateStrToTs(d) ?? -Infinity) > (dateStrToTs(bestDate) ?? -Infinity)) bestDate = d
    }
    return bestDate
  }
  // Data MASSIMA dentro la finestra etichetta→valori: nelle quietanze l'header
  // tabellare "SCAD. RATA  RATA SUCC." sta su una riga e le date sulla riga sotto
  // ("31/12/2024 31/12/2025") — le colonne OCR non si allineano, ma la scadenza
  // utile è comunque l'ultima copertura nota, cioè la data massima della finestra.
  const maxDateInWindow = (text, labelRe) => {
    let bestDate = null
    for (const m of text.matchAll(labelRe)) {
      for (const dm of m[0].matchAll(/\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}\b/g)) {
        const norm = normalizeDateValue(dm[0])
        if (norm && (dateStrToTs(norm) ?? -Infinity) > (dateStrToTs(bestDate) ?? -Infinity)) bestDate = norm
      }
    }
    return bestDate
  }
  // Data MINIMA della stessa finestra: nella quietanza "SCAD. RATA  RATA SUCC."
  // le due date sono l'INIZIO e la FINE del periodo di copertura corrente
  // ("31/12/2024 31/12/2025") → min = decorrenza rata, max = scadenza.
  const minDateInWindow = (text, labelRe) => {
    let bestDate = null
    for (const m of text.matchAll(labelRe)) {
      for (const dm of m[0].matchAll(/\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}\b/g)) {
        const norm = normalizeDateValue(dm[0])
        if (norm && (dateStrToTs(norm) ?? Infinity) < (dateStrToTs(bestDate) ?? Infinity)) bestDate = norm
      }
    }
    return bestDate
  }
  for (const d of analyzed) {
    const hits = {
      // Decorrenza: etichetta esplicita OPPURE l'inizio del periodo di rata
      // (min della finestra SCAD. RATA) — sulla quietanza più recente è la
      // decorrenza del periodo di copertura corrente, coerente con la scadenza.
      decorrenza: [maxLabeledDate(d.text, /DECORRENZA\b[^\n]{0,100}/gi),
        minDateInWindow(d.text, /SCAD\.\s*RATA[^\n]{0,120}(?:\n[^\n]{0,120})?/gi)]
        .filter(Boolean)
        .sort((a, b) => (dateStrToTs(b) ?? 0) - (dateStrToTs(a) ?? 0))[0] || null,
      // Per la scadenza valgono anche l'header abbreviato "SCAD. RATA/RATA SUCC."
      // (valori a riga sotto) e la fine del periodo di rata/regolazione
      scadenza: [maxLabeledDate(d.text, /SCADENZA\b[^\n]{0,100}/gi),
        maxDateInWindow(d.text, /SCAD\.\s*RATA[^\n]{0,120}(?:\n[^\n]{0,120})?/gi),
        parseLastDateFromContextLine(d.text, /PERIODO\b[^\n]{0,140}/i)]
        .filter(Boolean)
        .sort((a, b) => (dateStrToTs(b) ?? 0) - (dateStrToTs(a) ?? 0))[0] || null,
    }
    for (const id of ['decorrenza', 'scadenza']) {
      if (!(id in fieldsById) || !hits[id]) continue
      const norm = normalizeDateValue(hits[id])
      if (!norm) continue
      const cand = { valore: norm, effDate: norm, docType: d.type, appendixOrd: d.appendixOrd, docPos: d.pos, file: d.name, page: '' }
      best[id] = pickMoreRecentCandidate(best[id], cand, kindOf[id] || 'anagrafica')
    }
  }
  for (const id of ['decorrenza', 'scadenza']) {
    if (best[id]) seedNotes.push(`${id}=${best[id].valore} (da "${best[id].file}")`)
  }
  // Seed ATTIVITÀ: nei testi di polizza la descrizione concreta segue quasi sempre
  // un marker esplicito ("…per l'esercizio dell'attività di seguito descritta:").
  // Verificato sull'OCR reale (polizza EULIP pag. 3): il modello la saltava e il
  // recupero rispondeva {} — il regex la prende deterministicamente. Vale per
  // polizza E appendici (una ridefinizione in appendice vince per recency).
  const attField = activeFields.find((f) => /attivit/i.test(`${f.id} ${f.label} ${f.description || ''}`))
  if (attField) {
    for (const d of analyzed.filter((x) => !isPeriodicDocName(x.name))) {
      const m = d.text.match(/(?:di\s+seguito\s+)?descritt[ao]\s*[:;]\s*\n?\s*([^\n]{15,300})/i)
        || d.text.match(/ATTIVIT\S{0,2}(?:\s+ASSICURATA)?\s*[:]\s*\n?\s*([^\n]{15,300})/i)
      if (!m) continue
      const candidate = m[1].trim().replace(/\s+/g, ' ').replace(/[\s.,;:]+$/, '')
      if (candidate.length < 15 || isRinvioAttivita(candidate)) continue
      if (/^[A-Z\s'.]{10,}$/.test(candidate)) continue // heading tutto maiuscolo, non una descrizione
      const pIdx = (d.pages || []).findIndex((pg) => pg && pg.includes(m[1].trim().slice(0, 40)))
      const cand = {
        valore: candidate, effDate: d.dateStr, docType: d.type,
        appendixOrd: d.appendixOrd, docPos: d.pos, file: d.name, page: pIdx >= 0 ? pIdx + 1 : '',
      }
      best[attField.id] = pickMoreRecentCandidate(best[attField.id], cand, kindOf[attField.id] || 'strutturali')
    }
    if (best[attField.id]) seedNotes.push(`${attField.id}="${String(best[attField.id].valore).slice(0, 60)}…" (da "${best[attField.id].file}")`)
  }
  if (seedNotes.length) diag.push(`Stadio A: seed regex — ${seedNotes.join(' · ')}`)

  // ── Stage B: un passaggio per gruppo ───────────────────────────────────────
  // NESSUN campo viene escluso dal modello per via dei seed: i seed competono
  // nel merge per recency come ogni altro candidato (mai valori blindati).
  const promptExtra = (settings.polizzaPromptExtra || '').trim()
  // 24K di contesto per i gruppi: sul campo (diagnostica) i 16K col rapporto
  // prudente lasciavano 1/3 del contesto inutilizzato E fuori restavano proprio
  // le pagine coi dati (attività a pag. 23, P.IVA contraente a pag. 10). qwen2.5
  // regge 32K; 24K di KV su un 7B q4 stanno negli 8GB.
  const batchCtx = Math.min(modelLimit || 131072, 24576)

  // ── AFFINITÀ SEMANTICA descrizione↔testo (agnostica: niente classi keyword) ─
  // La DESCRIZIONE del campo è l'unica verità semantica disponibile: guida DOVE
  // cercare un campo (gate campo×documento) e CHI vince tra candidati in
  // conflitto (arbitro nel merge). Embeddings bge-m3; se non disponibili,
  // fallback LESSICALE sui token della descrizione — il motore non si ferma mai.
  const pageVecCache = new Map()   // `${doc.pos}:${pagina}` → vettore
  const descVecCache = new Map()   // field.id → vettore della descrizione
  const winVecCache = new Map()    // finestra di contesto (norm) → vettore
  let embeddingsOk = true
  let semanticLogged = false
  const fieldQueryText = (f) => `${f.label || ''}. ${stripFieldExamples(f.description || f.label || f.id)}`
  const lexTokenize = (str) => String(str || '')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !STAGED_STOPWORDS.has(t))
  const lexTokensCache = new Map() // field.id → token descrizione
  const lexTokensOf = (f) => {
    if (!lexTokensCache.has(f.id)) lexTokensCache.set(f.id, lexTokenize(fieldQueryText(f)))
    return lexTokensCache.get(f.id)
  }
  const lexAffinity = (f, normText) => {
    const toks = lexTokensOf(f)
    if (!toks.length || !normText) return 0
    let hit = 0
    for (const t of toks) if (normText.includes(t)) hit++
    return hit / toks.length
  }
  const ensurePageVecs = async (docsList) => {
    if (!embeddingsOk) return
    const wanted = []
    for (const d of docsList) {
      for (let p = 0; p < d.pages.length; p++) {
        if (d.pages[p].trim() && !pageVecCache.has(`${d.pos}:${p}`)) wanted.push({ d, p })
      }
    }
    for (let i = 0; i < wanted.length; i += 32) {
      const chunk = wanted.slice(i, i + 32)
      const vecs = await embedTexts(settings, chunk.map((w) => w.d.pages[w.p].slice(0, 2000)))
      chunk.forEach((w, j) => pageVecCache.set(`${w.d.pos}:${w.p}`, vecs[j]))
    }
  }
  const ensureDescVecs = async () => {
    if (!embeddingsOk) return
    const missing = activeFields.filter((f) => !descVecCache.has(f.id))
    if (!missing.length) return
    const vecs = await embedTexts(settings, missing.map(fieldQueryText))
    missing.forEach((f, i) => descVecCache.set(f.id, vecs[i]))
  }
  // Bootstrap una volta sola: pagine + descrizioni. Su errore → lessicale.
  // La riga di diagnostica arriva PRIMA del lavoro: su fascicoli grandi
  // l'embedding dura minuti e senza questa riga il job sembrava fermo.
  const totPages = analyzed.reduce((n, d) => n + (d.pages?.filter((p) => p.trim()).length || 0), 0)
  diag.push(`Affinità semantica: embedding di ${totPages} pagine + ${activeFields.length} descrizioni in corso (${settings.embeddingModel || 'bge-m3'})…`)
  onProgress?.({ batch: 0, batchTotal: 1 })
  try {
    await ensurePageVecs(analyzed)
    await ensureDescVecs()
    const nPages = pageVecCache.size
    diag.push(`Affinità semantica attiva (${settings.embeddingModel || 'bge-m3'}): ${nPages} pagine + ${descVecCache.size} descrizioni embeddate — instradamento e arbitrato guidati dalle DESCRIZIONI dei campi`)
    semanticLogged = true
  } catch (err) {
    embeddingsOk = false
    diag.push(`Affinità semantica NON disponibile (${err.message}) → fallback LESSICALE sui token delle descrizioni. Suggerimento: «ollama pull ${settings.embeddingModel || 'bge-m3'}».`)
  }
  // Affinità campo×documento = max sulle pagine del documento.
  const fdAffCache = new Map()
  const fieldDocAffinity = (field, doc) => {
    const key = `${field.id}|${doc.pos}`
    if (fdAffCache.has(key)) return fdAffCache.get(key)
    let aff = 0
    if (embeddingsOk && descVecCache.has(field.id)) {
      const q = descVecCache.get(field.id)
      for (let p = 0; p < doc.pages.length; p++) {
        const v = pageVecCache.get(`${doc.pos}:${p}`)
        if (v) aff = Math.max(aff, cosineSim(q, v))
      }
    } else {
      for (const np of doc.normPages || []) aff = Math.max(aff, lexAffinity(field, np))
    }
    fdAffCache.set(key, aff)
    return aff
  }
  const bestAffCache = new Map()
  const fieldBestAffinity = (field) => {
    if (bestAffCache.has(field.id)) return bestAffCache.get(field.id)
    let m = 0
    for (const d of analyzed) m = Math.max(m, fieldDocAffinity(field, d))
    bestAffCache.set(field.id, m)
    return m
  }
  // GATE campo×documenti: un campo si chiede su un set di documenti solo se lì
  // l'affinità raggiunge almeno il 70% della sua MIGLIORE affinità sull'intero
  // fascicolo (soglia RELATIVA: nessun assoluto da tarare, nessuna classe).
  // ECCEZIONE DURA, TYPE-BLIND (documenti tutti uguali — decisione definitiva):
  // il rumore degli embeddings escludeva campi proprio dai documenti giusti,
  // perdendo per sempre i candidati. Regola senza tipi: i 3 documenti PIÙ
  // RECENTI e il documento PIÙ CORPOSO del fascicolo (di solito il contratto)
  // non subiscono MAI esclusioni di campi — lì si chiede sempre tutto.
  const neverGatePos = new Set([
    ...[...analyzed].sort(byStagedRecency).slice(0, 3).map((d) => d.pos),
    [...analyzed].sort((a, b) => (b.pages?.length || 0) - (a.pages?.length || 0))[0]?.pos,
  ].filter((p) => p != null))
  const eligibleFieldsForDocs = (fields, docs) => fields.filter((f) => {
    if (docs.some((d) => neverGatePos.has(d.pos))) return true
    const bestAff = fieldBestAffinity(f)
    if (!(bestAff > 0)) return true // nessun segnale → mai escludere per zelo
    let m = 0
    for (const d of docs) { m = Math.max(m, fieldDocAffinity(f, d)); if (m >= bestAff * 0.7) break }
    return m >= bestAff * 0.7
  })
  // Affinità del CONTESTO attorno a un valore (per l'arbitro nel merge): finestra
  // ±200 char attorno alla prima occorrenza del valore nel documento sorgente.
  // La ricerca è NORMALIZZATA (findValueWindow in polizzaValidation.js): prima
  // era letterale e una sola maiuscola diversa ("Acqui Terme" vs "ACQUI TERME")
  // lasciava l'affinità a null — l'arbitro semantico, cieco, ricadeva sulla sola
  // recency per metà dei candidati testuali. L'indice normalizzato di ogni
  // documento si costruisce UNA volta sola (i candidati sono centinaia).
  const normIndexCache = new Map() // doc.pos → { text, norm, map }
  const normIndexOf = (doc) => {
    if (!normIndexCache.has(doc.pos)) normIndexCache.set(doc.pos, buildNormIndex(doc.text))
    return normIndexCache.get(doc.pos)
  }
  const candidateAffinity = async (field, cleaned, evidenza, srcDoc) => {
    if (!srcDoc?.text) return null
    const win = findValueWindow(normIndexOf(srcDoc), cleaned, evidenza)
    if (!win) return null
    // lex: SEMPRE calcolata — è lo spareggio deterministico a pari data
    // (documenti tutti uguali: decide la somiglianza con la DESCRIZIONE).
    const lex = lexAffinity(field, normForMatch(win))
    if (embeddingsOk && descVecCache.has(field.id)) {
      try {
        const key = normForMatch(win).slice(0, 120)
        if (!winVecCache.has(key)) {
          const [v] = await embedTexts(settings, [win.slice(0, 1200)])
          winVecCache.set(key, v)
        }
        return { aff: cosineSim(descVecCache.get(field.id), winVecCache.get(key)), lex }
      } catch { /* singolo embed fallito → lessicale */ }
    }
    return { aff: lex, lex }
  }

  // AFFINITÀ DEI SEED di Stadio A. I seed entravano nel merge senza affinità e
  // senza lex: l'arbitro semantico era CIECO su di loro (a0 = null → né
  // promozione né veto) e decideva la sola recency, così un valore letto da una
  // riga etichettata del contratto veniva sostituito da un candidato qualsiasi
  // di un documento più recente (attività assicurata: «produzione di olii e
  // grassi vegetali» → «lavoro interinale»). Si misura con la STESSA funzione dei
  // candidati del modello: stessa scala, stesso arbitro, nessun valore blindato.
  for (const [id, cand] of Object.entries(best)) {
    const f = fieldsById[id]
    if (!f || !cand || cand.affinity != null) continue
    const srcDoc = cand.file ? analyzed.find((d) => d.name === cand.file) : null
    try {
      const pair = await candidateAffinity(f, cand.valore, '', srcDoc)
      if (pair) { cand.affinity = pair.aff; cand.lex = pair.lex }
    } catch { /* seed senza affinità: resta come prima, decide la recency */ }
  }
  const seedAff = Object.entries(best).filter(([, c]) => typeof c?.affinity === 'number')
  if (seedAff.length) {
    diag.push(`Stadio A: affinità dei seed misurata — ${seedAff.map(([id, c]) => `${id}~${c.affinity.toFixed(2)}`).join(' · ')} (l'arbitro semantico non è più cieco sui seed)`)
  }

  // ── Stadio B a CASCATA: dal più nuovo al più vecchio, solo i buchi ─────────
  // È il metodo dell'estrazione manuale reale: documenti ordinati dal più
  // recente al più vecchio, e a ogni documento si chiedono SOLO i campi ancora
  // vuoti. La recency è garantita PER COSTRUZIONE (il primo che risponde è per
  // definizione il più recente) — sparisce l'arbitrato di merge tra candidati
  // sovrapposti — i prompt sono piccoli (solo i buchi + le loro descrizioni), e
  // appena i campi sono tutti pieni ci si ferma. Le validazioni per-candidato
  // (evidenza, checksum, placeholder, guardie) restano: impediscono che un
  // valore-spazzatura di un documento recente occupi lo slot del valore buono
  // di un documento più vecchio.
  let consecutiveErrors = 0
  let abortedByErrors = false
  let abortError = null
  let llmFieldsCount = 0 // campi arrivati dalle chiamate LLM (seed esclusi): guida l'abort
  const counters = { unknown: 0, placeholders: 0, sanitized: 0, noEvidence: 0, guardrail: 0 }

  // STRATEGIA Stadio B: la 'cascata dal più recente' è OPT-IN (proposta in
  // valutazione con l'utente — settings.polizzaStagedCascade = true per
  // provarla). Default: GRUPPI a copertura totale, comportamento invariato.
  const useCascade = settings.polizzaStagedCascade === true
  // In testa alla diagnostica: quale strategia ha DAVVERO girato (chiude ogni
  // dubbio su "lo switch ha funzionato?" guardando il log del job).
  diag.push(`Strategia Stadio B: ${useCascade ? 'CASCATA dal documento più recente' : 'GRUPPI a copertura totale'} — modello ${settings.ollamaModel || settings.llmModel || '?'}`)
  let progressTotal = 0
  let progressDone = 0

  if (useCascade) {
  const cascadeDocs = [...analyzed].sort(byStagedRecency)
  // CONTROPROVA e tetto tentativi — le pezze alle debolezze della cascata,
  // in forma AGNOSTICA (niente classi keyword):
  // 1. la polizza base non viene mai saltata: lì si ri-chiedono TUTTI i campi il
  //    cui valore corrente non viene dalla polizza — l'arbitro semantico del
  //    merge decide se il frontespizio smentisce il valore più recente;
  // 2. l'eleggibilità campo×documento è il GATE SEMANTICO (affinità della
  //    descrizione con le pagine del documento) — un campo non si chiede dove
  //    il documento non ne parla;
  // 3. un campo che resta null per RECOVERY_MISS_CAP documenti esce dalla
  //    cascata e passa al recupero semantico (Stadio E) — niente 40 chiamate
  //    per un campo che non esiste.
  const RECOVERY_MISS_CAP = 5
  const missCount = {}
  const hasPolizzaBase = cascadeDocs.some((d) => d.type === 'polizza')
  let polizzaVisited = !hasPolizzaBase
  const missingEligible = (doc) => {
    const base = activeFields.filter((f) => {
      if (!(f.id in best)) return (missCount[f.id] || 0) < RECOVERY_MISS_CAP
      // Controprova sulla polizza base: si ri-chiede tutto ciò che non viene da lei
      return doc.type === 'polizza' && best[f.id]?.docType !== 'polizza'
    })
    return eligibleFieldsForDocs(base, [doc])
  }
  diag.push(`Stadio B (cascata): ${cascadeDocs.length} documenti dal più recente al più vecchio — a ognuno solo i campi ancora vuoti ed ELEGGIBILI per affinità semantica; controprova sulla polizza base; max ${RECOVERY_MISS_CAP} tentativi per campo (num_ctx ${batchCtx})`)
  diag.push(`Cascata — ordine di visita: ${cascadeDocs.slice(0, 8).map((d) => `${d.name}${d.dateStr ? ` (${d.dateStr})` : ''}`).join(' → ')}${cascadeDocs.length > 8 ? ' → …' : ''}`)

  progressTotal = cascadeDocs.length
  let cascadeCalls = 0
  for (let di = 0; di < cascadeDocs.length; di++) {
    if (abortedByErrors) break
    const doc = cascadeDocs[di]
    progressDone++
    onProgress?.({ batch: progressDone, batchTotal: progressTotal })

    // Tutti i campi valorizzati? Ci si ferma SOLO dopo aver letto la polizza
    // base (controprova dei provvisori): i documenti più vecchi non-base si
    // saltano, la polizza no.
    const allFilled = activeFields.every((f) => f.id in best)
    if (allFilled && polizzaVisited) {
      diag.push(`Cascata: tutti i ${activeFields.length} campi valorizzati — ${cascadeDocs.length - di} documenti più vecchi saltati (${cascadeCalls} chiamate totali)`)
      break
    }
    if (allFilled && !polizzaVisited && doc.type !== 'polizza') continue // dritti alla polizza base
    const missingHere = missingEligible(doc)
    if (!missingHere.length) { if (doc.type === 'polizza') polizzaVisited = true; continue }

    const fieldLines = missingHere
      .map((f) => `- ${f.id} — ${f.label}: ${stripFieldExamples(f.description || f.label || f.id) || f.label || f.id}`)
      .join('\n')
    const docHeader = `DOCUMENTO ANALIZZATO: "${doc.name}" (tipo: ${doc.type}${doc.dateStr ? `, periodo/data: ${doc.dateStr}` : ''})`
    const buildPrompt = (text) => `CAMPI ANCORA MANCANTI DA CERCARE IN QUESTO DOCUMENTO (id — nome: descrizione):\n${fieldLines}\n${promptExtra ? `\nISTRUZIONI AGGIUNTIVE (priorità massima):\n${promptExtra}\n` : ''}\nLa DESCRIZIONE è l'istruzione di ricerca: trova il dato o la FRASE che le corrisponde (anche con parole diverse), rispettando le sue esclusioni (i "NON …").\n\n${docHeader}\n${text}\n\nRestituisci SOLO il JSON con UNA voce per OGNUNO dei ${missingHere.length} campi elencati: {"id_campo": {"valore":"...","evidenza":"testo esatto copiato"}}, e {"valore": null} per i campi il cui valore NON è in questo documento.`
    // Rapporto CONSERVATIVO 2.0 char/token: un budget ottimista fa troncare il
    // prompt in silenzio dal server (testa = guida campi persa → spazzatura).
    const reserve = estimateOllamaTokens(STAGED_CASCADE_SYSTEM.length + buildPrompt('').length) + 3000 + 512
    const budgetChars = Math.max(4000, Math.floor((batchCtx - reserve) * 2.0))
    // COPERTURA TOTALE del documento: se non entra in una chiamata si spezza —
    // il budget decide in quanti pezzi, MAI cosa resta fuori.
    const docBatches = buildGroupBatches([doc], budgetChars)

    for (let bi = 0; bi < docBatches.length; bi++) {
      if (abortedByErrors) break
      const { text: ctx, usedNames } = docBatches[bi]
      const label = `Cascata ${di + 1}/${cascadeDocs.length} "${doc.name}"${docBatches.length > 1 ? ` parte ${bi + 1}/${docBatches.length}` : ''}`
      cascadeCalls++
      let parsed = null
      let usedCtx = ctx
      try {
        const raw = await callOllamaRolling(s2, STAGED_CASCADE_SYSTEM, buildPrompt(ctx), { numCtx: batchCtx, timeoutMs: 600000, diag })
        try {
          parsed = parseJsonResponse(raw)
        } catch {
          // Retry SIGNIFICATIVO: a temperatura 0 rimandare lo stesso prompt produce
          // la stessa risposta — si riduce il contesto e si alza num_predict.
          diag.push(`${label}: risposta non parsabile, retry con contesto ridotto…`)
          const cutAt = ctx.lastIndexOf('\n\n[', Math.floor(ctx.length * 0.7))
          usedCtx = cutAt > 0 ? ctx.slice(0, cutAt) : ctx.slice(0, Math.floor(ctx.length * 0.7))
          const raw2 = await callOllamaRolling(s2, STAGED_CASCADE_SYSTEM, buildPrompt(usedCtx), { numCtx: batchCtx, numPredict: 4096, timeoutMs: 600000, diag })
          parsed = parseJsonResponse(raw2)
        }
        consecutiveErrors = 0
      } catch (err) {
        consecutiveErrors++
        diag.push(`${label} FALLITO (si prosegue): ${err.message}`)
        if (err.isLlmConnectionError || consecutiveErrors >= 3) {
          abortedByErrors = true
          abortError = err
          diag.push(`INTERROTTO per errori ripetuti: ${Object.keys(best).length} campi raccolti finora.`)
        }
        continue
      }

      const before = { ...counters }
      const report = []
      // Il merge è tutto nell'arbitro semantico dentro absorbStagedEntries: la
      // controprova sulla polizza base non ha più codice speciale — i suoi
      // candidati competono con l'affinità descrizione↔contesto come gli altri.
      llmFieldsCount += await absorbStagedEntries(parsed, missingHere, best, kindOf, analyzed, normForMatch(usedCtx), usedNames, counters, report, candidateAffinity)
      const filled = report.filter((r) => r.outcome === 'ok').length
      diag.push(`${label} (${missingHere.length} campi chiesti): riempiti ${filled} — scartati: ` +
        `${counters.placeholders - before.placeholders} placeholder, ${counters.sanitized - before.sanitized} sanitizzazione/checksum, ` +
        `${counters.noEvidence - before.noEvidence} senza evidenza` +
        `${counters.guardrail > before.guardrail ? `, ${counters.guardrail - before.guardrail} guardrail` : ''}`)
      // Esito PER CAMPO (con affinità semantica): senza questo dettaglio ogni
      // run era un indovinare su CHI fosse stato scartato e con quale valore.
      const reported = report.filter((r) => r.outcome !== 'vuoto/null')
      if (reported.length) {
        diag.push(`  ↳ ${reported.map((r) => `${r.id}${r.value ? `="${r.value}"` : ''}${r.aff != null ? `~${r.aff.toFixed(2)}` : ''} ${r.outcome === 'ok' ? '✓' : `[${r.outcome}]`}`).join(' · ')}`)
      }
    }

    // Dopo il documento: tentativi a vuoto (per il tetto) e registrazione
    // della polizza base visitata.
    for (const f of missingHere) {
      if (!(f.id in best)) {
        missCount[f.id] = (missCount[f.id] || 0) + 1
        if (missCount[f.id] === RECOVERY_MISS_CAP) diag.push(`Cascata: "${f.id}" null per ${RECOVERY_MISS_CAP} documenti → passa al recupero semantico`)
      }
    }
    if (doc.type === 'polizza') polizzaVisited = true
  }
  } else {
  // ── Stadio B a GRUPPI, copertura totale (percorso DEFAULT) ─────────────────
  const groupPlans = []
  for (const kind of ['strutturali', 'economici', 'anagrafica']) {
    const groupFields = partition[kind]
    // Selezione documenti DINAMICA, guidata dalle DESCRIZIONI dei campi: la
    // base tassonomica dà solo l'ordine di lettura noto-buono, ma OGNI campo
    // AGGIUNGE nulla e non toglie nulla: TUTTI i documenti, dal più recente al
    // più vecchio (selectGroupDocs è ormai uniforme — documenti tutti uguali).
    const groupDocs = selectGroupDocs(kind, analyzed)
    if (!groupFields.length || !groupDocs.length) {
      diag.push(`Gruppo "${kind}": saltato (${!groupFields.length ? 'nessun campo' : 'nessun documento pertinente'})`)
      continue
    }
    groupPlans.push({ kind, groupFields, groupDocs })
  }
  for (const plan of groupPlans) {
    const { kind, groupFields, groupDocs } = plan
    // fieldLines COMPLETO solo per stimare la riserva di budget; i campi chiesti
    // davvero a ogni batch sono quelli ELEGGIBILI per affinità semantica.
    plan.fieldLines = groupFields
      .map((f) => `- ${f.id} — ${f.label}: ${stripFieldExamples(f.description || f.label || f.id) || f.label || f.id}`)
      .join('\n')
    plan.system = stagedSystemPrompt(kind)
    plan.buildPrompt = (text, fieldLines = plan.fieldLines) => `CAMPI DA ESTRARRE (id — nome: descrizione):\n${fieldLines}\n${promptExtra ? `\nISTRUZIONI AGGIUNTIVE (priorità massima):\n${promptExtra}\n` : ''}\nTESTO DEI DOCUMENTI:\n${text}\n\nRestituisci SOLO il JSON.`
    // Rapporto CONSERVATIVO 2.0 char/token: un budget ottimista fa troncare il
    // prompt in silenzio dal server (testa = guida campi persa → spazzatura).
    const reserve = estimateOllamaTokens(plan.system.length + plan.buildPrompt('').length) + 3000 + 512
    const budgetChars = Math.max(4000, Math.floor((batchCtx - reserve) * 2.0))
    plan.batches = buildGroupBatches(groupDocs, budgetChars)
    // Batch FOCALIZZATI in testa al gruppo: un documento per batch, mai mescolato
    // agli altri. Due criteri, entrambi TYPE-BLIND (documenti tutti uguali —
    // decidono datazione e descrizioni, mai il nome o il tipo del file):
    //  - i 3 documenti PIÙ RECENTI del fascicolo, che portano il periodo corrente;
    //  - i 3 documenti PIÙ AFFINI alle DESCRIZIONI dei campi del gruppo, che
    //    portano i dati che il gruppo sta cercando.
    // Il secondo criterio è la cura di una regressione vista in diagnostica: con
    // TUTTI i documenti in ogni gruppo e l'ordine per sola recency, il documento
    // più affine ai campi strutturali (qui il contratto, il più VECCHIO) finiva
    // spezzato in coda a batch pieni di quietanze di quindici anni fa — la pagina
    // dei massimali arrivava al modello annegata, e il massimale RCO usciva
    // pescato da una clausola («1.000.000» invece di «4.000.000,00»). Da solo, in
    // un batch suo, lo stesso documento lo dava giusto.
    const groupAff = (d) => Math.max(0, ...groupFields.map((f) => fieldDocAffinity(f, d)))
    const mostAffine = [...groupDocs]
      .map((d) => [groupAff(d), d])
      .sort((a, b) => b[0] - a[0] || byStagedRecency(a[1], b[1]))
      .filter(([aff]) => aff > 0)
      .slice(0, 3)
      .map(([, d]) => d)
    const focusDocs = [...new Set([...groupDocs.slice(0, 3), ...mostAffine])]
    let focusCount = 0
    if (focusDocs.length) {
      const focus = focusDocs.flatMap((d) => buildGroupBatches([d], budgetChars))
      focusCount = focus.length
      if (focus.length) plan.batches = [...focus, ...plan.batches]
    }
    const totChars = plan.batches.reduce((n, b) => n + b.text.length, 0)
    diag.push(`Gruppo "${kind}": ${groupFields.length} campi, ${groupDocs.length} documenti (~${totChars} char) → ${plan.batches.length} batch (${focusCount ? `${focusCount} focalizzat${focusCount > 1 ? 'i' : 'o'} (recenti + più affini alle descrizioni) + ` : ''}copertura totale, num_ctx ${batchCtx})`)
    if (mostAffine.length) diag.push(`Gruppo "${kind}": documenti più affini alle descrizioni → ${mostAffine.map((d) => `${d.name}~${groupAff(d).toFixed(2)}`).join(' · ')}`)
  }
  progressTotal = groupPlans.reduce((n, p2) => n + p2.batches.length, 0)

  for (const plan of groupPlans) {
    if (abortedByErrors) break
    const { kind, groupFields } = plan
    for (let bi = 0; bi < plan.batches.length; bi++) {
      if (abortedByErrors) break
      const { text: ctx, usedNames } = plan.batches[bi]
      progressDone++
      onProgress?.({ batch: progressDone, batchTotal: progressTotal })

      // GATE SEMANTICO campo×documenti del batch: si chiedono qui SOLO i campi
      // la cui descrizione ha affinità con questi documenti (≥70% della loro
      // migliore affinità sull'intero fascicolo). Niente classi keyword: un
      // "massimale" non viene chiesto alle quietanze perché le loro pagine non
      // ne parlano, qualunque nome abbia il campo.
      const batchDocs = plan.groupDocs.filter((d) => usedNames.has(d.name))
      const batchFields = eligibleFieldsForDocs(groupFields, batchDocs.length ? batchDocs : plan.groupDocs)
      if (!batchFields.length) {
        diag.push(`Gruppo "${kind}" batch ${bi + 1}/${plan.batches.length} (${[...usedNames].slice(0, 3).join(', ')}${usedNames.size > 3 ? ', …' : ''}): saltato — nessun campo affine a questi documenti`)
        continue
      }
      const batchFieldLines = batchFields
        .map((f) => `- ${f.id} — ${f.label}: ${stripFieldExamples(f.description || f.label || f.id) || f.label || f.id}`)
        .join('\n')

      // num_ctx SEMPRE al tetto del batch: allocare meno per "risparmiare" rischia
      // il troncamento se la stima sottovaluta.
      const numCtx = batchCtx
      let parsed = null
      let usedCtx = ctx
      try {
        const raw = await callOllamaRolling(s2, plan.system, plan.buildPrompt(ctx, batchFieldLines), { numCtx, timeoutMs: 600000, diag })
        try {
          parsed = parseJsonResponse(raw)
        } catch {
          // Retry SIGNIFICATIVO: a temperatura 0 rimandare lo stesso prompt produce
          // la stessa risposta — si riduce il contesto e si alza num_predict.
          diag.push(`Gruppo "${kind}" batch ${bi + 1}: risposta non parsabile, retry con contesto ridotto…`)
          const cutAt = ctx.lastIndexOf('\n\n[', Math.floor(ctx.length * 0.7))
          usedCtx = cutAt > 0 ? ctx.slice(0, cutAt) : ctx.slice(0, Math.floor(ctx.length * 0.7))
          const raw2 = await callOllamaRolling(s2, plan.system, plan.buildPrompt(usedCtx, batchFieldLines), { numCtx, numPredict: 4096, timeoutMs: 600000, diag })
          parsed = parseJsonResponse(raw2)
        }
        consecutiveErrors = 0
      } catch (err) {
        consecutiveErrors++
        diag.push(`Gruppo "${kind}" batch ${bi + 1}/${plan.batches.length} FALLITO (si prosegue): ${err.message}`)
        if (err.isLlmConnectionError || consecutiveErrors >= 3) {
          abortedByErrors = true
          abortError = err
          diag.push(`INTERROTTO per errori ripetuti: ${Object.keys(best).length} campi raccolti finora.`)
        }
        continue
      }

      const before = { ...counters }
      const normCtx = normForMatch(usedCtx)
      const report = []
      llmFieldsCount += await absorbStagedEntries(parsed, batchFields, best, kindOf, analyzed, normCtx, usedNames, counters, report, candidateAffinity)
      const got = Object.keys(parsed || {}).length
      diag.push(`Gruppo "${kind}" batch ${bi + 1}/${plan.batches.length} (${[...usedNames].slice(0, 4).join(', ')}${usedNames.size > 4 ? ', …' : ''}): ` +
        `${batchFields.length}/${groupFields.length} campi eleggibili, ${got} proposti — scartati: ${counters.placeholders - before.placeholders} placeholder, ` +
        `${counters.sanitized - before.sanitized} sanitizzazione/checksum, ${counters.noEvidence - before.noEvidence} senza evidenza` +
        `${counters.guardrail > before.guardrail ? `, ${counters.guardrail - before.guardrail} guardrail` : ''}`)
      // Esito PER CAMPO (con affinità semantica): senza questo dettaglio ogni
      // run era un indovinare su CHI fosse stato scartato e con quale valore.
      if (report.length) {
        diag.push(`  ↳ ${report.map((r) => `${r.id}${r.value ? `="${r.value}"` : ''}${r.aff != null ? `~${r.aff.toFixed(2)}` : ''} ${r.outcome === 'ok' ? '✓' : `[${r.outcome}]`}`).join(' · ')}`)
      }
    }
  }
  }

  // Abort con ZERO contributo LLM: i soli seed regex non sono un'estrazione — il
  // job deve andare in ERRORE (rilanciabile), non fingere un successo quasi vuoto.
  if (abortedByErrors && llmFieldsCount === 0 && abortError) {
    const classified = classifyLlmError(abortError, settings)
    classified.diag = diag
    throw classified
  }

  // ── Stage E: recupero mirato dei campi ancora vuoti ────────────────────────
  if (!abortedByErrors) {
    const missing = activeFields.filter((f) => !(f.id in best))
    // Cap chiamate: 0 disattiva DAVVERO (parse con isFinite, niente || che
    // riporta al default), default 12, tetto 24.
    const rawCap = parseInt(settings.polizzaStagedRecoveryMax, 10)
    const maxCalls = Number.isFinite(rawCap) ? Math.max(0, Math.min(24, rawCap)) : 12
    if (missing.length && maxCalls > 0) {
      // Una chiamata per campo, raggruppate per genere (stesso pool di documenti)
      const byKind = { strutturali: [], economici: [], anagrafica: [] }
      for (const f of missing) byKind[kindOf[f.id] || 'anagrafica'].push(f)
      const perKind = []
      for (const [kind, list] of Object.entries(byKind)) {
        const allowedDocs = selectGroupDocs(kind, analyzed)
        if (!allowedDocs.length) continue // genere senza documenti eleggibili: non estraibile
        // UN campo per chiamata: il recupero è guidato dalla DESCRIZIONE del campo
        // — è lei la query semantica che ranka le pagine ed è lei l'istruzione al
        // modello. A gruppi di 3 il ranking era un compromesso tra descrizioni
        // diverse e l'attenzione del modello si divideva: la descrizione deve
        // bastare da sola, per QUALUNQUE tipologia, senza pattern per-layout.
        const chunks = list.map((f) => ({ kind, fields: [f], allowedDocs }))
        if (chunks.length) perKind.push(chunks)
      }
      // Interlacciamento ROUND-ROBIN tra i generi: con un cap basso e molti campi
      // mancanti, l'ordine fisso strutturali→economici→anagrafica affamerebbe
      // sistematicamente l'ultimo genere.
      const batches = []
      for (let i = 0; perKind.some((c) => i < c.length); i++) {
        for (const chunks of perKind) if (i < chunks.length) batches.push(chunks[i])
      }
      const planned = batches.slice(0, maxCalls)
      const skippedForCap = batches.length - planned.length
      progressTotal += planned.length
      let recovered = 0
      let recConsecutive = 0

      // RANKING SEMANTICO delle pagine (embeddings, es. bge-m3): trova la pagina
      // giusta anche quando usa PAROLE DIVERSE dalla label del campo
      // ("descrizione del rischio" vs "attività assicurata") — il ranking
      // lessicale resta solo come fallback se gli embeddings non ci sono.
      // Riusa l'infrastruttura di affinità dello Stadio B: pagine già embeddate
      // (pageVecCache), stesso stato embeddingsOk, stesso fallback lessicale.
      for (const b of planned) {
        if (abortedByErrors) break
        progressDone++
        onProgress?.({ batch: progressDone, batchTotal: progressTotal })

        // Contesto deterministico senza embeddings: pagine rank-ate per i token
        // DISCRIMINANTI di label (peso doppio) e descrizione, con stopword del
        // dominio (parole come "polizza"/"assicurato" compaiono in OGNI pagina e
        // renderebbero il punteggio puro rumore) e punteggio a frequenza saturata.
        const tokenize = (str) => String(str || '')
          .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !STAGED_STOPWORDS.has(t))
        const weights = new Map()
        for (const f of b.fields) {
          for (const t of tokenize(f.label)) weights.set(t, Math.max(weights.get(t) || 0, 2))
          for (const t of tokenize(stripFieldExamples(f.description || ''))) if (!weights.has(t)) weights.set(t, 1)
        }
        const countOcc = (np, t) => {
          let n = 0, i = 0
          while (n < 3 && (i = np.indexOf(t, i)) !== -1) { n++; i += t.length }
          return n // saturata a 3: conta la presenza ripetuta, non il conteggio esatto
        }
        let pool = null
        if (embeddingsOk) {
          try {
            await ensurePageVecs(b.allowedDocs)
            const queries = b.fields.map((f) => `${f.label}. ${stripFieldExamples(f.description || f.label || f.id)}`)
            const qVecs = await embedTexts(settings, queries)
            const semScored = []
            b.allowedDocs.forEach((d, docRank) => {
              for (let p = 0; p < d.pages.length; p++) {
                const v = pageVecCache.get(`${d.pos}:${p}`)
                if (!v) continue
                let score = 0
                for (const q of qVecs) score = Math.max(score, cosineSim(q, v))
                semScored.push({ d, p, score, docRank })
              }
            })
            semScored.sort((a, b2) => b2.score - a.score || a.docRank - b2.docRank || a.p - b2.p)
            pool = semScored
            if (!semanticLogged) {
              diag.push(`Stadio E: ranking SEMANTICO delle pagine (embeddings ${settings.embeddingModel || 'bge-m3'})`)
              semanticLogged = true
            }
          } catch (err) {
            embeddingsOk = false
            diag.push(`Stadio E: embeddings non disponibili (${err.message}) → ranking lessicale. Suggerimento: «ollama pull ${settings.embeddingModel || 'bge-m3'}».`)
          }
        }
        if (!pool) {
          const scored = []
          b.allowedDocs.forEach((d, docRank) => {
            d.normPages.forEach((np, p) => {
              let score = 0
              for (const [t, w] of weights) score += countOcc(np, t) * w
              scored.push({ d, p, score, docRank })
            })
          })
          scored.sort((a, b2) => b2.score - a.score || a.docRank - b2.docRank || a.p - b2.p)
          pool = scored[0]?.score > 0 ? scored : scored.sort((a, b2) => a.docRank - b2.docRank || a.p - b2.p)
        }
        const RECOVERY_CTX_CHARS = 12000
        let ctx = ''
        let ctxCost = 0
        const usedNames = new Set()
        for (const s of pool) {
          // Prompt con la pagina SPAZIALE (colonne preservate); budget misurato
          // sui caratteri UTILI, o il padding dimezzava le pagine inviate.
          const pageText = (s.d.spatialPages?.[s.p] ?? s.d.pages[s.p])
          if (!pageText.trim()) continue
          const block = `[${s.d.name} · pag. ${s.p + 1}]\n${pageText.trim()}`
          const cost = usefulLength(block)
          if (ctx && ctxCost + cost > RECOVERY_CTX_CHARS) break
          ctx += (ctx ? '\n---\n' : '') + (cost > RECOVERY_CTX_CHARS ? block.slice(0, RECOVERY_CTX_CHARS * 2) : block)
          ctxCost += cost
          usedNames.add(s.d.name)
        }
        if (!ctx) continue

        // Diagnostica VERA del recupero: senza sapere quali pagine sono state
        // mandate al modello, un esito "{}" è indebuggabile (visto per 4 run).
        const sentPages = []
        for (const s of pool) {
          if (!usedNames.has(s.d.name)) continue
          if (sentPages.length >= 6) break
          sentPages.push(`${s.d.name}·p${s.p + 1}`)
        }
        diag.push(`Recupero [${b.kind}] campi ${b.fields.map((f) => f.id).join(', ')} — pagine inviate: ${sentPages.join(', ')}${usedNames.size > sentPages.length ? ', …' : ''}`)

        const fieldLines = b.fields
          .map((f) => `- ${f.id} — ${f.label}: ${stripFieldExamples(f.description || f.label || f.id) || f.label || f.id}`)
          .join('\n')
        // Le ISTRUZIONI AGGIUNTIVE dell'utente valgono anche qui: il recupero è
        // una chiamata di estrazione a tutti gli effetti (prima le saltava).
        const userPrompt = `CAMPI DA ESTRARRE (id — nome: descrizione):\n${fieldLines}\n${promptExtra ? `\nISTRUZIONI AGGIUNTIVE (priorità massima):\n${promptExtra}\n` : ''}\nLa DESCRIZIONE è l'istruzione di ricerca: trova negli estratti il dato o la FRASE che le corrisponde (anche con parole diverse), rispettando le sue esclusioni (i "NON …").\n\nESTRATTI DEI DOCUMENTI:\n${ctx}\n\nRestituisci SOLO il JSON con UNA voce per OGNUNO dei ${b.fields.length} campi elencati: {"id_campo": {"valore":"...","evidenza":"testo esatto copiato"}}, e {"valore": null} per i campi il cui valore NON è negli estratti.`
        try {
          const raw = await callOllamaRolling(s2, STAGED_RECOVERY_SYSTEM, userPrompt, { numCtx: 8192, timeoutMs: 120000, diag })
          const parsed = parseJsonResponse(raw)
          const beforeIds = new Set(Object.keys(best))
          const recReport = []
          await absorbStagedEntries(parsed, b.fields, best, kindOf, analyzed, normForMatch(ctx), usedNames, counters, recReport, candidateAffinity)
          if (recReport.length) {
            diag.push(`  ↳ ${recReport.map((r) => `${r.id}${r.value ? `="${r.value}"` : ''} ${r.outcome === 'ok' ? '✓' : `[${r.outcome}]`}`).join(' · ')}`)
          }
          const gained = b.fields.filter((f) => !beforeIds.has(f.id) && (f.id in best))
          recovered += gained.length
          if (!gained.length) {
            const rawShort = String(raw || '').replace(/\s+/g, ' ').slice(0, 160)
            diag.push(`Recupero [${b.kind}]: nessun campo recuperato — risposta del modello: ${rawShort || '(vuota)'}`)
          } else {
            diag.push(`Recupero [${b.kind}]: recuperati ${gained.map((f) => f.id).join(', ')}`)
          }
          recConsecutive = 0
        } catch (err) {
          recConsecutive++
          diag.push(`Recupero (${b.fields.map((f) => f.id).join(', ')}): errore (${err.message})`)
          if (err.isLlmConnectionError || recConsecutive >= 3) {
            abortedByErrors = true
            diag.push(`Recupero INTERROTTO per errori ripetuti.`)
          }
        }
      }
      const stillMissing = activeFields.filter((f) => !(f.id in best)).length
      diag.push(`Stadio E (recupero mirato): ${missing.length} campi vuoti → ${planned.length} chiamate` +
        `${skippedForCap > 0 ? ` (cap ${maxCalls}: ${skippedForCap} micro-batch oltre il limite)` : ''}: ` +
        `recuperati ${recovered}, ancora vuoti ${stillMissing} — restano vuoti (meglio vuoto che sbagliato)`)
    } else if (!missing.length) {
      diag.push('Stadio E: nessun campo mancante, recupero non necessario.')
    }
  }

  // ── Coerenza decorrenza/scadenza ──────────────────────────────────────────
  // La coppia deve descrivere lo stesso periodo di copertura: un inizio uguale o
  // successivo alla fine è impossibile (visto sul campo: decorrenza 31/12/2011
  // con scadenza 31/12/2025 — vinceva un seed vecchio). Se la decorrenza è più
  // vecchia della scadenza di oltre ~13 mesi su una polizza con documenti
  // periodici ANNUALI, non è la decorrenza del periodo corrente: meglio vuota.
  {
    const decField = activeFields.find((f) => /decorrenz|data\s+(?:di\s+)?inizio|\beffetto\b/i.test(`${f.id} ${f.label} ${f.description || ''}`))
    const scaField = activeFields.find((f) => /scadenz|data\s+(?:di\s+)?fine/i.test(`${f.id} ${f.label} ${f.description || ''}`))
    const decTs = decField && best[decField.id] ? dateStrToTs(normalizeDateValue(best[decField.id].valore)) : null
    const scaTs = scaField && best[scaField.id] ? dateStrToTs(normalizeDateValue(best[scaField.id].valore)) : null
    if (decTs != null && scaTs != null) {
      const THIRTEEN_MONTHS = 400 * 24 * 3600 * 1000
      const hasAnnualPeriodics = analyzed.some((d) => isPeriodicDocName(d.name))
      if (decTs >= scaTs) {
        diag.push(`Coerenza date: decorrenza ${best[decField.id].valore} ≥ scadenza ${best[scaField.id].valore} → decorrenza svuotata (impossibile)`)
        delete best[decField.id]
      } else if (hasAnnualPeriodics && scaTs - decTs > THIRTEEN_MONTHS) {
        diag.push(`Coerenza date: decorrenza ${best[decField.id].valore} incoerente con scadenza ${best[scaField.id].valore} su polizza a rate annuali → decorrenza svuotata (meglio vuoto che sbagliato)`)
        delete best[decField.id]
      }
    }
  }

  // ── Uscita ────────────────────────────────────────────────────────────────
  const data = {}, sources = {}
  let located = 0, docOnly = 0, unsourced = 0
  for (const [k, e] of Object.entries(best)) {
    data[k] = e.valore
    if (e.file && e.page !== '' && e.page != null) { sources[k] = { file: e.file, page: e.page }; located++ }
    else if (e.file) { sources[k] = { file: e.file, page: '' }; docOnly++ }
    else unsourced++
  }
  diag.push(`Fonti: ${located} campi localizzati (file+pagina), ${docOnly} con solo nome documento, ${unsourced} senza fonte`)
  diag.push(`Motore a stadi completato: ${Object.keys(data).length} campi validi su ${activeFields.length}`)
  return { data, sources, diag }
}

/**
 * Dispatcher del fascicolo: sceglie il motore in base al provider e alle
 * impostazioni. Ollama + docs disponibili → per-campo (RAG, se attivo) oppure
 * motore a stadi (default per hardware debole); cloud e chiamate senza docs →
 * chiamata unica/batch storica.
 */
export async function extractPolizzaFromDocs(docs, fullText, settings, onProgress = null) {
  const provider = settings.llmProvider || 'ollama'
  if (provider === 'ollama' && Array.isArray(docs) && docs.length) {
    if (settings.polizzaPerField !== false) {
      return extractPolizzaPerField(docs, fullText, settings, onProgress)
    }
    return extractPolizzaStaged(docs, settings, onProgress)
  }
  return extractPolizzaFromFullText(fullText, settings, onProgress)
}

export async function extractPolizzaFromFullText(fullText, settings, onProgress = null) {
  const configuredFields = (settings.polizzaFields?.length > 0) ? settings.polizzaFields : ALL_POLIZZA_FIELDS
  const activeFields = configuredFields.filter(f => f.enabled !== false)
  const provider = settings.llmProvider || 'ollama'
  // Ollama (modelli piccoli): descrizioni SENZA esempi — il modello li copierebbe
  // nel risultato invece di leggere i documenti. Cloud: descrizioni originali.
  const descFor = provider === 'ollama'
    ? (f) => stripFieldExamples(f.description || f.label || f.id) || f.label || f.id
    : (f) => f.description || f.label || f.id
  const fieldLines = activeFields.map(f => `- ${f.id} — ${f.label}: ${descFor(f)}`).join('\n')
  const promptExtra = (settings.polizzaPromptExtra || '').trim()
  // Riusato anche dal path a batch: stesso prompt, testo diverso per chiamata.
  const buildUserPrompt = (text) =>
`CAMPI DA ESTRARRE (id — nome: descrizione):
${fieldLines}
${promptExtra ? `\nISTRUZIONI AGGIUNTIVE (priorità massima):\n${promptExtra}\n` : ''}
TESTO DEI DOCUMENTI DEL FASCICOLO:
${text}

Restituisci UN SOLO oggetto JSON con i campi che trovi, formato {"id": {"valore": "...", "documento": "nome file", "data_validita": "GG/MM/AAAA o null", "evidenza": "testo esatto copiato dal documento"}}.`
  const userPrompt = buildUserPrompt(fullText)
  // Diagnostica leggibile della chiamata (ritornata al chiamante e mostrata nel
  // log "Salva diagnostica"): con "0 campi estratti" deve essere possibile capire
  // COSA è successo — modello, contesto, durata, token letti, risposta grezza.
  const diag = []
  diag.push(`Fascicolo intero: provider ${provider} · ${activeFields.length} campi richiesti · testo ${fullText.length} char (prompt ${userPrompt.length} char)`)
  const startedAt = Date.now()
  let raw
  try {
    if (provider === 'anthropic') {
      const model = settings.polizzaWholeDossierModel || settings.anthropicModel || 'claude-haiku-4-5-20251001'
      diag.push(`Anthropic: modello ${model}`)
      const res = await resilientFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': settings.anthropicApiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 4096, system: WHOLE_DOSSIER_SYSTEM, messages: [{ role: 'user', content: userPrompt }] }),
        signal: AbortSignal.timeout(180000)
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(`Anthropic: ${res.status} ${e?.error?.message || ''}`) }
      raw = ((await res.json()).content?.[0]?.text || '').trim()
    } else if (provider === 'openai') {
      diag.push(`OpenAI: modello ${settings.openaiModel || 'gpt-4o-mini'}`)
      const res = await resilientFetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.openaiApiKey}` },
        body: JSON.stringify({ model: settings.openaiModel || 'gpt-4o-mini', messages: [{ role: 'system', content: WHOLE_DOSSIER_SYSTEM }, { role: 'user', content: userPrompt }], temperature: 0, response_format: { type: 'json_object' }, max_tokens: 4096 }),
        signal: AbortSignal.timeout(180000)
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(`OpenAI: ${res.status} ${e?.error?.message || ''}`) }
      raw = ((await res.json()).choices?.[0]?.message?.content || '').trim()
    } else {
      // BUG FIX: il modello "fascicolo intero" (polizzaWholeDossierModel, default
      // Claude) vale SOLO per il provider Anthropic. Con Ollama va usato il modello
      // Ollama configurato (vedi resolveOllamaModel: override ammesso solo se non
      // è palesemente un modello cloud).
      const ollamaModel = resolveOllamaModel(settings)
      // BUG FIX: un fascicolo intero può superare di molto il contesto del modello
      // (es. 45 doc ≈ 158K char ≈ 64K token vs qwen2.5 = 32K). Se num_ctx supera
      // n_ctx_train, Ollama lo riduce e TRONCA il prompt in silenzio tenendo la
      // coda: la guida dei campi si perde e il modello risponde spazzatura →
      // "0 campi" senza errori. Quindi: (1) si legge il limite REALE del modello
      // da /api/show, (2) se il fascicolo non ci sta, si spezza in batch di
      // documenti interi che ci stanno.
      const modelLimit = await getOllamaContextLimit({ ...settings, ollamaModel }, ollamaModel)
      diag.push(`Ollama: limite contesto del modello ${ollamaModel}: ${modelLimit ? `${modelLimit} token` : 'sconosciuto (assumo 131072)'}`)
      // QUALITÀ PRIMA, quando è fisicamente possibile: la chiamata UNICA col
      // quadro completo (come coi provider cloud) è ciò che dà i risultati
      // migliori — il fascicolo tipico (~10 documenti ≈ 15-20K token) sta nei
      // 32K di modelli come qwen2.5. Quindi: chiamata singola fino a
      // min(limite modello, 32768) ≈ 2-4 min su hardware consumer; SOLO oltre
      // si spezza in batch (chiamate brevi da ≤16K, guardrail, uscita
      // anticipata) — il prompt-eval di 60K+ token richiederebbe 10-15+ minuti.
      const SINGLE_CALL_MAX_CTX = 32768
      const PRACTICAL_BATCH_CTX = 16384
      const singleCtxCap = Math.min(modelLimit || 131072, SINGLE_CALL_MAX_CTX)
      const estTokens = estimateOllamaTokens(WHOLE_DOSSIER_SYSTEM.length + userPrompt.length) + 3000 + 512
      if (estTokens > singleCtxCap) {
        const batchCtx = Math.min(modelLimit || 131072, PRACTICAL_BATCH_CTX)
        console.log(`[polizza:fascicolo] Ollama: ~${estTokens} token stimati > tetto chiamata singola ${singleCtxCap} → batch di documenti`)
        diag.push(`Ollama: ~${estTokens} token stimati > tetto chiamata singola ${singleCtxCap} → elaborazione a batch di documenti (polizza/appendici prima, poi quietanze/regolazioni recenti, con guardrail e uscita anticipata)`)
        return await extractWholeDossierOllamaBatched(fullText, { ...settings, ollamaModel }, activeFields, buildUserPrompt, batchCtx, diag, onProgress, singleCtxCap)
      }
      const numCtx = Math.min(singleCtxCap, Math.max(16384, Math.ceil(estTokens / 1024) * 1024))
      console.log(`[polizza:fascicolo] Ollama: prompt ${userPrompt.length} char → chiamata singola (num_ctx ${numCtx})`)
      diag.push(`Ollama: ~${estTokens} token stimati → chiamata singola col quadro completo (num_ctx ${numCtx})`)
      // 10 min: 32K token di prompt-eval su hardware consumer possono richiedere
      // 4-6 minuti; il margine evita di buttare il lavoro per un timeout.
      raw = await callOllamaRolling({ ...settings, ollamaModel }, WHOLE_DOSSIER_SYSTEM, userPrompt, { numCtx, timeoutMs: 600000, diag })
    }
  } catch (err) {
    const classified = classifyLlmError(err, settings)
    classified.diag = diag
    throw classified
  }

  const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
  diag.push(`Risposta del modello in ${secs}s: ${raw.length} char`)

  let parsed
  try {
    parsed = parseJsonResponse(raw)
  } catch (err) {
    diag.push(`Risposta NON parsabile come JSON. Inizio risposta grezza: ${JSON.stringify(String(raw).slice(0, 400))}`)
    err.diag = diag
    throw err
  }
  const fieldsById = Object.fromEntries(activeFields.map(f => [f.id, f]))
  const data = {}, sources = {}
  const unknownKeys = [], discardedKeys = [], guardrailKeys = [], evidenceKeys = []
  const strictEvidence = provider === 'ollama'
  for (const [k, e] of Object.entries(parsed || {})) {
    if (!(k in fieldsById)) { unknownKeys.push(k); continue }
    const val = (e && typeof e === 'object') ? e.valore : e
    const cleaned = sanitizeFieldValue(fieldsById[k], val)
    if (cleaned == null || cleaned === '') { discardedKeys.push(k); continue }
    // ANTI-ALLUCINAZIONE: un importo deve essere citato dall'evidenza; con Ollama
    // un importo senza evidenza è considerato inventato.
    if (!passesEvidenceCheck(cleaned, e, strictEvidence)) { evidenceKeys.push(k); continue }
    const doc = (e && typeof e === 'object' && e.documento) ? String(e.documento) : null
    // GUARDRAIL: un campo strutturale (massimali, franchigie, attività…) non può
    // venire da una quietanza/regolazione premio — è una mislettura del modello.
    if (doc && isStructuralField(fieldsById[k]) && isPeriodicDocName(doc)) { guardrailKeys.push(k); continue }
    data[k] = cleaned
    if (doc) sources[k] = { file: doc, page: '' }
  }
  const totalKeys = Object.keys(parsed || {}).length
  diag.push(`Analisi risposta: ${totalKeys} chiavi dal modello — ${Object.keys(data).length} campi validi` +
    (unknownKeys.length ? ` — ${unknownKeys.length} ignorate (id inesistenti: ${unknownKeys.slice(0, 5).join(', ')}${unknownKeys.length > 5 ? ', …' : ''})` : '') +
    (discardedKeys.length ? ` — ${discardedKeys.length} scartate da sanitizzazione (${discardedKeys.slice(0, 5).join(', ')}${discardedKeys.length > 5 ? ', …' : ''})` : '') +
    (evidenceKeys.length ? ` — ${evidenceKeys.length} importi scartati senza evidenza dal documento (${evidenceKeys.slice(0, 5).join(', ')}${evidenceKeys.length > 5 ? ', …' : ''})` : '') +
    (guardrailKeys.length ? ` — guardrail: ${guardrailKeys.length} strutturali scartate perché attribuite a quietanze/regolazioni (${guardrailKeys.slice(0, 5).join(', ')}${guardrailKeys.length > 5 ? ', …' : ''})` : ''))
  if (Object.keys(data).length === 0) {
    // È l'informazione chiave quando "non esce niente": COSA ha risposto il modello.
    diag.push(`Nessun campo valido. Inizio risposta grezza del modello: ${JSON.stringify(String(raw).slice(0, 400))}`)
  }
  return { data, sources, diag }
}

// ─── Export Excel (nuovo file) ────────────────────────────────────────────────

/**
 * Crea un nuovo file Excel con un UNICO foglio "Polizza": tutti i campi estratti
 * in un solo elenco (colonne Campo / Valore), senza suddivisione per tipologia.
 * @param {string} filePath - percorso di destinazione
 * @param {object} data - dati estratti (chiavi = id campi)
 * @param {Array|null} [fieldsConfig] - configurazione campi opzionale (default: tutti i campi polizza)
 */
export async function exportToNewExcel(filePath, data, fieldsConfig = null) {
  const { default: ExcelJS } = await import('exceljs')

  const fields = (fieldsConfig || ALL_POLIZZA_FIELDS).filter(f => f.enabled !== false)
  const wb = new ExcelJS.Workbook()

  const ws = wb.addWorksheet('Polizza')
  ws.columns = [
    { header: 'Campo',  key: 'campo',  width: 45 },
    { header: 'Valore', key: 'valore', width: 55 }
  ]
  for (const f of fields) {
    ws.addRow({ campo: f.label, valore: data[f.id] ?? '' })
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
  const hasUserMapping = Object.keys(userMapping).some(k => userMapping[k]?.sheet && userMapping[k]?.cell)
  const edits = []

  if (hasUserMapping) {
    for (const [fieldId, target] of Object.entries(userMapping)) {
      if (!target?.sheet || !target?.cell) continue
      const value = data[fieldId]
      if (value == null || value === '') continue
      const numVal = parseItalianNumber(String(value))
      edits.push({ sheet: target.sheet, cell: target.cell, value: numVal !== null ? numVal : String(value) })
    }
  } else {
    const mapping = fieldsConfig ? buildMappingFromFields(fieldsConfig) : CSA_MAPPING
    for (const [fieldId, targets] of Object.entries(mapping)) {
      if (!Array.isArray(targets) || targets.length === 0) continue
      const value = data[fieldId]
      if (value == null || value === '') continue
      const numVal = parseItalianNumber(String(value))
      for (const target of targets) {
        edits.push({ sheet: target.sheet, cell: target.cell, value: numVal !== null ? numVal : String(value) })
      }
    }
  }

  // Scrittura chirurgica: modifica SOLO le celle target, preservando intatto il
  // resto del template (formattazione, colori, validazioni, grafici…). Evita il
  // prompt di ripristino di Excel su Windows. Vedi xlsxTemplateWriter.js.
  await writeTemplatePreservingStyles(templatePath, outputPath, edits)
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
  // Lettura robusta via jszip (xlsxTemplateReader): non usa ExcelJS, che può
  // andare in crash caricando file con formattazione condizionale.
  return readTemplateStructure(templatePath, { maxRow: 50, maxCol: 26 })
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
  // Lettura robusta dei valori attuali via jszip (no ExcelJS → no crash su file
  // con formattazione condizionale).
  const templateCells = await readTemplateCells(templatePath)
  const oldCellValue = (sheet, cell) => templateCells[sheet]?.[cell] ?? ''

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
      const oldValue = oldCellValue(target.sheet, target.cell)
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
        const oldValue = oldCellValue(target.sheet, target.cell)
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
  const edits = (approvedChanges || [])
    .filter(c => c && c.sheet && c.cell)
    .map(change => {
      const numVal = parseItalianNumber(String(change.newValue))
      return { sheet: change.sheet, cell: change.cell, value: numVal !== null ? numVal : String(change.newValue) }
    })

  // Scrittura chirurgica sullo ZIP del template: niente ricostruzione del file →
  // nessuna perdita di formattazione/colori e nessun ripristino richiesto da Excel.
  await writeTemplatePreservingStyles(templatePath, outputPath, edits)
}
