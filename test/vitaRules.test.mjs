/**
 * Polizza Vita: regole pure (web/lib/vita/rules.js). I numeri attesi sono quelli
 * del file del cliente «Elenco assicurati VITA 2026» (stato al 01/01/2026 e
 * foglio Movimentazioni, fine regolazione 31/12/2026).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_RULES, ageAt, rateFor, coverage, medicalBand, capitalOf, premiumOf, roundUp2,
  prorata, movementOf, computeInsured, makeCf,
} from '../web/lib/vita/rules.js'
import { decodeCf, checkPerson } from '../web/lib/rsm/rules.js'
import { VITA_RATES_2026 as RATES } from '../web/lib/vita/rates2026.ts'

test('età computabile come ROUND((data − nascita − 2)/365,25)', () => {
  assert.equal(ageAt('1972-02-16', '2026-01-01'), 54)
  assert.equal(ageAt('1964-05-19', '2026-01-01'), 62)
  assert.equal(ageAt('1985-11-08', '2026-01-01'), 40)
})

test('tassi dal foglio TASSI', () => {
  assert.ok(Math.abs(rateFor(54, RATES) - 3.16691347098945) < 1e-12)
  assert.equal(rateFor(17, RATES), null)
  assert.equal(rateFor(81, RATES), null)
})

test('capitale 2,5 × RAL e premio lordo come nel file', () => {
  // riga ALIGNAY: RAL 42.061,44, 40 anni → capitale 105.153,60, netto 84,07, lordo 85,10
  const c = capitalOf({ ral: 42061.44, keyFigure: false })
  assert.equal(c.capital, 105153.6)
  const p = premiumOf(c.capital, rateFor(40, RATES))
  assert.equal(p.net, 84.07)
  assert.equal(p.gross, 85.1)
  // riga AGNELOTTI: RAL 100.000,16, 62 anni → 250.000,40 · 1.735,64 · 1.736,67
  const c2 = capitalOf({ ral: 100000.16, keyFigure: false })
  const p2 = premiumOf(c2.capital, rateFor(62, RATES))
  assert.equal(c2.capital, 250000.4)
  assert.equal(p2.net, 1735.64)
  assert.equal(p2.gross, 1736.67)
})

test('ROUNDUP al centesimo senza errori di virgola mobile', () => {
  assert.equal(roundUp2(339.97 + 1.03), 341)
  assert.equal(roundUp2(84.07 + 1.03), 85.1)
  assert.equal(roundUp2(100.001), 100.01)
})

test('fasce sanitarie e capitale ridotto senza documenti', () => {
  assert.equal(medicalBand(400000), 'nessuna')
  assert.equal(medicalBand(400000.25), 'visita')
  assert.equal(medicalBand(800000), 'visita')
  assert.equal(medicalBand(1400000), 'visita+accertamenti')
  // TAVAZZANI-like: figura chiave senza rapporto → 400.000, scopertura 1.000.000
  const k = capitalOf({ ral: 310000.21, keyFigure: true }, { visit: false, ok: false })
  assert.equal(k.capital, 400000)
  assert.equal(k.scopertura, 1000000)
  // SANDRINI-like: RAL 272.000,04 senza rapporto → scopertura 280.000,10
  const s = capitalOf({ ral: 272000.04, keyFigure: false }, {})
  assert.equal(s.capital, 400000)
  assert.equal(s.scopertura, 280000.1)
  // con rapporto e ok C.A. Vita il capitale è pieno
  const f = capitalOf({ ral: 185039.14, keyFigure: false }, { visit: true, ok: true })
  assert.equal(f.capital, 462597.85)
  assert.equal(f.scopertura, 0)
  // rapporto fornito ma senza ok della compagnia: resta ridotto
  assert.equal(capitalOf({ ral: 185039.14 }, { visit: true, ok: false }).capital, 400000)
  // soglia al centesimo: RAL 160.000,10 → 400.000,25, serve il rapporto
  assert.equal(capitalOf({ ral: 160000.1 }, {}).capital, 400000)
})

test('oltre 800.000: con trackExtra servono anche gli accertamenti', () => {
  const rules = { ...DEFAULT_RULES, trackExtra: true }
  const base = { ral: 310000.21, keyFigure: true }
  assert.equal(capitalOf(base, { visit: true, ok: true, extra: false }, rules).capital, 400000)
  assert.equal(capitalOf(base, { visit: true, ok: true, extra: true }, rules).capital, 1400000)
  // come il file: senza trackExtra basta il rapporto
  assert.equal(capitalOf(base, { visit: true, ok: true }).capital, 1400000)
})

test('garanzie per età: morte + IPT fino a 70, solo morte fino a 80', () => {
  assert.equal(coverage(17), '')
  assert.equal(coverage(18), 'MORTE + IPT')
  assert.equal(coverage(70), 'MORTE + IPT')
  assert.equal(coverage(71), 'SOLO CASO MORTE')
  assert.equal(coverage(80), 'SOLO CASO MORTE')
  assert.equal(coverage(81), 'FUORI COPERTURA')
})

test('sovrappremio in percentuale', () => {
  const p = premiumOf(200000, 2, 25)
  assert.equal(p.net, 500)
  assert.equal(p.gross, 501.03)
})

test('inclusione pro-rata a giorni con diritti (GADDA: 16/07 → 31/12)', () => {
  assert.equal(prorata('2026-07-16', '2026-12-31'), 168 / 365)
  const m = movementOf({ kind: 'INCLUSIONE', date: '2026-07-16', capital: 205000, rate: rateFor(49, RATES) }, '2026-12-31')
  assert.equal(m.days, 168)
  assert.equal(m.net, 176.4)
  assert.equal(m.gross, 177.43)
})

test('esclusione: come il file (età al giorno di uscita) o con i dati pagati a inizio anno', () => {
  // CESARINI: capitale 229.055,125, tasso a 34 anni, uscita 01/05 → −82,44 nel file
  const exitRules = { ...DEFAULT_RULES, refundBasis: 'exit' }
  const asFile = movementOf({ kind: 'ESCLUSIONE', date: '2026-05-01', capital: 229055.125, rate: 0.5384153961554904 }, '2026-12-31', exitRules)
  assert.equal(asFile.gross, -82.44)
  assert.equal(asFile.rights, 0)
  // con i dati pagati (tasso a 33 anni) il rimborso è quanto pagato in proporzione
  const paid = movementOf({ kind: 'ESCLUSIONE', date: '2026-05-01', capital: 229055.125, rate: 0.5384153961554904, paid: { capital: 229055.125, rate: rateFor(33, RATES) } }, '2026-12-31')
  assert.equal(paid.gross, -77.19)
})

test('calcolo completo di un assicurato', () => {
  const c = computeInsured({ birthDate: '1985-11-08', ral: 42061.44, keyFigure: false, doc: {}, sovrPct: 0 }, RATES, '2026-01-01')
  assert.equal(c.age, 40)
  assert.equal(c.cover, 'MORTE + IPT')
  assert.equal(c.gross, 85.1)
})

test('codice fiscale di prova valido e coerente', () => {
  const cf = makeCf('Bianchi', 'Laura', '1975-03-12', 'F', 'F205')
  assert.equal(cf.length, 16)
  const d = decodeCf(cf, 2026)
  assert.equal(d.valid !== false, true)
  const chk = checkPerson({ cognome: 'Bianchi', nome: 'Laura', cf, birthDate: '1975-03-12' }, 2026)
  assert.deepEqual(chk.issues.filter((i) => i.level === 'error'), [])
})
