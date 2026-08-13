/**
 * Test del servizio che legge e riscrive il .xlsx (premioLordoWorkbook.js),
 * cioè il pezzo che sta sotto sia alla pagina web sia alla CLI.
 *
 * Esegui:  node --test test/premioLordoWorkbook.test.mjs
 *
 * La fixture è un workbook minimo costruito qui: niente file binari nel repo e
 * i casi limite (garanzia ignota, intestazione assente) si scrivono a mano.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  processPremioLordo,
  outputFileName,
  PremioLordoError,
  HEADERS_INPUT,
  HEADER_PREMIO_LORDO,
  HEADER_TOTALE,
  numToCol,
  colToNum
} from '../src/main/services/premioLordoWorkbook.js'

// ─── Costruzione di un .xlsx minimo ma valido ────────────────────────────────

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * @param {Array<Array<string|number>>} righe  intestazione inclusa
 * @param {string} nomeFoglio
 */
async function buildXlsx(righe, nomeFoglio = '20265539') {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()

  const rowsXml = righe
    .map((cells, i) => {
      const rowNum = i + 1
      const cellsXml = cells
        .map((v, c) => {
          if (v === null || v === undefined || v === '') return ''
          const ref = `${numToCol(c + 1)}${rowNum}`
          return typeof v === 'number'
            ? `<c r="${ref}"><v>${v}</v></c>`
            : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`
        })
        .join('')
      return `<row r="${rowNum}" spans="1:${cells.length}">${cellsXml}</row>`
    })
    .join('')

  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>'
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>'
  )
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets><sheet name="${esc(nomeFoglio)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>'
  )
  zip.file(
    'xl/styles.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders>' +
      '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
      '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
      '</styleSheet>'
  )
  zip.file(
    'xl/worksheets/sheet1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<dimension ref="A1:${numToCol(righe[0].length)}${righe.length}"/>` +
      `<sheetData>${rowsXml}</sheetData></worksheet>`
  )

  return zip.generateAsync({ type: 'nodebuffer' })
}

/** Rilegge il foglio prodotto come matrice di stringhe/numeri. */
async function readBack(buffer) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(buffer)
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string')
  const out = new Map()
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g
  let rm
  while ((rm = rowRe.exec(xml))) {
    const rowNum = parseInt(/\br="(\d+)"/.exec(rm[1] || '')?.[1] || '0', 10)
    const cells = new Map()
    const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cm
    while ((cm = cRe.exec(rm[2] || ''))) {
      const ref = /\br="([A-Z]+)\d+"/.exec(cm[1] || '')?.[1]
      if (!ref) continue
      const t = /\bt="([^"]+)"/.exec(cm[1] || '')?.[1] || 'n'
      const v = /<v>([\s\S]*?)<\/v>/.exec(cm[2] || '')?.[1]
      const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(cm[2] || '')?.[1]
      cells.set(ref, t === 'inlineStr' ? inline : v != null ? parseFloat(v) : '')
    }
    out.set(rowNum, cells)
  }
  return out
}

const INTESTAZIONE = [...HEADERS_INPUT]
/** Riga di dati completa: solo le 4 colonne che contano sono valorizzate. */
function riga({ polizza, movimento, garanzia, netto }) {
  const r = new Array(HEADERS_INPUT.length).fill('')
  r[0] = polizza
  r[1] = movimento
  r[14] = garanzia
  r[15] = netto
  return r
}

const INCL = 'Inclusione Applicazione'

// ─── Test ────────────────────────────────────────────────────────────────────

