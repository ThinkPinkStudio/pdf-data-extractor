/**
 * Lettura/scrittura del report "Tutte le Applicazioni" con le due colonne
 * PREMIO LORDO e IMPOTRO PREMIO LORDO TOTALE accodate.
 *
 * Qui sta l'I/O sul .xlsx; le REGOLE stanno in premioLordo.js (parte pura).
 * Lo stesso servizio serve la pagina web (Buffer → Buffer) e la CLI
 * (scripts/premio-lordo.mjs), così non esistono due implementazioni che
 * possono divergere.
 *
 * Perché non ExcelJS: caricare e riscrivere il workbook lo RICOSTRUISCE e perde
 * formattazione condizionale, filtri, grafici, stili (vedi xlsxTemplateWriter.js).
 * Qui si tocca SOLO l'XML del foglio, in un unico passaggio sulle righe: valori,
 * ordine e numero di righe restano quelli dell'input.
 */

import {
  computePremioLordo,
  verifyResult,
  aliquotaFor,
  isInclusione,
  setRoundingMode
} from './premioLordo.js'

// ─── Tracciato atteso ─────────────────────────────────────────────────────────

export const HEADERS_INPUT = [
  'Numero polizza', 'Movimento', 'Numero proposta', 'Stato', 'Titolo di emissione',
  'Finanziamento', 'Cod. cliente', 'Targa / Telaio / N.Pat', 'Marca / Modello',
  'Valore Assicurato', 'Data Entrata', 'Data Uscita', 'Cluster', 'Tipo Bene',
  'Garanzia', 'Premio Netto', 'Rateo Positivo', 'Rateo Negativo',
  'Numero polizza sostituita'
]

export const HEADER_PREMIO_LORDO = 'PREMIO LORDO'
export const HEADER_TOTALE = 'IMPOTRO PREMIO LORDO TOTALE'
const COLONNE_RICHIESTE = ['Numero polizza', 'Movimento', 'Garanzia', 'Premio Netto']

/** Errore con un codice stabile, così la UI può distinguere i casi. */
export class PremioLordoError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'PremioLordoError'
    this.code = code
    this.details = details
  }
}

// ─── XML helpers ──────────────────────────────────────────────────────────────

const unescapeXml = (s) =>
  String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')

const escapeXml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function colToNum(col) {
  let n = 0
  for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64)
  return n
}

export function numToCol(n) {
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - r) / 26)
  }
  return s
}

function parseSharedStrings(xml) {
  if (!xml) return []
  const out = []
  const siRe = /<si>([\s\S]*?)<\/si>|<si\s*\/>/g
  let m
  while ((m = siRe.exec(xml))) {
    if (m[1] == null) { out.push(''); continue }
    let text = ''
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g
    let tm
    while ((tm = tRe.exec(m[1]))) text += tm[1]
    out.push(unescapeXml(text))
  }
  return out
}

function decodeCell(attrs, body, shared) {
  const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1]
  if (!ref) return null
  const t = /\bt="([^"]+)"/.exec(attrs)?.[1] || 'n'
  const vRaw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
  let text = ''
  let num = null
  if (t === 's') {
    text = shared[parseInt(vRaw, 10)] ?? ''
  } else if (t === 'inlineStr') {
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g
    let tm
    while ((tm = tRe.exec(body))) text += tm[1]
    text = unescapeXml(text)
  } else if (t === 'str' || t === 'e') {
    text = unescapeXml(vRaw || '')
  } else if (t === 'b') {
    text = vRaw === '1' ? 'VERO' : 'FALSO'
  } else if (vRaw != null && vRaw !== '') {
    num = parseFloat(vRaw)
    text = vRaw
  }
  return { colNum: colToNum(ref), text, num, styleIdx: /\bs="(\d+)"/.exec(attrs)?.[1] ?? null }
}

const ROW_RE = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g
const CELL_RE = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g

/** Legge il foglio: righe in ordine, ogni riga con la mappa colonna → cella. */
function readSheet(sheetXml, shared) {
  const rows = []
  let maxCol = 0
  ROW_RE.lastIndex = 0
  let rm
  while ((rm = ROW_RE.exec(sheetXml))) {
    const rowNum = parseInt(/\br="(\d+)"/.exec(rm[1] || '')?.[1] || '0', 10)
    if (!rowNum) continue
    const cells = new Map()
    CELL_RE.lastIndex = 0
    let cm
    while ((cm = CELL_RE.exec(rm[2] || ''))) {
      const cell = decodeCell(cm[1] || '', cm[2] || '', shared)
      if (!cell) continue
      cells.set(cell.colNum, cell)
      if (cell.colNum > maxCol) maxCol = cell.colNum
    }
    rows.push({ rowNum, cells })
  }
  return { rows, maxCol }
}

