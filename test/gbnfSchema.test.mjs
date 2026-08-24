/**
 * Test dei vincoli di formato (JSON Schema + GBNF) per l'estrazione polizze.
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  fieldValueKind, VALUE_PATTERNS, buildJsonSchema, buildGbnfGrammar, ollamaFormatFor,
} from '../src/main/services/gbnfSchema.js'

const fields = [
  { id: 'polizza_numero', label: 'N° Polizza', type: 'text' },
  { id: 'decorrenza', label: 'Decorrenza', type: 'date' },
  { id: 'codice_fiscale_iva', label: 'P. IVA', type: 'text' },
  { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro', type: 'text' },
  { id: 'rct_tasso', label: 'Tasso regolazione ‰', type: 'text' },
  { id: 'attivita', label: 'Attività assicurata', type: 'text' },
]

test('fieldValueKind: date / vat / amount / rate / text', () => {
  assert.equal(fieldValueKind({ id: 'decorrenza', type: 'date' }), 'date')
  assert.equal(fieldValueKind({ id: 'codice_fiscale_iva' }), 'vat')
  assert.equal(fieldValueKind({ id: 'rct_massimale_sinistro', label: 'Massimale' }), 'amount')
  assert.equal(fieldValueKind({ id: 'rct_imposta', label: 'Imposta' }), 'amount')
  assert.equal(fieldValueKind({ id: 'rct_tasso', label: 'Tasso' }), 'rate')
  assert.equal(fieldValueKind({ id: 'attivita', label: 'Attività' }), 'text')
  assert.equal(fieldValueKind({ id: 'rct_parametro', label: 'Parametro regolazione' }), 'text')
})

test('VALUE_PATTERNS: date/amount/vat accettano i golden EULIP', () => {
  const re = (k) => new RegExp(VALUE_PATTERNS[k])
  assert.equal(re('date').test('31/12/2024'), true)
  assert.equal(re('date').test('gennaio 2024'), false)
  assert.equal(re('amount').test('4.000.000,00'), true)
  assert.equal(re('amount').test('1.800.000'), true)
  assert.equal(re('amount').test('5.501,25'), true)
  assert.equal(re('amount').test('3 milioni'), false)
  assert.equal(re('vat').test('00151510344'), true)
  assert.equal(re('vat').test('ABC'), false)
  assert.equal(re('rate').test('2,450'), true)
})

test('buildJsonSchema staged: pattern sui campi vincolati, testo libero altrove', () => {
  const s = buildJsonSchema(fields, 'staged')
  assert.equal(s.type, 'object')
  assert.equal(s.additionalProperties, false)
  assert.ok(s.properties.decorrenza)
  const decVal = s.properties.decorrenza.properties.valore.anyOf[0]
  assert.equal(decVal.pattern, VALUE_PATTERNS.date)
  const amtVal = s.properties.rct_massimale_sinistro.properties.valore.anyOf[0]
  assert.equal(amtVal.pattern, VALUE_PATTERNS.amount)
  const vatVal = s.properties.codice_fiscale_iva.properties.valore.anyOf[0]
  assert.equal(vatVal.pattern, VALUE_PATTERNS.vat)
  // attività: stringa libera, niente pattern
  const actVal = s.properties.attivita.properties.valore.anyOf[0]
  assert.equal(actVal.pattern, undefined)
  assert.equal(actVal.type, 'string')
})

test('buildJsonSchema perField: ammette oggetto vuoto (non trovato)', () => {
  const s = buildJsonSchema([{ id: 'decorrenza', type: 'date' }], 'perField')
  assert.equal(s.oneOf.length, 2)
  assert.deepEqual(s.oneOf[0], { type: 'object', additionalProperties: false, properties: {} })
  const filled = s.oneOf[1]
  assert.ok(filled.required.includes('valore'))
  assert.ok(filled.required.includes('evidenza'))
})

test('buildGbnfGrammar staged: contiene i vincoli e gli id campo', () => {
  const g = buildGbnfGrammar(fields, 'staged')
  assert.match(g, /^root ::=/)
  assert.match(g, /"polizza_numero"/)
  assert.match(g, /"decorrenza"/)
  assert.match(g, /date-body ::=/)
  assert.match(g, /amount ::=/)
  assert.match(g, /vat ::=/)
  // i testi liberi usano string, non amount/date
  assert.match(g, /f_attivita_entry ::=/)
})

test('buildGbnfGrammar perField: root ammette {}', () => {
  const g = buildGbnfGrammar([{ id: 'rct_imposta', label: 'Imposta' }], 'perField')
  assert.match(g, /root ::= "\{" ws "\}"/)
  assert.match(g, /amount/)
})

test('ollamaFormatFor: default schema, spegnibile, gbnf su richiesta', () => {
  const schema = ollamaFormatFor(fields, 'staged', {})
  assert.equal(typeof schema, 'object')
  assert.equal(schema.type, 'object')
  assert.equal(ollamaFormatFor(fields, 'staged', { polizzaConstrainedJson: false }), 'json')
  const g = ollamaFormatFor(fields, 'staged', { polizzaConstrainedFormat: 'gbnf' })
  assert.equal(typeof g, 'string')
  assert.match(g, /root ::=/)
  assert.equal(ollamaFormatFor([], 'staged', {}), 'json')
})