test('accoda le due colonne in T e U senza toccare le 19 di input', async () => {
  const righe = [
    INTESTAZIONE,
    riga({ polizza: 'P1', movimento: INCL, garanzia: 'RCA', netto: '277,90' }),
    riga({ polizza: 'P1', movimento: 'Quietanza Intermedia', garanzia: 'RCA', netto: '277,90' }),
  ]
  const { buffer, blocked, report } = await processPremioLordo(await buildXlsx(righe))

  assert.equal(blocked, null)
  assert.ok(buffer)
  assert.equal(report.sheet, '20265539')
  assert.equal(report.headerRow, 1)
  assert.equal(report.righeDati, 2)
  assert.equal(report.colonnaLordo, 'T')
  assert.equal(report.colonnaTotale, 'U')
  assert.ok(report.verificaOk && report.riletturaOk)

  const out = await readBack(buffer)
  assert.equal(out.get(1).get('T'), HEADER_PREMIO_LORDO)
  assert.equal(out.get(1).get('U'), HEADER_TOTALE)
  // 277,90 × 1,265 = 351,5435 → 351,54
  assert.equal(out.get(2).get('T'), 351.54)
  assert.equal(out.get(2).get('U'), 351.54) // gruppo di una riga: prima = ultima
  // la riga di quietanza resta VUOTA in entrambe
  assert.equal(out.get(3).get('T'), undefined)
  assert.equal(out.get(3).get('U'), undefined)
  // e le colonne di input non sono state toccate
  assert.equal(out.get(2).get('A'), 'P1')
  assert.equal(out.get(2).get('P'), '277,90')
})

test('il totale di gruppo va sull\'ultima riga della polizza', async () => {
  const righe = [
    INTESTAZIONE,
    riga({ polizza: 'P1', movimento: INCL, garanzia: 'RCA', netto: '100,00' }),        // 126,50
    riga({ polizza: 'P1', movimento: INCL, garanzia: 'Cristalli', netto: '100,00' }),  // 113,50
    riga({ polizza: 'P1', movimento: INCL, garanzia: 'Tutela Legale base', netto: '100,00' }), // 112,50
  ]
  const { buffer, report } = await processPremioLordo(await buildXlsx(righe))
  const out = await readBack(buffer)

  assert.deepEqual([out.get(2).get('T'), out.get(3).get('T'), out.get(4).get('T')], [126.5, 113.5, 112.5])
  assert.equal(out.get(2).get('U'), undefined)
  assert.equal(out.get(3).get('U'), undefined)
  assert.equal(out.get(4).get('U'), 352.5) // 126,50 + 113,50 + 112,50
  assert.equal(report.polizze, 1)
  assert.equal(report.totaleGenerale, 352.5)
})

test('numero di righe e ordine restano quelli dell\'input', async () => {
  const righe = [INTESTAZIONE]
  for (let i = 0; i < 50; i++) {
    righe.push(riga({
      polizza: `P${i % 7}`,
      movimento: i % 3 === 0 ? INCL : i % 3 === 1 ? 'Quietanza Intermedia' : 'Generica',
      garanzia: 'Incendio',
      netto: '10,00'
    }))
  }
  const { buffer, report } = await processPremioLordo(await buildXlsx(righe))
  const out = await readBack(buffer)

  assert.equal(report.righeDati, 50)
  assert.equal(out.size, 51) // intestazione + 50
  for (let r = 2; r <= 51; r++) {
    assert.equal(out.get(r).get('A'), righe[r - 1][0], `riga ${r}: polizza fuori posto`)
  }
})

test('una garanzia fuori tabella blocca il file finché non si conferma', async () => {
  const righe = [
    INTESTAZIONE,
    riga({ polizza: 'P1', movimento: INCL, garanzia: 'Kasko Integrale', netto: '100,00' }),
  ]
  const input = await buildXlsx(righe)

  const primo = await processPremioLordo(input)
  assert.equal(primo.blocked, 'unknownGaranzie')
  assert.equal(primo.buffer, null) // nessun file: l'aliquota non si inventa
  assert.equal(primo.report.unknownGaranzie.length, 1)
  assert.equal(primo.report.unknownGaranzie[0].garanzia, 'Kasko Integrale')
  assert.deepEqual(primo.report.unknownGaranzie[0].esempi, [2])

  const secondo = await processPremioLordo(input, { assumeDefault: true })
  assert.equal(secondo.blocked, null)
  const out = await readBack(secondo.buffer)
  assert.equal(out.get(2).get('T'), 113.5) // 13,5% come «tutte le altre»
})

