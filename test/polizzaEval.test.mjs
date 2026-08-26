/**
 * Test del harness di valutazione estrazioni polizza (golden EULIP).
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import {
  EULIP_EXPECTED, compareField, scoreExtraction, formatScoreReport,
} from '../src/main/services/polizzaEval.js'

const fixture = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'eulip-expected.json'),
  'utf8',
))

test('fixture JSON e EULIP_EXPECTED sono allineati', () => {
  assert.equal(fixture.id, EULIP_EXPECTED.id)
  assert.deepEqual(Object.keys(fixture.fields).sort(), Object.keys(EULIP_EXPECTED.fields).sort())
  for (const id of Object.keys(fixture.fields)) {
    assert.equal(fixture.fields[id].value, EULIP_EXPECTED.fields[id].value)
    assert.equal(fixture.fields[id].mode, EULIP_EXPECTED.fields[id].mode)
  }
})

test('compareField: exact / text / date / amount / vat / contains', () => {
  assert.equal(compareField({ value: '283618616', mode: 'exact' }, '283618616').status, 'exact')
  assert.equal(compareField({ value: '283618616', mode: 'exact' }, '283618617').status, 'mismatch')
  assert.equal(compareField({ value: 'ACQUI TERME', mode: 'text' }, 'Acqui Terme').status, 'normalized')
  assert.equal(compareField({ value: '31/12/2024', mode: 'date' }, '31-12-2024').status, 'normalized')
  assert.equal(compareField({ value: '4.000.000,00', mode: 'amount' }, '4.000.000,00').status, 'exact')
  assert.equal(compareField({ value: '1.800.000', mode: 'amount' }, '1.800.000,00').status, 'normalized')
  assert.equal(compareField({ value: '4.000.000,00', mode: 'amount' }, '€ 4.000.000,00').status, 'normalized')
  assert.equal(compareField({ value: '00151510344', mode: 'vat' }, '00151510344').status, 'exact')
  assert.equal(compareField({ value: '00151510344', mode: 'vat' }, '0000000151510344').status, 'normalized')
  assert.equal(compareField({ value: 'retribuzioni', mode: 'contains' }, 'Salari e retribuzioni + TFR').status, 'normalized')
})

test('compareField: missing e forbidden (parametro = Premi)', () => {
  assert.equal(compareField({ value: 'x', mode: 'exact' }, '').status, 'missing')
  assert.equal(compareField({ value: 'x', mode: 'exact' }, null).status, 'missing')
  const spec = EULIP_EXPECTED.fields['28672974-6247-5654-a053-be29b408ffc1'] // rct_parametro
  assert.equal(compareField(spec, 'Premi').status, 'forbidden')
  assert.equal(compareField(spec, 'Premio').status, 'forbidden')
  assert.equal(compareField(spec, 'Premi RCT').status, 'forbidden')
  assert.equal(compareField(spec, 'retribuzioni').status, 'exact')
})

test('scoreExtraction: golden perfetto → match 10/10, zero allucinazioni', () => {
  const data = {
    '1ec23911-3e7d-5549-b2e2-be3db9d06ee8': '283618616',                     // polizza_numero
    '6f260040-ae1d-56d8-a185-1eb178e384fb': '00151510344',                   // codice_fiscale_iva
    '4dc720d8-8237-5084-b288-fd32bd1d19c6': '31/12/2024',                    // decorrenza
    '22408456-185d-5803-b489-02af1a084911': '31/12/2025',                    // scadenza
    '94cbee3c-f83b-5b95-87b8-8b68d02d6d59': '4.000.000,00',                  // rct_massimale_sinistro
    '37ab743b-316e-58a4-8fe4-3112bc6d2139': '1.001,25',                      // rct_imposta
    '545374de-c000-5905-8c62-d36f9fdf7f43': '5.501,25',                      // rct_premio_totale
    '4ffc5b95-9f28-551a-b587-12f4ea740b12': 'ACQUI TERME',                   // agenzia
    '28672974-6247-5654-a053-be29b408ffc1': 'retribuzioni',                  // rct_parametro
    '9517aacb-987f-55c8-8737-2df19980c55f': '1.800.000',                     // rct_importo_preventivo
  }
  const s = scoreExtraction(data)
  assert.equal(s.matched, 10)
  assert.equal(s.expected, 10)
  assert.equal(s.fieldMatchRate, 1)
  assert.equal(s.exactMatchRate, 1)
  assert.equal(s.hallucinationRate, 0)
  assert.equal(s.counts.missing, 0)
})

test('scoreExtraction: accetta wrapping {data} e candidati {valore}', () => {
  const s = scoreExtraction({
    data: {
      '1ec23911-3e7d-5549-b2e2-be3db9d06ee8': { valore: '283618616', evidenza: 'n. 283618616' },
      '4ffc5b95-9f28-551a-b587-12f4ea740b12': { valore: 'Acqui Terme' },
    },
  })
  assert.equal(s.perField['1ec23911-3e7d-5549-b2e2-be3db9d06ee8'].status, 'exact')
  assert.equal(s.perField['4ffc5b95-9f28-551a-b587-12f4ea740b12'].status, 'normalized')
  assert.equal(s.perField['4dc720d8-8237-5084-b288-fd32bd1d19c6'].status, 'missing')
})

test('scoreExtraction: mismatch e forbidden alzano hallucinationRate', () => {
  const s = scoreExtraction({
    '1ec23911-3e7d-5549-b2e2-be3db9d06ee8': '000000000',
    '28672974-6247-5654-a053-be29b408ffc1': 'Premi',
    '94cbee3c-f83b-5b95-87b8-8b68d02d6d59': '10.000,00',
    '4ffc5b95-9f28-551a-b587-12f4ea740b12': 'ACQUI TERME',
  })
  assert.equal(s.perField['1ec23911-3e7d-5549-b2e2-be3db9d06ee8'].status, 'mismatch')
  assert.equal(s.perField['28672974-6247-5654-a053-be29b408ffc1'].status, 'forbidden')
  assert.equal(s.perField['94cbee3c-f83b-5b95-87b8-8b68d02d6d59'].status, 'mismatch')
  assert.equal(s.perField['4ffc5b95-9f28-551a-b587-12f4ea740b12'].status, 'exact')
  assert.ok(s.hallucinationRate > 0)
  assert.ok(s.fieldMatchRate < 0.5)
  assert.equal(s.counts.forbidden, 1)
})

test('scoreExtraction: campi extra (non nel golden) non sporcano il match rate', () => {
  const s = scoreExtraction({
    '1ec23911-3e7d-5549-b2e2-be3db9d06ee8': '283618616',
    '705af6c0-721c-5374-9a65-46102baf95d5': 'olii e grassi',
  })
  assert.ok(s.extra.includes('705af6c0-721c-5374-9a65-46102baf95d5'))
  assert.equal(s.perField['1ec23911-3e7d-5549-b2e2-be3db9d06ee8'].status, 'exact')
  // 1 match su 10 attesi, l'extra non conta come allucinazione del golden
  assert.equal(s.matched, 1)
})

test('formatScoreReport: contiene id dossier e almeno una riga campo', () => {
  const text = formatScoreReport(scoreExtraction({ '1ec23911-3e7d-5549-b2e2-be3db9d06ee8': '283618616' }))
  assert.match(text, /eulip/i)
  assert.match(text, /1ec23911/)
  assert.match(text, /283618616/)
})
