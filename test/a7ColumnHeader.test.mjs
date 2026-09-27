/**
 * Stadio A.7: il nome di una colonna non è un valore (schede DAS condominio:
 * «TUTELA LEGALE» per le Garanzie scelte dalla riga «Difesa Condominio»).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isColumnHeaderValue } from '../src/services/polizzaService.js'

const row = (label, cols) => ({ page: 1, key: label.toLowerCase().replace(/[^a-z0-9]/g, ''), row: { label, cols } })
const das = [row('Difesa Condominio - ed.2019', [
  { header: 'TUTELA LEGALE', value: '298,55' }, { header: 'PERDITE PECUNIARIE', value: '' },
  { header: 'IMPOSTE', value: '63,44' }, { header: 'PREMIO LORDO', value: '361,99' },
])]

test('valore = intestazione di colonna senza cella che lo porti: non è un dato', () => {
  assert.equal(isColumnHeaderValue('TUTELA LEGALE', das[0], das), true)
  assert.equal(isColumnHeaderValue('Tutela Legale, Imposte', das[0], das), true)
})

test('valori veri restano: una cella lo porta, oppure non è un\'intestazione', () => {
  assert.equal(isColumnHeaderValue('298,55', das[0], das), false)
  assert.equal(isColumnHeaderValue('Difesa Condominio', das[0], das), false)
  // scheda con una colonna per garanzia: l'intestazione è anche il valore di una cella
  const g = [row('Garanzie', [{ header: 'Tutela Legale', value: 'Tutela Legale' }])]
  assert.equal(isColumnHeaderValue('Tutela Legale', g[0], g), false)
  assert.equal(isColumnHeaderValue('TUTELA LEGALE', null, []), false)
})

test('tasso per mille: un valore in percentuale è un altro dato', async () => {
  const { sanitizeFieldValue } = await import('../src/services/polizzaService.js')
  const f = { id: 't', label: 'Tasso regolazione ‰', description: 'Tasso di regolazione: il tasso espresso per mille (‰) applicato al parametro di regolazione (es. 0,245, 44,16).' }
  assert.equal(sanitizeFieldValue(f, '3%'), null)
  assert.equal(sanitizeFieldValue(f, '0,245‰'), '0,245')
  assert.equal(sanitizeFieldValue(f, '0,245'), '0,245')
})
