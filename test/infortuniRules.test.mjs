/**
 * CSA Adesioni Infortuni: regole pure (web/lib/infortuni/rules.js).
 * Numerazione IAH0015842/001…, scadenza proposta, controlli dei campi del BDX
 * e del questionario, premio dall'opzione, righe del BDX nell'ordine del file.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FIELDS, QUESTIONS, DEFAULT_FIRST_NUMBER, defaultConfig, withDefaults, optionOf,
  nextNumber, defaultScadenza, validateAdesione, normalizeAdesione, bdxRow,
  parseEuro, shortEuro, splitAddresses, docBaseName, configForRecord, todayRome,
  isCompany, holderName, expiryBucket, groupByExpiry, renewalDraft, cleanLogo, DEFAULT_SECTION_NAME,
} from '../web/lib/infortuni/rules.js'
import { decodeCf } from '../web/lib/rsm/rules.js'

// Codice fiscale valido di Mario Rossi, nato il 10/01/1980 a Milano: il
// carattere di controllo si cerca invece di scriverlo a mano.
const CF15 = 'RSSMRA80A10F205'
const CF = CF15 + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((c) => decodeCf(CF15 + c).checkOk)
const WRONG_CHECK = CF15 + (CF.endsWith('A') ? 'B' : 'A')

const config = defaultConfig()
const ok = () => ({
  nome: 'Mario', cognome: 'Rossi', data_nascita: '1980-01-10', codice_fiscale: CF,
  email: 'mario.rossi@example.com', targa: 'gb133dt', tipo_veicolo: 'Autovettura', marca: 'FIAT',
  modello: 'FIAT 500', data_adesione: '2026-11-15', data_scadenza: '2027-11-15', opzione: 'Premium',
  questionario: { q1: 'SI', q2: 'SI', q3: 'SI', q4: 'SI' },
})

test('i campi sono le colonne del BDX del cliente, nell\'ordine', () => {
  assert.deepEqual(FIELDS.map((f) => f.col), [
    'Polizza n°', 'Nome Cliente', 'Cognome Cliente', 'Data di nascita ', 'Codice Fiscale', 'MAIL / PEC CLIENTE',
    'Targa', 'Tipo Veicolo', 'Marca', 'Modello', 'Data Adesione / Effetto Copertura', 'Data scadenza copertura',
    'Opzione ', 'Premio Lordo alla firma', 'NOTE',
  ])
  assert.equal(QUESTIONS.length, 4)
})

test('numerazione IAH0015842/001 → /002 … /999 → /1000', () => {
  assert.equal(DEFAULT_FIRST_NUMBER, 'IAH0015842/001')
  assert.equal(nextNumber('IAH0015842/001'), 'IAH0015842/002')
  assert.equal(nextNumber('IAH0015842/009'), 'IAH0015842/010')
  assert.equal(nextNumber('IAH0015842/999'), 'IAH0015842/1000')
})

test('opzioni e premi della tabella «Garanzie e massimali»', () => {
  assert.deepEqual(config.options.map((o) => [o.name, o.premio, o.imposte, o.speseMediche]), [
    ['Base', '45,00', '5,00', '1.000'], ['Premium', '60,00', '6,67', '2.500'], ['Top', '100,00', '11,11', '3.500'],
  ])
  assert.equal(optionOf(config, 'TOP').morte, '100.000')
  assert.equal(shortEuro('100,00'), '100')
  assert.equal(parseEuro('1.000,50'), 1000.5)
})

test('scadenza proposta un anno dopo, anche dal 29 febbraio', () => {
  assert.equal(defaultScadenza('2026-11-15'), '2027-11-15')
  assert.equal(defaultScadenza('2028-02-29'), '2029-02-28')
  assert.equal(defaultScadenza(''), '')
})

test('adesione completa: valida, premio dall\'opzione, codici in maiuscolo', () => {
  const r = normalizeAdesione(ok(), config)
  assert.equal(r.premio, '60,00')
  assert.equal(r.opzione, 'premium')
  assert.equal(r.targa, 'GB133DT')
  const v = validateAdesione(r, config, 2026)
  assert.deepEqual(v.errors, {})
  assert.deepEqual(v.warnings, [])
  assert.equal(v.valid, true)
})

test('campi mancanti, email, date e opzione sbagliate bloccano', () => {
  const v = validateAdesione({ ...ok(), nome: '', email: 'mario@', data_scadenza: '2026-11-15', opzione: 'gold' }, config, 2026)
  assert.equal(v.valid, false)
  assert.ok(v.errors.nome && v.errors.email && v.errors.data_scadenza && v.errors.opzione)
  assert.ok(validateAdesione({ ...ok(), data_nascita: '2026-02-30' }, config, 2026).errors.data_nascita)
})

test('codice fiscale: formato e carattere di controllo bloccano, partita IVA accettata', () => {
  assert.match(validateAdesione({ ...ok(), codice_fiscale: 'XXXXXXXXXX' }, config, 2026).errors.codice_fiscale, /non valido/)
  assert.match(validateAdesione({ ...ok(), codice_fiscale: WRONG_CHECK }, config, 2026).errors.codice_fiscale, /controllo/)
  assert.equal(validateAdesione({ ...ok(), codice_fiscale: '01234567890' }, config, 2026).valid, true)
})

test('nome o nascita che non tornano col codice fiscale: avviso, non blocco', () => {
  const v = validateAdesione({ ...ok(), nome: 'Luigi', data_nascita: '1980-01-11' }, config, 2026)
  assert.equal(v.valid, true)
  assert.equal(v.warnings.length, 2)
})

test('questionario: 4 risposte obbligatorie; un NO è un avviso', () => {
  const miss = validateAdesione({ ...ok(), questionario: { q1: 'SI' } }, config, 2026)
  assert.deepEqual(Object.keys(miss.errors).sort(), ['questionario.q2', 'questionario.q3', 'questionario.q4'])
  const no = validateAdesione({ ...ok(), questionario: { q1: 'SI', q2: 'SI', q3: 'NO', q4: 'SI' } }, config, 2026)
  assert.equal(no.valid, true)
  assert.match(no.warnings[0], /NO/)
})

test('riga del BDX: date vere, nome dell\'opzione, premio numerico', () => {
  const r = { ...normalizeAdesione(ok(), config), numero: 'IAH0015842/001' }
  const row = bdxRow(r, config)
  assert.equal(row.length, FIELDS.length)
  assert.equal(row[0], 'IAH0015842/001')
  assert.ok(row[3] instanceof Date && row[3].toISOString().startsWith('1980-01-10'))
  assert.equal(row[12], 'Premium')
  assert.equal(row[13], 60)
  assert.equal(row[14], null)
})

test('configurazione salvata completata coi default; indirizzi e nomi file', () => {
  const c = withDefaults({ mailTo: 'a@x.it', options: [{ name: 'Base', premio: '50,00' }] })
  assert.equal(c.polizzaCollettiva, 'IAH0015716')
  assert.equal(c.options.length, 1)
  assert.equal(c.options[0].key, 'base')
  assert.equal(c.options[0].premio, '50,00')
  assert.deepEqual(splitAddresses('a@x.it; b@y.it,  nonvalido, c@z.it'), ['a@x.it', 'b@y.it', 'c@z.it'])
  assert.equal(docBaseName({ numero: 'IAH0015842/001', cognome: "D'Amico", nome: 'Anna' }), 'IAH0015842_001_D_Amico_Anna')
})

test('interruttori dei punti da confermare: default e persistenza nella configurazione', () => {
  const d = defaultConfig()
  assert.equal(d.showRagioneSociale, false)
  assert.equal(d.showFranchigiaSpese, true)
  assert.equal(d.questionarioNumero, true)
  const c = withDefaults({ showRagioneSociale: true, questionarioNumero: false })
  assert.equal(c.showRagioneSociale, true)
  assert.equal(c.showFranchigiaSpese, true)
  assert.equal(c.questionarioNumero, false)
})

test('tariffa fissata all\'adesione: le tariffe nuove non cambiano premio e BDX delle vecchie', () => {
  const r = normalizeAdesione(ok(), config)
  assert.equal(r.tariffa.options.find((o) => o.key === 'premium').premio, '60,00')
  const nuova = withDefaults({ options: config.options.map((o) => ({ ...o, premio: o.key === 'premium' ? '70,00' : o.premio })) })
  // correzione dopo il cambio tariffa: premio e opzioni restano quelli dell'adesione
  const corretta = normalizeAdesione({ ...r, nome: 'Mario' }, nuova)
  assert.equal(corretta.premio, '60,00')
  assert.equal(bdxRow({ ...corretta, numero: 'X/1' }, nuova)[13], 60)
  assert.equal(configForRecord(nuova, corretta).options.find((o) => o.key === 'premium').premio, '60,00')
  // nuova adesione (senza tariffa): quella attuale
  assert.equal(normalizeAdesione({ ...ok(), tariffa: undefined }, nuova).premio, '70,00')
  // opzione tolta dalle Impostazioni: la vecchia adesione resta valida
  const senzaTop = withDefaults({ options: config.options.filter((o) => o.key !== 'top') })
  const top = normalizeAdesione({ ...ok(), opzione: 'top' }, config)
  assert.equal(validateAdesione(top, senzaTop, 2026).valid, true)
  // record di prima (senza tariffa): configurazione attuale
  assert.equal(configForRecord(nuova, { opzione: 'premium' }), nuova)
})

test('data del file BDX in ora italiana', () => {
  assert.equal(todayRome(new Date('2026-11-08T23:30:00Z')), '2026-11-09')
  assert.equal(todayRome(new Date('2026-07-01T10:00:00Z')), '2026-07-01')
})

test('azienda (ragione sociale compilata): nome, cognome e data di nascita facoltativi', () => {
  const on = { ...config, showRagioneSociale: true }
  const company = { ...ok(), nome: '', cognome: '', data_nascita: '', codice_fiscale: '02837290341', ragione_sociale: 'Rafmax Srl' }
  const v = validateAdesione(normalizeAdesione(company, on), on)
  assert.equal(v.valid, true, JSON.stringify(v.errors))
  assert.equal(isCompany(company, on), true)
  // Campo spento nelle Impostazioni: la ragione sociale non conta, servono i dati della persona.
  const off = validateAdesione(normalizeAdesione(company, config), config)
  assert.deepEqual(Object.keys(off.errors).sort(), ['cognome', 'data_nascita', 'nome'])
  // Ragione sociale vuota: persona, campi obbligatori.
  const empty = validateAdesione(normalizeAdesione({ ...company, ragione_sociale: '  ' }, on), on)
  assert.deepEqual(Object.keys(empty.errors).sort(), ['cognome', 'data_nascita', 'nome'])
  // Azienda con codice fiscale di persona e senza nome: nessun avviso sul nome.
  const cfPerson = validateAdesione(normalizeAdesione({ ...company, codice_fiscale: CF }, on), on)
  assert.equal(cfPerson.valid, true)
  assert.deepEqual(cfPerson.warnings, [])
  // Data di nascita scritta: si controlla ancora.
  assert.equal(validateAdesione(normalizeAdesione({ ...company, data_nascita: '2030-01-01' }, on), on).errors.data_nascita, 'La data di nascita deve essere prima dell\'adesione')
  assert.equal(holderName(company), 'Rafmax Srl')
  assert.equal(holderName(ok()), 'Rossi Mario')
  assert.equal(docBaseName({ ...company, numero: 'IAH0015842/007' }), 'IAH0015842_007_Rafmax_Srl')
})

test('BDX di un\'azienda: ragione sociale nella colonna Cognome Cliente (interruttore)', () => {
  const on = { ...config, showRagioneSociale: true }
  const company = normalizeAdesione({ ...ok(), nome: '', cognome: '', data_nascita: '', codice_fiscale: '02837290341', ragione_sociale: 'Rafmax Srl' }, on)
  const iCognome = FIELDS.findIndex((f) => f.id === 'cognome')
  const iNome = FIELDS.findIndex((f) => f.id === 'nome')
  assert.equal(bdxRow(company, on)[iCognome], 'Rafmax Srl')
  assert.equal(bdxRow(company, on)[iNome], null)
  assert.equal(bdxRow(company, { ...on, bdxRagioneInCognome: false })[iCognome], null)
  // Con nome e cognome compilati restano quelli.
  assert.equal(bdxRow(normalizeAdesione({ ...ok(), ragione_sociale: 'Rafmax Srl' }, on), on)[iCognome], 'Rossi')
})

test('nome della sezione e logo: default, valori salvati, immagini non valide scartate', () => {
  assert.equal(defaultConfig().sectionName, 'CSA Adesioni Infortuni conducente')
  assert.equal(withDefaults({ sectionName: '  ' }).sectionName, DEFAULT_SECTION_NAME)
  assert.equal(withDefaults({ sectionName: ' Infortuni CSA ' }).sectionName, 'Infortuni CSA')
  const png = 'data:image/png;base64,iVBORw0KGgo='
  assert.equal(withDefaults({ logo: png }).logo, png)
  assert.equal(cleanLogo('data:image/svg+xml;base64,PHN2Zz4='), '')
  assert.equal(cleanLogo('javascript:alert(1)'), '')
  assert.equal(cleanLogo('data:image/png;base64,' + 'A'.repeat(1_500_000)), '')
  assert.equal(defaultConfig().logoQuestionario, true)
  assert.equal(defaultConfig().logoCertificato, false)
})

test('scadenze: mese scorso, questo mese, mese prossimo; rinnovate col numero nuovo', () => {
  assert.equal(expiryBucket('2026-10-31', '2026-11-20'), 'past')
  assert.equal(expiryBucket('2026-11-01', '2026-11-20'), 'current')
  assert.equal(expiryBucket('2026-12-31', '2026-11-20'), 'next')
  assert.equal(expiryBucket('2027-01-01', '2026-11-20'), null)
  assert.equal(expiryBucket('2026-01-15', '2026-01-02'), 'current')
  assert.equal(expiryBucket('2025-12-15', '2026-01-02'), 'past')
  assert.equal(expiryBucket('', '2026-11-20'), null)
  const rows = [
    { id: 'a', numero: 'IAH0015842/002', data_scadenza: '2026-11-30', data: {} },
    { id: 'b', numero: 'IAH0015842/001', data_scadenza: '2026-11-05', data: {} },
    { id: 'c', numero: 'IAH0015842/010', data_scadenza: '2027-11-05', data: { rinnovo_di: 'b' } },
  ]
  const g = groupByExpiry(rows, '2026-11-20')
  assert.deepEqual(g.current.map((r) => [r.id, r.renewedBy]), [['b', 'IAH0015842/010'], ['a', null]])
  assert.deepEqual(g.past, [])
})

test('bozza del rinnovo: stessi dati, copertura dalla vecchia scadenza, niente numero né tariffa', () => {
  const old = { ...normalizeAdesione(ok(), config), numero: 'IAH0015842/001', note: 'x' }
  const d = renewalDraft(old, 'id-1')
  assert.equal(d.numero, undefined)
  assert.equal(d.tariffa, undefined)
  assert.equal(d.note, undefined)
  assert.equal(d.data_adesione, '2027-11-15')
  assert.equal(d.data_scadenza, '2028-11-15')
  assert.equal(d.rinnovo_di, 'id-1')
  assert.deepEqual(d.questionario, old.questionario)
  assert.notEqual(d.questionario, old.questionario)
  const saved = normalizeAdesione(d, config)
  assert.equal(validateAdesione(saved, config).valid, true)
  assert.equal(saved.rinnovo_di, 'id-1')
})
