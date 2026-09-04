/**
 * Test della coppia parametro→importo (findParameterPair) dopo il de-hardcoding.
 * Esegui: node --test test/polizzaDossierOverrides.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findParameterPair, findMassimaleSinistroSeed, normalizeBareAmountToText, findBisogniSeed } from '../src/services/polizzaDossierOverrides.js'

const txt = (t) => [{ name: 'polizza.pdf', text: t, pages: [t] }]
const txtSpatial = (sp, t) => [{ name: 'profilo.pdf', spatialText: sp, text: t }]

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

// ─── Regola 6: SEED MASSIMALE PER SINISTRO ─────────────────────────────────
test('findMassimaleSinistroSeed: sezione etichettata + importo "Illimitato"', () => {
  const d = txt('MASSIMALE PER SINISTRO MASSIMALE PER ANNO\n04/06/2025 04/06/2026 Annuale -\nMILANO 14/04/2025 NO 50.000,00 Illimitato')
  const s = findMassimaleSinistroSeed(d)
  assert.ok(s, 'seed trovato')
  assert.equal(s.value, '50.000,00')
})

test('findMassimaleSinistroSeed: senza etichetta "MASSIMALE PER SINISTRO" non scatta', () => {
  const d = txt('MASSIMALE ANNUO aggregato\n50.000,00 Illimitato')
  const s = findMassimaleSinistroSeed(d)
  assert.equal(s, null, 'manca la natura per-sinistro: niente seed')
})

test('findMassimaleSinistroSeed: ignora il DEFAULT del DIP (25.000,00)', () => {
  // il DIP non reca né l'etichetta per-sinistro né "Illimitato": non viene scelto
  const d = txt('Massimale 25.000,00 estendibile a 100.000,00\nMASSIMALE PER SINISTRO\n50.000,00 Illimitato')
  const s = findMassimaleSinistroSeed(d)
  assert.ok(s)
  assert.equal(s.value, '50.000,00', 'il default 25.000 del DIP non deve vincere')
})

// ─── Regola 7: NORMALIZZAZIONE FORMATTO IMPORTO ITALIANO ────────────────────
test('normalizeBareAmountToText: "127010" → "1.270,10" con evidenza nel testo', () => {
  const r = normalizeBareAmountToText('127010', 'PREMIO ANNUO 1.270,10 269,90 1.540,00')
  assert.equal(r, '1.270,10')
})

test('normalizeBareAmountToText: NON tocca "127010" se il testo ha solo "127.010,00"', () => {
  const r = normalizeBareAmountToText('127010', 'premio copertura 127.010,00 euro contro')
  assert.equal(r, null, 'importo grande reale: la forma "1.270,10" non compare → nessuna riscrittura')
})

test('normalizeBareAmountToText: già formattato (con virgola) resta invariato', () => {
  const r = normalizeBareAmountToText('1.270,10', 'PREMIO 1.270,10')
  assert.equal(r, null)
})

test('normalizeBareAmountToText: stringa non-cifre → null', () => {
  assert.equal(normalizeBareAmountToText('abc', 'abc 1.270,10'), null)
  assert.equal(normalizeBareAmountToText('', 'x'), null)
})

// ─── Regola 8: SEED BISOGNI ASSICURATIVI (voce con la X, testo SPAZIALE) ────
test('findBisogniSeed: voce co-lineare con la X nel testo spaziale', () => {
  const d = txtSpatial(
    "PROFILO CLIENTE - INDIVIDUAZIONE DEI BISOGNI ASSICURATIVI\n" +
    "  Tutela della mobilità / circolazione\n" +
    "  Tutela della vita privata\n" +
    "       X  Tutela della propria attività professionale\n" +
    "  Tutela dell'attività d'impresa o dell'ente\n",
    'profilo piatto senza coordinate'
  )
  const s = findBisogniSeed(d)
  assert.ok(s, 'seed trovato')
  assert.equal(s.value, 'Tutela della propria attività professionale')
})

test('findBisogniSeed: senza "X" co-lineare resta inerte', () => {
  const d = txtSpatial('Tutela della mobilità / circolazione\nTutela della vita privata\n', 'piatto')
  assert.equal(findBisogniSeed(d), null)
})

test('findBisogniSeed: senza testo spaziale (solo piatto) resta inerte', () => {
  const d = [{ name: 'p.pdf', text: 'X\nTutela della propria attività professionale' }]
  assert.equal(findBisogniSeed(d), null, 'senza griiglia spaziale la X è isolata: niente scelta deterministica')
})