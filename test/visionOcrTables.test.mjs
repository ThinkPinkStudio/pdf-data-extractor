// [flag ocrtabelle] (08/10/2026) Le scansioni lette dal modello visivo hanno le
// celle separate da spazi ma NON incolonnate, e le celle vuote saltate: nella
// scheda DAS OneClick di P07 «€ 18,67  € 2,33  € 21,00» sta sotto cinque
// intestazioni e nessuna regola sa di quale colonna è ogni importo. Con la
// variante il modello scrive le celle separate da «|» (anche le vuote) e il
// testo si incolonna come la griglia di una pagina digitale.
import test from 'node:test'
import assert from 'node:assert/strict'
import { alignPipeTables, dossierOcrEngine, visionOcrModel, OCR_TABLES_SUFFIX } from '../src/services/polizzaService.js'

const startOf = (line, cell) => line.indexOf(cell)

test('alignPipeTables: le celle di una riga sotto le intestazioni della loro colonna, anche con celle vuote', () => {
  const raw = [
    'GARANZIE PRESCELTE',
    '|  | TUTELA LEGALE | PERDITE PECUNIARIE | ASSISTENZA | IMPOSTE | PREMIO LORDO |',
    '|---|---|---|---|---|---|',
    '| Tutela legale circolazione stradale base | € 18,67 |  |  | € 2,33 | € 21,00 |',
    '| Indennità e rimborsi + patente a punti |  | € 7,93 |  | € 1,07 | € 9,00 |',
    '| PREMIO ANNUO | € 18,67 | € 7,93 |  | € 3,40 | € 30,00 |',
    'IDENTIFICAZIONE DEI RISCHI ASSICURATI',
  ].join('\n')
  const out = alignPipeTables(raw).split('\n')
  assert.equal(out.length, 6) // la riga di trattini sparisce
  assert.equal(out[0], 'GARANZIE PRESCELTE')
  assert.equal(out[5], 'IDENTIFICAZIONE DEI RISCHI ASSICURATI')
  const [head, tl, pp, tot] = out.slice(1, 5)
  assert.equal(startOf(tl, '€ 18,67'), startOf(head, 'TUTELA LEGALE'))
  assert.equal(startOf(tl, '€ 2,33'), startOf(head, 'IMPOSTE'))
  assert.equal(startOf(tl, '€ 21,00'), startOf(head, 'PREMIO LORDO'))
  assert.equal(startOf(pp, '€ 7,93'), startOf(head, 'PERDITE PECUNIARIE'))
  assert.equal(startOf(tot, '€ 30,00'), startOf(head, 'PREMIO LORDO'))
  // tra due colonne almeno due spazi (separatore di cella della griglia)
  assert.match(tl, /base {2,}€ 18,67/)
})

test('alignPipeTables: senza bordi esterni, riempitivi nelle celle, una riga sola, testo senza tabelle invariato', () => {
  const out = alignPipeTables('NETTO | IMPOSTE\nPremio Netto.......562,50 | 137,67').split('\n')
  assert.equal(startOf(out[1], '137,67'), startOf(out[0], 'IMPOSTE'))
  assert.match(out[1], /^Premio Netto {2,}562,50/)
  assert.equal(alignPipeTables('DECORRENZA | 30/06/2011'), 'DECORRENZA   30/06/2011')
  const plain = 'POLIZZA N  01469OC26\nDECORRENZA  30/06/2011'
  assert.equal(alignPipeTables(plain), plain)
})

test('dossierOcrEngine: la variante delle tabelle solo col flag e solo per il modello visivo', () => {
  const s = { polizzaOcrEngine: 'qwen3-vl:32b' }
  assert.equal(dossierOcrEngine(s, [false, false]), 'qwen3-vl:32b')
  assert.equal(dossierOcrEngine({ ...s, polizzaEngineFlags: 'ocrtabelle' }, [false]), 'qwen3-vl:32b' + OCR_TABLES_SUFFIX)
  // fascicolo misto: Tesseract (ocrsoloscansioni), la variante non conta
  assert.equal(dossierOcrEngine({ ...s, polizzaEngineFlags: 'ocrtabelle' }, [true, false]), '')
  // Tesseract resta Tesseract
  assert.equal(dossierOcrEngine({ polizzaOcrEngine: 'tesseract', polizzaEngineFlags: 'ocrtabelle' }, [false]), 'tesseract')
  // già con la variante (lettura preliminare + worker): non si raddoppia
  assert.equal(dossierOcrEngine({ polizzaOcrEngine: 'qwen3-vl:32b#tabelle', polizzaEngineFlags: 'ocrtabelle' }, [false]), 'qwen3-vl:32b#tabelle')
  assert.equal(visionOcrModel('qwen3-vl:32b#tabelle'), 'qwen3-vl:32b')
  assert.equal(visionOcrModel('qwen2.5vl:32b'), 'qwen2.5vl:32b')
})
