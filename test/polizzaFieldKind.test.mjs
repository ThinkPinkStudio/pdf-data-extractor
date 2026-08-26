/**
 * Test del modulo puro polizzaFieldKind.js: normalizzazione del `type` esplicito
 * e inferenza dal prefisso della description.
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FIELD_KINDS, kindFromType, inferKindFromDescription, fieldKind,
} from '../src/main/services/polizzaFieldKind.js'

// ─── kindFromType ─────────────────────────────────────────────────────────────

test('kindFromType: chiavi canoniche passano invariate', () => {
  for (const k of FIELD_KINDS) assert.equal(kindFromType(k), k, `"${k}" identità`)
  for (const k of FIELD_KINDS) assert.equal(kindFromType(k.toUpperCase()), k, `"${k.toUpperCase()}" case-insensitive`)
})

test('kindFromType: alias storici → chiave canonica', () => {
  assert.equal(kindFromType('date'), 'date')
  assert.equal(kindFromType('amount'), 'number')
  assert.equal(kindFromType('currency'), 'number')
  assert.equal(kindFromType('vat'), 'fiscal')
  assert.equal(kindFromType('P.IVA'), 'fiscal')
  assert.equal(kindFromType('rate'), 'percent')
  // L'opzione "auto" del select NON è una chiave: senza type il motore ricade
  // sul prefisso description. 'auto' come valore libero → text (default storico).
  assert.equal(kindFromType('auto'), 'text')
  // Stringhe senza senso → text (default storico)
  assert.equal(kindFromType(''), 'text')
  assert.equal(kindFromType(undefined), 'text')
  assert.equal(kindFromType(null), 'text')
})

// ─── inferKindFromDescription ─────────────────────────────────────────────────

test('inferKindFromDescription: prefissi concreti del profilo RC PROF MED V2', () => {
  assert.equal(inferKindFromDescription('NUMERO/IMPORTO (euro). Massimale…'), 'number')
  assert.equal(inferKindFromDescription('NUMERO/IMPORTO. Fatturato dichiarato…'), 'number')
  assert.equal(inferKindFromDescription('NUMERO/IMPORTO (euro). Franchigia base…'), 'number')
  assert.equal(inferKindFromDescription('NUMERO/IMPORTO (euro). Massimale della garanzia Tutela…'), 'number')
  assert.equal(inferKindFromDescription('NUMERO/IMPORTO (euro). Premio lordo…'), 'number')
  assert.equal(inferKindFromDescription('TESTO (elenco). Tutti i sottolimiti…'), 'enum')
  assert.equal(inferKindFromDescription('TESTO. Verifica se è presente la garanzia Tutela…'), 'text')
  assert.equal(inferKindFromDescription('TESTO (SÌ/NO). Tacito rinnovo…'), 'boolean')
  assert.equal(inferKindFromDescription('TESTO (SÌ/NO).'), 'boolean')
  assert.equal(inferKindFromDescription('SÌ/NO.'), 'boolean')
  assert.equal(inferKindFromDescription('PERCENTUALE. Tasso applicato…'), 'percent')
  assert.equal(inferKindFromDescription('DATA di decorrenza della polizza…'), 'date')
  assert.equal(inferKindFromDescription('CODICE FISCALE/P.IVA del contraente'), 'fiscal')
  assert.equal(inferKindFromDescription('FISCALE (codice fiscale o P.IVA)'), 'fiscal')
})

test('inferKindFromDescription: prefisso riconosciuto SOLO all\'inizio, non a metà', () => {
  // "numero" in mezzo alla frase NON è un prefisso (regola dell'ancoraggio)
  assert.equal(inferKindFromDescription('Massimale per sinistro, es. 4.000.000,00'), null)
  assert.equal(inferKindFromDescription('Il testo libero che contiene la parola numero'), null)
  assert.equal(inferKindFromDescription('Il premio è SÌ/NO in mezzo'), null)
  assert.equal(inferKindFromDescription(null), null)
  assert.equal(inferKindFromDescription(undefined), null)
  assert.equal(inferKindFromDescription(''), null)
})

// ─── fieldKind: type esplicito vince, altrimenti description ─────────────────

test('fieldKind: type esplicito vince sul prefisso della description', () => {
  assert.equal(fieldKind({ type: 'number', description: 'TESTO. Descrizione che dichiara testo' }), 'number')
  assert.equal(fieldKind({ type: 'date', description: 'NUMERO/IMPORTO.' }), 'date')
  assert.equal(fieldKind({ type: 'enum', description: 'SÌ/NO.' }), 'enum')
})

test('fieldKind: solo description (nessun type) → prefisso', () => {
  assert.equal(fieldKind({ description: 'NUMERO/IMPORTO (euro). Massimale' }), 'number')
  assert.equal(fieldKind({ description: 'TESTO (SÌ/NO).' }), 'boolean')
  assert.equal(fieldKind({ description: 'TESTO. Frazionamento di pagamento' }), 'text')
  assert.equal(fieldKind({ description: 'Data di decorrenza' }), 'date')
  assert.equal(fieldKind({ description: 'SÌ/NO.' }), 'boolean')
})

test('fieldKind: type vuoto e description senza prefisso → text', () => {
  // L'opzione "auto" del select salva type vuoto/assente: il motore ricade
  // sul prefisso description; senza prefisso → text (comportamento storico).
  assert.equal(fieldKind({ type: '', description: 'Massimale per sinistro, es. 4.000.000,00' }), 'text')
  assert.equal(fieldKind({ description: 'Premio lordo totale in euro' }), 'text')
  assert.equal(fieldKind({}), 'text')
  assert.equal(fieldKind(null), 'text')
  assert.equal(fieldKind(undefined), 'text')
  assert.equal(fieldKind({ id: 'x', label: 'Etichetta' }), 'text')
})

test('fieldKind: type presente ma non normalizzabile (futuro) → text', () => {
  assert.equal(fieldKind({ type: 'sconosciuto', description: 'TESTO.' }), 'text')
})