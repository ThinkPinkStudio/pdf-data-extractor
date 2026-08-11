/**
 * Test del calcolo PREMIO LORDO / IMPOTRO PREMIO LORDO TOTALE.
 *
 * Esegui:  node --test test/premioLordo.test.mjs
 *
 * Le fixture vengono dal materiale del committente:
 *  - l'esempio a mano dentro il file di input (righe 10-21, polizza …000005),
 *    che fissa formula e aliquote;
 *  - il file di output di riferimento (FILE_GIACOMEL), che fissa arrotondamento
 *    a 2 decimali e totale sull'ULTIMA riga del gruppo.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  aliquotaFor,
  roundHalfUp,
  premioLordoFor,
  sumMoney,
  setRoundingMode,
  parseAmount,
  isInclusione,
  normalizeLabel,
  computePremioLordo,
  verifyResult,
  ALIQUOTA_ALTRE
} from '../src/main/services/premioLordo.js'

// ─── Aliquote ────────────────────────────────────────────────────────────────

test('aliquote della tabella del committente', () => {
  assert.deepEqual(aliquotaFor('RCA'), { rate: 0.265, known: true })
  assert.deepEqual(aliquotaFor('Assistenza in viaggio'), { rate: 0.10, known: true })
  assert.deepEqual(aliquotaFor('Tutela Legale base'), { rate: 0.125, known: true })
  assert.deepEqual(aliquotaFor('Infortunio'), { rate: 0.025, known: true })
})

test('la famiglia Infortuni prende il 2,5%', () => {
  for (const g of ['Infortunio', 'Infortuni conducente', 'INFORTUNI DEL CONDUCENTE', 'Infortunio conducente']) {
    assert.equal(aliquotaFor(g).rate, 0.025, g)
    assert.equal(aliquotaFor(g).known, true, g)
  }
})

test('le altre garanzie elencate prendono il 13,5%', () => {
  const altre = [
    'Cristalli', 'Furto totale o parziale', 'Incendio', 'Calamità naturali',
    'Guasti Integrale', 'Atti vandalici ed eventi sociopolitici',
    'Assistenza in viaggio ibrido-elettrico'
  ]
  for (const g of altre) assert.deepEqual(aliquotaFor(g), { rate: 0.135, known: true }, g)
})

test('le etichette reali con suffisso restano riconosciute', () => {
  // Nel report arrivano così, non come nella tabella del committente.
  assert.deepEqual(aliquotaFor('A4T GARANZIE AGGIUNTIVE (post 1/8/2006)'), { rate: 0.135, known: true })
  assert.deepEqual(aliquotaFor('GARANZIE ACCESSORIE: FORMULA UNO'), { rate: 0.135, known: true })
  assert.deepEqual(aliquotaFor('GARANZIE ACCESSORIE: FORMULA DUE'), { rate: 0.135, known: true })
})

test('"Assistenza in viaggio ibrido-elettrico" NON eredita il 10% della base', () => {
  // Il rischio è un match per prefisso: la variante ibrido-elettrico sta nel 13,5%.
  assert.equal(aliquotaFor('Assistenza in viaggio').rate, 0.10)
  assert.equal(aliquotaFor('Assistenza in viaggio ibrido-elettrico').rate, 0.135)
})

test('maiuscole, accenti e spazi non cambiano l\'aliquota', () => {
  assert.equal(aliquotaFor('  rca  ').rate, 0.265)
  assert.equal(aliquotaFor('CALAMITA NATURALI').rate, 0.135)
  assert.equal(aliquotaFor('Calamità  naturali').rate, 0.135)
  assert.equal(normalizeLabel('Calamità naturali'), 'calamita naturali')
})

test('una garanzia sconosciuta viene segnalata, non arrotondata a caso', () => {
  const res = aliquotaFor('Kasko integrale extra')
  assert.equal(res.known, false)
  assert.equal(res.rate, ALIQUOTA_ALTRE) // proposta, ma da confermare
})

// ─── Arrotondamento ──────────────────────────────────────────────────────────

test('arrotondamento commerciale a 2 decimali', () => {
  setRoundingMode('commerciale')
  assert.equal(roundHalfUp(351.5435), 351.54)
  assert.equal(roundHalfUp(266.7379), 266.74)
  assert.equal(roundHalfUp(1.005), 1.01)
  assert.equal(roundHalfUp(2.675), 2.68)
  assert.equal(roundHalfUp(0), 0)
  assert.ok(Number.isNaN(roundHalfUp('non un numero')))
})

test('i casi esattamente a metà: commerciale sale, legacy va al pari', () => {
  // Casi presi dal vecchio file di output: 23 × 1,135 = 26,105 esatti.
  const casi = [
    [23, 0.135, 26.11, 26.10],
    [187, 0.135, 212.25, 212.24],
    [795, 0.135, 902.33, 902.32],
    [891, 0.135, 1011.29, 1011.28],
    [145, 0.135, 164.58, 164.58], // quoziente dispari: le due regole coincidono
    [21, 0.135, 23.84, 23.84]
  ]
  for (const [netto, rate, commerciale, legacy] of casi) {
    assert.equal(premioLordoFor(netto, rate, 'commerciale'), commerciale, `${netto} commerciale`)
    assert.equal(premioLordoFor(netto, rate, 'legacy'), legacy, `${netto} legacy`)
  }
})

test('premioLordoFor non dipende dal rumore binario del double', () => {
  // 134,20 arriva dal foglio come 134.19999999999999: deve restare 134,20.
  assert.equal(premioLordoFor(134.19999999999999, 0.265), premioLordoFor('134,20', 0.265))
  assert.equal(premioLordoFor(134.2, 0.265), 169.76)
  // il classico caso che Math.round() sbaglia
  assert.equal(premioLordoFor(1, 0.01, 'commerciale'), 1.01)
})

test('gli importi negativi si arrotondano allontanandosi da zero', () => {
  assert.equal(premioLordoFor(-23, 0.135, 'commerciale'), -26.11)
  assert.equal(premioLordoFor(-23, 0.135, 'legacy'), -26.10)
})

test('sumMoney somma senza deriva binaria', () => {
  assert.equal(sumMoney([0.1, 0.2]), 0.3)
  assert.equal(sumMoney([4.2, 121.29, 6.2, 5.58, 137.06, 17.16, 15.44, 12.62, 49.51, 3.7, 169.76, 40.5]), 583.02)
  assert.equal(sumMoney([1.11, NaN, 2.22]), 3.33)
})

test('setRoundingMode rifiuta un modo inventato', () => {
  assert.throws(() => setRoundingMode('a caso'), /Modo di arrotondamento ignoto/)
  setRoundingMode('commerciale')
})

// ─── Lettura degli importi ───────────────────────────────────────────────────

test('il Premio Netto si legge sia come numero sia come testo italiano', () => {
  assert.equal(parseAmount(277.9), 277.9)
  assert.equal(parseAmount('277,90'), 277.9)
  assert.equal(parseAmount('1.234,56'), 1234.56)
  assert.equal(parseAmount('3.7'), 3.7)          // celle già convertite a numero
  assert.equal(parseAmount('€ 110,26'), 110.26)
  assert.equal(parseAmount('-45,10'), -45.1)
  assert.ok(Number.isNaN(parseAmount('')))
  assert.ok(Number.isNaN(parseAmount('-')))
})

test('il Movimento si riconosce a meno di spazi e maiuscole', () => {
  assert.ok(isInclusione('Inclusione Applicazione'))
  assert.ok(isInclusione('  inclusione   applicazione '))
  assert.ok(!isInclusione('Quietanza Intermedia'))
  assert.ok(!isInclusione('Generica'))
  assert.ok(!isInclusione(''))
})

// ─── Calcolo su fixture ──────────────────────────────────────────────────────

/** L'esempio a mano del committente: polizza …000005, 12 garanzie (righe 10-21). */
const POLIZZA_005 = [
  ['A4T GARANZIE AGGIUNTIVE (post 1/8/2006)', 3.7],
  ['Assistenza in viaggio', 110.26],
  ['Atti vandalici ed eventi sociopolitici', 5.46],
  ['Calamità naturali', 4.92],
  ['Cristalli', 120.76],
  ['Furto totale o parziale', 15.12],
  ['GARANZIE ACCESSORIE: FORMULA DUE', 13.6],
  ['GARANZIE ACCESSORIE: FORMULA UNO', 11.12],
  ['Guasti Integrale', 43.62],
  ['Incendio', 3.26],
  ['RCA', 134.2],
  ['Tutela Legale base', 36]
].map(([garanzia, premioNetto]) => ({
  numeroPolizza: '20265539000005',
  movimento: 'Inclusione Applicazione',
  garanzia,
  premioNetto
}))

