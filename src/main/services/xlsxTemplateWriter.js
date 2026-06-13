/**
 * Scrittura "chirurgica" su template Excel esistenti.
 *
 * PROBLEMA che risolve:
 * ExcelJS (wb.xlsx.load → wb.xlsx.writeFile) RICOSTRUISCE l'intero file .xlsx.
 * Tutto ciò che ExcelJS non modella viene perso o alterato: formattazione
 * condizionale, validazioni dati, grafici, immagini, parti customXml, impostazioni
 * di stampa, temi colore, stili. Il risultato su Windows è il messaggio «il file
 * contiene un problema, vuoi ripristinarlo?» e una formattazione/colori diversi
 * dall'originale. ExcelJS può addirittura andare in CRASH al solo caricamento di
 * un file con formattazione condizionale.
 *
 * SOLUZIONE:
 * Un .xlsx è un archivio ZIP di parti XML. Qui apriamo lo ZIP, modifichiamo SOLO
 * il valore delle celle target dentro l'XML del foglio interessato e lasciamo ogni
 * altra parte BYTE-PER-BYTE identica. Si preserva l'indice di stile (attributo `s`)
 * di ogni cella, quindi colori, formato numero, bordi e font restano quelli
 * dell'originale. Nessuna ricostruzione → nessun ripristino, nessuna perdita.
 */

import { readFileSync } from 'fs'
import { writeFile } from 'fs/promises'

// ─── Helper riferimenti cella (A1, N17, AA3, …) ───────────────────────────────

/** Converte una colonna in lettere ("A","Z","AA") nel suo indice 1-based. */
function colToNum(col) {
  let n = 0
  for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64)
  return n
}

/** Spezza un riferimento "C3" → { col:'C', row:3, colNum:3 }. */
function splitRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(String(ref).trim().toUpperCase())
  if (!m) throw new Error(`Riferimento cella non valido: ${ref}`)
  return { col: m[1], row: parseInt(m[2], 10), colNum: colToNum(m[1]) }
}

