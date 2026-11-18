/**
 * Polizza Vita per CATEGORIA (Agos, 18/11/2026): capitale e premio fissi per
 * categoria, pro-rata con i diritti, file mensile delle risorse umane (assunti,
 * cessati, passaggi di livello) applicato a più polizze. I numeri attesi sono
 * quelli dei file del cliente «Agos LTC 2026» e «Anagrafiche Agos Vita Quadri
 * e Dirigenti 2026».
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  categoryFor, computeInsured, movementOf, yearEndOf, nextDay, makeCf, parseVitaWorkbook,
  parseHrMonthly, planHrEvents, categoriesFromWorkbook, premiumOf,
} from '../web/lib/vita/rules.js'

const base = { periodStart: '2026-01-01', periodEnd: '2027-01-01', rates: {}, mail: { to: '', cc: '', signature: '' } }
const R = { refundBasis: 'start', minAge: 0, deathMaxAge: 99, ipMaxAge: 99, grossRounding: 'nessuno', rightsProRata: true, exitNextDay: true }
const LTC = { ...base, companies: [{ key: 'agos', name: 'Agos Ducato Spa', policy: '', hrCode: '300' }],
  rules: { ...R, capitalMode: 'categoria', countLastDay: true, rights: 1.03, categories: [{ key: 'd', name: 'DIPENDENTI', capital: 13200, rate: 1.96, match: '' }] } }
const QD = { ...base, companies: [{ key: 'agos', name: 'Agos Ducato', policy: '60020', hrCode: '300' }, { key: 'rent', name: 'Agos Renting', policy: '60020' }],
  rules: { ...R, capitalMode: 'categoria', countLastDay: false, rights: 0, categories: [
    { key: 'q', name: 'QUADRO', capital: 51645.59, rate: 0, premium: 110.41, match: 'quadro' },
    { key: 'g', name: 'DIRIGENTE', capital: 144607.93, rate: 0, premium: 309.16, match: 'dirigente' }] } }
const c2 = (n) => Math.round(n * 100) / 100

test('categoria dal livello: parole, nome, unica categoria per tutti', () => {
  assert.equal(categoryFor('Quadro direttivo livello 1 - credito agos', QD.rules).name, 'QUADRO')
  assert.equal(categoryFor('Dirigente - commercio', QD.rules).name, 'DIRIGENTE')
  assert.equal(categoryFor('QUADRO', QD.rules).name, 'QUADRO')
  assert.equal(categoryFor('Impiegato area 3 livello 1', QD.rules), null)
  assert.equal(categoryFor('Impiegato area 3 livello 1', LTC.rules).name, 'DIPENDENTI')
  assert.equal(categoryFor('', LTC.rules).name, 'DIPENDENTI')
})

test('premi come i fogli di Agos: decimali pieni, totale coi decimali', () => {
  const p = computeInsured({ level: 'x', birthDate: '1966-05-06' }, {}, '2026-01-01', LTC.rules)
  assert.equal(p.capital, 13200)
  assert.ok(Math.abs(p.gross - 26.902) < 1e-9) // 13.200 × 1,96‰ + 1,03: il file mostra 26,90, il totale somma 26,902
  assert.equal(p.age, 60) // età computabile come nel file
  const q = computeInsured({ level: 'Quadro direttivo livello 2' }, {}, '2026-01-01', QD.rules)
  assert.ok(Math.abs(q.gross - 110.41) < 1e-9)
  assert.equal(c2(computeInsured({ level: 'DIRIGENTE' }, {}, '2026-01-01', QD.rules).gross), 309.16)
  // con l'arrotondamento al centesimo il premio resta 26,90 e il totale perde i millesimi
  assert.equal(premiumOf(13200, 1.96, 0, { ...LTC.rules, grossRounding: 'normale' }).gross, 26.9)
})

test('pro-rata LTC: fino al 01/01 dopo, diritti in pro-rata sulle entrate, rimborso senza diritti', () => {
  const ye = yearEndOf(LTC)
  assert.equal(ye, '2027-01-01')
  const k = computeInsured({ level: '' }, {}, '2026-01-15', LTC.rules)
  const inc = movementOf({ kind: 'INCLUSIONE', date: '2026-01-15', capital: k.capital, rate: k.rate }, ye, LTC.rules)
  assert.equal(inc.days, 351)
  assert.equal(c2(inc.gross), 25.87) // CHAFIK DALILA
  assert.equal(c2(movementOf({ kind: 'INCLUSIONE', date: '2026-02-16', capital: k.capital, rate: k.rate }, ye, LTC.rules).gross), 23.51)
  const out = movementOf({ kind: 'ESCLUSIONE', date: '2026-01-12', capital: k.capital, rate: k.rate, paid: { capital: k.capital, rate: k.rate } }, ye, LTC.rules)
  assert.equal(c2(out.gross), -25.09) // MORRA LUCA
})

test('pro-rata Vita Quadri: fino al 31/12, premio fisso della categoria', () => {
  const ye = yearEndOf(QD)
  assert.equal(ye, '2026-12-31')
  const k = computeInsured({ level: 'QUADRO' }, {}, '2026-02-16', QD.rules)
  assert.equal(c2(movementOf({ kind: 'INCLUSIONE', date: '2026-02-16', capital: k.capital, rate: k.rate }, ye, QD.rules).gross), 96.19) // FALCIONE
  assert.equal(c2(movementOf({ kind: 'ESCLUSIONE', date: '2026-02-01', capital: k.capital, rate: k.rate, paid: { capital: k.capital, rate: k.rate } }, ye, QD.rules).gross), -100.73) // TINELLI
  const d = computeInsured({ level: 'Dirigente - commercio' }, {}, '2026-04-01', QD.rules)
  assert.equal(c2(movementOf({ kind: 'INCLUSIONE', date: '2026-04-01', capital: d.capital, rate: d.rate }, ye, QD.rules).gross), 232.08) // ALBERTINI
})

// Persone di prova con codici fiscali validi
const P = (cognome, nome, birth, sex = 'F') => ({ cognome, nome, birth, cf: makeCf(cognome, nome, birth, sex, 'F205') })
const A = P('ROSSI', 'ANNA', '1980-03-10')
const B = P('BIANCHI', 'LUCA', '1975-06-20', 'M')
const C = P('VERDI', 'CARLA', '1990-01-05')
const D = P('NERI', 'PAOLO', '1969-05-23', 'M')
const serial = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000) + 25569

test('import Vita Quadri: polizza condivisa da due aziende, passaggio quadro → dirigente, uscita e rientro', () => {
  const head = ['AZIENDA', 'NR. POLIZZA', 'MATRICOLA', 'COGNOME', 'NOME', 'C.F. TITOLARE', 'DATA DI NASCITA', 'CATEGORIA', 'CAPITALE', 'PREMIO', 'DECORRENZA', 'SCADENZA', 'MODULO']
  const row = (az, p, lv, matr) => [az, 60020, matr, p.cognome, p.nome, p.cf, serial(p.birth), lv, 51645.59, 110.41, serial('2026-01-01'), serial('2026-12-31'), 'X']
  const vh = ['AZIENDA', 'NR. POLIZZA', 'MATRICOLA', 'AZIONE', 'COGNOME', 'NOME', 'C.F. TITOLARE', 'DATA DI NASCITA', 'DESCRIZIONE LIVELLO', 'CAPITALE', 'PREMIO', 'DECORRENZA', 'SCADENZA']
  const v = (az, pol, az2, p, lv, date) => [az, pol, '', az2, p.cognome, p.nome, p.cf, serial(p.birth), lv, 0, 0, serial(date), serial('2026-12-31')]
  const sheets = {
    'Rinnovo 2026': [head, row('AGOS DUCATO SPA', A, 'QUADRO', '0001'), row('AGOS RENTING', B, 'QUADRO', '2'), row('AGOS DUCATO SPA', C, 'QUADRO', '0003'), ['', '', '', '', '', '', '', '', 35521845.42, 75940.37]],
    'Variazioni 2026': [vh,
      v('AGOS DUCATO', 60021, 'ESCLUSIONE', A, 'QUADRO', '2026-08-01'), // numero trascinato: si dice
      v('AGOS DUCATO', 60020, 'INCLUSIONE', A, 'DIRIGENTE', '2026-08-01'),
      v('AGOS DUCATO', 60020, 'ESCLUSIONE', C, 'QUADRO', '2026-03-01'),
      v('AGOS DUCATO', 60020, 'INCLUSIONE', C, 'QUADRO', '2026-05-04')],
  }
  const r = parseVitaWorkbook(QD, sheets)
  assert.equal(r.insured.length, 5)
  const a = r.insured.filter((p) => p.cf === A.cf)
  assert.deepEqual(a.map((p) => [p.level, p.entryDate, p.exitDate, p.exitKind || p.entryKind]), [['QUADRO', '2026-01-01', '2026-08-01', 'passaggio'], ['DIRIGENTE', '2026-08-01', null, 'passaggio']])
  assert.equal(r.insured.find((p) => p.cf === B.cf).company, 'rent')
  const c = r.insured.filter((p) => p.cf === C.cf)
  assert.deepEqual(c.map((p) => [p.entryDate, p.exitDate]), [['2026-01-01', '2026-03-01'], ['2026-05-04', null]])
  assert.ok(r.warnings.some((w) => /60021/.test(w)))
  assert.equal(r.insured[0].extra.MATRICOLA, '0001')
  assert.equal(r.insured[0].extra.MODULO, 'X')
  assert.deepEqual(r.layout.stato.slice(0, 3), ['AZIENDA', 'NR. POLIZZA', 'MATRICOLA'])
})

test('import LTC: movimentazioni a due sezioni, INSERIMENTI ed ESCLUSIONI', () => {
  const head = ['AZIENDA', 'MATRICOLA', 'COGNOME', 'NOME', 'C.F. ASSICURATO', 'DATA DI NASCITA', 'CAPITALE', 'TASSO', 'DIRITTI', 'PREMIO', 'DECORRENZA', 'SCADENZA']
  const ins = ['MATRICOLA', 'COGNOME', 'NOME', 'C.F. TITOLARE', 'DATA DI NASCITA', 'PREMIO', 'DATA ENTRATA', 'SCADENZA POLIZZA']
  const esc = ['MATRICOLA', 'COGNOME', 'NOME', 'C.F. TITOLARE', 'DATA DI NASCITA', 'PREMIO', 'DATA USCITA', 'SCADENZA POLIZZA']
  const sheets = {
    'LTC Rinnovo 2026': [head, ['AGOS DUCATO SPA', '1', A.cognome, A.nome, A.cf, serial(A.birth), 13200, 0.00196, 1.03, 26.902, serial('2026-01-01'), serial('2027-01-01')]],
    'MOVIMENTAZIONI 2026': [['INSERIMENTI'], ins, ['9', B.cognome, B.nome, B.cf, serial(B.birth), 25.87, serial('2026-01-15'), serial('2027-01-01')], [], ['ATTENZIONE NEL FILE DELLE VARIAZIONI IL CLIENTE INDICA L\'ULTIMO GIORNO LAVORATIVO.'], ['ESCLUSIONI'], esc,
      ['1', A.cognome, A.nome, A.cf, serial(A.birth), -20, serial('2026-03-01'), serial('2027-01-01')]],
  }
  const r = parseVitaWorkbook(LTC, sheets)
  assert.equal(r.insured.length, 2)
  assert.equal(r.insured.find((p) => p.cf === A.cf).exitDate, '2026-03-01')
  assert.equal(r.insured.find((p) => p.cf === B.cf).entryDate, '2026-01-15')
  const cats = categoriesFromWorkbook(sheets, '2027-01-01')
  assert.deepEqual(cats.categories.map((c) => [c.name, c.capital, c.rate]), [['DIPENDENTI', 13200, 1.96]])
  assert.equal(cats.rights, 1.03)
  assert.equal(cats.countLastDay, true)
})

// File mensile come quello di Agos: un foglio per mese, sezioni con la loro intestazione
const hrHead = (date) => ['Soc', 'Matricola', 'Cognome', 'Nome', 'CodFiscale', 'DataNascita', 'LocalitaNascita', 'ProvinciaNascita', 'Livello', 'SessoDL', 'TipodiContratto', 'TipoContrattoDL', date]
const hr = (p, lv, date, soc = '300') => [soc, '0009', p.cognome, p.nome, p.cf, serial(p.birth), 'MILANO', 'MI', lv, 'F', 'IND', 'Tempo Indeterminato', date ? serial(date) : null]
const MONTHLY = {
  'Gen 2026': [['Gennaio'], ['ASSUNTI '], hrHead('DataAssunzione'), hr(D, 'Quadro direttivo livello 1 - credito agos', '2026-01-15'), ['CESSATI  '], hrHead('DataCessazione'), hr(C, 'Impiegato area 3 livello 1', '2026-01-31')],
  'Giu 2026': [['Giugno'], ['PROROGHE'], [...hrHead('proroga dal'), 'proroga fino al'], hr(B, 'Impiegato area 3', '2026-06-01'),
    ['PASSAGGI DI LIVELLO CON DECORRENZA'], hrHead('Data decorrenza'), hr(B, 'Quadro direttivo livello 1', '2026-06-30'),
    ['PROMOZIONI QD A DIR'], hrHead('Data decorrenza'), hr(A, 'Dirigente - commercio', '2026-08-01'), hr(D, 'Quadro direttivo livello 2', null)],
}

test('file mensile: sezioni, date, proroghe', () => {
  const r = parseHrMonthly(MONTHLY)
  assert.deepEqual(r.months, ['Gen 2026', 'Giu 2026'])
  assert.deepEqual(r.events.map((e) => [e.kind, e.cognome, e.date]), [
    ['entrata', 'NERI', '2026-01-15'], ['uscita', 'VERDI', '2026-01-31'], ['proroga', 'BIANCHI', '2026-06-01'],
    ['livello', 'BIANCHI', '2026-06-30'], ['livello', 'ROSSI', '2026-08-01'], ['livello', 'NERI', null]])
})

const row = (p, over) => ({ id: over.id, company: 'agos', cf: p.cf, cognome: p.cognome, nome: p.nome, birthDate: p.birth, level: 'QUADRO', entryDate: '2026-01-01', entryKind: 'iniziale', exitDate: null, exitKind: null, ...over })

test('piano del file mensile sulla Vita Quadri: solo quadri e dirigenti, uscita dal giorno dopo, promozione', () => {
  const ev = parseHrMonthly(MONTHLY).events
  const insured = [row(A, { id: 'a' }), row(C, { id: 'c', level: 'Impiegato' })]
  const plan = planHrEvents(QD, insured, ev)
  const ch = plan.changes.map((c) => [c.kind, c.who, c.date])
  assert.deepEqual(ch, [
    ['entrata', 'NERI PAOLO', '2026-01-15'], // assunto quadro
    ['uscita', 'VERDI CARLA', '2026-02-01'], // ultimo giorno 31/01 → esce dal 01/02
    ['entrata', 'BIANCHI LUCA', '2026-06-30'], // impiegato → quadro: entra
    ['passaggio', 'ROSSI ANNA', '2026-08-01'], // quadro → dirigente
  ])
  assert.equal(plan.skipped.proroghe, 1)
  // la cessazione di VERDI riguarda una riga che non è di nessuna categoria ma è assicurata: esce
  assert.equal(plan.updates.find((u) => u.id === 'c').set.exitDate, '2026-02-01')
  const a = plan.updates.find((u) => u.id === 'a').set
  assert.equal(a.exitKind, 'passaggio')
  const nuovaA = plan.inserts.find((p) => p.cf === A.cf)
  assert.equal(nuovaA.entryKind, 'passaggio')
  assert.equal(nuovaA.transferId, a.exitTransferId)
  assert.equal(plan.inserts.find((p) => p.cf === D.cf).extra.MATRICOLA, '0009')
  assert.ok(plan.warnings.some((w) => /NERI PAOLO.*senza data/.test(w)) === false) // il passaggio senza data di NERI non cambia categoria
})

test('piano sulla LTC: tutti i dipendenti, i passaggi di livello non cambiano niente', () => {
  const ev = parseHrMonthly(MONTHLY).events
  const plan = planHrEvents(LTC, [row(A, { id: 'a', level: '' }), row(B, { id: 'b', level: '' }), row(C, { id: 'c', level: '' })], ev)
  assert.deepEqual(plan.changes.map((c) => [c.kind, c.who]), [['entrata', 'NERI PAOLO'], ['uscita', 'VERDI CARLA']])
  assert.equal(plan.skipped.giaRegistrati, 2) // passaggi di BIANCHI e ROSSI: stessa categoria
})

test('ricaricare lo stesso file non registra niente; una data diversa è una differenza da scegliere', () => {
  const ev = parseHrMonthly(MONTHLY).events
  const insured = [row(A, { id: 'a' }), row(C, { id: 'c', level: 'Impiegato' })]
  const p1 = planHrEvents(QD, insured, ev)
  const after = [
    ...insured.map((p) => ({ ...p, ...(p1.updates.find((u) => u.id === p.id) || {}).set })),
    ...p1.inserts.map((p, i) => ({ ...p, id: `n${i}` })),
  ]
  const p2 = planHrEvents(QD, after, ev)
  assert.equal(p2.changes.length, 0)
  assert.equal(p2.inserts.length + p2.updates.length, 0)
  // l'uscita registrata con la data sbagliata (come COSCI nel file del cliente)
  const wrong = after.map((p) => (p.id === 'c' ? { ...p, exitDate: '2026-01-01' } : p))
  const p3 = planHrEvents(QD, wrong, ev)
  assert.equal(p3.diffs.length, 1)
  assert.equal(p3.diffs[0].expected, '2026-02-01')
  assert.equal(p3.updates.length, 0) // non si corregge da sola
  const p4 = planHrEvents(QD, wrong, ev, { fix: [p3.diffs[0].key] })
  assert.deepEqual(p4.updates, [{ id: 'c', set: { exitDate: '2026-02-01' } }])
})

test('codice società: righe di altre società fuori; senza codici tutto al primo contraente', () => {
  const ev = parseHrMonthly({ 'Gen 2026': [['ASSUNTI'], hrHead('DataAssunzione'), hr(D, 'Quadro', '2026-01-15', '999')] }).events
  assert.equal(planHrEvents(QD, [], ev).skipped.altraSocieta, 1)
  const noCodes = { ...QD, companies: QD.companies.map(({ hrCode, ...c }) => c) }
  assert.equal(planHrEvents(noCodes, [], ev).inserts[0].company, 'agos')
  assert.equal(nextDay('2026-12-31'), '2027-01-01')
})
