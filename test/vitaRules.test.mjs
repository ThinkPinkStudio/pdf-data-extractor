/**
 * Polizza Vita: regole pure (web/lib/vita/rules.js). I numeri attesi sono quelli
 * del file del cliente «Elenco assicurati VITA 2026» (stato al 01/01/2026 e
 * foglio Movimentazioni, fine regolazione 31/12/2026).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_RULES, ageAt, rateFor, coverage, medicalBand, capitalOf, premiumOf, roundUp2,
  prorata, movementOf, computeInsured, makeCf, missingDoc, parseVitaRates, parseVitaWorkbook, findVitaHeader,
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

test('oltre 800.000: la visita porta a 800.000, accertamenti o check-up al capitale previsto', () => {
  const base = { ral: 310000.21, keyFigure: true } // capitale previsto 1.400.000
  assert.equal(capitalOf(base, {}).capital, 400000)
  assert.equal(capitalOf(base, { visit: true, ok: false }).capital, 400000)
  assert.equal(capitalOf(base, { visit: true, ok: true }).capital, 800000)
  assert.equal(capitalOf(base, { visit: true, ok: true }).scopertura, 600000)
  assert.equal(capitalOf(base, { visit: true, extra: true, ok: true }).capital, 1400000)
  assert.equal(capitalOf(base, { visit: true, extra: true, ok: false }).capital, 400000)
  // gli accertamenti non sostituiscono il rapporto di visita
  assert.equal(capitalOf(base, { extra: true, ok: true }).capital, 400000)
  // figura chiave con RAL bassa: la documentazione si chiede comunque
  assert.equal(capitalOf({ ral: 50000, keyFigure: true }, {}).capital, 400000)
})

test('alla figura chiave i documenti si chiedono anche con un capitale sotto la prima soglia', () => {
  const rules = { ...DEFAULT_RULES, keyFigureCapital: 300000 }
  const senza = capitalOf({ ral: 30000, keyFigure: true }, {}, rules)
  assert.equal(senza.band, 'visita')
  assert.equal(senza.capital, 300000) // il tetto non alza mai il capitale sopra il previsto
  assert.equal(senza.scopertura, 0)
  // chi non è figura chiave con lo stesso capitale non deve nulla
  assert.equal(capitalOf({ ral: 120000, keyFigure: false }, {}, rules).band, 'nessuna')
})

test('che cosa manca, per la mail all\'Azienda', () => {
  assert.equal(missingDoc({ band: 'nessuna', doc: {} }), null)
  assert.equal(missingDoc({ band: 'visita', doc: {} }), 'visita')
  assert.equal(missingDoc({ band: 'visita', doc: { visit: true } }), 'ok')
  assert.equal(missingDoc({ band: 'visita', doc: { visit: true, ok: true } }), null)
  assert.equal(missingDoc({ band: 'visita+accertamenti', doc: { visit: true, ok: true } }), 'accertamenti')
  assert.equal(missingDoc({ band: 'visita+accertamenti', doc: { visit: true, extra: true, ok: true } }), null)
  assert.equal(missingDoc({ band: 'visita+accertamenti', doc: { extra: true, ok: true } }), 'visita')
})

test('età computabile: compiuta fino a sei mesi dal compleanno, altrimenti da compiere', () => {
  assert.equal(ageAt('1972-02-16', '2026-01-01'), 54) // 53 compiuti, ultimo compleanno 16/02/2025, oltre i sei mesi → 54
  assert.equal(ageAt('1980-07-01', '2026-01-01'), 45) // esattamente sei mesi dal compleanno: resta 45
  assert.equal(ageAt('1980-07-01', '2026-01-02'), 46)
  assert.equal(ageAt('1980-12-31', '2026-01-01'), 45)
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

/* ─── Lettura dei file del cliente ───────────────────────────────────────── */

const CFG = {
  periodStart: '2026-01-01', periodEnd: '2027-01-01',
  companies: [{ key: 'sgr', name: 'Amundi SGR', policy: '60037' }, { key: 're', name: 'Amundi Real Estate', policy: '60038' }],
  rules: DEFAULT_RULES, rates: RATES, mail: { to: '', cc: '', signature: '' },
}
const HEAD = ['AZIENDA', 'NR. POLIZZA', 'COGNOME', 'NOME', 'CODICE FISCALE', 'LIVELLO', 'DATA DI NASCITA', 'DATA INSERIMENTO', "ETA'", 'RAL ANNUA 2025', 'RAL 2026 FULL TIME', 'SOVRAPREMI %', 'FIGURA CHIAVE', 'RAPPORTO DI VISITA MEDICA', 'RAPPORTO DI VISITA MEDICA FORNITO', 'OK C.A. VITA OVER 400.000', 'NOTE']
const RIGA = (cf, pol, ral25, ral26, fk = 'NO', visita = 'NO', ok = 'SI') =>
  ['AMUNDI SGR', pol, 'ROSSI', 'MARIO', cf, 'Quadro', 31000, 46023, 50, ral25, ral26, 0, fk, 'NO', visita, ok, '']

