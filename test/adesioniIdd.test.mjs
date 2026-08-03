/**
 * Test del questionario IDD nel tracciato AXA (CSA Adesioni).
 *
 * Esegui:  node --test
 *
 * Copre il difetto segnalato: nel tracciato Excel le colonne CODICE RISPOSTA
 * arrivavano vuote. Le cause coperte qui sono tre:
 *  1. le risposte non erano obbligatorie → si salvava un'attivazione senza
 *     questionario e nessuno se ne accorgeva fino ad AXA;
 *  2. con più di 5 domande configurate le risposte in eccesso non avevano una
 *     colonna dove finire (le intestazioni canoniche ne prevedono 5, la legenda
 *     ne ammette 20);
 *  3. leggendo un flusso con le intestazioni scritte "CODICE DOMANDA1" le
 *     risposte già presenti venivano buttate via.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildTrackRow,
  flussoRowToRecord,
  validateRecord,
  missingIddAnswers,
  iddErrorKey,
} from '../web/lib/adesioni/recordMapper.js'
import {
  DEFAULT_FIELDS,
  DEFAULT_IDD,
  TRACCIATO_HEADERS,
  trackHeadersFor,
  iddPairCapacity,
  normHeader,
} from '../web/lib/adesioni/tracciato.js'

const ANSWERS = {
  INTERESSE_COPERTURA: 'S',
  INTERESSE_SPECIFICO: 'AF35',
  INTERESSE_SP_LEG: 'S',
  MASSIMALI_COERENTI: 'S',
  INFO_TECNICHE: 'S',
}

/** Record valido di attivazione (tutti i campi obbligatori compilati). */
function baseRecord(over = {}) {
  return {
    numero_polizza: '191025', lob: 'A', tipologia_polizza: 'C',
    codice_configurazione: '00003', identificativo: '000001', tipo_oggetto: '2',
    codice_fiscale: 'RSSMRA80A01H501U', cognome: 'Rossi', nome: 'Mario',
    indirizzo: 'Via Roma 1', cap: '20100', citta: 'Milano', provincia: 'MI',
    targa: 'AB123CD', marca: 'Fiat', modello: 'Panda', tipologia_veicolo: '1', peso: '1000',
    data_immatricolazione: '01/01/2020', data_inizio: '31/10/2025', data_fine: '31/10/2026',
    data_rendicontazione: '01/11/2025', tipo_movimento: 'A',
    idd: { ...ANSWERS },
    ...over,
  }
}

/** Valore di una colonna del tracciato per intestazione. */
function cell(row, headers, header) {
  const i = headers.findIndex((h) => normHeader(h) === normHeader(header))
  assert.notEqual(i, -1, `intestazione assente: ${header}`)
  return row[i]
}

test('le risposte del questionario finiscono nelle colonne CODICE RISPOSTA', () => {
  const row = buildTrackRow(baseRecord(), DEFAULT_FIELDS, DEFAULT_IDD, TRACCIATO_HEADERS)
  DEFAULT_IDD.forEach((q, i) => {
    assert.equal(cell(row, TRACCIATO_HEADERS, `CODICE DOMANDA ${i + 1}`), q.domanda)
    assert.equal(cell(row, TRACCIATO_HEADERS, `CODICE RISPOSTA ${i + 1}`), ANSWERS[q.domanda])
  })
})

test('per i movimenti M/E le risposte restano vuote ma le domande no', () => {
  for (const mov of ['M', 'E']) {
    const row = buildTrackRow(baseRecord({ tipo_movimento: mov }), DEFAULT_FIELDS, DEFAULT_IDD, TRACCIATO_HEADERS)
    assert.equal(cell(row, TRACCIATO_HEADERS, 'CODICE DOMANDA 1'), DEFAULT_IDD[0].domanda)
    assert.equal(cell(row, TRACCIATO_HEADERS, 'CODICE RISPOSTA 1'), '')
  }
})

test('le risposte con spazi ai bordi arrivano ripulite nel tracciato', () => {
  const rec = baseRecord({ idd: { ...ANSWERS, INTERESSE_COPERTURA: ' S ' } })
  const row = buildTrackRow(rec, DEFAULT_FIELDS, DEFAULT_IDD, TRACCIATO_HEADERS)
  assert.equal(cell(row, TRACCIATO_HEADERS, 'CODICE RISPOSTA 1'), 'S')
})

