/**
 * Test della validazione pura per l'estrazione polizze RC.
 *
 * Esegui:  node --test test/*.test.mjs
 *
 * Copre i bug osservati sul campo con i modelli locali piccoli:
 *  - placeholder ("non specificato", "null") accettati come valori;
 *  - P.IVA/CF plausibili ma con checksum sbagliato (es. "0000003078910340");
 *  - merge "primo trovato" invece di "documento più recente vince".
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  parsePureAmount,
  isPlaceholderValue,
  isValidPartitaIva,
  isValidCodiceFiscale,
  validateCodiceFiscaleIva,
  isStructuralField,
  isPeriodicEconomicField,
  partitionFields,
  normForMatch,
  passesStagedEvidence,
  pickMoreRecentCandidate,
} from '../src/main/services/polizzaValidation.js'

// ─── Placeholder ─────────────────────────────────────────────────────────────

test('placeholder: i letterali di assenza-dato vengono scartati', () => {
  for (const v of [
    'non specificato', 'Non Specificato', ' NON SPECIFICATO ', 'non indicata',
    'n/d', 'N.D.', 'nd', 'N/A', 'null', 'NULL', 'none', 'nessuno',
    '-', '—', '...', 'x', '???', 'da definire', 'vedi condizioni di polizza',
    '"non specificato"', '(non presente)',
  ]) {
    assert.equal(isPlaceholderValue(v), true, `"${v}" deve essere placeholder`)
  }
})

test('placeholder: i valori legittimi sopravvivono (mai match substring)', () => {
  for (const v of [
    'Retribuzioni', 'EULIP SRL', 'Fonderia Nardi S.p.A.',   // contengono "nd"/"na"
    'Via Nazionale 12', '4.000.000,00', '31/12/2025',
    'produzione di oli e grassi vegetali', 'X S.r.l.',
  ]) {
    assert.equal(isPlaceholderValue(v), false, `"${v}" NON deve essere placeholder`)
  }
})

// ─── Checksum P.IVA ──────────────────────────────────────────────────────────

test('P.IVA: checksum ufficiale', () => {
  assert.equal(isValidPartitaIva('12345678903'), true)     // vettore noto valido
  assert.equal(isValidPartitaIva('12345678901'), false)    // cifra di controllo errata
  assert.equal(isValidPartitaIva('00151510344'), true)     // P.IVA reale (EULIP)
  assert.equal(isValidPartitaIva('00000000000'), false)    // uniforme: mai reale
  assert.equal(isValidPartitaIva('1234567890'), false)     // 10 cifre
  assert.equal(isValidPartitaIva('123456789031'), false)   // 12 cifre
})

// ─── Checksum Codice Fiscale ─────────────────────────────────────────────────

test('CF: struttura + carattere di controllo', () => {
  assert.equal(isValidCodiceFiscale('RSSMRA85T10A562S'), true)
  assert.equal(isValidCodiceFiscale('RSSMRA85T10A562T'), false)  // controllo mutato
  assert.equal(isValidCodiceFiscale('rssmra85t10a562s'), true)   // case-insensitive
  assert.equal(isValidCodiceFiscale('0000003078910340'), false)  // fake osservato sul campo
  assert.equal(isValidCodiceFiscale('AAAAAAAAAAAAAAAA'), false)  // struttura impossibile
})

test('validateCodiceFiscaleIva: normalizza, valida, ripara OCR', () => {
  // Casella modulistica a 16 char zero-padded: zeri + P.IVA a 11 cifre.
  // Vista sul campo (OCR polizza EULIP): "0000000151510344" → "00151510344".
  assert.equal(validateCodiceFiscaleIva('0000000151510344'), '00151510344')
  // Stesso pattern del vecchio "fake" osservato: il trailing-11 è checksum-valido
  // (ufficio 034 = Parma) → era una P.IVA genuina padded, va RIPARATA non scartata
  assert.equal(validateCodiceFiscaleIva('0000003078910340'), '03078910340')
  // Padding NON zero: resta invalido (né P.IVA né CF)
  assert.equal(validateCodiceFiscaleIva('1234503078910340'), null)
  // P.IVA valida con spazi/punti
  assert.equal(validateCodiceFiscaleIva('00 151 510 344'), '00151510344')
  // CF valido minuscolo
  assert.equal(validateCodiceFiscaleIva('rssmra85t10a562s'), 'RSSMRA85T10A562S')
  // Riparazione OCR: O→0 su una P.IVA altrimenti valida
  assert.equal(validateCodiceFiscaleIva('OO151510344'), '00151510344')
  // Riparazione che NON produce un checksum valido → scartata
  assert.equal(validateCodiceFiscaleIva('OO151510345'), null)
  // Spazzatura corta (codici agenzia)
  assert.equal(validateCodiceFiscaleIva('0705'), null)
})

// ─── Partizione campi ────────────────────────────────────────────────────────

test('partitionFields: i campi default finiscono nel gruppo giusto', () => {
  const fields = [
    { id: 'polizza_numero', label: 'N° Polizza', description: 'numero della polizza' },
    { id: 'scadenza', label: 'Scadenza', description: 'data di scadenza', type: 'date' },
    { id: 'attivita', label: 'Attività assicurata', description: "descrizione dell'attività" },
    { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro', description: 'massimale RCT' },
    { id: 'rct_premio_totale', label: 'Premio totale', description: 'premio lordo annuo' },
    { id: 'rct_tasso', label: 'Tasso ‰', description: 'tasso di regolazione' },
    { id: 'campo_custom_xyz', label: 'Nota interna', description: 'annotazione libera' },
  ]
  const p = partitionFields(fields)
  assert.deepEqual(p.strutturali.map(f => f.id), ['attivita', 'rct_massimale_sinistro'])
  assert.deepEqual(p.economici.map(f => f.id), ['rct_premio_totale', 'rct_tasso'])
  assert.deepEqual(p.anagrafica.map(f => f.id), ['polizza_numero', 'scadenza', 'campo_custom_xyz'])
  assert.equal(isStructuralField(fields[3]), true)
  assert.equal(isPeriodicEconomicField(fields[4]), true)
})

// ─── Evidenza ────────────────────────────────────────────────────────────────

const CTX = normForMatch(
  'POLIZZA R.C. N° 283618616 — Contraente: EULIP SRL\n' +
  'Attività: produzione di olî e grassi vegetali per industria alimentare\n' +
  'Massimale per sinistro: € 4.000.000,00 — SCADENZA 31/12/2025'
)

test('evidenza importi: simmetrica — ancorato al contesto passa, inventato no', () => {
  const f = { id: 'rct_massimale_sinistro', label: 'Massimale' }
  // Con evidenza coerente → passa
  assert.equal(passesStagedEvidence(f, '4.000.000,00',
    { evidenza: 'Massimale per sinistro: € 4.000.000,00' }, CTX), true)
  // SENZA evidenza ma con le cifre nel contesto → passa lo stesso (i modelli
  // piccoli omettono spesso la chiave evidenza: il valore vero non va punito)
  assert.equal(passesStagedEvidence(f, '4.000.000,00', {}, CTX), true)
  // Importo inventato senza evidenza → scartato
  assert.equal(passesStagedEvidence(f, '9.500.000,00', {}, CTX), false)
  // Evidenza che non contiene le cifre → scartato
  assert.equal(passesStagedEvidence(f, '9.500.000,00', { evidenza: 'Massimale per sinistro' }, CTX), false)
  // Evidenza fabbricata auto-coerente ma ASSENTE dal contesto → scartato
  assert.equal(passesStagedEvidence(f, '9.500.000,00',
    { evidenza: 'Massimale per sinistro: € 9.500.000,00 come da polizza' }, CTX), false)
})

test('evidenza: le riformattazioni del modello non vengono punite', () => {
  const f = { id: 'attivita', label: 'Attività assicurata' }
  // Case/punteggiatura/accenti diversi dal testo → containment normalizzato
  assert.equal(passesStagedEvidence(f,
    'Produzione di oli e grassi vegetali per industria alimentare', {}, CTX), true)
  // Testo inventato di sana pianta → scartato
  assert.equal(passesStagedEvidence(f,
    'commercio di autoveicoli usati e ricambi', {}, CTX), false)
})

test('evidenza: le date devono comparire nel contesto', () => {
  const f = { id: 'scadenza', label: 'Scadenza', type: 'date' }
  assert.equal(passesStagedEvidence(f, '31/12/2025', {}, CTX), true)
  assert.equal(passesStagedEvidence(f, '31.12.2025', {}, CTX), true)   // formato diverso, stessa data
  assert.equal(passesStagedEvidence(f, '31/12/2019', {}, CTX), false)  // data mai vista
})

// ─── Recenza dei candidati ───────────────────────────────────────────────────

test('recency: il documento più recente vince, mai il primo trovato', () => {
  const vecchio = { valore: 'EULIP SPA', effDate: '31/12/2009', docType: 'polizza', appendixOrd: null, docPos: 0 }
  const nuovo = { valore: 'EULIP SRL', effDate: '31/12/2024', docType: 'appendice', appendixOrd: 12, docPos: 8 }
  // In entrambi gli ordini di inserimento vince il 2024
  assert.equal(pickMoreRecentCandidate(vecchio, nuovo, 'anagrafica').valore, 'EULIP SRL')
  assert.equal(pickMoreRecentCandidate(nuovo, vecchio, 'anagrafica').valore, 'EULIP SRL')
})

test('recency: un valore NON datato non scavalca mai un valore datato', () => {
  const datato = { valore: 'A', effDate: '31/12/2024', docType: 'appendice', appendixOrd: null, docPos: 3 }
  const nonDatato = { valore: 'B', effDate: null, docType: 'quietanza', appendixOrd: null, docPos: 9 }
  assert.equal(pickMoreRecentCandidate(datato, nonDatato, 'anagrafica').valore, 'A')
  // ...ma un non datato riempie un candidato datato assente
  assert.equal(pickMoreRecentCandidate(null, nonDatato, 'anagrafica').valore, 'B')
})

test('recency: senza date decide la priorità del tipo documento per genere', () => {
  const daPolizza = { valore: 'P', effDate: null, docType: 'polizza', appendixOrd: null, docPos: 0 }
  const daRegolazione = { valore: 'R', effDate: null, docType: 'regolazione', appendixOrd: null, docPos: 5 }
  // Economico: la regolazione batte la polizza
  assert.equal(pickMoreRecentCandidate(daPolizza, daRegolazione, 'economici').valore, 'R')
  // Strutturale: la polizza batte la regolazione
  assert.equal(pickMoreRecentCandidate(daPolizza, daRegolazione, 'strutturali').valore, 'P')
})

test('recency: tra appendici senza data vince l\'ordinale più alto', () => {
  const app8 = { valore: 'otto', effDate: null, docType: 'appendice', appendixOrd: 8, docPos: 2 }
  const app12 = { valore: 'dodici', effDate: null, docType: 'appendice', appendixOrd: 12, docPos: 7 }
  assert.equal(pickMoreRecentCandidate(app8, app12, 'anagrafica').valore, 'dodici')
  assert.equal(pickMoreRecentCandidate(app12, app8, 'anagrafica').valore, 'dodici')
})

// ─── Datazione documenti "a massima copertura" ───────────────────────────────
// Il motore a stadi data i documenti con latestDateExcludingEmission: la
// quietanza che RISTAMPA in testa la scadenza contrattuale originale (2008) ma
// copre la rata 2025 deve risultare datata 2025, non 2008 (il bug che
// neutralizzava la regola "il più recente vince" su tutto il fascicolo).
import { latestDateExcludingEmission } from '../src/main/services/polizzaDates.js'

test('datazione: la quietanza con header contrattuale vecchio è datata dalla rata', () => {
  const QUIETANZA_2025 =
    'QUIETANZA DI PREMIO — POLIZZA N. 283618616\n' +
    'DECORRENZA 31/12/2007 SCADENZA 31/12/2008\n' +   // header contrattuale originale
    'RATA DAL 31/12/2024 AL 31/12/2025\n' +
    'Emesso in Milano il 15/01/2026\n' +               // emissione: da IGNORARE
    'PREMIO LORDO € 5.501,25'
  assert.equal(latestDateExcludingEmission(QUIETANZA_2025), '31/12/2025')
})

// ─── parsePureAmount (spostata qui dal servizio) ─────────────────────────────

test('parsePureAmount: importi italiani sì, resto no', () => {
  assert.equal(parsePureAmount('4.000.000,00'), 4000000)
  assert.equal(parsePureAmount('€ 2.500,50'), 2500.5)
  assert.equal(parsePureAmount('31/12/2025'), null)
  assert.equal(parsePureAmount('2,5 ‰'), null)
  assert.equal(parsePureAmount('Fatturato'), null)
})