test('l\'arrotondamento legacy cambia solo i pareggi', async () => {
  const righe = [
    INTESTAZIONE,
    riga({ polizza: 'P1', movimento: INCL, garanzia: 'Incendio', netto: '23,00' }), // 26,105 esatti
    riga({ polizza: 'P1', movimento: INCL, garanzia: 'Incendio', netto: '10,00' }), // 11,35: nessun pareggio
  ]
  const input = await buildXlsx(righe)

  const comm = await processPremioLordo(input, { rounding: 'commerciale' })
  const leg = await processPremioLordo(input, { rounding: 'legacy' })

  assert.equal((await readBack(comm.buffer)).get(2).get('T'), 26.11)
  assert.equal((await readBack(leg.buffer)).get(2).get('T'), 26.10)
  assert.equal((await readBack(comm.buffer)).get(3).get('T'), 11.35)
  assert.equal((await readBack(leg.buffer)).get(3).get('T'), 11.35)

  assert.equal(comm.report.pareggi.length, 1)
  assert.equal(comm.report.pareggi[0].riga, 2)
})

test('le colonne di lavoro oltre il tracciato vengono rimosse', async () => {
  const conAppunti = [
    [...INTESTAZIONE, '', 'Imposte Percentuali', 'Premio lordo'],
    [...riga({ polizza: 'P1', movimento: INCL, garanzia: 'RCA', netto: '100,00' }), '', 0.265, 126.5],
  ]
  const { buffer, report } = await processPremioLordo(await buildXlsx(conAppunti))

  assert.equal(report.colonneExtra.length, 2)
  assert.deepEqual(report.colonneExtra.map((c) => c.colonna), ['U', 'V'])
  assert.equal(report.colonneExtraRimosse, true)
  assert.ok(report.celleRimosse >= 4)

  const out = await readBack(buffer)
  assert.equal(out.get(1).get('T'), HEADER_PREMIO_LORDO)
  assert.equal(out.get(1).get('U'), HEADER_TOTALE) // U riusata dalle colonne nostre
  assert.equal(out.get(1).get('V'), undefined)     // gli appunti sono spariti
  assert.equal(out.get(2).get('T'), 126.5)
})

test('un file senza intestazione riconoscibile viene rifiutato con un codice', async () => {
  const righe = [['pippo', 'pluto', 'paperino'], ['a', 'b', 'c']]
  await assert.rejects(
    () => processPremioLordo(buildXlsx(righe).then((b) => b)),
    (err) => err instanceof PremioLordoError && err.code === 'headerNotFound'
  )
})

test('un file che non è un .xlsx viene rifiutato con un codice', async () => {
  await assert.rejects(
    () => processPremioLordo(Buffer.from('questo non e uno zip')),
    (err) => err instanceof PremioLordoError && err.code === 'notXlsx'
  )
})

test('mancando una colonna indispensabile si dice quale', async () => {
  const senzaGaranzia = HEADERS_INPUT.map((h) => (h === 'Garanzia' ? 'Colonna X' : h))
  await assert.rejects(
    () => processPremioLordo(buildXlsx([senzaGaranzia, new Array(19).fill('x')])),
    (err) => err instanceof PremioLordoError && err.code === 'missingColumns' &&
      err.details.mancanti.includes('Garanzia')
  )
})

test('outputFileName aggiunge il suffisso senza raddoppiare l\'estensione', () => {
  assert.equal(outputFileName('Report 2026.xlsx'), 'Report 2026 - PREMIO LORDO.xlsx')
  assert.equal(outputFileName('senza-estensione'), 'senza-estensione - PREMIO LORDO.xlsx')
  assert.equal(outputFileName(''), 'report - PREMIO LORDO.xlsx')
})

test('numToCol e colToNum sono l\'una l\'inversa dell\'altra', () => {
  for (const [n, s] of [[1, 'A'], [19, 'S'], [20, 'T'], [21, 'U'], [26, 'Z'], [27, 'AA'], [52, 'AZ'], [53, 'BA']]) {
    assert.equal(numToCol(n), s)
    assert.equal(colToNum(s), n)
  }
})