/**
 * Riscrive il foglio in UN SOLO passaggio: per ogni riga toglie le celle oltre
 * `purgeAbove` e accoda l'XML fornito da `appendFor(rowNum)`.
 * Un passaggio unico invece di una regex per riga: su 4.500 righe × 2,5 MB la
 * seconda strada sarebbe quadratica (minuti invece di millisecondi).
 */
function rewriteSheet(sheetXml, { purgeAbove, appendFor, newMaxCol }) {
  let purged = 0
  let purgedFormulas = 0
  ROW_RE.lastIndex = 0

  const out = sheetXml.replace(ROW_RE, (full, attrs, inner) => {
    const rowNum = parseInt(/\br="(\d+)"/.exec(attrs || '')?.[1] || '0', 10)
    if (!rowNum) return full

    let body = inner ?? ''
    if (purgeAbove != null && body) {
      CELL_RE.lastIndex = 0
      body = body.replace(CELL_RE, (cellFull, cAttrs, cBody) => {
        const ref = /\br="([A-Z]+)\d+"/.exec(cAttrs || '')?.[1]
        if (!ref || colToNum(ref) <= purgeAbove) return cellFull
        purged++
        if (/<f[\s>/]/.test(cBody || '')) purgedFormulas++
        return ''
      })
    }

    const extra = appendFor(rowNum) || ''
    if (!extra && body === (inner ?? '')) return full

    let rowAttrs = attrs || ''
    if (extra) {
      // `spans` dichiara l'intervallo di colonne della riga: va riallineato.
      rowAttrs = rowAttrs.replace(/\bspans="(\d+):(\d+)"/, (_m, from) => `spans="${from}:${newMaxCol}"`)
    }
    return `<row${rowAttrs}>${body}${extra}</row>`
  })

  return { xml: out, purged, purgedFormulas }
}

const cellText = (cells, colNum) => String(cells?.get(colNum)?.text ?? '').trim()
const cellValue = (cells, colNum) => {
  const c = cells?.get(colNum)
  if (!c) return ''
  return c.num != null ? c.num : c.text
}

// ─── Stili e geometria del foglio ─────────────────────────────────────────────

/**
 * Registra in cellXfs uno stile con numFmtId=4 (built-in "#,##0.00": in Excel
 * italiano si legge 1.234,56) e ne restituisce l'indice. I valori restano
 * NUMERI veri — sommabili in Excel — con due decimali sempre visibili.
 */
function addNumberStyle(stylesXml) {
  const xf = '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'

  const selfClosing = /<cellXfs\b[^>]*?\/>/.exec(stylesXml)
  if (selfClosing) {
    return { xml: stylesXml.replace(selfClosing[0], `<cellXfs count="1">${xf}</cellXfs>`), index: 0 }
  }
  const block = /<cellXfs\b([^>]*?)>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)
  if (!block) {
    throw new PremioLordoError('styles', 'styles.xml senza <cellXfs>: impossibile registrare il formato numerico')
  }
  const existing = (block[2].match(/<xf\b/g) || []).length
  const attrs = block[1].replace(/\s*count="\d+"/, '')
  return {
    xml: stylesXml.replace(block[0], `<cellXfs${attrs} count="${existing + 1}">${block[2]}${xf}</cellXfs>`),
    index: existing
  }
}

const buildNumberCell = (ref, value, styleIdx) => `<c r="${ref}" s="${styleIdx}"><v>${value}</v></c>`
const buildTextCell = (ref, value, styleIdx) =>
  `<c r="${ref}"${styleIdx != null ? ` s="${styleIdx}"` : ''} t="inlineStr">` +
  `<is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`

/** Allinea <dimension ref="A1:X4529"/> all'ultima colonna effettiva. */
function fixDimension(xml, lastColLetter) {
  return xml.replace(
    /<dimension\s+ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\s*\/>/,
    (_m, c1, r1, _c2, r2) => `<dimension ref="${c1}${r1}:${lastColLetter}${r2}"/>`
  )
}

