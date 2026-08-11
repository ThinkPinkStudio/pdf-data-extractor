#!/usr/bin/env node
/**
 * CLI: aggiunge PREMIO LORDO e IMPOTRO PREMIO LORDO TOTALE al report
 * "Tutte le Applicazioni".
 *
 *   node scripts/premio-lordo.mjs input.xlsx [output.xlsx] [opzioni]
 *
 * Opzioni:
 *   --sheet <nome>       foglio da elaborare (default: quello con nome numerico,
 *                        es. "20265539", altrimenti il primo)
 *   --rounding <modo>    commerciale (default, half-up: 26,105 → 26,11) oppure
 *                        "legacy" (half-even, come il vecchio output: 26,105 → 26,10)
 *   --keep-extra         NON rimuove le colonne oltre le 19 di tracciato
 *                        (di default gli appunti di lavoro tipo "Imposte
 *                        Percentuali"/"Premio lordo" vengono tolti, come nel
 *                        file di output di riferimento)
 *   --assume-default     applica 13,5% alle garanzie non in tabella senza
 *                        chiedere (senza questo flag il comando si FERMA)
 *   --dry-run            calcola e stampa il report, non scrive nulla
 *
 * Perché non ExcelJS: caricare e riscrivere il workbook lo RICOSTRUISCE e perde
 * formattazione condizionale, filtri, grafici, stili (vedi xlsxTemplateWriter.js).
 * Qui si tocca SOLO l'XML del foglio, in un unico passaggio sulle righe: valori,
 * ordine e numero di righe restano quelli dell'input.
 */

import { readFileSync, existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import path from 'path'

import { buildSheetPathMap } from '../src/main/services/xlsxTemplateWriter.js'
import {
  computePremioLordo,
  verifyResult,
  aliquotaFor,
  formatItalian,
  isInclusione,
  setRoundingMode
} from '../src/main/services/premioLordo.js'

// ─── Tracciato atteso ─────────────────────────────────────────────────────────

const HEADERS_INPUT = [
  'Numero polizza', 'Movimento', 'Numero proposta', 'Stato', 'Titolo di emissione',
  'Finanziamento', 'Cod. cliente', 'Targa / Telaio / N.Pat', 'Marca / Modello',
  'Valore Assicurato', 'Data Entrata', 'Data Uscita', 'Cluster', 'Tipo Bene',
  'Garanzia', 'Premio Netto', 'Rateo Positivo', 'Rateo Negativo',
  'Numero polizza sostituita'
]

const HEADER_PREMIO_LORDO = 'PREMIO LORDO'
const HEADER_TOTALE = 'IMPOTRO PREMIO LORDO TOTALE'
const COLONNE_RICHIESTE = ['Numero polizza', 'Movimento', 'Garanzia', 'Premio Netto']

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

function colToNum(col) {
  let n = 0
  for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64)
  return n
}

