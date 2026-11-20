// [flag tabelleocr] (08/10/2026) Tabelle delle scansioni lette da GLM-OCR in
// HTML → griglia incolonnata come quella delle pagine digitali.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHtmlTable, htmlTableToGrid } from '../src/services/tableHtml.js'
import { coverColumnPairs } from '../src/services/polizzaOperativita.js'

// Risposta vera di GLM-OCR sul ritaglio della scheda DAS OneClick (P07, pag. 1).
const P07 = '<table><thead><tr><th></th><th></th><th>TUTELA LEGALE</th><th>PERDITE PECUNIARIE</th><th>ASSISTENZA</th><th>IMPOSTE</th><th>PREMIO LORDO</th></tr></thead><tbody><tr><td>PROD-000423</td><td>Tutela legale circolazione stradale base</td><td>€ 18,67</td><td></td><td></td><td>€ 2,33</td><td>€ 21,00</td></tr><tr><td>PROD-000423</td><td>Indennità e rimborsi + patente a punti</td><td></td><td>€ 7,93</td><td></td><td>€ 1,07</td><td>€ 9,00</td></tr></tbody></table><table><tr><td>ripetuta</td></tr></table>'
const TOT = '<table><thead><tr><th>PREMIO TOTALE</th><th colspan="2">FRAZIONAMENTO NETTO IMPONIBILE</th><th>DIRITTO</th><th>RIMBORSO</th><th>IMPOSTE</th><th>PREMIO LORDO</th></tr></thead><tbody><tr><td>PREMIO RATA INIZIALE</td><td></td><td>€ 26,60</td><td></td><td></td><td>€ 3,40</td><td>€ 30,00</td></tr></tbody></table>'

test('parseHtmlTable: solo la prima tabella, celle vuote e unite', () => {
  const r = parseHtmlTable(P07)
  assert.equal(r.length, 3)
  assert.deepEqual(r[1].map((c) => c.text), ['PROD-000423', 'Tutela legale circolazione stradale base', '€ 18,67', '', '', '€ 2,33', '€ 21,00'])
  assert.deepEqual(parseHtmlTable(TOT)[0].map((c) => c.span), [1, 2, 1, 1, 1, 1])
  assert.equal(parseHtmlTable('<table><tr><td>l&#x27;ammontare&nbsp;€</td></tr></table>')[0][0].text, "l'ammontare €")
})

test('htmlTableToGrid: gli importi sotto le loro intestazioni, la colonna della copertura si riconosce', () => {
  const g = htmlTableToGrid(P07).split('\n')
  const at = (l, s) => l.indexOf(s)
  assert.equal(at(g[1], '€ 18,67'), at(g[0], 'TUTELA LEGALE'))
  assert.equal(at(g[1], '€ 2,33'), at(g[0], 'IMPOSTE'))
  assert.equal(at(g[1], '€ 21,00'), at(g[0], 'PREMIO LORDO'))
  assert.equal(at(g[2], '€ 7,93'), at(g[0], 'PERDITE PECUNIARIE'))
  // la regola della pertinenza vede la cella sotto «TUTELA LEGALE»
  const pairs = coverColumnPairs(g.join('\n'), [['tutela', 'legale']])
  assert.deepEqual(pairs.map((p) => p.value), ['18,67'])
})

test('htmlTableToGrid: la cella unita sta sopra le colonne che copre; tabella di una riga = niente', () => {
  const g = htmlTableToGrid(TOT).split('\n')
  const head = g[0].indexOf('FRAZIONAMENTO NETTO IMPONIBILE')
  const v = g[1].indexOf('€ 26,60')
  assert.ok(v >= head && v < head + 'FRAZIONAMENTO NETTO IMPONIBILE'.length)
  assert.equal(g[1].indexOf('€ 3,40'), g[0].indexOf('IMPOSTE'))
  assert.equal(htmlTableToGrid('<table><tr><td>sola riga</td></tr></table>'), '')
})
