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
  parseEuro, shortEuro, splitAddresses, docBaseName,
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
