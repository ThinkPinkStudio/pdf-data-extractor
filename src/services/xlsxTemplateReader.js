/**
 * Lettura "robusta" dei valori da un template Excel.
 *
 * Come per la scrittura (xlsxTemplateWriter.js), NON usiamo ExcelJS: il suo
 * caricamento completo può andare in CRASH su file con formattazione condizionale
 * e in generale fatica con i file prodotti da Excel reale. Qui leggiamo solo i
 * valori delle celle direttamente dall'XML dei fogli dentro lo ZIP, gestendo
 * stringhe condivise, stringhe inline, numeri, booleani, risultati di formula e
 * date (numero seriale + formato data → GG/MM/AAAA).
 *
 * Usata da readExcelStructure (mappatura campi→celle) e previewTemplateChanges
 * (valori "vecchi" nel diff): operazioni di sola lettura per la UI.
 */

import { readFileSync } from 'fs'
import { buildSheetPathMap } from './xlsxTemplateWriter.js'

/** Reverse dell'escape XML, per il testo da mostrare. */
function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&') // per ultimo, per non ri-decodificare
}

/** Numero seriale Excel (sistema 1900) → 'GG/MM/AAAA'. Solo per visualizzazione. */
function serialToDateStr(serial) {
  if (!Number.isFinite(serial)) return null
  // 25569 = giorni tra 1899-12-30 (epoca Excel) e 1970-01-01 (epoca Unix)
  const ms = Math.round((serial - 25569) * 86400 * 1000)
  const d = new Date(ms)
  if (isNaN(d.getTime())) return null
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getUTCFullYear()}`
}

/** Estrae l'array delle stringhe condivise da sharedStrings.xml (index-aligned). */
function parseSharedStrings(xml) {
  if (!xml) return []
  const out = []
  const siRe = /<si>([\s\S]*?)<\/si>|<si\s*\/>/g
  let m
  while ((m = siRe.exec(xml))) {
    if (m[1] == null) { out.push(''); continue } // <si/> vuoto
    let text = ''
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g
    let tm
    while ((tm = tRe.exec(m[1]))) text += tm[1]
    out.push(unescapeXml(text))
  }
  return out
}

/**
 * Costruisce isDateStyle[styleIndex] = true se quella cella usa un formato data/ora.
 * Considera i formati built-in (14-22, 45-47) e i numFmt personalizzati con token data.
 */
function buildDateStyleFlags(stylesXml) {
  const dateFmtIds = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])
  if (!stylesXml) return []

  // numFmt personalizzati: se il formatCode contiene token di anno/giorno è una data
  const numFmtRe = /<numFmt\b[^>]*\bnumFmtId="(\d+)"[^>]*\bformatCode="([^"]*)"/g
  let m
  while ((m = numFmtRe.exec(stylesXml))) {
    const code = m[2].toLowerCase().replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '')
    if (/[dy]/.test(code)) dateFmtIds.add(+m[1])
  }

  // cellXfs: l'ordine degli <xf> corrisponde all'indice di stile `s` delle celle
  const block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)
  const flags = []
  if (block) {
    const xfRe = /<xf\b([^>]*?)\/?>/g
    let xm
    while ((xm = xfRe.exec(block[1]))) {
      const idm = /\bnumFmtId="(\d+)"/.exec(xm[1])
      flags.push(dateFmtIds.has(idm ? +idm[1] : 0))
    }
  }
  return flags
}

/** Estrae { 'A1': 'valore', … } dal foglio, con valori già in forma display. */
function cellsFromSheet(sheetXml, shared, isDateStyle) {
  const cells = {}
  if (!sheetXml) return cells
  const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
  let m
  while ((m = cRe.exec(sheetXml))) {
    const attrs = m[1] || ''
    const inner = m[2] || ''
    const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1]
    if (!ref) continue
    const t = /\bt="([^"]+)"/.exec(attrs)?.[1] || 'n'
    const sIdx = /\bs="(\d+)"/.exec(attrs)?.[1]
    const vRaw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]

    let val = ''
    if (t === 's') {
      val = shared[parseInt(vRaw, 10)] ?? ''
    } else if (t === 'inlineStr') {
      let text = ''
      const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g
      let tm
      while ((tm = tRe.exec(inner))) text += tm[1]
      val = unescapeXml(text)
    } else if (t === 'str') {
      val = unescapeXml(vRaw || '')
    } else if (t === 'b') {
      val = vRaw === '1' ? 'VERO' : 'FALSO'
    } else if (t === 'e') {
      val = unescapeXml(vRaw || '')
    } else {
      // numero (eventualmente data)
      if (vRaw == null || vRaw === '') val = ''
      else if (sIdx != null && isDateStyle[+sIdx]) val = serialToDateStr(parseFloat(vRaw)) || vRaw
      else if (parseFloat(vRaw) === 0) val = '' // coerente con la vecchia getCellDisplayValue
      else val = vRaw
    }

    if (typeof val === 'string' && val.trim() === '……….') val = ''
    if (val != null && val !== '') cells[ref] = String(val)
  }
  return cells
}

/**
 * Legge tutti i fogli del template e restituisce { nomeFoglio: { cella: valore } }.
 * @param {string} templatePath
 */
export async function readTemplateCells(templatePath) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(readFileSync(templatePath))
  const sheetPaths = await buildSheetPathMap(zip)
  const shared = parseSharedStrings(await zip.file('xl/sharedStrings.xml')?.async('string'))
  const isDateStyle = buildDateStyleFlags(await zip.file('xl/styles.xml')?.async('string'))

  const result = {}
  for (const [name, path] of Object.entries(sheetPaths)) {
    const xml = await zip.file(path)?.async('string')
    result[name] = cellsFromSheet(xml, shared, isDateStyle)
  }
  return result
}

/** Indice colonna (A=1) per ordinare le celle. */
function colNum(ref) {
  const col = /^([A-Z]+)/.exec(ref)?.[1] || ''
  let n = 0
  for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64)
  return n
}

/**
 * Struttura del template per la UI di mappatura: { nomeFoglio: [{addr, value}] }.
 * Limitata alle prime righe/colonne per non riempire la UI (come la versione ExcelJS).
 */
export async function readTemplateStructure(templatePath, { maxRow = 50, maxCol = 26 } = {}) {
  const bySheet = await readTemplateCells(templatePath)
  const structure = {}
  for (const [name, cells] of Object.entries(bySheet)) {
    const list = Object.entries(cells)
      .filter(([addr]) => {
        const row = parseInt(/(\d+)$/.exec(addr)?.[1] || '0', 10)
        return row >= 1 && row <= maxRow && colNum(addr) <= maxCol
      })
      .sort((a, b) => {
        const ra = parseInt(/(\d+)$/.exec(a[0])[1], 10)
        const rb = parseInt(/(\d+)$/.exec(b[0])[1], 10)
        return ra - rb || colNum(a[0]) - colNum(b[0])
      })
      .map(([addr, value]) => ({ addr, value: String(value).slice(0, 60) }))
    structure[name] = list
  }
  return structure
}