test('con più di 5 domande il tracciato cresce e nessuna risposta si perde', () => {
  const idd = [
    ...DEFAULT_IDD,
    { domanda: 'DOMANDA_EXTRA', label: 'Domanda aggiuntiva', options: [{ value: 'S', label: 'Sì' }] },
  ]
  const headers = trackHeadersFor(idd)
  assert.equal(iddPairCapacity(headers), 6)
  // La coppia aggiunta resta prima di TIPO MOVIMENTO, che chiude il tracciato.
  assert.equal(normHeader(headers[headers.length - 1]), 'TIPO MOVIMENTO')

  const rec = baseRecord({ idd: { ...ANSWERS, DOMANDA_EXTRA: 'S' } })
  const row = buildTrackRow(rec, DEFAULT_FIELDS, idd) // senza headers espliciti
  assert.equal(row.length, headers.length)
  assert.equal(cell(row, headers, 'CODICE DOMANDA 6'), 'DOMANDA_EXTRA')
  assert.equal(cell(row, headers, 'CODICE RISPOSTA 6'), 'S')
})

test('il questionario di default non allarga il tracciato canonico', () => {
  assert.deepEqual(trackHeadersFor(DEFAULT_IDD), TRACCIATO_HEADERS)
  assert.equal(iddPairCapacity(TRACCIATO_HEADERS), 5)
})

test('attivazione senza risposte: record non valido, una voce per domanda', () => {
  const rec = baseRecord({ idd: {} })
  assert.equal(missingIddAnswers(rec, DEFAULT_IDD).length, DEFAULT_IDD.length)
  const { valid, errors } = validateRecord(rec, DEFAULT_FIELDS, DEFAULT_IDD)
  assert.equal(valid, false)
  for (const q of DEFAULT_IDD) assert.equal(errors[iddErrorKey(q.domanda)], 'required')
})

test('risposta non prevista dalla domanda: errore select', () => {
  const rec = baseRecord({ idd: { ...ANSWERS, INTERESSE_SPECIFICO: 'XX' } })
  const { valid, errors } = validateRecord(rec, DEFAULT_FIELDS, DEFAULT_IDD)
  assert.equal(valid, false)
  assert.equal(errors[iddErrorKey('INTERESSE_SPECIFICO')], 'select')
})

test('attivazione completa: record valido', () => {
  const { valid, errors } = validateRecord(baseRecord(), DEFAULT_FIELDS, DEFAULT_IDD)
  assert.deepEqual(errors, {})
  assert.equal(valid, true)
})

test('per M/E il questionario non è obbligatorio', () => {
  for (const mov of ['M', 'E']) {
    const rec = baseRecord({ tipo_movimento: mov, idd: {} })
    assert.deepEqual(missingIddAnswers(rec, DEFAULT_IDD), [])
    assert.equal(validateRecord(rec, DEFAULT_FIELDS, DEFAULT_IDD).valid, true)
  }
})

test('senza questionario passato la validazione resta quella dei soli campi', () => {
  const { valid } = validateRecord(baseRecord({ idd: {} }), DEFAULT_FIELDS)
  assert.equal(valid, true)
})

test('il flusso in ingresso restituisce le risposte anche con altre grafie', () => {
  const row = {
    'CODICE DOMANDA1': 'INTERESSE_COPERTURA', 'CODICE RISPOSTA1': 'S',
    'CODICE_DOMANDA_2': 'INTERESSE_SPECIFICO', 'CODICE_RISPOSTA_2': 'AF35',
    'CODICE DOMANDA 3': 'INTERESSE_SP_LEG', 'CODICE RISPOSTA 3': 'N',
  }
  const rec = flussoRowToRecord(row, DEFAULT_FIELDS, DEFAULT_IDD)
  assert.equal(rec.idd.INTERESSE_COPERTURA, 'S')
  assert.equal(rec.idd.INTERESSE_SPECIFICO, 'AF35')
  assert.equal(rec.idd.INTERESSE_SP_LEG, 'N')
})

test('andata e ritorno tracciato → flusso → tracciato conserva le risposte', () => {
  const row = buildTrackRow(baseRecord(), DEFAULT_FIELDS, DEFAULT_IDD, TRACCIATO_HEADERS)
  const byHeader = {}
  TRACCIATO_HEADERS.forEach((h, i) => { byHeader[h] = row[i] })
  const back = flussoRowToRecord(byHeader, DEFAULT_FIELDS, DEFAULT_IDD)
  assert.deepEqual(back.idd, ANSWERS)
  assert.deepEqual(buildTrackRow(back, DEFAULT_FIELDS, DEFAULT_IDD, TRACCIATO_HEADERS), row)
})