test('import: la colonna RAL si sceglie dall\'anno del programma', () => {
  const sheets = { 'Amundi SGR': [HEAD, RIGA('RSSMRA85T10A562S', 60037, 40000, 50000)] }
  // il programma 2026 prende «RAL 2026 FULL TIME», non la RAL 2025
  assert.equal(parseVitaWorkbook(CFG, sheets).insured[0].ral, 50000)
  assert.equal(parseVitaWorkbook(CFG, sheets, { ralYear: 2025 }).insured[0].ral, 40000)
  // senza una colonna dell'anno chiesto lo dice e usa l'ultima
  const r = parseVitaWorkbook(CFG, sheets, { ralYear: 2030 })
  assert.equal(r.insured[0].ral, 50000)
  assert.ok(r.warnings.some((w) => /RAL 2030/.test(w)))
})

test('import: il contraente si riconosce dal numero di polizza', () => {
  const sheets = { 'Amundi SGR': [HEAD, RIGA('RSSMRA85T10A562S', 60037, 0, 50000), RIGA('BNCLRA90A41F205I', 60038, 0, 60000), RIGA('VRDGPP70A01H501S', 99999, 0, 70000)] }
  const { insured, warnings } = parseVitaWorkbook(CFG, sheets)
  // la polizza 99999 non è di nessuno: la riga entra col nome dell'azienda, ma lo si dice
  assert.deepEqual(insured.map((p) => p.company), ['sgr', 're', 'sgr'])
  assert.ok(warnings.some((w) => /99999/.test(w) && /nessun contraente/.test(w)), warnings.join('\n'))
  // senza nemmeno un nome riconoscibile la riga si salta
  const muto = { 'Foglio X': [HEAD, RIGA('VRDGPP70A01H501S', 99999, 0, 70000).map((v, i) => (i === 0 ? 'ALTRA SPA' : v))] }
  const r2 = parseVitaWorkbook(CFG, muto)
  assert.equal(r2.insured.length, 0)
  assert.ok(r2.warnings.some((w) => /senza un contraente riconoscibile/.test(w)), r2.warnings.join('\n'))
})

test('import: righe di servizio e fogli delle movimentazioni fuori', () => {
  const sheets = {
    'Amundi SGR': [HEAD, RIGA('RSSMRA85T10A562S', 60037, 0, 50000), ['TOTALI', null, null, null, null, null, null, null, null, 0, 1234567, 0], ['Assicurati: 1']],
    'Movimentazioni SGR': [HEAD, RIGA('BNCLRA90A41F205I', 60037, 0, 60000)],
    TASSI: [['Età', 'Tasso ‰'], [18, 0.34]],
  }
  const { insured, warnings } = parseVitaWorkbook(CFG, sheets)
  assert.equal(insured.length, 1, 'solo la persona vera')
  assert.equal(warnings.filter((w) => /TASSI/.test(w)).length, 0, 'il foglio dei tassi non è un errore')
})

test('import: il sovrappremio del file è una frazione, qui è una percentuale', () => {
  const sheets = { 'Amundi SGR': [HEAD, ['AMUNDI SGR', 60037, 'ROSSI', 'MARIO', 'RSSMRA85T10A562S', 'Quadro', 31000, 46023, 50, 0, 50000, 0.25, 'NO', 'NO', 'NO', 'SI', '']] }
  assert.equal(parseVitaWorkbook(CFG, sheets).insured[0].sovrPct, 25)
})

test('tassi per età dal foglio del file, riconosciuto dal contenuto', () => {
  const r = parseVitaRates({
    'Amundi SGR': [HEAD, RIGA('RSSMRA85T10A562S', 60037, 0, 50000)],
    'Tassi 2027': [['Età', 'Tasso ‰'], [18, 0.35], [19, 0.37], ['', ''], [80, 30.5]],
  })
  assert.equal(r.n, 3)
  assert.equal(r.from, 'Tassi 2027')
  assert.equal(r.minAge, 18)
  assert.equal(r.maxAge, 80)
  assert.equal(r.rates['80'], 30.5)
  // nessun foglio dei tassi: niente, non si inventa
  assert.equal(parseVitaRates({ 'Amundi SGR': [HEAD] }).n, 0)
})

test('intestazione del tracciato trovata anche con la riga di titolo sopra', () => {
  const h = findVitaHeader([[null, 'Elenco assicurati'], [], HEAD], 2026)
  assert.equal(h.row, 2)
  assert.equal(h.map.cf, 4)
  assert.equal(h.map.ral, 10, 'la colonna RAL 2026, non la 2025')
})

