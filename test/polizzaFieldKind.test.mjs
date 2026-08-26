/**
 * Test del modulo puro polizzaFieldKind.js: normalizzazione del `type` esplicito
 * e inferenza dal prefisso della description.
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FIELD_KINDS, kindFromType, inferKindFromDescription, fieldKind, fieldNatura,
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

// ─── fieldNatura: natura dal solo vocabolo di label/description (type-blind) ─

test('fieldNatura: ricava la grandezza da label/description, MAI dall\'id', () => {
  assert.equal(fieldNatura({ id: '94cbee3c-f83b-5b95-87b8-8b68d02d6d59', label: 'Massimale per sinistro' }), 'massimale_sinistro')
  assert.equal(fieldNatura({ id: 'ac724518-d10e-55c5-95b7-10c700365820', label: 'Massimale annuo' }), 'massimale_annuo')
  assert.equal(fieldNatura({ label: 'Massimale per persona' }), 'massimale_persona')
  assert.equal(fieldNatura({ label: 'Massimale danni materiali' }), 'massimale_danni')
  assert.equal(fieldNatura({ label: 'Massimale per prestatore' }), 'massimale_prestatore')
  assert.equal(fieldNatura({ label: 'Franchigia base' }), 'franchigia')
  assert.equal(fieldNatura({ label: 'Scoperto base' }), 'scoperto')
  assert.equal(fieldNatura({ label: 'Premio totale' }), 'premio_totale')
  assert.equal(fieldNatura({ label: 'Premio imponibile' }), 'premio_imponibile')
  assert.equal(fieldNatura({ label: 'Imposta' }), 'imposta')
  assert.equal(fieldNatura({ label: 'Parametro regolazione' }), 'parametro')
  assert.equal(fieldNatura({ label: 'Importo preventivo' }), 'importo_preventivo')
  assert.equal(fieldNatura({ label: 'Professione dichiarata' }), 'attivita')
  // Anagrafica: nessuna natura riconoscibile → null
  assert.equal(fieldNatura({ label: 'N° Polizza' }), null)
  assert.equal(fieldNatura({ label: 'Compagnia' }), null)
  assert.equal(fieldNatura(null), null)
})

test('fieldNatura: gli id UUID non influenzano la natura (nessun falso match)', () => {
  // Lo stesso campo con id parlante e con id UUID dà LA STESSA natura: decide
  // solo label/description.
  const a = fieldNatura({ id: 'rct_massimale_sinistro', label: 'Massimale per sinistro' })
  const b = fieldNatura({ id: '94cbee3c-f83b-5b95-87b8-8b68d02d6d59', label: 'Massimale per sinistro' })
  assert.equal(a, 'massimale_sinistro')
  assert.equal(b, 'massimale_sinistro')
  assert.equal(a, b)
  // Un campo con solo id UUID (niente label/description) non è classificabile.
  assert.equal(fieldNatura({ id: '94cbee3c-f83b-5b95-87b8-8b68d02d6d59' }), null)
})

test('fieldNatura: la descrizione di contrapposizione non cambia la natura', () => {
  // "Non confondere con massimale annuo / non il massimale" sono NOTE, non la
  // natura del campo: il taglio al marcatore negativo le esclude.
  assert.equal(fieldNatura({ label: 'Franchigia', description: 'Non confondere con il massimale per sinistro' }), 'franchigia')
  assert.equal(fieldNatura({ label: 'Massimale per sinistro', description: 'Non riutilizzare il valore del massimale annuo' }), 'massimale_sinistro')
  // L'attività è unica: la natura resta "attivita" anche con esempio.
  assert.equal(fieldNatura({ label: 'Professione dichiarata', description: 'ESEMPIO Radiodiagnostica' }), 'attivita')
})

test('fieldNatura: campi riusati con significato testuale restano testuali/attività', () => {
  // rcp_imposta/rcp_premio_imponibile riusati come Tacito Rinnovo / Frazionamento:
  // la description dice il ruolo REALE, non quello dell'id.
  const tacito = fieldNatura({ label: 'Tacito Rinnovo', description: 'TESTO (SÌ/NO). Tacito rinnovo: Sì, No, Non indicato.' })
  assert.equal(tacito, null) // nessuna grandezza numerica → natura non decidibile
  const fraz = fieldNatura({ label: 'Frazionamento', description: 'TESTO. annuale, semestrale, trimestrale, mensile.' })
  assert.equal(fraz, null)
})