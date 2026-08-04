/**
 * Test della ricostruzione SPAZIALE del testo OCR (griglia a colonne) e del
 * fuzzy-match delle chiavi campo storpiate dal modello.
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildSpatialPage, collapseSpatial, usefulLength } from '../src/main/services/ocrLayout.js'
import { matchFieldKey } from '../src/main/services/polizzaValidation.js'

// Costruttore di blocks tesseract.js sintetici: parole {testo, x, y} con
// larghezza-carattere nominale 10px e altezza riga 20px.
function blocksFrom(words, { charW = 10, rowH = 20 } = {}) {
  return [{
    paragraphs: [{
      lines: [{
        rowAttributes: { rowHeight: rowH },
        words: words.map(([text, x, y]) => ({
          text,
          bbox: { x0: x, x1: x + text.length * charW, y0: y, y1: y + rowH },
        })),
      }],
    }],
  }]
}

test('buildSpatialPage: due colonne restano INCOLONNATE (etichetta sopra, valore sotto)', () => {
  // Il caso reale delle quietanze: "SCAD. RATA   RATA SUCC." su una riga e le
  // due date sulla riga sotto, ciascuna sotto la propria etichetta.
  const page = buildSpatialPage(blocksFrom([
    ['SCAD.', 0, 0], ['RATA', 70, 0], ['RATA', 300, 0], ['SUCC.', 350, 0],
    ['31/12/2024', 0, 40], ['31/12/2025', 300, 40],
  ]))
  const [top, bottom] = page.split('\n')
  // Le colonne di destra iniziano alla STESSA colonna testo (300/10 = 30)
  assert.equal(top.indexOf('RATA SUCC.'), bottom.indexOf('31/12/2025'), page)
  assert.equal(top.indexOf('SCAD.'), bottom.indexOf('31/12/2024'), page)
})

test('buildSpatialPage: riquadri affiancati (line Tesseract separate, stessa y) si fondono sulla riga visiva', () => {
  // Due blocchi distinti alla stessa altezza: Tesseract li emette come "line"
  // separate una DOPO l'altra; la griglia li rimette fianco a fianco.
  const left = blocksFrom([['Contraente:', 0, 0], ['EULIP', 120, 0], ['SRL', 190, 0]])
  const right = blocksFrom([['Agenzia:', 400, 2], ['ACQUI', 490, 2], ['TERME', 560, 2]])
  const page = buildSpatialPage([...left, ...right])
  const lines = page.split('\n')
  assert.equal(lines.length, 1, page)
  assert.ok(lines[0].indexOf('Contraente:') < lines[0].indexOf('Agenzia:'), page)
  // L'inizio del riquadro destro rispetta la sua colonna reale (400/10 = 40)
  assert.ok(lines[0].indexOf('Agenzia:') >= 38, page)
})

test('buildSpatialPage: collisioni → mai sovrapporre, separatore di un solo spazio', () => {
  // Seconda parola con x0 dentro la prima (bbox OCR imprecisa)
  const page = buildSpatialPage(blocksFrom([['ABCDEF', 0, 0], ['GHI', 30, 0]]))
  assert.equal(page, 'ABCDEF GHI')
})

test('buildSpatialPage: charW robusto (mediana) e input degeneri', () => {
  // Un outlier (parola larghissima) non deve spostare le colonne delle altre
  const page = buildSpatialPage(blocksFrom([
    ['X', 0, 0], ['Y', 100, 0], ['Z', 200, 0],
    ['outlierlarghissimoconbboxenorme', 0, 40],
  ]))
  const [top] = page.split('\n')
  assert.equal(top.indexOf('Y'), 10, page)
  assert.equal(top.indexOf('Z'), 20, page)
  // Input degeneri: mai lanciare, sempre stringa
  assert.equal(buildSpatialPage(null), '')
  assert.equal(buildSpatialPage([]), '')
  assert.equal(buildSpatialPage([{ paragraphs: null }]), '')
  assert.equal(buildSpatialPage(blocksFrom([['', 0, 0]])), '')
})

test('buildSpatialPage: il padding è limitato (MAX_COLS), coordinate assurde non esplodono', () => {
  const page = buildSpatialPage(blocksFrom([['A', 0, 0], ['B', 999999, 0]]))
  assert.ok(page.length < 700, `riga di ${page.length} char`)
  assert.ok(page.includes('A') && page.includes('B'))
})

test('collapseSpatial: griglia → piatto equivalente al vecchio output', () => {
  const spatial = 'SCAD. RATA                    RATA SUCC.\n31/12/2024                    31/12/2025'
  assert.equal(collapseSpatial(spatial), 'SCAD. RATA RATA SUCC.\n31/12/2024 31/12/2025')
  // indentazione rimossa, spazi interni collassati, righe preservate
  assert.equal(collapseSpatial('   a   b\n  c'), 'a b\nc')
  assert.equal(collapseSpatial(''), '')
})

test('usefulLength: le run di spazi contano 1', () => {
  assert.equal(usefulLength('a          b'), 'a b'.length)
  assert.equal(usefulLength('ab'), 2)
  assert.equal(usefulLength(''), 0)
  // le newline non vengono toccate
  assert.equal(usefulLength('a\n\nb'), 4)
})

// ─── matchFieldKey: chiavi campo storpiate dal modello ───────────────────────

test('matchFieldKey: caso reale di produzione — UUID con un carattere storpiato', () => {
  const ids = ['311ac415-b0cb-4f96-83eb-969b0bd9efea', 'rct_massimale_sinistro', 'bfb4228b-4db7-4cb3-95a6-48308c7beafd']
  // Il q4 ha risposto "311ac411-…" per il campo "311ac415-…"
  assert.equal(matchFieldKey('311ac411-b0cb-4f96-83eb-969b0bd9efea', ids), '311ac415-b0cb-4f96-83eb-969b0bd9efea')
  // match esatto: sempre se stesso
  assert.equal(matchFieldKey('rct_massimale_sinistro', ids), 'rct_massimale_sinistro')
  // due refusi: ancora entro il tetto
  assert.equal(matchFieldKey('rct_masimale_sinistr', ids), 'rct_massimale_sinistro')
  // tre refusi: fuori tetto → null
  assert.equal(matchFieldKey('rct_masmale_sinstr', ids), null)
})

test('matchFieldKey: prudenza — ambiguo, corto o vuoto → null', () => {
  // Due id che distano 1 dalla chiave → ambiguo, mai indovinare
  assert.equal(matchFieldKey('campo_x1', ['campo_x2', 'campo_x3']), null)
  // Chiavi corte: il fuzzy non si applica (rischio collisioni)
  assert.equal(matchFieldKey('scadenz', ['scadenza', 'decorrenza']), null)
  assert.equal(matchFieldKey('', ['scadenza']), null)
  // Id corti non partecipano al fuzzy nemmeno come candidati
  assert.equal(matchFieldKey('imposta1', ['imposta']), null)
})
