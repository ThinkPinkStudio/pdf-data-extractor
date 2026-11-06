/**
 * Riepilogo generale — modulo puro src/services/summaryAggregate.js.
 * Nessun servizio esterno (niente Ollama, niente DB).
 *
 * Esegui:  node --test test/summaryAggregate.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  isEmpty, parseAmount, parseRate, parseDate, textKey, checkAnswer, flattenValues,
  classifyField, defaultOp, numStats, aggregate, delta, valueCounts, buckets, completeness, dueWithin,
  yearOf, yearsOf, referenceYear, previousYear,
  defaultPrefs, defaultYearFieldId, defaultDueFieldId, sanitizePrefs, mergePrefs, effectivePrefs,
  compareYears, policyName, profileKeyOf, checkEligible, resolveMember, memberWarnings,
  referenceFields, buildSnapshot, summarize, sanitizeJobIds, OTHER_KEY, EMPTY_KEY, DOSSIER_KEY,
  fieldSig, freezeField, frozenKind,
} from '../src/services/summaryAggregate.js'

const TODAY = '26/09/2026'
const REAL = JSON.parse(readFileSync(new URL('../polizze_test/profili-polizza-riconoscimento.json', import.meta.url), 'utf8'))
const realProfile = (name) => REAL.find((p) => p.name === name)

// Profilo sintetico in stile Tutela Legale (descrizioni realistiche, label del cliente).
const FIELDS = [
  { id: 'num', label: 'N° Polizza', description: 'Numero identificativo della polizza: la sequenza alfanumerica accanto a «Polizza n.» (es. 410000880)', type: 'number' },
  { id: 'cmp', label: 'Compagnia', description: 'Nome della compagnia assicuratrice (es. Generali Italia S.p.A.)', type: 'text' },
  { id: 'con', label: 'Contraente', description: 'Ragione sociale o nome del contraente (es. CONDOMINIO VIA VERDI 12)', type: 'text' },
  { id: 'iva', label: 'P. IVA / Cod. Fiscale', description: 'Partita IVA o codice fiscale del contraente (es. 00151510344)', type: 'text' },
  { id: 'dec', label: 'Decorrenza', description: 'Data di decorrenza della polizza (es. 31/12/2024)', type: 'date' },
  { id: 'sca', label: 'Scadenza', description: 'Data di scadenza della polizza (es. 31/12/2025)', type: 'date' },
  { id: 'fra', label: 'Frazionamento', description: 'Frazionamento del premio come TESTO (es. Annuale, Semestrale)', type: 'text' },
  { id: 'mas', label: 'Massimale per sinistro', description: "Massimale per sinistro: l'importo massimo che la compagnia paga per ogni sinistro (es. 25.000,00)", type: 'number' },
  { id: 'fr', label: 'Franchigia', description: "Franchigia generica: l'importo che resta a carico dell'assicurato (es. 250,00)", type: 'number' },
  { id: 'imp', label: 'Premio imponibile', description: 'Premio imponibile (netto) della garanzia (es. 620,00)', type: 'number' },
  { id: 'int', label: 'Interessi', description: 'Interessi di frazionamento del premio (es. 0,00)', type: 'number' },
  { id: 'tax', label: 'Imposte', description: 'Imposte sul premio della garanzia (es. 140,00)', type: 'number' },
  { id: 'lor', label: 'Premio lordo', description: 'Premio lordo totale della garanzia (es. 760,00)', type: 'number' },
  { id: 'tas', label: 'Tasso ‰', description: 'Tasso di regolazione per mille (es. 0,245)' },
  { id: 'tut', label: 'Tutela', description: "Verifica se è presente la garanzia Tutela Legale: rispondi 'Sì' o 'No'", type: 'text' },
]

// Portafoglio sintetico: condomìni su più anni, due compagnie che cambiano.
function portfolio() {
  const rows = [
    // jobId, nome, num, iva, cmp, dec, sca, mas, fr, imp, tax, lor, fra, tut, tas
    ['a1', 'Condominio Via Verdi 12', 'TL001', '00000000001', 'Generali', '31/10/2023', '31/10/2024', '25.000,00', '250,00', '590,00', '130,00', '720,00', 'Annuale', 'Sì', '0,245'],
    ['a2', 'Condominio Parco Nord', 'TL002', '00000000002', 'ARAG', '15/11/2023', '15/11/2024', '50.000,00', '250,00', '705,00', '155,00', '860,00', 'Annuale', 'No', ''],
    ['a3', 'Condominio Viale Monza 88', 'TL003', '00000000003', 'ARAG', '01/03/2023', '01/03/2024', '10.000,00', '', '336,00', '74,00', '410,00', 'Semestrale', '', ''],
    ['b1', 'Condominio Via Verdi 12', 'TL010', '00000000001', 'DAS', '31/10/2025', '31/10/2026', '25.000,00', '200,00', '623,00', '137,00', '760,00', 'Annuale', 'Sì', '0,300'],
    ['b2', 'Condominio Parco Nord', 'TL002', '00000000002', 'ARAG', '15/11/2025', '15/11/2026', '50.000,00', '200,00', '730,00', '160,00', '890,00', 'Annuale', 'SI', ''],
    ['b3', 'Condominio Via Manzoni 3', 'TL020', '00000000009', 'DAS', '31/12/2025', '31/12/2026', '25.000,00', '150,00', '578,00', '127,00', '705,00', 'Annuale', 'no', ''],
    ['c1', 'Supercondominio Le Betulle', 'TL030', '00000000030', 'DAS', '20/04/2026', '20/04/2027', '50.000,00', '150,00', '918,00', '202,00', '1.120,00', 'Semestrale', 'Sì', ''],
    ['n1', 'Condominio Senza Data', 'TL040', '00000000040', 'Allianz', '', '', '25.000,00', '', '', '', '', '', '', ''],
  ]
  return rows.map(([jobId, name, num, iva, cmp, dec, sca, mas, fr, imp, tax, lor, fra, tut, tas]) => ({
    jobId,
    batchId: 'B1',
    name,
    path: 'PIZZAMIGLIO / Condomìni',
    state: 'ok',
    values: Object.fromEntries(Object.entries({ num, iva, cmp, con: name, dec, sca, mas, fr, imp, int: imp ? '0,00' : '', tax, lor, fra, tut, tas }).filter(([, v]) => v !== '')),
  }))
}

const run = (over = {}) => summarize({ fields: FIELDS, policies: portfolio(), yearFieldId: 'dec', dueFieldId: 'sca', prefs: {}, today: TODAY, view: {}, ...over })

// ─── Lettura dei valori ──────────────────────────────────────────────────────

test('parseAmount: formati italiani, vuoti e non numerici', () => {
  assert.equal(parseAmount('1.234,56'), 1234.56)
  assert.equal(parseAmount('€ 1.000'), 1000)
  assert.equal(parseAmount('760,00'), 760)
  assert.equal(parseAmount('10689.58'), 10689.58)
  assert.equal(parseAmount('4.000.000,00'), 4000000)
  assert.equal(parseAmount('0,00'), 0)
  for (const v of ['', '  ', 'n/d', '-', null, undefined]) assert.equal(parseAmount(v), null, String(v))
  for (const v of ['', '  ', 'n/d', '-']) assert.equal(isEmpty(v), true, v)
  assert.equal(parseAmount('Illimitato'), null)
  assert.equal(parseAmount('10%'), null)
  assert.equal(isEmpty('Illimitato'), false, 'un valore non numerico non è vuoto: è «non numerico»')
})

test('parseRate: il punto da solo è il decimale (0.245 non è 245)', () => {
  assert.equal(parseRate('0.245'), 0.245)
  assert.equal(parseRate('2,450'), 2.45)
  assert.equal(parseRate('12,5‰'), 12.5)
  assert.equal(parseRate('1,5%'), 1.5)
  assert.equal(parseRate('1.234,5'), 1234.5)
  assert.equal(parseRate('0,245 per mille'), 0.245)
  assert.equal(parseRate('n/d'), null)
  assert.equal(parseRate('variabile'), null)
})

test('parseDate: formati, anno a 2 cifre, data dentro un testo, giorno UTC', () => {
  assert.equal(parseDate('31/12/24').y, 2024)
  assert.equal(parseDate('2024-12-31').y, 2024)
  assert.equal(parseDate('31.12.2024').y, 2024)
  assert.equal(parseDate('dal 31/12/2024 al 31/12/2025').str, '31/12/2024')
  assert.equal(parseDate('boh'), null)
  assert.equal(parseDate(''), null)
  const a = parseDate('26/09/2026')
  const b = parseDate('25/12/2026')
  assert.equal(b.day - a.day, 90)
  assert.deepEqual({ y: a.y, m: a.m, d: a.d }, { y: 2026, m: 9, d: 26 })
})

test('textKey e checkAnswer', () => {
  assert.equal(textKey('D.A.S.'), 'DAS')
  assert.equal(textKey(' das '), 'DAS')
  assert.equal(textKey('Condomìni'), 'CONDOMINI')
  const tut = FIELDS.find((f) => f.id === 'tut')
  assert.equal(checkAnswer(tut, 'SI'), 'Sì')
  assert.equal(checkAnswer(tut, 'sì'), 'Sì')
  assert.equal(checkAnswer(tut, 'Sì, massimale 500.000'), 'Sì')
  assert.equal(checkAnswer(tut, 'boh'), OTHER_KEY)
  assert.equal(checkAnswer(tut, ''), null)
})

test('flattenValues: stessa regola di flattenRollingState', () => {
  assert.deepEqual(flattenValues({ a: { valore: '760,00' }, b: { valore: null }, c: { valore: '' }, d: 'X1', e: null }), { a: '760,00', d: 'X1' })
})

// ─── Tipi dei campi ──────────────────────────────────────────────────────────

test('classifyField: tipo SOLO dalla descrizione', () => {
  const k = (f) => classifyField(f)
  assert.deepEqual(k(FIELDS[0]), { kind: 'identifier', idKind: 'document' })
  assert.deepEqual(k(FIELDS[3]), { kind: 'identifier', idKind: 'vat' })
  assert.deepEqual(k(FIELDS.find((f) => f.id === 'tut')), { kind: 'check', answers: ['Sì', 'No'] })
  assert.equal(k({ id: 'x', type: 'date', description: 'Data di decorrenza' }).kind, 'date')
  assert.deepEqual(k({ id: 'x', description: 'Premio lordo totale della polizza (es. 760,00)' }), { kind: 'amount', unit: 'eur', structural: false })
  assert.deepEqual(k({ id: 'x', type: 'number', description: 'Numero di addetti dichiarati (es. 12)' }), { kind: 'amount', unit: 'num', structural: false })
  assert.equal(k(FIELDS.find((f) => f.id === 'tas')).kind, 'rate')
  assert.equal(k(FIELDS.find((f) => f.id === 'cmp')).kind, 'text')
  // limiti e condizioni (classe binaria di structuralNature, testa della descrizione)
  assert.equal(k(FIELDS.find((f) => f.id === 'mas')).structural, true)
  assert.equal(k(FIELDS.find((f) => f.id === 'fr')).structural, true)
  assert.deepEqual(k({ id: 'x', description: 'Limite massimo di indennizzo per singolo sinistro (es. 1.000.000,00)' }), { kind: 'amount', unit: 'eur', structural: true })
  // la label non conta, in nessuno dei due versi
  assert.equal(k({ id: 'x', label: 'Premio lordo', description: 'Nome della compagnia assicuratrice' }).kind, 'text')
  assert.equal(k({ id: 'x', label: 'Compagnia', description: 'Premio lordo annuo della polizza (es. 760,00)' }).kind, 'amount')
  assert.equal(defaultOp(FIELDS.find((f) => f.id === 'mas')), 'avg')
  assert.equal(defaultOp(FIELDS.find((f) => f.id === 'lor')), 'sum')
  assert.equal(defaultOp(FIELDS.find((f) => f.id === 'tas')), 'avg')
  assert.equal(defaultOp(FIELDS.find((f) => f.id === 'cmp')), null)
})

test('classifyField sui profili reali: Tutela Legale 3 e Rc Professionale V3', () => {
  const count = (p) => {
    const c = {}
    for (const f of p.fields) { const kk = classifyField(f).kind; c[kk] = (c[kk] || 0) + 1 }
    return c
  }
  const tl = realProfile('Tutela Legale 3')
  assert.equal(tl.fields.length, 23)
  assert.deepEqual(count(tl), { identifier: 2, text: 9, date: 2, amount: 9, rate: 1 })
  const byLabel = Object.fromEntries(tl.fields.map((f) => [f.label, classifyField(f)]))
  assert.equal(byLabel['N° Polizza'].idKind, 'document')
  assert.equal(byLabel['P. IVA / Cod. Fiscale'].idKind, 'vat')
  // limiti/condizioni contro importi periodici
  for (const l of ['Massimale per sinistro tutela legale', 'Massimale per anno tutela legale', 'Franchigia generica o minima']) assert.equal(byLabel[l].structural, true, l)
  for (const l of ['Premio imponibile tutela legale', 'Imposte', 'Premio lordo totale tutela legale', 'Interessi di frazionamento', 'Diritti', 'Importo preventivo parametro regolazione']) assert.equal(byLabel[l].structural, false, l)
  // 12 verifiche: dal 26/09 anche Visto pesante e i due massimali visto
  assert.equal(count(realProfile('Rc Professionale V3')).check, 12)
  // unità: sui 5 profili reali solo «Numero addetti» è un numero senza €
  const nums = REAL.flatMap((p) => p.fields.filter((f) => classifyField(f).unit === 'num').map((f) => `${p.name}/${f.label}`))
  assert.deepEqual(nums, ['CSA RC Professionale/Numero addetti / professionisti'])
  const csa = Object.fromEntries(realProfile('CSA RC Professionale').fields.map((f) => [f.label, classifyField(f)]))
  assert.equal(csa['Massimale per sinistro'].unit, 'eur')
  assert.equal(csa['Massimale aggregato annuo'].unit, 'eur')
  assert.equal(csa['Massimale per sinistro'].structural, true, 'natura fine «franchigia», classe giusta')
})

// ─── Statistiche ─────────────────────────────────────────────────────────────

test('somma e media senza i vuoti; non numerici esclusi e contati', () => {
  const f = { id: 'p', label: 'Premio', description: 'Premio lordo totale (es. 760,00)' }
  const values = ['100,00', '', '200,00', 'n/d', 'Illimitato']
  const out = summarize({ fields: [f], policies: values.map((v, i) => ({ jobId: `j${i}`, name: `P${i}`, values: { p: v } })), today: TODAY })
  const st = out.fieldStats.p
  assert.equal(st.sum, 300)
  assert.equal(st.avg, 150)
  assert.equal(st.n, 2)
  assert.equal(st.empty, 2)
  assert.deepEqual(st.nonNumeric, [{ value: 'Illimitato', count: 1 }])
})

test('numStats: mediana e insieme vuoto', () => {
  assert.equal(numStats([1, 3, 2]).median, 2)
  assert.equal(numStats([1, 2, 3, 4]).median, 2.5)
  assert.deepEqual(numStats([]), { n: 0, sum: null, avg: null, median: null, min: null, max: null })
  assert.equal(numStats([0.1, 0.2]).sum, 0.3, 'niente rumore in virgola mobile')
  assert.deepEqual(aggregate('minmax', [5, 1, 3]), { min: 1, max: 5 })
  assert.equal(aggregate('sum', []), null)
  assert.equal(aggregate('count', []), 0)
})

test('anni, anno di riferimento e anno precedente con dati', () => {
  const ps = ['31/12/2023', '01/01/2024', '', '15/06/2024'].map((d, i) => ({ jobId: `j${i}`, values: { dec: d } }))
  assert.deepEqual(yearsOf(ps, 'dec', TODAY), [
    { year: 2023, count: 1, inProgress: false },
    { year: 2024, count: 2, inProgress: false },
    { year: null, count: 1, inProgress: false },
  ])
  assert.equal(yearOf(ps[0], 'dec'), 2023)
  assert.equal(yearOf(ps[0], null), null)
  assert.equal(referenceYear([2023, 2024, 2026], TODAY), 2024)
  assert.equal(yearsOf([{ values: { dec: '01/01/2026' } }], 'dec', TODAY)[0].inProgress, true)
  assert.equal(referenceYear([2026], TODAY), 2026)
  assert.equal(referenceYear([], TODAY), null)
  // anni con buchi: l'anno A di default è il più recente CON DATI prima del riferimento
  assert.equal(previousYear([2021, 2022, 2024, 2026], 2024), 2022)
  assert.equal(previousYear([2024], 2024), null)
})

test('delta', () => {
  assert.ok(Math.abs(delta(5180, 5930).pct - 0.1448) < 0.0001)
  assert.equal(delta(5180, 5930).abs, 750)
  assert.equal(delta(0, 5).pct, null)
  assert.equal(delta(0, 5).abs, 5)
  assert.equal(delta(null, 5).abs, null)
  assert.equal(delta(null, 5).pct, null)
})

test('valueCounts: chiave normalizzata, grafia più frequente, parità alfabetica', () => {
  const vc = valueCounts(['DAS', 'das ', 'D.A.S.', 'ARAG', '', 'Allianz', 'Generali', 'Zurich'], 2)
  assert.deepEqual(vc.items, [{ key: 'DAS', label: 'DAS', count: 3 }, { key: 'ALLIANZ', label: 'Allianz', count: 1 }])
  assert.deepEqual(vc.other, { count: 3, distinct: 3 })
  assert.equal(vc.empty, 1)
  assert.equal(vc.distinct, 5)
  assert.equal(valueCounts(['das', 'DAS', 'DAS'], 5).items[0].label, 'DAS', 'la grafia più frequente')
})

test('verifiche: risposte canonizzate, altre, vuoti, % sui non vuoti', () => {
  const tut = FIELDS.find((f) => f.id === 'tut')
  const values = ['SI', 'No', 'sì', '', 'boh']
  const out = summarize({ fields: [tut], policies: values.map((v, i) => ({ jobId: `j${i}`, name: `P${i}`, values: { tut: v } })), today: TODAY })
  const st = out.fieldStats.tut
  assert.deepEqual(st.answers, [{ answer: 'Sì', count: 2, pct: 0.5 }, { answer: 'No', count: 1, pct: 0.25 }])
  assert.equal(st.other, 1)
  assert.equal(st.empty, 1)
})

test('completezza: denominatore = campi × polizze (Regola 4), campi più vuoti', () => {
  const fields = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const ps = [{ values: { a: '1', b: '2' } }, { values: { a: '3', c: 'n/d', b: 'x2' } }]
  const c = completeness(fields, ps)
  assert.equal(c.filled, 4)
  assert.equal(c.total, 6)
  assert.deepEqual(c.mostEmpty, [{ fieldId: 'c', empty: 2, of: 2 }])
  const c2 = completeness(fields, [{ values: {} }, { values: { b: '1' } }])
  assert.deepEqual(c2.mostEmpty.map((x) => x.fieldId), ['a', 'c', 'b'], 'vuoti decrescenti, a parità ordine del profilo')
})

test('fasce: bande tonde, valori, casi degeneri', () => {
  const b = buckets([100, 150, 220, 250, 310, 330, 360, 420, 480, 900])
  assert.equal(b.mode, 'bands')
  assert.deepEqual(b.items.map((x) => [x.from, x.to]), [[0, 200], [200, 400], [400, 600], [600, 800], [800, 1000]])
  assert.deepEqual(b.items.map((x) => x.count), [2, 5, 2, 0, 1])
  assert.ok(b.items.every((x) => x.open === null))
  const v = buckets([10000, 25000, 25000, 50000], 1)
  assert.equal(v.mode, 'values')
  assert.deepEqual(v.items.map((x) => [x.from, x.count]), [[10000, 1], [25000, 2], [50000, 1]])
  assert.equal(v.empty, 1)
  // 93 polizze alla stessa tariffa: 5° e 95° percentile coincidono → minimo e massimo
  const flat = [...Array(93).fill(250), 100, 120, 150, 300, 400, 500, 600]
  const d = buckets(flat)
  assert.equal(d.mode, 'bands')
  assert.equal(d.items.reduce((a, x) => a + x.count, 0), 100)
  assert.ok(d.items.every((x) => Number.isFinite(x.count) && (x.from == null || Number.isFinite(x.from))))
  assert.ok(d.items.length <= 10)
  assert.equal(buckets(Array(20).fill(250)).mode, 'values')
  // fascia aperta sopra se il massimo arriva all'ultimo bordo
  const o = buckets([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 1000])
  assert.equal(o.items[o.items.length - 1].open, 'above')
})

test('scadenze entro N giorni (estremi inclusi), in ordine di data', () => {
  const dates = ['26/12/2026', '30/09/2026', '25/12/2026', '01/09/2026', '24/12/2026', '']
  const ps = dates.map((d, i) => ({ jobId: `j${i}`, name: `P${i}`, values: { sca: d } }))
  assert.deepEqual(dueWithin(ps, 'sca', TODAY, 90), [
    { jobId: 'j1', date: '30/09/2026', days: 4 },
    { jobId: 'j4', date: '24/12/2026', days: 89 },
    { jobId: 'j2', date: '25/12/2026', days: 90 },
  ])
  assert.deepEqual(dueWithin(ps, null, TODAY, 90), [])
})

// ─── Confronto ───────────────────────────────────────────────────────────────

test('confronto: abbinamento a passate, nuove, non rinnovate, cambi', () => {
  const P = (jobId, year, num, iva, cmp, lor, mas) => ({ jobId, name: jobId, year, values: { num, iva, cmp, lor, mas } })
  const policies = [
    P('X1a', 2024, 'X1', '01', 'DAS', '700,00', '25.000,00'),
    P('X2a', 2024, 'X2', '02', 'Generali', '400,00', '10.000,00'),
    P('X3a', 2024, 'X3', '03', 'ARAG', '300,00', '10.000,00'),
    P('X1b', 2025, 'X1', '-', 'DAS', '760,00', '50.000,00'),
    P('Y2b', 2025, 'Y2', '02', 'DAS', '410,00', '10.000,00'),
    P('Z9b', 2025, 'Z9', '09', 'ARAG', '500,00', '25.000,00'),
  ]
  const prefs = { matchFieldIds: ['num', 'iva'], highlights: [{ fieldId: 'lor', op: 'sum' }, { fieldId: 'mas', op: 'avg' }], groupFieldId: 'cmp' }
  const c = compareYears({ fields: FIELDS, policies, prefs, yearA: 2024, yearB: 2025, today: TODAY })
  assert.equal(c.yearA, 2024)
  assert.equal(c.yearB, 2025)
  assert.deepEqual(c.continuity, { renewed: 2, added: 1, lost: 1, matchedBy: { num: 1, iva: 1 } })
  const renewed = c.rows.filter((r) => r.kind === 'renewed')
  assert.deepEqual(renewed.map((r) => [r.jobA, r.jobB, r.matchedBy]), [['X1a', 'X1b', 'num'], ['X2a', 'Y2b', 'iva']], 'per |differenza| decrescente')
  assert.equal(renewed[0].amounts[0].diff, 60)
  assert.deepEqual(renewed[0].changed, ['mas'])
  assert.deepEqual(renewed[1].changed, ['cmp'])
  assert.deepEqual(renewed[1].group, { a: 'Generali', b: 'DAS', changed: true })
  assert.deepEqual(c.rows.filter((r) => r.kind !== 'renewed').map((r) => [r.kind, r.jobA || r.jobB]), [['added', 'Z9b'], ['lost', 'X3a']])
  assert.deepEqual(c.cards[0], { fieldId: null, op: 'count', a: 3, b: 3, delta: { a: 3, b: 3, abs: 0, pct: 0 } })
  assert.equal(c.cards[1].a, 1400)
  assert.equal(c.cards[1].b, 1670)
  assert.equal(compareYears({ fields: FIELDS, policies, prefs, yearA: 2025, yearB: 2025, today: TODAY }).error, 'same-year')
  assert.equal(compareYears({ fields: FIELDS, policies: policies.slice(0, 3), prefs, today: TODAY }).error, 'need-two-years')
  // @dossier: abbina per nome della cartella
  const byDossier = compareYears({ fields: FIELDS, policies: [P('Via Verdi', 2024, '', '', 'DAS', '1', '1'), P('via verdi', 2025, '', '', 'DAS', '2', '1')], prefs: { ...prefs, matchFieldIds: [DOSSIER_KEY] }, today: TODAY })
  assert.equal(byDossier.continuity.renewed, 1)
})

test('confronto: A di default = anno più recente con dati prima di B (anni con buchi)', () => {
  const ps = [2022, 2024, 2026].map((y, i) => ({ jobId: `j${i}`, name: `P${i}`, values: { dec: `01/01/${y}` } }))
  const c = compareYears({ fields: FIELDS, policies: ps, prefs: { matchFieldIds: ['num'] }, today: TODAY, yearFieldId: 'dec' })
  assert.equal(c.yearB, 2024)
  assert.equal(c.yearA, 2022)
})

// ─── Preferenze ──────────────────────────────────────────────────────────────

test('defaultPrefs: calcoli, campi in evidenza, raggruppa per, abbinamento, date', () => {
  const ps = portfolio()
  const d = defaultPrefs(FIELDS, ps, 'dec')
  assert.deepEqual(d.ops, { mas: ['avg'], fr: ['avg'], imp: ['sum'], int: ['sum'], tax: ['sum'], lor: ['sum'], tas: ['avg'] })
  // 3 importi non strutturali (più valori NON NULLI: «Interessi» sempre 0,00 resta fuori) + 1 limite in media
  assert.deepEqual(d.highlights, [
    { fieldId: 'imp', op: 'sum' }, { fieldId: 'tax', op: 'sum' }, { fieldId: 'lor', op: 'sum' }, { fieldId: 'mas', op: 'avg' },
  ])
  assert.equal(d.groupFieldId, 'fra', 'meno valori distinti (2) tra i testi non «per polizza»')
  assert.equal(d.distributionFieldId, 'mas', 'prima i limiti/condizioni valorizzati in almeno metà delle polizze')
  assert.deepEqual(d.matchFieldIds, ['num', 'iva'])
  assert.equal(d.dueDays, 90)
  assert.equal(d.tableRows, 'amountsCounts')
  assert.equal(defaultYearFieldId(FIELDS), 'dec')
  assert.equal(defaultDueFieldId(FIELDS, ps, 'dec'), 'sca')
  assert.equal(defaultDueFieldId([FIELDS[4]], ps, 'dec'), null)
  const noIds = defaultPrefs(FIELDS.filter((f) => f.id !== 'num' && f.id !== 'iva'), ps, 'dec')
  assert.deepEqual(noIds.matchFieldIds, [DOSSIER_KEY])
  // senza limiti/condizioni: 4 importi periodici
  const onlyPremi = defaultPrefs(FIELDS.filter((f) => !['mas', 'fr'].includes(f.id)), ps, 'dec')
  assert.equal(onlyPremi.highlights.length, 4)
  assert.ok(onlyPremi.highlights.every((h) => h.op === 'sum'))
})

test('defaultPrefs sul profilo reale Tutela Legale 3: premi in somma, massimale in media', () => {
  const tl = realProfile('Tutela Legale 3')
  const id = Object.fromEntries(tl.fields.map((f) => [f.label, f.id]))
  const ps = portfolio().map((p) => ({
    ...p,
    values: {
      [id['Decorrenza']]: p.values.dec,
      [id['Compagnia']]: p.values.cmp,
      [id['Massimale per sinistro tutela legale']]: p.values.mas,
      [id['Franchigia generica o minima']]: p.values.fr,
      [id['Premio imponibile tutela legale']]: p.values.imp,
      [id['Interessi di frazionamento']]: p.values.int,
      [id['Diritti']]: p.values.int,
      [id['Imposte']]: p.values.tax,
      [id['Premio lordo totale tutela legale']]: p.values.lor,
    },
  }))
  const d = defaultPrefs(tl.fields, ps, id['Decorrenza'])
  const label = (fid) => tl.fields.find((f) => f.id === fid).label
  assert.deepEqual(d.highlights.map((h) => `${label(h.fieldId)}:${h.op}`), [
    'Premio imponibile tutela legale:sum', 'Imposte:sum', 'Premio lordo totale tutela legale:sum', 'Massimale per sinistro tutela legale:avg',
  ])
})

test('importo con soli valori non numerici: si mostra come testo, fuori dai default', () => {
  const per = { id: 'per', label: 'Frazionamento', description: 'Periodicità di pagamento del premio: annuale, semestrale, trimestrale' }
  const lor = FIELDS.find((f) => f.id === 'lor')
  const ps = ['annuale', 'semestrale', 'annuale'].map((v, i) => ({ jobId: `j${i}`, name: `P${i}`, values: { per: v, lor: '100,00' } }))
  const out = summarize({ fields: [per, lor], policies: ps, today: TODAY })
  const f = out.fields.find((x) => x.id === 'per')
  assert.equal(f.kind, 'amount')
  assert.equal(f.textLike, true)
  assert.equal(f.group, 'text')
  assert.ok(!('per' in out.prefs.ops))
  assert.ok(!out.prefs.highlights.some((h) => h.fieldId === 'per'))
  assert.equal(out.prefs.distributionFieldId, 'lor')
  assert.deepEqual(out.fieldStats.per.values.map((v) => [v.label, v.count]), [['annuale', 2], ['semestrale', 1]])
  assert.equal(out.fieldStats.per.textLike, true)
})

test('sanitizePrefs e mergePrefs', () => {
  const { prefs, errors } = sanitizePrefs({
    ops: { lor: ['sum', 'avg'], cmp: ['sum'], zzz: ['sum'], mas: ['bogus'], tas: ['sum'], fr: [] },
    highlights: [{ fieldId: 'cmp', op: 'sum' }, { fieldId: 'lor', op: 'sum' }, { fieldId: 'lor', op: 'sum' }, { fieldId: 'tas', op: 'avg' }],
    groupFieldId: 'lor',
    distributionFieldId: null,
    dueDays: 0,
    matchFieldIds: ['num', DOSSIER_KEY, 'lor'],
    tableRows: 'all',
    foo: 1,
  }, FIELDS)
  assert.deepEqual(prefs, {
    ops: { lor: ['sum', 'avg'] },
    highlights: [{ fieldId: 'lor', op: 'sum' }, { fieldId: 'tas', op: 'avg' }],
    distributionFieldId: null,
    matchFieldIds: ['num', DOSSIER_KEY],
    tableRows: 'all',
  })
  const reasons = errors.map((e) => `${e.key}:${e.reason}${e.fieldId ? ':' + e.fieldId : ''}`).sort()
  assert.deepEqual(reasons, [
    'dueDays:out-of-range', 'foo:unknown-key', 'groupFieldId:bad-kind:lor', 'highlights:duplicate:lor', 'highlights:not-numeric:cmp',
    'matchFieldIds:bad-kind:lor', 'ops:bad-op:mas', 'ops:bad-op:tas', 'ops:empty:fr', 'ops:not-numeric:cmp', 'ops:unknown-field:zzz',
  ].sort())
  assert.deepEqual(sanitizePrefs(null, FIELDS), { prefs: {}, errors: [] })
  assert.equal(sanitizePrefs([], FIELDS).errors[0].reason, 'not-object')
  // merge: ops campo per campo, il resto voce per voce; errori → salvate invariate
  const m = mergePrefs({ ops: { lor: ['sum'] }, dueDays: 30 }, { ops: { mas: ['minmax'] }, dueDays: 60 }, FIELDS)
  assert.deepEqual(m, { prefs: { ops: { lor: ['sum'], mas: ['minmax'] }, dueDays: 60 }, errors: [] })
  const bad = mergePrefs({ dueDays: 30 }, { dueDays: 999 }, FIELDS)
  assert.deepEqual(bad.prefs, { dueDays: 30 })
  assert.equal(bad.errors.length, 1)
  assert.deepEqual(mergePrefs({ dueDays: 30 }, null, FIELDS), { prefs: {}, errors: [] })
  // effettive: la scelta «nessuno» (null) resta, il resto dai default
  const eff = effectivePrefs({ groupFieldId: null, ops: { lor: ['avg'] } }, FIELDS, portfolio(), 'dec')
  assert.equal(eff.groupFieldId, null)
  assert.deepEqual(eff.ops.lor, ['avg'])
  assert.deepEqual(eff.ops.imp, ['sum'])
})

test('indipendenza dalla label: stesso riepilogo con tutte le label sostituite', () => {
  const view = { yearA: 2023, yearB: 2025 }
  const a = summarize({ fields: FIELDS, policies: portfolio(), yearFieldId: 'dec', dueFieldId: 'sca', prefs: {}, today: TODAY, view })
  const b = summarize({ fields: FIELDS.map((f) => ({ ...f, label: 'X' })), policies: portfolio(), yearFieldId: 'dec', dueFieldId: 'sca', prefs: {}, today: TODAY, view })
  const strip = (o) => ({ ...o, fields: o.fields.map(({ label, ...r }) => r), removedFields: o.removedFields.map(({ label, ...r }) => r) }) // eslint-disable-line no-unused-vars
  assert.deepEqual(strip(a), strip(b))
  assert.deepEqual(defaultPrefs(FIELDS, portfolio(), 'dec'), defaultPrefs(FIELDS.map((f) => ({ ...f, label: 'Premio lordo' })), portfolio(), 'dec'))
})

// ─── Membri, chiavi, ammissione ──────────────────────────────────────────────

test('resolveMember: precedenza degli stati (live) e fotografia', () => {
  const run = { finished_at: 1790000000, field_values: { lor: '700,00' }, fields: [{ id: 'lor', label: 'Premio' }] }
  const job = (status, extra = {}) => ({ id: 'j', status, rolling_state: { lor: { valore: '760,00' } }, field_defs: [{ id: 'lor' }], updated_at: 1790001000, ...extra })
  const base = { mode: 'live', summaryKey: 'P1', jobKey: 'P1', runKey: 'P1' }
  const ok = resolveMember({ ...base, job: job('done'), lastDoneRun: run })
  assert.equal(ok.state, 'ok')
  assert.deepEqual(ok.values, { lor: '760,00' })
  assert.equal(ok.valuesAt, 1790001000)
  const stale = resolveMember({ ...base, job: job('running'), lastDoneRun: run })
  assert.equal(stale.state, 'stale')
  assert.deepEqual(stale.values, { lor: '700,00' })
  assert.equal(stale.valuesAt, 1790000000)
  for (const s of ['queued', 'matched', 'error', 'canceled']) assert.equal(resolveMember({ ...base, job: job(s), lastDoneRun: run }).state, 'stale', s)
  assert.deepEqual(pick(resolveMember({ ...base, job: job('running'), lastDoneRun: null })), ['excluded', 'notDone'])
  assert.deepEqual(pick(resolveMember({ ...base, jobKey: 'P2', job: job('done'), lastDoneRun: run })), ['excluded', 'otherProfile'])
  assert.deepEqual(pick(resolveMember({ ...base, jobKey: 'P2', runKey: 'P2', job: job('queued'), lastDoneRun: run })), ['excluded', 'otherProfile'])
  assert.equal(resolveMember({ ...base, job: null }).state, 'missing')
  // Non valido / Non pertinente / Da verificare: esclusi anche con una run 'done' vecchia
  assert.deepEqual(pick(resolveMember({ ...base, job: job('mismatch'), lastDoneRun: run, notValid: true })), ['excluded', 'notValid'])
  assert.deepEqual(pick(resolveMember({ ...base, job: job('mismatch'), lastDoneRun: run })), ['excluded', 'notPertinent'])
  assert.deepEqual(pick(resolveMember({ ...base, job: job('review'), lastDoneRun: run })), ['excluded', 'review'])
  // 'auto' in coda senza run: non «altro profilo», semplicemente non estratta
  assert.deepEqual(pick(resolveMember({ ...base, jobKey: null, job: job('queued', { profile_id: 'auto' }), lastDoneRun: null })), ['excluded', 'notDone'])
  assert.equal(resolveMember({ ...base, job: job('done'), forced: true }).forced, true)
  // fotografia: sempre i valori fotografati, qualunque sia lo stato del job
  const snap = resolveMember({ mode: 'snapshot', job: job('mismatch'), snapshotEntry: { values: { lor: '500,00' }, jobUpdatedAt: 5, forced: true } })
  assert.deepEqual([snap.state, snap.values, snap.valuesAt, snap.forced], ['ok', { lor: '500,00' }, 5, true])
  assert.equal(resolveMember({ mode: 'snapshot', job: null, snapshotEntry: null }).state, 'missing')
})
const pick = (m) => [m.state, m.reason]

test('memberWarnings: codici e motivi di esclusione', () => {
  const w = memberWarnings([
    { jobId: 'a', state: 'ok', forced: true },
    { jobId: 'b', state: 'stale' },
    { jobId: 'c', state: 'excluded', reason: 'notValid' },
    { jobId: 'd', state: 'excluded', reason: 'review' },
    { jobId: 'e', state: 'missing' },
    { jobId: 'f', state: 'excluded', reason: 'notValid', forced: true },
  ])
  assert.deepEqual(w, [
    { code: 'missing', jobIds: ['e'] },
    { code: 'stale', jobIds: ['b'] },
    { code: 'excluded', jobIds: ['c', 'd', 'f'], byReason: { notValid: ['c', 'f'], review: ['d'] } },
    { code: 'forced', jobIds: ['a'] },
  ])
})

test('policyName: come in Elaborazioni', () => {
  assert.deepEqual(policyName({ dossierName: 'LOTTO/PIZZAMIGLIO/Condomìni/Via Verdi 12', batchLabel: 'LOTTO', jobId: 'abcdef123456' }), { name: 'Via Verdi 12', path: 'PIZZAMIGLIO / Condomìni' })
  assert.deepEqual(policyName({ dossierName: '', scannedFiles: ['z.pdf', 'b.pdf', 'm.pdf'], jobId: 'abcdef123456' }), { name: 'b.pdf (+2)', path: '' })
  assert.deepEqual(policyName({ scannedFiles: ['solo.pdf'], jobId: 'abcdef123456' }), { name: 'solo.pdf', path: '' })
  assert.deepEqual(policyName({ jobId: 'abcdef123456' }), { name: 'abcdef12', path: '' })
})

const PROFILES = [
  { id: 'P1', name: 'Tutela Legale 3', fields: [{ id: 'a' }, { id: 'b' }, { id: 'c', enabled: false }] },
  { id: 'P2', name: 'RC', fields: [{ id: 'a' }, { id: 'd' }] },
]
const defs = (...ids) => ids.map((id) => ({ id, label: id.toUpperCase() }))

const kn = (k) => (k.error ? k : { key: k.key, name: k.name })

test('profileKeyOf: auto, profilo, singole, contenimento, hash', () => {
  assert.deepEqual(profileKeyOf({ profile_id: 'auto', status: 'queued', field_defs: defs('a', 'b') }, PROFILES), { error: 'auto-profile' })
  assert.deepEqual(kn(profileKeyOf({ profile_id: 'auto', status: 'done', field_defs: defs('b', 'a') }, PROFILES)), { key: 'P1', name: 'Tutela Legale 3' }, 'auto già estratto: dai campi')
  assert.deepEqual(profileKeyOf({ profile_id: 'P2', profile_name: null, status: 'done' }, PROFILES), { key: 'P2', name: 'RC', sig: null })
  assert.deepEqual(profileKeyOf({ profile_id: 'P9', profile_name: 'Vecchio', status: 'done' }, PROFILES), { key: 'P9', name: 'Vecchio', sig: null })
  assert.deepEqual(kn(profileKeyOf({ profile_id: null, status: 'done', field_defs: defs('a', 'b') }, PROFILES)), { key: 'P1', name: 'Tutela Legale 3' }, 'stessi campi abilitati')
  assert.deepEqual(kn(profileKeyOf({ profile_id: null, status: 'done', field_defs: defs('b') }, PROFILES)), { key: 'P1', name: 'Tutela Legale 3' }, 'singola fatta prima di un campo aggiunto: l\'unico profilo che la contiene')
  const amb = profileKeyOf({ profile_id: null, status: 'done', field_defs: defs('a') }, PROFILES)
  assert.match(amb.key, /^campi:[0-9a-f]{16}$/, 'id condivisi da più profili: mai mescolati, chiave dai campi')
  assert.equal(amb.name, null)
  assert.deepEqual(profileKeyOf({ field_defs: defs('x', 'y') }, PROFILES), profileKeyOf({ field_defs: defs('y', 'x') }, PROFILES), 'ordine indifferente')
  // una run: { profile_id, field_defs: run.fields, status: 'done' }
  assert.deepEqual(profileKeyOf({ profile_id: null, field_defs: defs('a', 'b'), status: 'done' }, PROFILES).key, 'P1')
})

test('checkEligible: ordine dei rifiuti, chiave maggioritaria, doppioni', () => {
  const values = { rolling_state: { a: { valore: '1' } } }
  const J = (id, extra) => ({ id, status: 'done', profile_id: 'P1', profile_name: 'Tutela Legale 3', dossier_name: `LOTTO/${id}`, batch_label: 'LOTTO', ...values, ...extra })
  const jobs = [
    J('j1'), J('j2'), J('j3', { profile_id: 'P2', profile_name: 'RC' }),
    J('j4', { status: 'mismatch', notValid: true }), J('j5', { status: 'running' }),
    J('j6', { rolling_state: { a: { valore: null } } }), J('j7', { source_job_id: 'j1' }),
  ]
  const hashesByJob = { j1: ['h1', 'h2'], j2: ['h2', 'h1'], j3: ['h3'] }
  const r = checkEligible({ requestedIds: ['j3', 'j1', 'j2', 'j4', 'j5', 'j6', 'j7', 'jX', 'j1'], jobs, profiles: PROFILES, hashesByJob })
  assert.equal(r.key, 'P1')
  assert.equal(r.name, 'Tutela Legale 3')
  assert.deepEqual(r.eligible, [{ jobId: 'j1', name: 'j1' }])
  assert.deepEqual(r.refused.map((x) => [x.jobId, x.reason, x.detail]), [
    ['j3', 'other-profile', 'RC'],
    ['j2', 'duplicate', 'j1'],
    ['j4', 'not-valid', undefined],
    ['j5', 'not-done', undefined],
    ['j6', 'no-values', undefined],
    ['j7', 'test-run', undefined],
    ['jX', 'not-found', undefined],
  ])
  // parità: vince la chiave del primo job nell'ordine della richiesta
  const tie = checkEligible({ requestedIds: ['j3', 'j1'], jobs, profiles: PROFILES })
  assert.equal(tie.key, 'P2')
  assert.deepEqual(tie.refused.map((x) => x.reason), ['other-profile'])
  // aggiunta a un riepilogo: già membri, doppioni di un membro (hash o duplicate_of)
  const more = [...jobs, J('j8', { duplicate_of: 'm1' }), J('j9')]
  const add = checkEligible({
    requestedIds: ['m1', 'j8', 'j9', 'j1', 'j3'], jobs: more, profiles: PROFILES, summaryKey: 'P1',
    members: [{ jobId: 'm1', name: 'Via Verdi 12' }], hashesByJob: { m1: ['h9'], j9: ['h9'], j1: ['h1'] },
  })
  assert.deepEqual(add.already, ['m1'])
  assert.deepEqual(add.eligible.map((x) => x.jobId), ['j1'])
  assert.deepEqual(add.refused.map((x) => [x.jobId, x.reason, x.detail]), [
    ['j8', 'duplicate', 'Via Verdi 12'], ['j9', 'duplicate', 'Via Verdi 12'], ['j3', 'other-profile', 'RC'],
  ])
  // un hash mancante (righe precedenti alla migrazione) non permette il confronto: niente falso doppione
  const noHash = checkEligible({ requestedIds: ['j1', 'j2'], jobs, profiles: PROFILES, hashesByJob: { j1: ['h1', null], j2: ['h1', null] } })
  assert.equal(noHash.eligible.length, 2)
})

test('sanitizeJobIds: stringhe brevi, niente doppioni, tetto', () => {
  assert.deepEqual(sanitizeJobIds(['a', 'b', 'a']), { ids: ['a', 'b'], error: null })
  assert.equal(sanitizeJobIds('a').error, 'not-array')
  assert.equal(sanitizeJobIds([]).error, 'empty')
  assert.equal(sanitizeJobIds(['a', 5]).error, 'bad-id')
  assert.equal(sanitizeJobIds(['x'.repeat(65)]).error, 'bad-id')
  assert.equal(sanitizeJobIds(['constructor', ' ']).error, 'bad-id')
  assert.equal(sanitizeJobIds(['a', 'b', 'c'], 2).error, 'too-many')
})

test('referenceFields e campi tolti dal profilo: N = profilo di riferimento', () => {
  const r = referenceFields([
    { fieldDefs: defs('a', 'b', 'c'), at: 5 },
    { fieldDefs: defs('a', 'b'), at: 10 },
    { fieldDefs: defs('a', 'd'), at: 1 },
  ])
  assert.deepEqual(r.fields.map((f) => f.id), ['a', 'b'])
  assert.deepEqual(r.removed.map((f) => f.id), ['c', 'd'])
  assert.deepEqual(referenceFields([]), { fields: [], removed: [] })
  const fields = [{ id: 'a', description: 'Premio lordo (es. 760,00)' }, { id: 'b', description: 'Nome della compagnia' }]
  const out = summarize({
    fields, removedFields: [{ id: 'c', label: 'C', description: 'Imposte (es. 140,00)' }],
    policies: [{ jobId: 'j1', name: 'x', values: { a: '10,00', c: '2,00' } }, { jobId: 'j2', name: 'y', values: { a: '20,00', b: 'DAS' } }],
    today: TODAY,
  })
  assert.equal(out.dashboard.completeness.total, 4, 'N = 2 campi del profilo di riferimento × 2 polizze')
  assert.equal(out.dashboard.completeness.filled, 3)
  assert.deepEqual(out.removedFields.map((f) => [f.id, f.group]), [['c', 'removed']])
  assert.equal(out.fieldStats.c.sum, 2)
  assert.ok(!out.table.groups.some((g) => g.rows.some((r2) => r2.fieldId === 'c')), 'i campi tolti non entrano nella Tabella')
})

test('buildSnapshot: ok e stale fotografati, Non valido fuori, gli altri conservano la voce vecchia', () => {
  const previous = { jobs: { c: { values: { a: 'old' } }, d: { values: { a: 'old-d' } } } }
  const { snapshot, dropped, keptOld } = buildSnapshot({
    takenAt: 100,
    fields: defs('a'),
    members: [
      { jobId: 'a', state: 'ok', values: { a: '10,00', b: '', c: '  ' }, valuesAt: 7, dossierName: 'L/x', batchId: 'B', batchLabel: 'L', scannedFiles: ['x.pdf'] },
      { jobId: 'b', state: 'stale', values: { a: '9,00' }, valuesAt: 6, forced: true },
      { jobId: 'c', state: 'excluded', reason: 'notValid' },
      { jobId: 'd', state: 'excluded', reason: 'notDone' },
      { jobId: 'e', state: 'missing' },
    ],
    previous,
  })
  assert.deepEqual(snapshot.jobs.a, { values: { a: '10,00' }, dossierName: 'L/x', batchId: 'B', batchLabel: 'L', scannedFiles: ['x.pdf'], jobUpdatedAt: 7, forced: false })
  assert.equal(snapshot.jobs.b.forced, true)
  assert.deepEqual(snapshot.jobs.d, previous.jobs.d)
  assert.ok(!('c' in snapshot.jobs), 'un membro ora Non valido non conserva la voce vecchia')
  assert.deepEqual(dropped, ['c', 'e'])
  assert.deepEqual(keptOld, ['d'])
  assert.deepEqual(snapshot.fieldDefs, [{ id: 'a', label: 'A', frozen: { kind: 'text' } }], 'classificazione congelata')
  assert.equal(snapshot.takenAt, 100)
})

// ─── summarize ───────────────────────────────────────────────────────────────

test('summarize: cruscotto, delta sull\'anno precedente con dati, gruppo con l\'operazione della prima carta', () => {
  const out = run()
  assert.deepEqual(out.view.years.map((y) => [y.year, y.count, y.inProgress]), [[2023, 3, false], [2025, 3, false], [2026, 1, true], [null, 1, false]])
  assert.equal(out.view.refYear, 2025)
  assert.equal(out.view.prevYear, 2023, 'il 2024 non ha polizze: si confronta col 2023')
  assert.equal(out.dashboard.total, 8)
  assert.equal(out.dashboard.focusYearCount, 3)
  const lor = out.dashboard.kpis.find((k) => k.fieldId === 'lor')
  assert.equal(lor.value, 720 + 860 + 410 + 760 + 890 + 705 + 1120)
  assert.deepEqual([lor.delta.a, lor.delta.b, lor.delta.yearA, lor.delta.yearB], [1990, 2355, 2023, 2025])
  const mas = out.dashboard.kpis.find((k) => k.fieldId === 'mas')
  assert.equal(mas.op, 'avg')
  assert.deepEqual(mas.range, { min: 10000, max: 50000 })
  assert.deepEqual(out.dashboard.byYear.bars.map((b) => [b.year, b.value, b.count, b.ref, b.inProgress]), [
    [2023, 1631, 3, false, false], [2025, 1931, 3, true, false], [2026, 918, 1, false, true],
  ])
  assert.equal(out.dashboard.group.fieldId, 'fra')
  assert.deepEqual(out.dashboard.group.rows.map((r) => [r.label, r.count, r.amount]), [['Annuale', 5, 3226], ['Semestrale', 2, 1254]])
  assert.equal(out.dashboard.group.empty.count, 1)
  // con la prima carta in media anche il gruppo è in media
  const avgFirst = run({ prefs: { highlights: [{ fieldId: 'mas', op: 'avg' }] } })
  assert.equal(avgFirst.dashboard.group.op, 'avg')
  assert.equal(avgFirst.dashboard.group.rows[0].amount, 35000)
  assert.deepEqual(out.dashboard.due.items.map((d) => [d.jobId, d.days, d.group, d.name]), [['b1', 35, 'Annuale', 'Condominio Via Verdi 12'], ['b2', 50, 'Annuale', 'Condominio Parco Nord']], 'b3 scade tra 96 giorni')
  assert.equal(out.dashboard.distribution.fieldId, 'mas')
  assert.equal(out.dashboard.distribution.mode, 'values')
  assert.equal(out.dashboard.completeness.total, FIELDS.length * 8)
})

test('summarize: tabella per anno (importi, condizioni, gruppo; tutti i campi con «all»)', () => {
  const out = run()
  const g = Object.fromEntries(out.table.groups.map((x) => [x.key, x]))
  assert.deepEqual(out.table.columns.map((c) => [c.key, c.ref, c.inProgress]), [['2023', false, false], ['2025', true, false], ['2026', false, true], ['none', false, false]])
  assert.deepEqual(out.table.deltaYears, { a: 2023, b: 2025 })
  const pol = g.portfolio.rows[0]
  assert.deepEqual(pol.cells, { 2023: 3, 2025: 3, 2026: 1, none: 1 })
  assert.equal(pol.total, 8)
  assert.equal(pol.delta.pct, 0)
  assert.deepEqual(g.amounts.rows.map((r) => `${r.fieldId}:${r.op}`), ['imp:sum', 'int:sum', 'tax:sum', 'lor:sum'])
  assert.deepEqual(g.conditions.rows.map((r) => `${r.fieldId}:${r.op}`), ['mas:avg', 'fr:avg'])
  assert.equal(g.amounts.rows.find((r) => r.fieldId === 'imp').strong, true, 'totale in grassetto sulla prima carta')
  assert.equal(g.conditions.rows[0].total, 32500, 'media dei massimali, compresa la polizza senza anno')
  assert.ok(Math.abs(g.conditions.rows[0].cells['2025'] - 100000 / 3) < 1e-6)
  assert.deepEqual(g.group.rows.map((r) => [r.key, r.label, r.total]), [['ANNUALE', 'Annuale', 5], ['SEMESTRALE', 'Semestrale', 2], [EMPTY_KEY, null, 1]])
  assert.ok(!g.rates && !g.checks)
  // più calcoli per lo stesso campo: righe consecutive (nel mockup Σ e ⌀ del premio)
  const two = run({ prefs: { ops: { lor: ['avg', 'sum'] }, tableRows: 'all' } })
  const g2 = Object.fromEntries(two.table.groups.map((x) => [x.key, x]))
  assert.deepEqual(g2.amounts.rows.filter((r) => r.fieldId === 'lor').map((r) => r.op), ['sum', 'avg'])
  assert.deepEqual(g2.rates.rows.map((r) => [r.fieldId, r.op, r.total]), [['tas', 'avg', 0.2725]])
  assert.deepEqual(g2.checks.rows.map((r) => [r.fieldId, r.label, r.cells['2025']]), [['tut', 'Sì', 2 / 3]])
  const onlyAmounts = run({ prefs: { tableRows: 'amounts' } })
  assert.deepEqual(onlyAmounts.table.groups.map((x) => x.key), ['portfolio', 'amounts', 'conditions'])
})

test('summarize: filtri anno e gruppo; «per polizza» calcolato su tutto l\'insieme', () => {
  const y = run({ view: { year: 2023 } })
  assert.equal(y.dashboard.total, 3)
  assert.equal(y.view.focusYear, 2023)
  assert.equal(y.view.prevYear, null)
  assert.equal(y.table.columns.length, 4, 'la Tabella tiene gli anni come colonne')
  assert.equal(y.table.columns.find((c) => c.ref).year, 2023)
  const none = run({ view: { year: 'none' } })
  assert.deepEqual(none.policies.map((p) => p.jobId), ['n1'])
  assert.equal(none.dashboard.kpis[0].delta, null)
  const g = run({ view: { group: 'SEMESTRALE' } })
  assert.deepEqual(g.policies.map((p) => p.jobId).sort(), ['a3', 'c1'])
  assert.deepEqual(g.table.groups.find((x) => x.key === 'portfolio').rows[0].cells, { 2023: 1, 2026: 1 })
  assert.deepEqual(g.view.groupValues.map((v) => [v.key, v.count]), [['ANNUALE', 5], ['SEMESTRALE', 2]], 'il menu dei valori ignora il filtro gruppo')
  // contraente: ripetuto nei rinnovi (Via Verdi 12 e Parco Nord nel 2023 e nel 2025) ma tutto
  // diverso DENTRO ogni anno → «per polizza», anche quando il filtro ne lascia 2
  assert.equal(run().fields.find((f) => f.id === 'con').group, 'identifier')
  assert.equal(run().fields.find((f) => f.id === 'cmp').group, 'text', 'la compagnia si ripete nello stesso anno')
  assert.equal(g.fields.find((f) => f.id === 'con').group, 'identifier')
  assert.equal(g.fields.find((f) => f.id === 'con').unique, true)
})

test('summarize: elenco ordinato solo per il campo aperto', () => {
  const out = run({ view: { field: 'lor' } })
  assert.deepEqual(out.fieldStats.lor.sorted.slice(0, 3), [{ jobId: 'c1', value: 1120 }, { jobId: 'b2', value: 890 }, { jobId: 'a2', value: 860 }])
  assert.equal(out.fieldStats.imp.sorted, undefined)
  assert.equal(run().view.field, 'imp', 'default: il primo campo in evidenza')
  assert.ok(Array.isArray(run().fieldStats.imp.sorted))
})

test('summarize: nella risposta i valori per polizza sono solo quelli «per polizza», salvo values: all', () => {
  const out = run()
  assert.deepEqual(Object.keys(out.policies.find((p) => p.jobId === 'b1').values).sort(), ['con', 'iva', 'num'])
  assert.equal(out.policies.find((p) => p.jobId === 'b1').groupLabel, 'Annuale')
  const full = run({ values: 'all' })
  assert.equal(full.policies.find((p) => p.jobId === 'b1').values.lor, '760,00')
})

test('summarize: stessa polizza due volte nello stesso anno → avviso samePolicy', () => {
  const ps = portfolio()
  ps.push({ ...ps[3], jobId: 'b1bis', name: 'Condominio Via Verdi 12 (copia)' })
  const out = summarize({ fields: FIELDS, policies: ps, yearFieldId: 'dec', today: TODAY })
  assert.deepEqual(out.warnings, [{ code: 'samePolicy', jobIds: ['b1', 'b1bis'], groups: [{ value: 'TL010', year: 2025, jobIds: ['b1', 'b1bis'] }] }])
  assert.deepEqual(run().warnings, [], 'stesso numero in anni diversi (TL002 2023 e 2025) è un rinnovo, non un doppione')
})

test('summarize: confronto di default (B = riferimento, A = anno precedente con dati)', () => {
  const out = run()
  assert.equal(out.compare.yearB, 2025)
  assert.equal(out.compare.yearA, 2023)
  assert.deepEqual(out.compare.continuity, { renewed: 2, added: 1, lost: 1, matchedBy: { num: 1, iva: 1 } })
  const verdi = out.compare.rows.find((r) => r.jobB === 'b1')
  assert.deepEqual([verdi.jobA, verdi.matchedBy, verdi.group], ['a1', 'iva', { a: 'Annuale', b: 'Annuale', changed: false }])
  assert.deepEqual(verdi.amounts.map((a) => [a.fieldId, a.diff]), [['imp', 33], ['tax', 7]])
  assert.equal(out.compare.cards.length, 4)
  assert.equal(out.compare.groupShift.fieldId, 'fra')
  assert.deepEqual(run({ view: { yearA: 2025, yearB: 2025 } }).compare.error, 'same-year')
  const empty = summarize({ fields: FIELDS, policies: [], yearFieldId: 'dec', today: TODAY })
  assert.equal(empty.compare.error, 'need-two-years')
  assert.equal(empty.dashboard.total, 0)
  assert.equal(empty.dashboard.completeness.pct, null)
})

// ─── Revisione 26/09/2026 ────────────────────────────────────────────────────

test('parseAmount: formato inglese riconosciuto, virgola ambigua non numerica', () => {
  assert.equal(parseAmount('1,234.56'), 1234.56, 'prima diventava 1,23456')
  assert.equal(parseAmount('€ 12,345.00'), 12345)
  assert.equal(parseAmount('1,234,567'), 1234567)
  assert.equal(parseAmount('1,234'), null, 'migliaia inglesi o tre decimali italiani: ambiguo')
  assert.equal(parseAmount('0,245'), 0.245, 'lo zero iniziale non è ambiguo')
  assert.equal(parseAmount('1.234,56'), 1234.56)
  assert.equal(parseAmount('49,05'), 49.05)
})

test('parseDate: una data che non esiste nel calendario non è una data', () => {
  assert.equal(parseDate('31/02/2025'), null)
  assert.equal(parseDate('dal 31/04/2025'), null)
  assert.equal(parseDate('29/02/2025'), null)
  assert.equal(parseDate('29/02/2024').str, '29/02/2024')
})

test('fotografia: la classificazione congelata non segue le descrizioni né il motore', () => {
  const lor = FIELDS.find((f) => f.id === 'lor')
  const frozen = freezeField(lor)
  assert.deepEqual(frozen.frozen, { kind: 'amount', unit: 'eur', structural: false })
  // la descrizione cambia (o il motore la legge diversamente): il campo congelato resta un importo
  const changed = { ...frozen, description: 'Nota libera del cliente (es. testo)', type: 'text' }
  assert.deepEqual(classifyField(changed), { kind: 'amount', unit: 'eur', structural: false })
  assert.equal(classifyField({ ...lor, description: 'Nota libera del cliente (es. testo)', type: 'text' }).kind, 'text')
  // risposte di una verifica congelate
  const tut = freezeField(FIELDS.find((f) => f.id === 'tut'))
  assert.deepEqual(tut.frozen.answers, ['Sì', 'No'])
  assert.equal(checkAnswer({ ...tut, description: '' }, 'SI'), 'Sì')
  // valori spazzatura in `frozen` ignorati
  assert.equal(frozenKind({ frozen: { kind: 'boh' } }), null)
  assert.deepEqual(freezeField(frozen).frozen, frozen.frozen, 'ricongelare non cambia niente')
})

test('profileKeyOf: chiave stabile delle singole (copia non attiva, campo tolto, firme ammesse)', () => {
  const P = { id: 'P', name: 'TL3', fields: defs('a', 'b', 'c') }
  const copy = { id: 'P2', name: 'TL3 copia', enabled: false, fields: defs('a', 'b', 'c') }
  const single = { profile_id: null, status: 'done', field_defs: defs('a', 'b', 'c') }
  assert.equal(profileKeyOf(single, [P, copy]).key, 'P', 'una copia NON attiva non rende ambiguo il confronto')
  const minus = { id: 'P', name: 'TL3', fields: defs('a', 'b') }
  const drift = profileKeyOf(single, [minus])
  assert.equal(drift.key, fieldSig(single.field_defs), 'campo tolto dal profilo: senza firme ammesse la chiave cambia')
  assert.equal(drift.sig, fieldSig(single.field_defs))
  const kept = profileKeyOf(single, [minus], { preferKey: 'P', acceptedSigs: [drift.sig] })
  assert.deepEqual(kn(kept), { key: 'P', name: 'TL3' }, 'firma ammessa nel riepilogo: resta del riepilogo')
  // due profili contengono la singola: vince quello del riepilogo
  const Q = { id: 'Q', name: 'Altro', fields: defs('a', 'b', 'c', 'z') }
  const R = { id: 'R', name: 'Altro 2', fields: defs('a', 'b', 'c', 'y') }
  assert.match(profileKeyOf(single, [Q, R]).key, /^campi:/)
  assert.equal(profileKeyOf(single, [Q, R], { preferKey: 'R' }).key, 'R')
  // checkEligible restituisce le firme delle singole ammesse
  const job = { id: 's1', status: 'done', profile_id: null, field_defs: defs('a', 'b', 'c'), rolling_state: { a: { valore: '1' } }, dossier_name: 'x' }
  const r = checkEligible({ requestedIds: ['s1'], jobs: [job], profiles: [minus], summaryKey: 'P', acceptedSigs: [drift.sig] })
  assert.deepEqual(r.eligible.map((e) => e.jobId), ['s1'])
  assert.deepEqual(r.sigs, [drift.sig])
})

test('referenceFields: una fonte senza descrizioni (run) non fa da riferimento se ce n\'è una descritta', () => {
  const bare = FIELDS.map(({ id, label }) => ({ id, label }))
  const ref = referenceFields([{ fieldDefs: bare, at: 200 }, { fieldDefs: FIELDS, at: 100 }])
  assert.equal(ref.fields.find((f) => f.id === 'lor').description, FIELDS.find((f) => f.id === 'lor').description)
  assert.deepEqual(referenceFields([{ fieldDefs: bare, at: 200 }]).fields.map((f) => f.id), bare.map((f) => f.id), 'senza altro, si usa')
})

test('copertura: una somma con premi vuoti non è un calo (delta «partial»), celle con n su polizze', () => {
  const ps = []
  for (let i = 0; i < 10; i++) ps.push({ jobId: `a${i}`, name: `A${i}`, values: { dec: '01/01/2024', lor: '1.000,00' } })
  for (let i = 0; i < 10; i++) ps.push({ jobId: `b${i}`, name: `B${i}`, values: { dec: '01/01/2025', lor: i < 6 ? '1.000,00' : '' } })
  const out = summarize({ fields: FIELDS, policies: ps, yearFieldId: 'dec', prefs: { highlights: [{ fieldId: 'lor', op: 'sum' }, { fieldId: 'lor', op: 'avg' }] }, today: TODAY, view: {} })
  const [sum, avg] = out.dashboard.kpis
  assert.equal(sum.delta.pct, -0.4)
  assert.equal(sum.delta.partial, true, 'somma con 4 premi vuoti nel 2025')
  assert.deepEqual(sum.delta.cov, { a: { n: 10, of: 10 }, b: { n: 6, of: 10 } })
  assert.equal(sum.empty, 4)
  assert.equal(sum.of, 20)
  assert.equal(avg.delta.pct, 0)
  assert.equal(avg.delta.partial, false, 'la media sui valori presenti resta confrontabile')
  const row = out.table.groups.find((g) => g.key === 'amounts').rows.find((r) => r.fieldId === 'lor' && r.op === 'sum')
  assert.deepEqual(row.cov, { 2024: { n: 10, of: 10 }, 2025: { n: 6, of: 10 } })
  assert.deepEqual(row.totalCov, { n: 16, of: 20 })
  assert.equal(row.delta.partial, true)
  assert.deepEqual(out.dashboard.byYear.bars.map((b) => [b.year, b.count, b.n]), [[2024, 10, 10], [2025, 10, 6]])
  const card = out.compare.cards.find((c) => c.fieldId === 'lor' && c.op === 'sum')
  assert.deepEqual(card.cov, { a: { n: 10, of: 10 }, b: { n: 6, of: 10 } })
  assert.equal(card.delta.partial, true)
  const fs = out.fieldStats.lor.byYear
  assert.deepEqual(fs.map((r) => [r.year, r.n, r.of]), [[2024, 10, 10], [2025, 6, 10]])
})

test('confronto: il gruppo cambia per chiave, non per grafia («DAS» → «D.A.S.» non è un cambio)', () => {
  const P = (jobId, year, cmp) => ({ jobId, name: jobId, year, values: { num: 'X1', cmp } })
  const c = compareYears({ fields: FIELDS, policies: [P('a', 2024, 'DAS'), P('b', 2025, 'D.A.S.')], prefs: { matchFieldIds: ['num'], groupFieldId: 'cmp' }, yearA: 2024, yearB: 2025, today: TODAY })
  assert.equal(c.rows[0].group.changed, false)
  assert.deepEqual(c.rows[0].changed, [])
})