test('esempio del committente: i 12 premi lordi della polizza …000005', () => {
  setRoundingMode('commerciale')
  const { premioLordo, totale, groups } = computePremioLordo(POLIZZA_005)

  // Valori dell'esempio a mano, arrotondati a 2 decimali come da specifica.
  assert.deepEqual(premioLordo, [
    4.20, 121.29, 6.20, 5.58, 137.06, 17.16, 15.44, 12.62, 49.51, 3.70, 169.76, 40.50
  ])

  // REGOLA 3: il totale sta SOLO sull'ultima riga del gruppo.
  assert.equal(groups.length, 1)
  assert.equal(totale.filter((v) => v != null).length, 1)
  assert.equal(totale[totale.length - 1], 583.02)
  assert.deepEqual(totale.slice(0, -1), new Array(11).fill(null))
})

test('solo le Inclusione Applicazione entrano nel calcolo', () => {
  const rows = [
    { numeroPolizza: 'P1', movimento: 'Inclusione Applicazione', garanzia: 'RCA', premioNetto: '277,90' },
    { numeroPolizza: 'P1', movimento: 'Quietanza Intermedia', garanzia: 'RCA', premioNetto: '277,90' },
    { numeroPolizza: 'P1', movimento: 'Generica', garanzia: 'RCA', premioNetto: '277,90' }
  ]
  const res = computePremioLordo(rows)
  assert.deepEqual(res.premioLordo, [351.54, null, null])
  assert.deepEqual(res.totale, [351.54, null, null]) // gruppo di una riga: prima = ultima
  assert.equal(res.stats.inclusioni, 1)
})