/**
 * Ripulisce gli intervalli di celle unite che cadevano nelle colonne rimosse.
 *
 * Nei file "lavorati a mano" il totale provvisorio sta spesso in una colonna
 * UNITA: togliere le celle senza togliere l'unione lascerebbe un blocco unito
 * vuoto a destra delle colonne nuove. Un intervallo a cavallo viene accorciato
 * invece che buttato.
 */
function cleanMergeCells(xml, lastInputCol) {
  let removed = 0
  const out = xml.replace(/<mergeCells\b[^>]*>([\s\S]*?)<\/mergeCells>/, (_full, inner) => {
    const kept = []
    const re = /<mergeCell\b[^>]*\bref="([A-Z]+)(\d+):([A-Z]+)(\d+)"[^>]*\/>/g
    let m
    while ((m = re.exec(inner))) {
      const [, c1, r1, c2, r2] = m
      if (colToNum(c1) > lastInputCol) { removed++; continue }
      if (colToNum(c2) > lastInputCol) {
        removed++
        kept.push(`<mergeCell ref="${c1}${r1}:${numToCol(lastInputCol)}${r2}"/>`)
        continue
      }
      kept.push(m[0])
    }
    // <mergeCells count="0"/> non è valido: se non resta nulla si toglie tutto
    return kept.length ? `<mergeCells count="${kept.length}">${kept.join('')}</mergeCells>` : ''
  })
  return { xml: out, removed }
}

/** Altri elementi con riferimenti a intervalli, per non lasciarli danglanti in silenzio. */
function danglingRanges(xml, lastInputCol) {
  const warnings = []
  const re = /<(conditionalFormatting|dataValidation|autoFilter|ignoredError)\b[^>]*\b(?:sqref|ref)="([^"]+)"/g
  let m
  while ((m = re.exec(xml))) {
    const oltre = m[2].split(/\s+/).some((range) =>
      range.split(':').some((ref) => {
        const col = /^([A-Z]+)/.exec(ref)?.[1]
        return col && colToNum(col) > lastInputCol
      })
    )
    if (oltre) warnings.push(`<${m[1]}> su ${m[2]}`)
  }
  return warnings
}

/**
 * Riscrive <cols>: butta le larghezze delle colonne di lavoro rimosse e ne
 * definisce due nuove per le colonne aggiunte.
 *
 * Non è cosmesi: se la colonna riusata portava `style` con formato PERCENTUALE
 * (capita nei file lavorati a mano), il totale erediterebbe una colonna che di
 * default mostra percentuali.
 */
function rewriteCols(xml, lastInputCol, colLordo, colTotale) {
  const nuove =
    `<col min="${colLordo}" max="${colLordo}" width="14" customWidth="1"/>` +
    `<col min="${colTotale}" max="${colTotale}" width="28" customWidth="1"/>`

  if (!/<cols>/.test(xml)) {
    return xml.replace(/(<sheetData[\s>])/, `<cols>${nuove}</cols>$1`)
  }
  return xml.replace(/<cols>([\s\S]*?)<\/cols>/, (_full, inner) => {
    const kept = inner.replace(/<col\b[^>]*?\/>/g, (col) => {
      const min = parseInt(/\bmin="(\d+)"/.exec(col)?.[1] || '0', 10)
      const max = parseInt(/\bmax="(\d+)"/.exec(col)?.[1] || '0', 10)
      if (min > lastInputCol) return ''
      if (max > lastInputCol) return col.replace(/\bmax="\d+"/, `max="${lastInputCol}"`)
      return col
    })
    return `<cols>${kept}${nuove}</cols>`
  })
}

// ─── API pubblica ─────────────────────────────────────────────────────────────

/**
 * Elabora il report e restituisce il file con le due colonne in coda.
 *
 * @param {Buffer|Uint8Array|ArrayBuffer} input  contenuto del .xlsx di partenza
 * @param {object} [opts]
 * @param {string}  [opts.sheet]           nome del foglio (default: quello numerico, altrimenti il primo)
 * @param {'commerciale'|'legacy'} [opts.rounding='commerciale']
 * @param {boolean} [opts.keepExtra=false]  tiene le colonne oltre il tracciato
 * @param {boolean} [opts.assumeDefault=false] applica 13,5% alle garanzie fuori tabella
 * @returns {Promise<{buffer:Buffer|null, blocked:string|null, report:object}>}
 *   `blocked === 'unknownGaranzie'` → nessun file prodotto: servono conferme
 *   (le trovi in `report.unknownGaranzie`). Rilancia con assumeDefault:true.
 */
