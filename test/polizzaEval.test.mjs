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
  const spec = EULIP_EXPECTED.fields.rct_parametro
  assert.equal(compareField(spec, 'Premi').status, 'forbidden')
  assert.equal(compareField(spec, 'Premio').status, 'forbidden')
  assert.equal(compareField(spec, 'Premi RCT').status, 'forbidden')
  assert.equal(compareField(spec, 'retribuzioni').status, 'exact')
})

test('scoreExtraction: golden perfetto → match 10/10, zero allucinazioni', () => {
  const data = {
    polizza_numero: '283618616',
    codice_fiscale_iva: '00151510344',
    decorrenza: '31/12/2024',
    scadenza: '31/12/2025',
    rct_massimale_sinistro: '4.000.000,00',
    rct_imposta: '1.001,25',
    rct_premio_totale: '5.501,25',
    agenzia: 'ACQUI TERME',
    rct_parametro: 'retribuzioni',
    rct_importo_preventivo: '1.800.000',
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
      polizza_numero: { valore: '283618616', evidenza: 'n. 283618616' },
      agenzia: { valore: 'Acqui Terme' },
    },
  })
  assert.equal(s.perField.polizza_numero.status, 'exact')
  assert.equal(s.perField.agenzia.status, 'normalized')
  assert.equal(s.perField.decorrenza.status, 'missing')
})

test('scoreExtraction: mismatch e forbidden alzano hallucinationRate', () => {
  const s = scoreExtraction({
    polizza_numero: '000000000',
    rct_parametro: 'Premi',
    rct_massimale_sinistro: '10.000,00',
    agenzia: 'ACQUI TERME',
  })
  assert.equal(s.perField.polizza_numero.status, 'mismatch')
  assert.equal(s.perField.rct_parametro.status, 'forbidden')
  assert.equal(s.perField.rct_massimale_sinistro.status, 'mismatch')
  assert.equal(s.perField.agenzia.status, 'exact')
  assert.ok(s.hallucinationRate > 0)
  assert.ok(s.fieldMatchRate < 0.5)
  assert.equal(s.counts.forbidden, 1)
})

test('scoreExtraction: campi extra (non nel golden) non sporcano il match rate', () => {
  const s = scoreExtraction({
    polizza_numero: '283618616',
    rcp_prodotti: 'olii e grassi',
  })
  assert.ok(s.extra.includes('rcp_prodotti'))
  assert.equal(s.perField.polizza_numero.status, 'exact')
  // 1 match su 10 attesi, l'extra non conta come allucinazione del golden
  assert.equal(s.matched, 1)
})

test('formatScoreReport: contiene id dossier e almeno una riga campo', () => {
  const text = formatScoreReport(scoreExtraction({ polizza_numero: '283618616' }))
  assert.match(text, /eulip/i)
  assert.match(text, /polizza_numero/)
  assert.match(text, /283618616/)
})
