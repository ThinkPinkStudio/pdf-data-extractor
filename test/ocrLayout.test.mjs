/**
 * Test della ricostruzione SPAZIALE del testo OCR (griglia a colonne) e del
 * fuzzy-match delle chiavi campo storpiate dal modello.
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildSpatialPage, collapseSpatial, usefulLength, detectLabelValuePairs } from '../src/main/services/ocrLayout.js'
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

// ─── detectLabelValuePairs: aligner colonnare ───────────────────────────────

test('detectLabelValuePairs: same-row "Etichetta: valore" → coppia rilevata', () => {
  const pairs = detectLabelValuePairs(['Scadenza rata: 31/12/2024'])
  assert.equal(pairs.length, 1, JSON.stringify(pairs))
  assert.equal(pairs[0].value, '31/12/2024')
  assert.match(pairs[0].label, /Scadenza rata/i)
  assert.equal(pairs[0].row, 1)
})

test('detectLabelValuePairs: griglia a colonne — valore collegato alla colonna giusta (non invertito)', () => {
  // Riga di sole etichette sopra, riga di valori sotto, colonne allineate.
  const page = [
    'SCAD. RATA     RATA SUCC.',
    '31/12/2024     31/12/2025',
  ]
  const pairs = detectLabelValuePairs(page)
  assert.equal(pairs.length, 2, JSON.stringify(pairs))
  const v2024 = pairs.find((p) => p.value === '31/12/2024')
  const v2025 = pairs.find((p) => p.value === '31/12/2025')
  assert.ok(v2024, JSON.stringify(pairs))
  assert.ok(v2025, JSON.stringify(pairs))
  // 31/12/2024 sta sotto "SCAD. RATA", NON sotto "RATA SUCC."
  assert.match(v2024.label, /SCAD\.?/i)
  assert.match(v2025.label, /RATA SUCC/i)
  // le coppie vivono sulla riga delle etichette
  assert.equal(v2024.row, 1)
  assert.equal(v2025.row, 1)
})

test('detectLabelValuePairs: accetta anche una stringa unica (pagina) divisa in righe', () => {
  const pairs = detectLabelValuePairs('Scadenza rata: 31/12/2024\nCosto: 1.200,00')
  assert.equal(pairs.length, 2, JSON.stringify(pairs))
  assert.equal(pairs.find((p) => p.label.includes('Scadenza')).value, '31/12/2024')
  assert.equal(pairs.find((p) => p.label.includes('Costo')).value, '1.200,00')
})

test('detectLabelValuePairs: rumore (righe corte / testo libero) → [] o pochissime coppie', () => {
  const noise = detectLabelValuePairs([
    'Il presente documento',
    'attesta la copertura',
    'assunta dalla compagnia.',
  ])
  assert.equal(noise.length, 0, JSON.stringify(noise))
  // righe da un solo token-breve, senza ':' né colonna valore → vuoto
  assert.equal(detectLabelValuePairs(['Polizza', 'RC', 'Terzi']).length, 0)
})

test('detectLabelValuePairs: type-blind — nessuna assunzione di dominio', () => {
  // Etichette e valori generici, senza i termini "polizza"/"fattura/fatura".
  const pairs = detectLabelValuePairs(['Cifra: 88', 'Total: 1234'])
  assert.equal(pairs.length, 2, JSON.stringify(pairs))
  assert.equal(pairs.find((p) => p.label.includes('Cifra')).value, '88')
  assert.equal(pairs.find((p) => p.label.includes('Total')).value, '1234')
  // boilerplate di impaginazione (pag., n.) NON diventa etichetta
  const bp = detectLabelValuePairs(['Pag. 12'])
  assert.equal(bp.length, 0, JSON.stringify(bp))
})