test('import: i fogli delle MOVIMENTAZIONI portano entrate e uscite dell\'anno', () => {
  const MOV = ['AZIENDA', 'NR. POLIZZA', 'COGNOME', 'NOME', 'CODICE FISCALE', 'LIVELLO', 'DATA DI NASCITA', 'AZIONE', 'DATA AZIONE', "ETA'", 'RAL ANNUA', 'SOVRAPREMI %', 'FIGURA CHIAVE', 'NOTE']
  const mov = (cf, pol, azione, data, ral = 0, cognome = 'ROSSI') =>
    ['AMUNDI SGR', pol, cognome, 'MARIO', cf, 'Quadro', 31000, azione, data, 50, ral, 0, 'NO', '']
  const sheets = {
    'Amundi SGR': [HEAD, RIGA('RSSMRA85T10A562S', 60037, 0, 50000), RIGA('BNCLRA90A41F205I', 60037, 0, 60000)],
    'Movimentazioni SGR': [MOV,
      mov('RSSMRA85T10A562S', 60037, 'ESCLUSIONE', '01/05/2026'),
      mov('VRDGPP70A01H501S', 60037, 'INCLUSIONE', '16/07/2026', 82000, 'VERDI')],
  }
  const { insured } = parseVitaWorkbook(CFG, sheets)
  const uscito = insured.find((p) => p.cf === 'RSSMRA85T10A562S')
  assert.equal(uscito.exitDate, '2026-05-01')
  assert.equal(uscito.exitKind, 'cessazione')
  const entrato = insured.find((p) => p.cf === 'VRDGPP70A01H501S')
  assert.ok(entrato, 'chi entra in corso d\'anno e non è nello stato si aggiunge')
  assert.equal(entrato.entryDate, '2026-07-16')
  assert.equal(entrato.entryKind, 'inclusione')
  assert.equal(entrato.ral, 82000)
  // chi non ha movimenti resta com'era
  assert.equal(insured.find((p) => p.cf === 'BNCLRA90A41F205I').exitDate, null)
})

test('import: uscita da una polizza ed entrata nell\'altra lo stesso giorno = passaggio', () => {
  const MOV = ['AZIENDA', 'NR. POLIZZA', 'COGNOME', 'NOME', 'CODICE FISCALE', 'LIVELLO', 'DATA DI NASCITA', 'AZIONE', 'DATA AZIONE', "ETA'", 'RAL ANNUA', 'SOVRAPREMI %', 'FIGURA CHIAVE', 'NOTE']
  const sheets = {
    'Amundi SGR': [HEAD, RIGA('RSSMRA85T10A562S', 60037, 0, 50000)],
    'Movimentazioni SGR': [MOV, ['AMUNDI SGR', 60037, 'ROSSI', 'MARIO', 'RSSMRA85T10A562S', 'Quadro', 31000, 'ESCLUSIONE', '23/01/2026', 50, 50000, 0, 'NO', '']],
    'Movimentazioni Amundi RE': [MOV, ['AMUNDI RE', 60038, 'ROSSI', 'MARIO', 'RSSMRA85T10A562S', 'Quadro', 31000, 'INCLUSIONE', '23/01/2026', 50, 50000, 0, 'NO', '']],
  }
  const { insured } = parseVitaWorkbook(CFG, sheets)
  const esce = insured.find((p) => p.company === 'sgr')
  const entra = insured.find((p) => p.company === 're')
  assert.equal(esce.exitKind, 'passaggio')
  assert.equal(entra.entryKind, 'passaggio')
  assert.equal(esce.exitTransferId, entra.transferId, 'le due righe sono legate')
})

test('import: un\'uscita di chi non è in quella polizza si segnala, non si perde in silenzio', () => {
  const MOV = ['AZIENDA', 'NR. POLIZZA', 'COGNOME', 'NOME', 'CODICE FISCALE', 'LIVELLO', 'DATA DI NASCITA', 'AZIONE', 'DATA AZIONE', "ETA'", 'RAL ANNUA', 'SOVRAPREMI %', 'FIGURA CHIAVE', 'NOTE']
  const sheets = {
    'Amundi SGR': [HEAD, RIGA('RSSMRA85T10A562S', 60037, 0, 50000)],
    'Movimentazioni SGR': [MOV, ['AMUNDI SGR', 60037, 'BIANCHI', 'LAURA', 'BNCLRA90A41F205I', 'Quadro', 31000, 'ESCLUSIONE', '01/05/2026', 50, 0, 0, 'NO', '']],
  }
  const { insured, warnings } = parseVitaWorkbook(CFG, sheets)
  assert.equal(insured.filter((p) => p.exitDate).length, 0)
  assert.ok(warnings.some((w) => /BIANCHI LAURA/.test(w) && /non è fra gli assicurati/.test(w)), warnings.join('\n'))
})