function numToCol(n) {
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

/** Decodifica una singola cella `<c …>` in { colNum, text, num, styleIdx, hasFormula }. */
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
  return {
    colNum: colToNum(ref),
    text,
    num,
    styleIdx: /\bs="(\d+)"/.exec(attrs)?.[1] ?? null,
    hasFormula: /<f[\s>/]/.test(body)
  }
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

    // `spans` dichiara l'intervallo di colonne della riga: va riallineato.
    let rowAttrs = attrs || ''
    if (extra) {
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

// ─── Stili ────────────────────────────────────────────────────────────────────

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
  if (!block) throw new Error('styles.xml senza <cellXfs>: impossibile registrare il formato numerico')
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

/** Allarga/stringe <dimension ref="A1:X4529"/> sull'ultima colonna effettiva. */
function fixDimension(xml, lastColLetter) {
  return xml.replace(
    /<dimension\s+ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\s*\/>/,
    (_m, c1, r1, _c2, r2) => `<dimension ref="${c1}${r1}:${lastColLetter}${r2}"/>`
  )
}

/**
 * Ripulisce gli intervalli di celle unite che cadevano nelle colonne rimosse.
 *
 * Nel file di partenza il totale a mano stava in X10:X21 UNITE: togliere le
 * celle senza togliere l'unione lascerebbe un blocco unito vuoto a destra delle
 * colonne nuove. Un intervallo a cavallo viene accorciato invece che buttato.
 */
function cleanMergeCells(xml, lastInputCol) {
  let removed = 0
  const out = xml.replace(/<mergeCells\b[^>]*>([\s\S]*?)<\/mergeCells>/, (_full, inner) => {
    const kept = []
    const re = /<mergeCell\b[^>]*\bref="([A-Z]+)(\d+):([A-Z]+)(\d+)"[^>]*\/>/g
    let m
    while ((m = re.exec(inner))) {
      const [, c1, r1, c2, r2] = m
      if (colToNum(c1) > lastInputCol) { removed++; continue } // tutto negli appunti
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

/**
 * Altri elementi che portano riferimenti a intervalli: se puntano alle colonne
 * rimosse lo si dice, invece di lasciare che Excel se ne accorga per primo.
 */
function warnDanglingRanges(xml, lastInputCol) {
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
 * definisce due nuove per PREMIO LORDO / IMPOTRO PREMIO LORDO TOTALE.
 *
 * Non è cosmesi: nel file di partenza la colonna U aveva `style="4"`, cioè il
 * formato PERCENTUALE degli appunti ("Imposte Percentuali"). Lasciarla lì
 * significherebbe dare al totale una colonna che di default è in percentuale.
 */
function rewriteCols(xml, lastInputCol, colLordo, colTotale) {
  const nuove =
    `<col min="${colLordo}" max="${colLordo}" width="14" customWidth="1"/>` +
    `<col min="${colTotale}" max="${colTotale}" width="28" customWidth="1"/>`

  if (!/<cols>/.test(xml)) {
    // <cols> va subito dopo <sheetFormatPr> (o dopo <dimension>/<sheetViews>)
    return xml.replace(/(<sheetData[\s>])/, `<cols>${nuove}</cols>$1`)
  }
  return xml.replace(/<cols>([\s\S]*?)<\/cols>/, (_full, inner) => {
    const kept = inner.replace(/<col\b[^>]*?\/>/g, (col) => {
      const min = parseInt(/\bmin="(\d+)"/.exec(col)?.[1] || '0', 10)
      const max = parseInt(/\bmax="(\d+)"/.exec(col)?.[1] || '0', 10)
      if (min > lastInputCol) return '' // definizione tutta dentro gli appunti
      if (max > lastInputCol) return col.replace(/\bmax="\d+"/, `max="${lastInputCol}"`)
      return col
    })
    return `<cols>${kept}${nuove}</cols>`
  })
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    assumeDefault: false, dryRun: false, sheet: null,
    rounding: 'commerciale', keepExtra: false, positional: []
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--assume-default') opts.assumeDefault = true
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--keep-extra') opts.keepExtra = true
    else if (a === '--sheet') opts.sheet = argv[++i]
    else if (a.startsWith('--sheet=')) opts.sheet = a.slice(8)
    else if (a === '--rounding') opts.rounding = argv[++i]
    else if (a.startsWith('--rounding=')) opts.rounding = a.slice(11)
    else if (a.startsWith('--')) throw new Error(`Opzione sconosciuta: ${a}`)
    else opts.positional.push(a)
  }
  if (!['commerciale', 'legacy'].includes(opts.rounding)) {
    throw new Error(`--rounding accetta "commerciale" o "legacy", non "${opts.rounding}"`)
  }
  return opts
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const inputPath = opts.positional[0]
  if (!inputPath) {
    console.error(
      'Uso: node scripts/premio-lordo.mjs <input.xlsx> [output.xlsx] ' +
      '[--sheet N] [--rounding commerciale|legacy] [--keep-extra] [--assume-default] [--dry-run]'
    )
    process.exit(2)
  }
  if (!existsSync(inputPath)) throw new Error(`File non trovato: ${inputPath}`)
  setRoundingMode(opts.rounding)

  const outputPath =
    opts.positional[1] ||
    path.join(
      path.dirname(inputPath),
      `${path.basename(inputPath, path.extname(inputPath))} - PREMIO LORDO.xlsx`
    )

  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(readFileSync(inputPath))
  const sheetPaths = await buildSheetPathMap(zip)
  const sheetNames = Object.keys(sheetPaths)
  if (!sheetNames.length) throw new Error('Nessun foglio nel workbook')

  const sheetName = opts.sheet || sheetNames.find((n) => /^\d+$/.test(n.trim())) || sheetNames[0]
  if (!sheetPaths[sheetName]) {
    throw new Error(`Foglio "${sheetName}" inesistente. Disponibili: ${sheetNames.join(', ')}`)
  }

  const sheetPath = sheetPaths[sheetName]
  let sheetXml = await zip.file(sheetPath).async('string')
  const shared = parseSharedStrings(await zip.file('xl/sharedStrings.xml')?.async('string'))
  const { rows, maxCol } = readSheet(sheetXml, shared)
  if (!rows.length) throw new Error(`Foglio "${sheetName}" vuoto`)

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
    throw new Error(
      `Intestazione non riconosciuta nel foglio "${sheetName}" ` +
      `(match migliore ${headerScore}/${HEADERS_INPUT.length} alla riga ${headerRow || '—'}). ` +
      'Verifica il foglio o passa --sheet.'
    )
  }

  // Colonne del TRACCIATO: solo quelle riconosciute. Quello che sta oltre
  // (appunti di lavoro tipo "Imposte Percentuali") non conta come input.
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
  if (mancanti.length) throw new Error(`Colonne indispensabili assenti: ${mancanti.join(', ')}`)

  const COL_POLIZZA = colOf('Numero polizza')
  const COL_MOVIMENTO = colOf('Movimento')
  const COL_GARANZIA = colOf('Garanzia')
  const COL_NETTO = colOf('Premio Netto')
  const colLordo = lastInputCol + 1
  const colTotale = lastInputCol + 2

  // Colonne estranee presenti in input (appunti di lavoro)
  const extra = new Map()
  for (const r of rows) {
    for (const [colNum, c] of r.cells) {
      if (colNum <= lastInputCol) continue
      if (String(c.text ?? '').trim() === '') continue
      const label = r.rowNum === headerRow ? c.text : null
      const e = extra.get(colNum) || { colNum, label: null, count: 0 }
      if (label) e.label = label
      e.count++
      extra.set(colNum, e)
    }
  }

  // ── Righe dati ─────────────────────────────────────────────────────────────
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

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log(`\nFoglio "${sheetName}" · intestazione riga ${headerRow} · ${dataRows.length} righe dati`)
  console.log(`Tracciato riconosciuto: ${headerScore}/${HEADERS_INPUT.length} colonne (A…${numToCol(lastInputCol)})`)
  console.log(`Nuove colonne: ${numToCol(colLordo)} = ${HEADER_PREMIO_LORDO} · ${numToCol(colTotale)} = ${HEADER_TOTALE}`)
  console.log(`Arrotondamento: ${opts.rounding}`)

  if (extra.size) {
    const desc = [...extra.values()]
      .map((e) => `${numToCol(e.colNum)}${e.label ? ` "${e.label}"` : ''} (${e.count} celle)`)
      .join(', ')
    console.log(`\nColonne oltre il tracciato trovate in input: ${desc}`)
    console.log(opts.keepExtra
      ? '  --keep-extra: restano nel file (le nuove colonne si sovrappongono: verifica!)'
      : '  → rimosse, come nel file di output di riferimento (usa --keep-extra per tenerle)')
  }

  const perMovimento = new Map()
  for (const r of dataRows) perMovimento.set(r.movimento || '(vuoto)', (perMovimento.get(r.movimento || '(vuoto)') || 0) + 1)
  console.log('\nRighe per Movimento:')
  for (const [k, v] of [...perMovimento.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(6)}  ${k}`)
  }

  const perGaranzia = new Map()
  for (const r of dataRows) {
    if (!isInclusione(r.movimento)) continue
    const k = r.garanzia || '(vuota)'
    perGaranzia.set(k, (perGaranzia.get(k) || 0) + 1)
  }
  console.log('\nGaranzie sulle Inclusioni → aliquota applicata:')
  for (const [k, v] of [...perGaranzia.entries()].sort((a, b) => b[1] - a[1])) {
    const { rate, known } = aliquotaFor(k)
    const pct = `${(rate * 100).toFixed(1).replace('.', ',')}%`
    console.log(`  ${String(v).padStart(6)}  ${pct.padStart(7)} ${known ? ' ' : '?'} ${k}`)
  }

  if (result.missingPremio.length) {
    console.log(`\n⚠  ${result.missingPremio.length} inclusioni con Premio Netto non numerico:`)
    for (const m of result.missingPremio.slice(0, 10)) {
      console.log(`   riga ${dataRows[m.index].rowNum}: ${JSON.stringify(m.raw)}`)
    }
  }

  if (result.unknownGaranzie.length) {
    console.log('\n⛔ GARANZIE NON IN TABELLA — serve conferma dell\'aliquota:')
    for (const u of result.unknownGaranzie) {
      const righe = u.rows.slice(0, 8).map((i) => dataRows[i].rowNum).join(', ')
      console.log(`   "${u.garanzia}" — ${u.count} righe (es. riga ${righe}${u.rows.length > 8 ? ', …' : ''})`)
    }
    if (!opts.assumeDefault) {
      console.log('\n   Nessun file scritto. Conferma l\'aliquota, oppure rilancia con --assume-default')
      console.log('   per applicare il 13,5% previsto per «tutte le altre garanzie».')
      process.exit(3)
    }
    console.log('\n   --assume-default attivo: applicato 13,5%.')
  }

  if (result.tieBreaks.length) {
    const altro = opts.rounding === 'commerciale' ? 'legacy' : 'commerciale'
    console.log(`\nℹ  ${result.tieBreaks.length} righe cadono esattamente a metà (…,xx5): ` +
      `con --rounding ${altro} varrebbero 0,01 in meno/più.`)
    for (const t of result.tieBreaks.slice(0, 12)) {
      console.log(`   riga ${dataRows[t.index].rowNum}: ${t.garanzia} · netto ${t.premioNetto} · ` +
        `${opts.rounding} ${formatItalian(t.valore)} vs ${altro} ${formatItalian(t.alt)}`)
    }
    if (result.tieBreaks.length > 12) console.log(`   … e altre ${result.tieBreaks.length - 12}`)
  }

  const somma = result.groups.reduce((a, g) => a + g.total, 0)
  console.log(
    `\n${result.stats.calcolate} PREMIO LORDO su ${result.stats.inclusioni} inclusioni · ` +
    `${result.groups.length} polizze · totale generale ${formatItalian(somma)}`
  )

  console.log('\nVerifica sul calcolo:')
  for (const c of verification.checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name} — ${c.detail}`)
  if (!verification.ok) {
    console.error('\nVerifica FALLITA: nessun file scritto.')
    process.exit(1)
  }

  if (opts.dryRun) {
    console.log('\n--dry-run: nessun file scritto.\n')
    return
  }

  // ── Scrittura ──────────────────────────────────────────────────────────────
  if (opts.keepExtra && maxCol >= colLordo) {
    throw new Error(
      `--keep-extra ma le colonne ${numToCol(colLordo)}/${numToCol(colTotale)} sono già occupate: ` +
      'i due usi si sovrapporrebbero.'
    )
  }

  let stylesXml = await zip.file('xl/styles.xml')?.async('string')
  if (!stylesXml) throw new Error('styles.xml assente dal workbook')
  const styled = addNumberStyle(stylesXml)
  const numStyle = styled.index
  const headerStyle = headerCells.get(lastInputCol)?.styleIdx ?? null

  // XML da accodare, indicizzato per numero di riga
  const appendByRow = new Map()
  appendByRow.set(
    headerRow,
    buildTextCell(`${numToCol(colLordo)}${headerRow}`, HEADER_PREMIO_LORDO, headerStyle) +
      buildTextCell(`${numToCol(colTotale)}${headerRow}`, HEADER_TOTALE, headerStyle)
  )
  let scritte = 0
  dataRows.forEach((row, i) => {
    const lordo = result.premioLordo[i]
    const tot = result.totale[i]
    if (lordo == null && tot == null) return // cella assente = cella vuota: è quanto chiesto
    let xmlCells = ''
    if (lordo != null) xmlCells += buildNumberCell(`${numToCol(colLordo)}${row.rowNum}`, lordo, numStyle)
    if (tot != null) xmlCells += buildNumberCell(`${numToCol(colTotale)}${row.rowNum}`, tot, numStyle)
    appendByRow.set(row.rowNum, xmlCells)
    scritte++
  })

  const rewritten = rewriteSheet(sheetXml, {
    purgeAbove: opts.keepExtra ? null : lastInputCol,
    appendFor: (rowNum) => appendByRow.get(rowNum),
    newMaxCol: colTotale
  })
  sheetXml = fixDimension(rewritten.xml, numToCol(colTotale))
  let mergePulite = 0
  if (!opts.keepExtra) {
    sheetXml = rewriteCols(sheetXml, lastInputCol, colLordo, colTotale)
    const merged = cleanMergeCells(sheetXml, lastInputCol)
    sheetXml = merged.xml
    mergePulite = merged.removed
    for (const w of warnDanglingRanges(sheetXml, lastInputCol)) {
      console.log(`⚠  riferimento a colonne rimosse rimasto: ${w}`)
    }
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
  if (rewritten.purged) {
    console.log(`\nRimosse ${rewritten.purged} celle oltre la colonna ${numToCol(lastInputCol)}` +
      `${rewritten.purgedFormulas ? ` (di cui ${rewritten.purgedFormulas} con formula)` : ''}` +
      `${mergePulite ? `, più ${mergePulite} intervallo/i di celle unite` : ''}.`)
  }

  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
  await writeFile(outputPath, buf)

  // ── Rilettura del file SCRITTO ─────────────────────────────────────────────
  const outZip = await JSZip.loadAsync(readFileSync(outputPath))
  const outPath = (await buildSheetPathMap(outZip))[sheetName]
  const outShared = parseSharedStrings(await outZip.file('xl/sharedStrings.xml')?.async('string'))
  const outSheet = readSheet(await outZip.file(outPath).async('string'), outShared)
  const outData = outSheet.rows.filter((r) => r.rowNum > headerRow)

  const nLordo = outData.filter((r) => r.cells.get(colLordo)?.num != null).length
  const nTot = outData.filter((r) => r.cells.get(colTotale)?.num != null).length
  const hdr = outSheet.rows.find((r) => r.rowNum === headerRow)?.cells
  const checks = [
    ['righe dati invariate', outData.length === dataRows.length, `${outData.length} / ${dataRows.length}`],
    ['ultima colonna', outSheet.maxCol === colTotale, `${numToCol(outSheet.maxCol)} (attesa ${numToCol(colTotale)})`],
    ['intestazioni nuove', cellText(hdr, colLordo) === HEADER_PREMIO_LORDO && cellText(hdr, colTotale) === HEADER_TOTALE,
      `${cellText(hdr, colLordo)} / ${cellText(hdr, colTotale)}`],
    ['PREMIO LORDO valorizzati', nLordo === result.stats.calcolate, `${nLordo} / ${result.stats.calcolate}`],
    ['totali di polizza', nTot === result.groups.length, `${nTot} / ${result.groups.length}`]
  ]
  console.log('\nVerifica sul file scritto:')
  for (const [name, ok, detail] of checks) console.log(`  ${ok ? '✓' : '✗'} ${name} — ${detail}`)

  console.log(`\nScritto: ${outputPath}  (${scritte} righe con valori)\n`)
  if (!checks.every(([, ok]) => ok)) process.exit(1)
}

main().catch((err) => {
  console.error(`\nErrore: ${err.message}\n`)
  process.exit(1)
})
