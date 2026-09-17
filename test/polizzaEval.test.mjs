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
} from '../src/services/polizzaEval.js'

const fixture = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'eulip-expected.json'),
  'utf8',
))

test('fixture JSON e EULIP_EXPECTED sono allineati', () => {
  assert.equal(fixture.id, EULIP_EXPECTED.id)
  assert.deepEqual(Object.keys(fixture.fields).sort(), Object.keys(EULIP_EXPECTED.fields).sort())
  for (const label of Object.keys(fixture.fields)) {
    assert.equal(fixture.fields[label].value, EULIP_EXPECTED.fields[label].value)
    assert.equal(fixture.fields[label].mode, EULIP_EXPECTED.fields[label].mode)
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
  const spec = EULIP_EXPECTED.fields['Parametro regolazione'] // rct_parametro
  assert.equal(compareField(spec, 'Premi').status, 'forbidden')
  assert.equal(compareField(spec, 'Premio').status, 'forbidden')
  assert.equal(compareField(spec, 'Premi RCT').status, 'forbidden')
  assert.equal(compareField(spec, 'retribuzioni').status, 'exact')
})

// I dati estratti possono avere chiavi = id campo (UUID) o chiavi = label.
// Per il golden perfetto usiamo le LABEL come chiavi (il formato stabile).
test('scoreExtraction: golden perfetto con chiavi LABEL → match 10/10, zero allucinazioni', () => {
  const data = {
    'N° Polizza': '283618616',
    'P. IVA / Cod. Fiscale': '00151510344',
    'Decorrenza': '31/12/2024',
    'Scadenza': '31/12/2025',
    'Massimale per sinistro': '4.000.000,00',
    'Imposta': '1.001,25',
    'Premio totale': '5.501,25',
    'Agenzia': 'ACQUI TERME',
    'Parametro regolazione': 'retribuzioni',
    'Importo preventivo parametro': '1.800.000',
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
      'N° Polizza': { valore: '283618616', evidenza: 'n. 283618616' },
      'Agenzia': { valore: 'Acqui Terme' },
    },
  })
  assert.equal(s.perField['N° Polizza'].status, 'exact')
  assert.equal(s.perField['Agenzia'].status, 'normalized')
  assert.equal(s.perField['Decorrenza'].status, 'missing')
})

test('scoreExtraction: mismatch e forbidden alzano hallucinationRate', () => {
  const s = scoreExtraction({
    'N° Polizza': '000000000',
    'Parametro regolazione': 'Premi',
    'Massimale per sinistro': '10.000,00',
    'Agenzia': 'ACQUI TERME',
  })
  assert.equal(s.perField['N° Polizza'].status, 'mismatch')
  assert.equal(s.perField['Parametro regolazione'].status, 'forbidden')
  assert.equal(s.perField['Massimale per sinistro'].status, 'mismatch')
  assert.equal(s.perField['Agenzia'].status, 'exact')
  assert.ok(s.hallucinationRate > 0)
  assert.ok(s.fieldMatchRate < 0.5)
  assert.equal(s.counts.forbidden, 1)
})

test('scoreExtraction: campi extra (non nel golden) non sporcano il match rate', () => {
  const s = scoreExtraction({
    'N° Polizza': '283618616',
    '705af6c0-721c-5374-9a65-46102baf95d5': 'olii e grassi',
  })
  assert.ok(s.extra.includes('705af6c0-721c-5374-9a65-46102baf95d5'))
  assert.equal(s.perField['N° Polizza'].status, 'exact')
  assert.equal(s.matched, 1)
})

test('formatScoreReport: contiene id dossier e almeno una riga campo', () => {
  const text = formatScoreReport(scoreExtraction({ 'N° Polizza': '283618616' }))
  assert.match(text, /eulip/i)
  assert.match(text, /N° Polizza/)
  assert.match(text, /283618616/)
})