/** Escape dei caratteri speciali per testo XML. */
function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Costruisce l'XML di una cella.
 * - number  → <c r=".." s="..">‹v›NUM‹/v›</c>  (nessun attributo t)
 * - stringa → <c r=".." s=".." t="inlineStr"><is><t xml:space="preserve">…</t></is></c>
 *   Le stringhe inline evitano di dover toccare sharedStrings.xml.
 * `styleAttr` (l'indice di stile della cella originale) viene preservato così
 * la formattazione/colore restano identici.
 */
function buildCell(ref, value, styleAttr) {
  const s = styleAttr != null ? ` s="${styleAttr}"` : ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${s}><v>${value}</v></c>`
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
}

/** Inserisce una cella nella posizione di colonna corretta dentro il contenuto di una riga. */
function insertCellInRow(rowContent, newCell, colNum) {
  const cellRe = /<c r="([A-Z]+)\d+"/g
  let m
  while ((m = cellRe.exec(rowContent))) {
    if (colToNum(m[1]) > colNum) {
      return rowContent.slice(0, m.index) + newCell + rowContent.slice(m.index)
    }
  }
  return rowContent + newCell
}

/** Inserisce una nuova riga nella posizione corretta dentro <sheetData>. */
function insertRowInSheetData(xml, newRow, rowNum) {
  // <sheetData/> vuoto
  const selfClosing = /<sheetData\s*\/>/
  if (selfClosing.test(xml)) {
    return xml.replace(selfClosing, `<sheetData>${newRow}</sheetData>`)
  }
  const rowRe = /<row r="(\d+)"/g
  let m
  while ((m = rowRe.exec(xml))) {
    if (parseInt(m[1], 10) > rowNum) {
      return xml.slice(0, m.index) + newRow + xml.slice(m.index)
    }
  }
  const close = xml.indexOf('</sheetData>')
  if (close === -1) throw new Error('Struttura foglio non valida: <sheetData> assente')
  return xml.slice(0, close) + newRow + xml.slice(close)
}

/**
 * Imposta il valore di una cella nell'XML del foglio, preservando lo stile.
 * @returns {{ xml: string, hadFormula: boolean }}
 */
function setCellValue(xml, ref, value) {
  const { row, colNum } = splitRef(ref)

  // 1. La cella esiste già? (forma <c .../> oppure <c ...>…</c>)
  const cellRe = new RegExp(`<c r="${ref}"((?:\\s[^>]*)?)(?:/>|>([\\s\\S]*?)</c>)`)
  const existing = cellRe.exec(xml)
  if (existing) {
    const attrs = existing[1] || ''
    const inner = existing[2] || ''
    const hadFormula = /<f[\s>]/.test(inner)
    const sm = /\bs="(\d+)"/.exec(attrs)
    const styleAttr = sm ? sm[1] : null
    return { xml: xml.replace(cellRe, buildCell(ref, value, styleAttr)), hadFormula }
  }

  // 2. Cella assente: va inserita mantenendo l'ordine colonne/righe richiesto da Excel.
  const newCell = buildCell(ref, value, null)

  // 2a. Riga vuota auto-chiusa <row r="3"/>
  const rowSelfRe = new RegExp(`<row r="${row}"((?:\\s[^>]*)?)/>`)
  const rowSelf = rowSelfRe.exec(xml)
  if (rowSelf) {
    return {
      xml: xml.replace(rowSelfRe, `<row r="${row}"${rowSelf[1] || ''}>${newCell}</row>`),
      hadFormula: false
    }
  }

  // 2b. Riga esistente con contenuto
  const rowOpenRe = new RegExp(`<row r="${row}"((?:\\s[^>]*)?)>`)
  const rowOpen = rowOpenRe.exec(xml)
  if (rowOpen) {
    const contentStart = rowOpen.index + rowOpen[0].length
    const endIdx = xml.indexOf('</row>', contentStart)
    if (endIdx === -1) throw new Error(`Riga ${row} malformata nel foglio`)
    const rowContent = xml.slice(contentStart, endIdx)
    const merged = insertCellInRow(rowContent, newCell, colNum)
    return { xml: xml.slice(0, contentStart) + merged + xml.slice(endIdx), hadFormula: false }
  }

  // 2c. Riga assente
  return { xml: insertRowInSheetData(xml, `<row r="${row}">${newCell}</row>`, row), hadFormula: false }
}

// ─── Risoluzione nome foglio → file XML dentro lo ZIP ──────────────────────────

/**
 * Costruisce la mappa { nomeFoglio → percorso XML } leggendo workbook.xml e i suoi
 * relationship. Necessaria perché "sheet1.xml" non corrisponde per forza al primo
 * foglio per nome.
 */
export async function buildSheetPathMap(zip) {
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string')
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string')
  if (!workbookXml || !relsXml) {
    throw new Error('File Excel non valido: workbook.xml o relationship mancanti')
  }

  // rId → target (es. rId1 → worksheets/sheet1.xml)
  const ridToTarget = {}
  const relRe = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/?>/g
  let rm
  while ((rm = relRe.exec(relsXml))) {
    // L'attributo Target può precedere Id: gestiamo entrambi gli ordini
    ridToTarget[rm[1]] = rm[2]
  }
  // Secondo passaggio per i casi in cui Target viene prima di Id
  const relRe2 = /<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\bId="([^"]+)"[^>]*\/?>/g
  while ((rm = relRe2.exec(relsXml))) {
    ridToTarget[rm[2]] = rm[1]
  }

  // nome foglio → rId
  const nameToPath = {}
  const sheetRe = /<sheet\b[^>]*\/?>/g
  let sm
  while ((sm = sheetRe.exec(workbookXml))) {
    const tag = sm[0]
    const name = /\bname="([^"]+)"/.exec(tag)?.[1]
    const rid = /\br:id="([^"]+)"/.exec(tag)?.[1] || /\br:id="([^"]+)"/.exec(tag)?.[1]
    if (!name || !rid) continue
    let target = ridToTarget[rid]
    if (!target) continue
    target = target.replace(/^\//, '')                 // "/xl/worksheets/.." → "xl/worksheets/.."
    const path = target.startsWith('xl/') ? target : `xl/${target}`
    nameToPath[name] = path
  }
  return nameToPath
}

/** Aggiunge fullCalcOnLoad a un <calcPr> esistente (solo in-place, nessun rischio di schema). */
function ensureRecalc(workbookXml) {
  if (/<calcPr\b[^>]*\bfullCalcOnLoad="1"/.test(workbookXml)) return workbookXml
  if (/<calcPr\b[^>]*\/>/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr\b([^>]*?)\s*\/>/, (_m, a) =>
      `<calcPr${a.replace(/\s*fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`)
  }
  return workbookXml // niente <calcPr>: non lo creiamo per non rischiare l'ordine dello schema
}

// ─── API pubblica ──────────────────────────────────────────────────────────────

/**
 * Scrive i valori nelle celle indicate preservando integralmente il resto del
 * template (formattazione, colori, validazioni, grafici, customXml…).
 *
 * @param {string} templatePath  percorso del template .xlsx di partenza
 * @param {string} outputPath     percorso del file da salvare
 * @param {Array<{sheet:string, cell:string, value:(string|number)}>} edits
 * @returns {Promise<{written:number, skipped:Array}>}
 */
export async function writeTemplatePreservingStyles(templatePath, outputPath, edits) {
  const { default: JSZip } = await import('jszip')

  const zip = await JSZip.loadAsync(readFileSync(templatePath))
  const sheetPaths = await buildSheetPathMap(zip)

  // Raggruppa le modifiche per foglio
  const bySheet = {}
  const skipped = []
  for (const e of edits || []) {
    if (!e || !e.sheet || !e.cell) continue
    if (e.value == null || e.value === '') continue
    if (!sheetPaths[e.sheet]) { skipped.push({ ...e, reason: 'foglio inesistente' }); continue }
    ;(bySheet[e.sheet] ||= []).push(e)
  }

  let written = 0
  let anyFormulaOverwritten = false

  for (const [sheet, sheetEdits] of Object.entries(bySheet)) {
    const path = sheetPaths[sheet]
    let xml = await zip.file(path).async('string')
    for (const e of sheetEdits) {
      const res = setCellValue(xml, e.cell, e.value)
      xml = res.xml
      if (res.hadFormula) anyFormulaOverwritten = true
      written++
    }
    zip.file(path, xml)
  }

  // Se abbiamo sovrascritto una cella che conteneva una formula, forza il ricalcolo
  // all'apertura (evita risultati "stantii" e un eventuale prompt di ripristino).
  if (anyFormulaOverwritten) {
    const wbFile = zip.file('xl/workbook.xml')
    if (wbFile) zip.file('xl/workbook.xml', ensureRecalc(await wbFile.async('string')))
  }

  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
  await writeFile(outputPath, buf)
  return { written, skipped }
}

// Esportate solo per i test unitari
export const __test = { colToNum, splitRef, setCellValue, buildSheetPathMap, escapeXml }
