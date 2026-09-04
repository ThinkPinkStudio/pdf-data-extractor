/**
 * Test della coppia parametro→importo (findParameterPair) dopo il de-hardcoding.
 * Esegui: node --test test/polizzaDossierOverrides.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findParameterPair } from '../src/services/polizzaDossierOverrides.js'

const txt = (t) => [{ name: 'polizza.pdf', text: t, pages: [t] }]

test('findParameterPair: stessa riga "Fatturato 1.500.000,00"', () => {
  const d = txt('Attività Studio associato\nFatturato 1.500.000,00\nSoggetto assicurato Studio/Societa')
  const p = findParameterPair(d)
  assert.ok(p, 'pair trovata')
  assert.equal(p.name, 'Fatturato')
  assert.equal(p.amount, '1.500.000,00')
})

test('findParameterPair: etichetta su riga e importo su riga sotto ("Fatturato\\n1.500.000,00")', () => {
  const d = txt('Fatturato\n1.500.000,00\nSoggetto assicurato')
  const p = findParameterPair(d)
  assert.ok(p, 'pair trovata')
  assert.equal(p.name, 'Fatturato')
  assert.equal(p.amount, '1.500.000,00')
})

test('findParameterPair: riga sotto con coppia propria non crea coppia spuria ("RCP\\nFatturato 1.5…")', () => {
  const d = txt('RCP\nFatturato 1.500.000,00\nResto')
  const p = findParameterPair(d)
  assert.ok(p, 'pair trovata')
  assert.equal(p.name, 'Fatturato', 'la coppia vera è su "Fatturato 1.500.000,00", non label "RCP" + importo')
  assert.equal(p.amount, '1.500.000,00')
})

test('findParameterPair: "COLLEGATO ALLA POLIZZA" non è un parametro', () => {
  const d = txt('COLLEGATO ALLA POLIZZA N. 01469DAS00086\nFatturato\n1.500.000,00')
  const p = findParameterPair(d)
  assert.ok(p, 'pair trovata')
  assert.equal(p.name, 'Fatturato')
})

test('findParameterPair: riga premio/boilerplate non è un parametro', () => {
  const d = txt('PREMIO ANNUO 1.270,10 269,90 1.540,00\nFatturato 1.500.000,00')
  const p = findParameterPair(d)
  assert.ok(p)
  assert.equal(p.name, 'Fatturato')
  assert.equal(p.amount, '1.500.000,00')
})

test('findParameterPair: etichetta composta "Preventivo Fatturato Resto del Mondo"', () => {
  const d = txt('Preventivo Fatturato Resto del Mondo 60.000.000,00\nSoggetto assicurato')
  const p = findParameterPair(d)
  assert.ok(p)
  assert.equal(p.name.toLowerCase().includes('fatturato'), true)
  assert.equal(p.amount, '60.000.000,00')
})

test('findParameterPair: il footer aziendale (Cap. Soc.) non vince sul parametro vero', () => {
  const d = txt('D.A.S. S.p.A.\nCap. Soc. € 2.750.000,00 interamente versato\nRegistro Imprese VR\nRISCHI ASSICURATI\nFatturato 1.500.000,00\nSoggetto assicurato')
  const p = findParameterPair(d)
  assert.ok(p, 'pair trovata')
  assert.equal(p.name, 'Fatturato', 'il footer "Cap. Soc." non deve essere scelto al posto del parametro in sezione RISCHI')
  assert.equal(p.amount, '1.500.000,00')
})