test('il totale va sull\'ultima riga del gruppo, anche con polizze alternate', () => {
  const mk = (p, g, n, mov = 'Inclusione Applicazione') =>
    ({ numeroPolizza: p, movimento: mov, garanzia: g, premioNetto: n })
  const rows = [
    mk('P1', 'RCA', 100),                      // 126.50
    mk('P2', 'RCA', 200),                      // 253.00
    mk('P1', 'Cristalli', 100),                // 113.50
    mk('P1', 'RCA', 100, 'Quietanza Intermedia'),
    mk('P2', 'Cristalli', 200)                 // 227.00
  ]
  const { premioLordo, totale } = computePremioLordo(rows)
  assert.deepEqual(premioLordo, [126.50, 253.00, 113.50, null, 227.00])
  // P1 chiude alla riga 2 (indice 2), P2 alla riga 5 (indice 4)
  assert.deepEqual(totale, [null, null, 240.00, null, 480.00])
})

test('il totale è la somma dei PREMIO LORDO già arrotondati', () => {
  setRoundingMode('commerciale')
  const { premioLordo, totale } = computePremioLordo(POLIZZA_005)
  const somma = premioLordo.reduce((a, v) => a + v, 0)
  assert.equal(Math.round(somma * 100) / 100, totale[totale.length - 1])
})

test('un Premio Netto illeggibile non inventa un valore', () => {
  const rows = [
    { numeroPolizza: 'P1', movimento: 'Inclusione Applicazione', garanzia: 'RCA', premioNetto: '-' },
    { numeroPolizza: 'P1', movimento: 'Inclusione Applicazione', garanzia: 'RCA', premioNetto: '100,00' }
  ]
  const res = computePremioLordo(rows)
  assert.equal(res.premioLordo[0], null)
  assert.equal(res.premioLordo[1], 126.5)
  assert.equal(res.missingPremio.length, 1)
  assert.equal(res.missingPremio[0].index, 0)
})

test('le garanzie sconosciute vengono raccolte con le loro righe', () => {
  const rows = [
    { numeroPolizza: 'P1', movimento: 'Inclusione Applicazione', garanzia: 'Kasko', premioNetto: 100 },
    { numeroPolizza: 'P1', movimento: 'Inclusione Applicazione', garanzia: 'Kasko', premioNetto: 50 },
    { numeroPolizza: 'P1', movimento: 'Quietanza Intermedia', garanzia: 'Ignota', premioNetto: 50 }
  ]
  const res = computePremioLordo(rows)
  assert.equal(res.unknownGaranzie.length, 1)
  assert.equal(res.unknownGaranzie[0].garanzia, 'Kasko')
  assert.deepEqual(res.unknownGaranzie[0].rows, [0, 1])
  // la riga non-inclusione non viene nemmeno guardata
})

// ─── Verifica finale ─────────────────────────────────────────────────────────

test('verifyResult promuove un calcolo corretto', () => {
  const res = computePremioLordo(POLIZZA_005)
  const v = verifyResult(POLIZZA_005, res)
  assert.ok(v.ok, JSON.stringify(v.checks, null, 2))
  assert.equal(v.checks.length, 4)
})

test('verifyResult boccia un totale spostato dall\'ultima riga', () => {
  const res = computePremioLordo(POLIZZA_005)
  const last = res.totale.length - 1
  res.totale[0] = res.totale[last]   // spostato sulla PRIMA riga
  res.totale[last] = null
  const v = verifyResult(POLIZZA_005, res)
  assert.ok(!v.ok)
  assert.ok(v.checks.some((c) => !c.ok && c.name.includes('ultima riga')))
})

test('verifyResult boccia un\'inclusione senza premio lordo', () => {
  const res = computePremioLordo(POLIZZA_005)
  res.premioLordo[3] = null
  const v = verifyResult(POLIZZA_005, res)
  assert.ok(!v.ok)
  assert.ok(v.checks.some((c) => !c.ok && c.name.includes('PREMIO LORDO')))
})

test('verifyResult boccia una riga non-inclusione valorizzata', () => {
  const rows = [
    { numeroPolizza: 'P1', movimento: 'Inclusione Applicazione', garanzia: 'RCA', premioNetto: 100 },
    { numeroPolizza: 'P1', movimento: 'Generica', garanzia: 'RCA', premioNetto: 100 }
  ]
  const res = computePremioLordo(rows)
  res.premioLordo[1] = 126.5
  const v = verifyResult(rows, res)
  assert.ok(!v.ok)
  assert.ok(v.checks.some((c) => !c.ok && c.name.includes('non-inclusione')))
})

test('verifyResult boccia un numero di righe diverso dall\'input', () => {
  const res = computePremioLordo(POLIZZA_005)
  const v = verifyResult(POLIZZA_005, res, { expectedRowCount: POLIZZA_005.length + 1 })
  assert.ok(!v.ok)
  assert.ok(v.checks.some((c) => !c.ok && c.name.includes('righe invariate')))
})