export async function processPremioLordo(input, opts = {}) {
  const {
    sheet: wantedSheet = null,
    rounding = 'commerciale',
    keepExtra = false,
    assumeDefault = false
  } = opts

  setRoundingMode(rounding)

  const { default: JSZip } = await import('jszip')
  const { buildSheetPathMap } = await import('./xlsxTemplateWriter.js')

  let zip
  try {
    zip = await JSZip.loadAsync(input)
  } catch {
    throw new PremioLordoError('notXlsx', 'Il file non è un .xlsx leggibile (è un .xls o un CSV rinominato?)')
  }

  const sheetPaths = await buildSheetPathMap(zip)
  const sheetNames = Object.keys(sheetPaths)
  if (!sheetNames.length) throw new PremioLordoError('noSheets', 'Nessun foglio nel workbook')

  const sheetName = wantedSheet || sheetNames.find((n) => /^\d+$/.test(n.trim())) || sheetNames[0]
  if (!sheetPaths[sheetName]) {
    throw new PremioLordoError('sheetNotFound', `Foglio "${sheetName}" inesistente`, { sheets: sheetNames })
  }

  const sheetPath = sheetPaths[sheetName]
  let sheetXml = await zip.file(sheetPath).async('string')
  const shared = parseSharedStrings(await zip.file('xl/sharedStrings.xml')?.async('string'))
  const { rows, maxCol } = readSheet(sheetXml, shared)
  if (!rows.length) throw new PremioLordoError('emptySheet', `Foglio "${sheetName}" vuoto`)

  // ── Intestazione: la riga che riconosce più colonne del tracciato ───────────
  const normHeader = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  const wanted = new Set(HEADERS_INPUT.map(normHeader))
  let headerRow = 0
  let headerScore = 0
  let headerCells = null
  for (const r of rows.slice(0, 50)) {
    let score = 0
    for (const [, c] of r.cells) if (wanted.has(normHeader(c.text))) score++
    if (score > headerScore) { headerScore = score; headerRow = r.rowNum; headerCells = r.cells }
  }
  if (headerScore < 10) {
    throw new PremioLordoError(
      'headerNotFound',
      `Intestazione non riconosciuta nel foglio "${sheetName}": ` +
      `${headerScore} colonne su ${HEADERS_INPUT.length}`,
      { sheets: sheetNames, sheet: sheetName, score: headerScore }
    )
  }

  // Colonne del TRACCIATO: solo quelle riconosciute. Quello che sta oltre
  // (appunti di lavoro) non conta come input.
  const colByHeader = new Map()
  let lastInputCol = 0
  for (const [colNum, c] of headerCells) {
    const key = normHeader(c.text)
    if (!wanted.has(key)) continue
    if (!colByHeader.has(key)) colByHeader.set(key, colNum)
    lastInputCol = Math.max(lastInputCol, colNum)
  }
  const colOf = (name) => colByHeader.get(normHeader(name))

  const mancanti = COLONNE_RICHIESTE.filter((h) => !colOf(h))
  if (mancanti.length) {
    throw new PremioLordoError('missingColumns', `Colonne indispensabili assenti: ${mancanti.join(', ')}`, { mancanti })
  }

  const COL_POLIZZA = colOf('Numero polizza')
  const COL_MOVIMENTO = colOf('Movimento')
  const COL_GARANZIA = colOf('Garanzia')
  const COL_NETTO = colOf('Premio Netto')
  const colLordo = lastInputCol + 1
  const colTotale = lastInputCol + 2

  // Colonne estranee già presenti (appunti di lavoro)
  const extraCols = new Map()
  for (const r of rows) {
    for (const [colNum, c] of r.cells) {
      if (colNum <= lastInputCol) continue
      if (String(c.text ?? '').trim() === '') continue
      const e = extraCols.get(colNum) || { colonna: numToCol(colNum), etichetta: null, celle: 0 }
      if (r.rowNum === headerRow) e.etichetta = c.text
      e.celle++
      extraCols.set(colNum, e)
    }
  }

  // ── Calcolo ────────────────────────────────────────────────────────────────
  const dataRows = rows
    .filter((r) => r.rowNum > headerRow)
    .map((r) => ({
      rowNum: r.rowNum,
      numeroPolizza: cellText(r.cells, COL_POLIZZA),
      movimento: cellText(r.cells, COL_MOVIMENTO),
      garanzia: cellText(r.cells, COL_GARANZIA),
      premioNetto: cellValue(r.cells, COL_NETTO)
    }))

  const result = computePremioLordo(dataRows)
  const verification = verifyResult(dataRows, result)

  // Riepiloghi per la UI
  const perMovimento = new Map()
  for (const r of dataRows) {
    const k = r.movimento || '(vuoto)'
    perMovimento.set(k, (perMovimento.get(k) || 0) + 1)
  }
  const perGaranzia = new Map()
  for (const r of dataRows) {
    if (!isInclusione(r.movimento)) continue
    const k = r.garanzia || '(vuota)'
    perGaranzia.set(k, (perGaranzia.get(k) || 0) + 1)
  }

  const report = {
    sheet: sheetName,
    sheets: sheetNames,
    headerRow,
    headerScore,
    righeDati: dataRows.length,
    colonnaLordo: numToCol(colLordo),
    colonnaTotale: numToCol(colTotale),
    rounding,
    movimenti: [...perMovimento.entries()]
      .map(([nome, righe]) => ({ nome, righe }))
      .sort((a, b) => b.righe - a.righe),
    garanzie: [...perGaranzia.entries()]
      .map(([nome, righe]) => {
        const { rate, known } = aliquotaFor(nome)
        return { nome, righe, aliquota: rate, inTabella: known }
      })
      .sort((a, b) => b.righe - a.righe),
    inclusioni: result.stats.inclusioni,
    calcolate: result.stats.calcolate,
    polizze: result.groups.length,
    totaleGenerale: Math.round(result.groups.reduce((a, g) => a + g.total, 0) * 100) / 100,
    unknownGaranzie: result.unknownGaranzie.map((u) => ({
      garanzia: u.garanzia,
      righe: u.count,
      esempi: u.rows.slice(0, 8).map((i) => dataRows[i].rowNum)
    })),
    premioNettoIllleggibile: result.missingPremio.map((m) => ({
      riga: dataRows[m.index].rowNum,
      valore: String(m.raw ?? '')
    })),
    pareggi: result.tieBreaks.map((t) => ({
      riga: dataRows[t.index].rowNum,
      garanzia: String(t.garanzia ?? ''),
      premioNetto: String(t.premioNetto ?? ''),
      valore: t.valore,
      alternativa: t.alt
    })),
    colonneExtra: [...extraCols.values()],
    colonneExtraRimosse: !keepExtra,
    verifica: verification.checks.map((c) => ({ nome: c.name, ok: c.ok, dettaglio: c.detail })),
    verificaOk: verification.ok,
    celleRimosse: 0,
    formuleRimosse: 0,
    unioniRimosse: 0,
    avvisi: []
  }

  // Garanzia fuori tabella: NON si inventa un'aliquota, si chiede conferma.
  if (report.unknownGaranzie.length && !assumeDefault) {
    return { buffer: null, blocked: 'unknownGaranzie', report }
  }

  if (!verification.ok) {
    throw new PremioLordoError('verificationFailed', 'Verifica interna fallita: nessun file prodotto', {
      checks: report.verifica
    })
  }

  // ── Scrittura ──────────────────────────────────────────────────────────────
  if (keepExtra && maxCol >= colLordo) {
    throw new PremioLordoError(
      'extraColumnsClash',
      `Le colonne ${numToCol(colLordo)}/${numToCol(colTotale)} sono già occupate: ` +
      'con "mantieni colonne extra" i due usi si sovrapporrebbero.'
    )
  }

  const stylesXmlRaw = await zip.file('xl/styles.xml')?.async('string')
  if (!stylesXmlRaw) throw new PremioLordoError('noStyles', 'styles.xml assente dal workbook')
  const styled = addNumberStyle(stylesXmlRaw)
  const numStyle = styled.index
  const headerStyle = headerCells.get(lastInputCol)?.styleIdx ?? null

  const appendByRow = new Map()
  appendByRow.set(
    headerRow,
    buildTextCell(`${numToCol(colLordo)}${headerRow}`, HEADER_PREMIO_LORDO, headerStyle) +
      buildTextCell(`${numToCol(colTotale)}${headerRow}`, HEADER_TOTALE, headerStyle)
  )
  dataRows.forEach((row, i) => {
    const lordo = result.premioLordo[i]
    const tot = result.totale[i]
    if (lordo == null && tot == null) return // cella assente = cella vuota: è quanto chiesto
    let xmlCells = ''
    if (lordo != null) xmlCells += buildNumberCell(`${numToCol(colLordo)}${row.rowNum}`, lordo, numStyle)
    if (tot != null) xmlCells += buildNumberCell(`${numToCol(colTotale)}${row.rowNum}`, tot, numStyle)
    appendByRow.set(row.rowNum, xmlCells)
  })

  const rewritten = rewriteSheet(sheetXml, {
    purgeAbove: keepExtra ? null : lastInputCol,
    appendFor: (rowNum) => appendByRow.get(rowNum),
    newMaxCol: colTotale
  })
  sheetXml = fixDimension(rewritten.xml, numToCol(colTotale))
  report.celleRimosse = rewritten.purged
  report.formuleRimosse = rewritten.purgedFormulas

  if (!keepExtra) {
    sheetXml = rewriteCols(sheetXml, lastInputCol, colLordo, colTotale)
    const merged = cleanMergeCells(sheetXml, lastInputCol)
    sheetXml = merged.xml
    report.unioniRimosse = merged.removed
    report.avvisi = danglingRanges(sheetXml, lastInputCol)
  }

  zip.file(sheetPath, sheetXml)
  zip.file('xl/styles.xml', styled.xml)

  // Le formule cancellate lasciano una calcChain che punta al nulla → Excel
  // chiederebbe di "ripristinare" il file. La si toglie: Excel la rigenera.
  if (rewritten.purgedFormulas > 0 && zip.file('xl/calcChain.xml')) {
    zip.remove('xl/calcChain.xml')
    const ctFile = zip.file('[Content_Types].xml')
    if (ctFile) {
      const ct = await ctFile.async('string')
      zip.file('[Content_Types].xml', ct.replace(/<Override[^>]*calcChain\.xml"[^>]*\/>/g, ''))
    }
    const relsFile = zip.file('xl/_rels/workbook.xml.rels')
    if (relsFile) {
      const rels = await relsFile.async('string')
      zip.file('xl/_rels/workbook.xml.rels', rels.replace(/<Relationship[^>]*calcChain\.xml"[^>]*\/>/g, ''))
    }
  }

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })

  // ── Ricontrollo sul file appena SCRITTO, non sul calcolo in memoria ─────────
  const outZip = await JSZip.loadAsync(buffer)
  const outPath = (await buildSheetPathMap(outZip))[sheetName]
  const outShared = parseSharedStrings(await outZip.file('xl/sharedStrings.xml')?.async('string'))
  const outSheet = readSheet(await outZip.file(outPath).async('string'), outShared)
  const outData = outSheet.rows.filter((r) => r.rowNum > headerRow)
  const hdr = outSheet.rows.find((r) => r.rowNum === headerRow)?.cells

  const riletture = [
    { nome: 'righe dati invariate', ok: outData.length === dataRows.length, dettaglio: `${outData.length} / ${dataRows.length}` },
    { nome: 'ultima colonna', ok: outSheet.maxCol === colTotale, dettaglio: `${numToCol(outSheet.maxCol)} (attesa ${numToCol(colTotale)})` },
    {
      nome: 'intestazioni nuove',
      ok: cellText(hdr, colLordo) === HEADER_PREMIO_LORDO && cellText(hdr, colTotale) === HEADER_TOTALE,
      dettaglio: `${cellText(hdr, colLordo)} / ${cellText(hdr, colTotale)}`
    },
    {
      nome: 'PREMIO LORDO valorizzati',
      ok: outData.filter((r) => r.cells.get(colLordo)?.num != null).length === result.stats.calcolate,
      dettaglio: `${outData.filter((r) => r.cells.get(colLordo)?.num != null).length} / ${result.stats.calcolate}`
    },
    {
      nome: 'totali di polizza',
      ok: outData.filter((r) => r.cells.get(colTotale)?.num != null).length === result.groups.length,
      dettaglio: `${outData.filter((r) => r.cells.get(colTotale)?.num != null).length} / ${result.groups.length}`
    }
  ]
  report.rilettura = riletture
  report.riletturaOk = riletture.every((c) => c.ok)

  if (!report.riletturaOk) {
    throw new PremioLordoError('outputCheckFailed', 'Il file prodotto non ha superato la rilettura', {
      checks: riletture
    })
  }

  return { buffer, blocked: null, report }
}

/** Nome suggerito per il file di uscita, a partire da quello di partenza. */
export function outputFileName(inputName) {
  const base = String(inputName || 'report').replace(/\.[^.]*$/, '') || 'report'
  return `${base} - PREMIO LORDO.xlsx`
}
