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
  isTextualField,
  isTextualZeroPlaceholder,
  isTextualNumericOnly,
  isValidPartitaIva,
  isValidCodiceFiscale,
  validateCodiceFiscaleIva,
  isStructuralField,
  isGarbageIdentifier,
  isPeriodicEconomicField,
  partitionFields,
  normForMatch,
  passesStagedEvidence,
  pickMoreRecentCandidate,
  looseAmount,
  isSuspectStructuralOverride,
  isRinvioAttivita,
  isCompanyNameAsAgency,
  isInsurerFooterPIva,
  isOtherCoverageDocName,
  isPremiumField,
  isOtherCoveragePremiumSource,
  pickSemanticCandidate,
  stripFieldExamples,
  buildNormIndex,
  findValueWindow,
  hasOcrDigitRun,
  validateCrossFields,
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

// ─── FIX D2 — IDENTIFICATIVI ALFANUMERICI SPORCHI (garbage OCR) ──────────────
// Un numero di polizza/proposta/preventivo è una stringa alfanumerica pulita.
// Un candidato con artefatti OCR ("3ROL]]D") o con troppi caratteri non
// alfanumerici è spazzatura: si scarta, mai si "ripara" (non inventare).
test('D2 isGarbageIdentifier: artefatti OCR adiacenti identici → true', () => {
  assert.equal(isGarbageIdentifier('3ROL]]D'), true)   // PROF.LE: garbage
  assert.equal(isGarbageIdentifier('RCM((20100'), true)
  assert.equal(isGarbageIdentifier('ELP--2024'), true)
  assert.equal(isGarbageIdentifier('P%OL|20'), false)  // no run identico adiacente
})

test('D2 isGarbageIdentifier: meno del 70% alfanumerici → true (senza run adiacenti identici)', () => {
  assert.equal(isGarbageIdentifier('A..%%&&##'), true) // 1 alnum su 9 → ratio basso
  assert.equal(isGarbageIdentifier('12ab..cd..'), true) // molti separatori sparsi
  assert.equal(isGarbageIdentifier('ABC.!.(.)%'), true) // pochi alfanumerici, nessun run
})

test('D2 isGarbageIdentifier: identificativi reali puliti → false', () => {
  assert.equal(isGarbageIdentifier('RCM20100036608'), false) // il valore vero (solo alnum)
  assert.equal(isGarbageIdentifier('ILI0003005'), false)
  assert.equal(isGarbageIdentifier('410000880'), false)
  assert.equal(isGarbageIdentifier('RCM-2010-0036608'), false) // solo '-' come separatore
  assert.equal(isGarbageIdentifier(''), false)
  assert.equal(isGarbageIdentifier(null), false)
})

test('D2 isGarbageIdentifier: UUID/id con singolo separatore → false, doppio separatore → true', () => {
  // Un UUID/codice con separatori SINGOLI ("-") è pulito e sopravvive.
  assert.equal(isGarbageIdentifier('311ac411-3e3a-4e42-be90-001b'), false)
  // Un doppio separatore adiacente ("--") è il marker del rumore OCR → garbage.
  assert.equal(isGarbageIdentifier('RCM--2024--0001'), true)
})

// ─── Filtro anti-0 per campi TESTO (Problema 2) ──────────────────────────────

test('anti-0 testo: "0" è non-valido su campi TESTO (description con prefisso TESTO)', () => {
  const campoTesto = { description: 'TESTO. Tacito rinnovo: Sì, No oppure Non indicato, MAI con un numero/0' }
  const campoTestoElenco = { description: 'TESTO (elenco). Tutti i sottolimiti' }
  for (const v of ['0', '0,00', '0.00', '€ 0', '0.0']) {
    assert.equal(isTextualZeroPlaceholder(campoTesto, v), true, `"${v}" su campo TESTO deve essere placeholder`)
    assert.equal(isTextualZeroPlaceholder(campoTestoElenco, v), true, `"${v}" su campo TESTO (elenco) deve essere placeholder`)
  }
})

test('anti-0 testo: NON colpisce i campi NUMERO/IMPORTO (premio, massimale)', () => {
  const premio = { description: 'NUMERO/IMPORTO. Premio lordo annuo totale (es. 5.501,25)' }
  const massimale = { description: 'NUMERO/IMPORTO (euro). Massimale per singolo sinistro (es. 7.500.000,00)' }
  // lo 0 può essere un premio/massimale legittimo (o un valore semantico): non va filtato
  assert.equal(isTextualZeroPlaceholder(premio, '0'), false)
  assert.equal(isTextualZeroPlaceholder(massimale, '0,00'), false)
})

test('anti-0 testo: un TESTO che esplicita SÌ/NO ma descrive numeri tabulati è comunque testo', () => {
  // Il prefisso è la fonte di tipo: qui è TESTO, lo 0 resta placeholder anche se
  // la descrizione contiene una cifra d'esempio.
  const campo = { description: 'TESTO (SÌ/NO). Tacito rinnovo: rispondi Sì o No, MAI 0' }
  assert.equal(isTextualZeroPlaceholder(campo, '0'), true)
  assert.equal(isTextualZeroPlaceholder(campo, 'No'), false)
})

test('anti-0 testo: campo testuale ma con valore testuale vero → non toccato', () => {
  const campo = { description: 'TESTO. Frazionamento di pagamento (annuale, semestrale)' }
  assert.equal(isTextualZeroPlaceholder(campo, 'annuale'), false)
  assert.equal(isTextualZeroPlaceholder(campo, '0'), true)
})

test('anti-0 testo: campo senza prefisso TESTO non viene mai bloccato per 0', () => {
  const campoNeutro = { description: 'Premio lordo totale in euro' }
  assert.equal(isTextualZeroPlaceholder(campoNeutro, '0'), false)
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

// ─── Evidenza di importo: tolleranza alla lettera OCR interposta ─────────────
// Bug sul campo (fascicolo Cedam): il 7.500.000,00 della dichiarazione 2026
// veniva marcato [senza-evidenza] e scartato PRIMA del merge per recency,
// perché una lettera di confusione OCR (0→O) nel testo SPAZIALE rompeva la run
// contigua "7500000" che il vecchio check cercava con normCtx.includes().
// L'atto 2018 col 5.000.000,00 restava l'unico candidato e vinceva per default.

test('hasOcrDigitRun: run esatta → sì; run con LETTERA OCR interposta → sì (contigua)', () => {
  assert.equal(hasOcrDigitRun('massimale 7.500.000 unico', '7500000'), true)
  // La lettera-fantasma 0→O spezzava il run nel vecchio normCtx.includes()
  assert.equal(hasOcrDigitRun('massimali assicurati 7.500O000 unico', '7500000'), true)
  // 'l' per '1' e 's' per '5' (confusioni OCR classiche)
  assert.equal(hasOcrDigitRun('somma 4.0O0.0O0,00', '4000000'), true)
  // lettera NON di confusione (es. una parola) NON vale: la run deve restare densa
  assert.equal(hasOcrDigitRun('massimale Euro settecento', '7500000'), false)
  // Niente sottosequenze: un numero più grande NON valida uno più piccolo
  assert.equal(hasOcrDigitRun('75.000.000', '7500000'), false)
  assert.equal(hasOcrDigitRun('750.000', '7500000'), false)
})

test('evidenza importi: il 7.500.000 con 0→O OCR supera il check (fascicolo Cedam)', () => {
  const f = { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro' }
  // Contesto SPAZIALE del batch come arriva al modello (griglia a colonne)
  const ctx = 'Massimali Assicurati: RCT/RCO Euro 7.500O000,00 Unico per sinistro'
  const nctx = normForMatch(ctx)
  // Il vecchio check fallirebbe: la run continua "7500000" NON c'è più
  assert.equal(nctx.includes('7500000'), false)
  // ma le cifre sono DAVVERO nel testo → l'evidenza passa ora
  assert.equal(passesStagedEvidence(f, '7.500.000,00', {}, nctx), true)
})

test('evidenza importi: resta severa sugli importi NON presenti (nessun nuovo falso positivo)', () => {
  const f = { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro' }
  const nctx = normForMatch('Massimali Assicurati: RCT/RCO Euro 7.500O000,00')
  // Importo inventato non nel contesto → ancora scartato
  assert.equal(passesStagedEvidence(f, '9.500.000,00', {}, nctx), false)
  // Importo che esiste ma con cifre DIVERSE (7.500.000 vs 750.000) → scartato
  assert.equal(passesStagedEvidence(f, '750.000,00', {}, nctx), false)
  // Evidenza fabbricata assente dal contesto → scartato
  assert.equal(passesStagedEvidence(f, '9.500.000,00',
    { evidenza: 'Massimali Assicurati: RCT/RCO Euro 9.500O000,00 come da polizza' }, nctx), false)
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

test('merge Cedam: il 7.500.000 della dichiarazione 2026 vince sul 5.000.000 dell\'atto 2018', () => {
  // Il flusso completo del bug: finché l'evidenza era rotta, il candidato recente
  // veniva scartato PRIMA del merge e l'atto vecchio vinceva per default.
  // Ora, con l'evidenza robusta all'OCR, il 7.500.000 entra nel merge e la
  // recency lo fa vincere (affinità comparabili o leggermente favorevoli).
  const campo = { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro' }
  const ctx = normForMatch('Dichiarazione 31/07/2026 — Massimali Assicurati: RCT/RCO Euro 7.500O000,00 Unico per sinistro')
  // L'evidenza passa con la lettera OCR
  assert.equal(passesStagedEvidence(campo, '7.500.000,00', {}, ctx), true)

  const atto2018 = { valore: '5.000.000,00', effDate: '31/12/2018', docType: 'atto', affinity: 0.6, lex: 0.4, docPos: 5 }
  const dichiarazione2026 = { valore: '7.500.000,00', effDate: '31/07/2026', docType: 'dichiarazione', affinity: 0.62, lex: 0.5, docPos: 1 }
  // Con il candidato recente arrivato al merge, l'arbitro semantico:
  // - affinità comparabili → recency → vince il 2026;
  assert.equal(pickSemanticCandidate(atto2018, dichiarazione2026, 'strutturali').valore, '7.500.000,00')
  // - vale in entrambi gli ordini di arrivo
  assert.equal(pickSemanticCandidate(dichiarazione2026, atto2018, 'strutturali').valore, '7.500.000,00')

  // La recency NON è assoluta: con affinità NETTAMENTE più bassa sul 2026
  // (Δ > vetoMargin), vince comunque l'atto 2018 con la descrizione più vicina.
  const lontano = { valore: '7.500.000,00', effDate: '31/07/2026', docType: 'dichiarazione', affinity: 0.42, lex: 0.3, docPos: 1 }
  assert.equal(pickSemanticCandidate(atto2018, lontano, 'strutturali').valore, '5.000.000,00')
})

test('recency: senza date NESSUNA priorità di tipo — decide lo spareggio lessicale, poi la posizione', () => {
  // DECISIONE DEFINITIVA: documenti tutti uguali. A pari (non-)data vince chi
  // somiglia di più alla descrizione del campo (lex); senza lex, la posizione.
  const daPolizza = { valore: 'P', effDate: null, docType: 'polizza', appendixOrd: null, docPos: 0, lex: 0.3 }
  const daRegolazione = { valore: 'R', effDate: null, docType: 'regolazione', appendixOrd: null, docPos: 5, lex: 0.7 }
  assert.equal(pickMoreRecentCandidate(daPolizza, daRegolazione, 'economici').valore, 'R')
  assert.equal(pickMoreRecentCandidate(daRegolazione, daPolizza, 'strutturali').valore, 'R')
  // Senza lex: posizione originale più bassa (deterministico, mai il tipo)
  const a = { valore: 'A', effDate: null, docType: 'regolazione', docPos: 5 }
  const b = { valore: 'B', effDate: null, docType: 'polizza', docPos: 0 }
  assert.equal(pickMoreRecentCandidate(a, b, 'economici').valore, 'B')
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

// ─── Guardie di merge (run EULIP 18:24: massimale 4M → "€. 10.000") ──────────

test('looseAmount: parse permissivo anche con "€." e testo attorno', () => {
  assert.equal(looseAmount('€. 10.000,00'), 10000)
  assert.equal(looseAmount('4.000.000,00'), 4000000)
  assert.equal(looseAmount('Euro 2.600.000,00 per prestatore'), 2600000)
  assert.equal(looseAmount('Retribuzioni'), null)
})

test('override massimale: un crollo sotto il 20% è un sub-limite pescato male', () => {
  const massimale = { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro' }
  const testoAppendice = 'nell\'ambito del massimale per sinistro e fino a concorrenza dell\'importo di Euro 10.000,00'
  // 4.000.000 → 10.000: rifiutato anche se l'appendice cita "massimale" vicino al valore
  assert.equal(isSuspectStructuralOverride(massimale, '4.000.000,00', '€. 10.000,00', testoAppendice), true)
  // 4.000.000 → 2.600.000 con etichetta vicino: riduzione legittima da rinnovo
  const testoRinnovo = 'massimale per prestatore di lavoro elevato a Euro 2.600.000,00 per sinistro'
  assert.equal(isSuspectStructuralOverride(massimale, '4.000.000,00', '2.600.000,00', testoRinnovo), false)
})

test('override strutturale: senza etichetta vicino al valore il documento non ridefinisce il campo', () => {
  const franchigia = { id: 'rct_franchigia', label: 'Franchigia generica o minima RCT' }
  const testoSenzaEtichetta = 'il premio annuo lordo è pari a Euro 2.000,00 oltre imposte'
  assert.equal(isSuspectStructuralOverride(franchigia, '500,00', '2.000,00', testoSenzaEtichetta), true)
  const testoConEtichetta = 'la garanzia è prestata con una franchigia di Euro 2.000,00 per sinistro'
  assert.equal(isSuspectStructuralOverride(franchigia, '500,00', '2.000,00', testoConEtichetta), false)
})

test('attività: i rinvii/parafrasi non sono una descrizione', () => {
  assert.equal(isRinvioAttivita("l'attività per la quale è prestata l'assicurazione"), true)
  assert.equal(isRinvioAttivita("attività della spett.le ditta contraente"), true)
  assert.equal(isRinvioAttivita('vedi polizza'), true)
  assert.equal(isRinvioAttivita("esercente un'impresa per la produzione di olii e grassi vegetali per industria alimentare cosmetica e farmaceutica"), false)
  assert.equal(isRinvioAttivita('produzione di olii e grassi vegetali'), false)
})

test('attività: date e importi puri NON sono rinvii (data retroattività 14/10/2014)', () => {
  // Fascicolo B: la "Data retroattività" (14/10/2014) proposta dalla scheda era
  // scartata dal guardrail rinvio-attivita perché il campo "Data retroattività"
  // matcha /attivit/ come substring e la data breve (<12 char) tornava `true`.
  assert.equal(isRinvioAttivita('14/10/2014'), false)
  assert.equal(isRinvioAttivita('14/10/2025'), false)
  assert.equal(isRinvioAttivita('31/12/2020'), false)
  // Importo puro: non è un rinvio.
  assert.equal(isRinvioAttivita('10.000,00'), false)
  assert.equal(isRinvioAttivita('500.000'), false)
  // Un rinvio vero resta un rinvio.
  assert.equal(isRinvioAttivita("di cui alla clausola precedente"), true)
  assert.equal(isRinvioAttivita("come da polizza"), true)
})

test('agenzia: la denominazione della compagnia non è un\'agenzia', () => {
  assert.equal(isCompanyNameAsAgency('Generali Italia S.p.A.'), true)
  assert.equal(isCompanyNameAsAgency('Assicurazioni Generali'), true)
  assert.equal(isCompanyNameAsAgency('MILANO 901'), false)
  assert.equal(isCompanyNameAsAgency('AGENZIA DI ACQUI TERME'), false)
  assert.equal(isCompanyNameAsAgency('001/00 ACQUI TERME'), false)
})

test('P.IVA nel footer societario della compagnia: è l\'assicuratore, non il contraente', () => {
  const footerQuietanza = 'Generali Italia S.p.A. - Sede legale: Mogliano Veneto (TV), Via Marocchesa, 14 - '
    + 'C.F. e iscr. nel Registro Imprese di Treviso n. 00409920584 - Partita IVA 01333550323 - Capitale Sociale: Euro 1.618.628.450,00'
  assert.equal(isInsurerFooterPIva(footerQuietanza, '01333550323'), true)
  const frontespizio = 'CONTRAENTE/ASSICURATO CODICE FISCALE/PARTITA IVA\nEULIP SPA 0000000151510344'
  assert.equal(isInsurerFooterPIva(frontespizio, '00151510344'), false)
  // Valore assente nel testo: la guardia non scatta (decide l'evidenza a monte)
  assert.equal(isInsurerFooterPIva(frontespizio, '01333550323'), false)
})

// ─── Arbitro semantico del merge (agnostico: decide l'affinità descrizione↔contesto) ─

test('arbitro semantico: affinità nettamente diversa vince anche contro la recency', () => {
  const kind = 'economici'
  // Incumbente: preventivo dall'appendice (alta affinità col contesto "retribuzioni preventivate")
  const incumbent = { valore: '1.800.000,00', effDate: '31/12/2018', docType: 'appendice', affinity: 0.62 }
  // Candidato più RECENTE ma semanticamente lontano (consuntivo della regolazione)
  const consuntivo = { valore: '1.809.600,00', effDate: '31/12/2024', docType: 'regolazione', affinity: 0.31 }
  assert.equal(pickSemanticCandidate(incumbent, consuntivo, kind), incumbent)
  // Simmetrico: candidato più recente E semanticamente migliore → vince lui
  const buono = { valore: '1.900.000,00', effDate: '31/12/2024', docType: 'appendice', affinity: 0.75 }
  assert.equal(pickSemanticCandidate(incumbent, buono, kind), buono)
})

test('arbitro semantico: affinità comparabili → decide la recency (regola invariata)', () => {
  const kind = 'economici'
  const vecchio = { valore: '5.601,25', effDate: '31/12/2023', docType: 'quietanza', affinity: 0.55 }
  const nuovo = { valore: '6.501,25', effDate: '31/12/2025', docType: 'quietanza', affinity: 0.57 }
  assert.equal(pickSemanticCandidate(vecchio, nuovo, kind), nuovo)
})

test('arbitro semantico: collasso numerico >80% passa solo con affinità superiore', () => {
  const kind = 'strutturali'
  const massimale = { valore: '4.000.000,00', effDate: null, docType: 'polizza', affinity: 0.6 }
  // Sub-limite pescato da una clausola, stessa affinità → rifiutato anche se datato
  const sublimite = { valore: '€. 10.000,00', effDate: '31/12/2020', docType: 'appendice', affinity: 0.58 }
  assert.equal(pickSemanticCandidate(massimale, sublimite, kind), massimale)
  // Riduzione genuina con affinità NETTAMENTE superiore (Δ > 0.15) → passa
  const ridotto = { valore: '500.000,00', effDate: '31/12/2020', docType: 'appendice', affinity: 0.80 }
  assert.equal(pickSemanticCandidate(massimale, ridotto, kind), ridotto)
  // Senza affinità calcolabile il collasso resta prudente: rifiutato
  const massimaleNoAff = { valore: '4.000.000,00', effDate: null, docType: 'polizza', affinity: null }
  const senzaAff = { valore: '10.000,00', effDate: '31/12/2020', docType: 'appendice', affinity: null }
  assert.equal(pickSemanticCandidate(massimaleNoAff, senzaAff, kind), massimaleNoAff)
})

test('arbitro semantico: senza affinità su entrambi → pura recency; slot vuoto → riempi', () => {
  const kind = 'anagrafica'
  const a = { valore: 'EULIP SPA', effDate: null, docType: 'polizza', affinity: null }
  const b = { valore: 'EULIP SRL', effDate: '31/12/2025', docType: 'quietanza', affinity: null }
  assert.equal(pickSemanticCandidate(a, b, kind), b)
  assert.equal(pickSemanticCandidate(null, a, kind), a)
})

test('documenti tutti uguali: a pari data lo spareggio è la somiglianza LESSICALE con la descrizione', () => {
  const kind = 'economici'
  // Caso reale EULIP: quietanza 2025 datata 31/12/2024 (scadenza rata) =
  // stessa data della regolazione 2024. Nessuna priorità per tipo documento
  // (decisione definitiva): vince il candidato il cui contesto somiglia di
  // più alla DESCRIZIONE del campo (lex), da qualunque file provenga.
  const regolazione = { valore: '528', effDate: '31/12/2024', docType: 'regolazione', affinity: 0.63, lex: 0.2 }
  const quietanza = { valore: '1.001,25', effDate: '31/12/2024', docType: 'quietanza', affinity: 0.54, lex: 0.6 }
  assert.equal(pickSemanticCandidate(regolazione, quietanza, kind), quietanza)
  // Vale in entrambi gli ordini di arrivo
  assert.equal(pickSemanticCandidate(quietanza, regolazione, kind), quietanza)
  // Date DIVERSE → la recency comanda come sempre (lex è solo spareggio)
  const q2024 = { valore: '962,00', effDate: '31/12/2023', docType: 'quietanza', affinity: 0.5, lex: 0.9 }
  assert.equal(pickSemanticCandidate(q2024, quietanza, kind), quietanza)
  // Senza lex su uno dei due → fallback deterministico (ordinale/posizione),
  // mai una priorità di tipo documento
  const senzaLex = { valore: '4.900,00', effDate: '31/12/2024', docType: 'regolazione', affinity: 0.5 }
  assert.equal(pickSemanticCandidate(quietanza, senzaLex, kind), quietanza)
})

// ─── Descrizioni dei campi: l'esempio si taglia, le istruzioni NO ────────────
// Bug visto sul campo (fascicolo EULIP): il vecchio taglio ", es. …" arrivava a
// FINE RIGA e le descrizioni sono su una riga sola, quindi tutto ciò che l'utente
// scriveva DOPO l'esempio ("VIETATO …", "NON …", "ometti il campo") non arrivava
// mai né al prompt né al vettore di affinità.

test('stripFieldExamples: taglia SOLO l\'esempio, non le istruzioni che seguono', () => {
  const desc = "Restituisci la grandezza economica misurata per la regolazione: la dicitura che contiene "
    + "'Retribuzioni' (oppure Salari, Fatturato, Ricavi), es. 'Retribuzioni preventivate Inail e non "
    + "Inail'. VIETATO restituire da sole le parole 'Consuntivo', 'Preventivo': sono intestazioni di "
    + 'colonna, NON il parametro. Se trovi solo quelle senza il nome della grandezza, ometti il campo.'
  const out = stripFieldExamples(desc)
  // l'esempio sparisce…
  assert.ok(!out.includes('preventivate Inail'), out)
  // …ma il divieto e la regola di omissione restano
  assert.ok(out.includes('VIETATO restituire da sole'), out)
  assert.ok(out.includes('ometti il campo'), out)
  assert.ok(out.includes("contiene 'Retribuzioni'"), out)
})

test('stripFieldExamples: esempio numerico senza virgolette, istruzione successiva salva', () => {
  // Il punto DENTRO l'importo non chiude la frase (è seguito da una cifra)
  assert.equal(
    stripFieldExamples('Massimale per sinistro, es. 3.000.000,00. NON un premio.'),
    'Massimale per sinistro. NON un premio.'
  )
  // Esempio in coda senza nulla dopo: si taglia tutto l'esempio
  assert.equal(
    stripFieldExamples('Tasso di regolazione per mille, es. 0,245'),
    'Tasso di regolazione per mille'
  )
  // Forma tra parentesi: comportamento storico invariato
  assert.equal(
    stripFieldExamples("Nome dell'agenzia assicurativa (es. ACQUI TERME)"),
    "Nome dell'agenzia assicurativa"
  )
  // Descrizione senza esempi: intatta
  assert.equal(stripFieldExamples('Partita IVA del contraente'), 'Partita IVA del contraente')
})

// ─── Finestra di contesto: ricerca NORMALIZZATA ──────────────────────────────
// Prima era letterale: una maiuscola diversa e l'affinità restava null, quindi
// l'arbitro semantico decideva sulla sola recency (metà dei candidati testuali).

test('findValueWindow: trova il valore anche con case/accenti/punteggiatura diversi', () => {
  const testo = 'COD. AGENZIA 001 00 ACQUI TERME — polizza RCT/RCO n. 283618616 del 31/12/2024'
  // il modello risponde "Acqui Terme", il documento scrive "ACQUI TERME"
  const win = findValueWindow(testo, 'Acqui Terme', '')
  assert.ok(win && win.includes('ACQUI TERME'), String(win))
  // valore assente → null (nessuna finestra inventata)
  assert.equal(findValueWindow(testo, 'MOGLIANO VENETO', ''), null)
  // importo con separatori diversi da quelli dell'OCR: ancora sulle cifre
  const importi = 'massimale per sinistro Euro 4.000.000.00 per ogni sinistro'
  assert.ok(findValueWindow(importi, '4.000.000,00', '')?.includes('4.000.000.00'))
})

test('findValueWindow: accetta un indice precalcolato e riporta gli offset grezzi', () => {
  const testo = "l'attività assicurata è: produzione di olii e grassi vegetali per industria"
  const idx = buildNormIndex(testo)
  const win = findValueWindow(idx, 'PRODUZIONE DI OLII', '')
  assert.ok(win && win.includes('produzione di olii e grassi vegetali'), String(win))
  // l'evidenza fa da ripiego quando il valore non compare
  assert.ok(findValueWindow(idx, 'olii vegetali di produzione', 'grassi vegetali')?.includes('grassi vegetali'))
})

// ─── Evidenza dei testi: tolleranza al refuso OCR ────────────────────────────

test('passesStagedEvidence: un solo token storpiato dall\'OCR non scarta il valore', () => {
  const f = { id: 'attivita', label: 'Attività assicurata', type: 'text' }
  // OCR: "olii" letto "olti". Il modello corregge il refuso → il valore è vero.
  const ctx = normForMatch("esercente un'impresa per la produzione di olti e grassi vegetali")
  assert.equal(passesStagedEvidence(f, 'produzione di olio e grassi vegetali', {}, ctx), true)
  // Ma una sola parola in comune non basta MAI (i caratteri coperti sono minoranza)
  assert.equal(passesStagedEvidence(f, 'produzione di macchinari industriali', {}, ctx), false)
  // Due token con quello lungo mancante: sotto la maggioranza dei caratteri → no
  const ctx2 = normForMatch('premio annuo della sezione')
  assert.equal(passesStagedEvidence(f, 'premio annuo consuntivo regolazione', {}, ctx2), false)
  // Valore di due parole con una assente: regola stretta invariata
  assert.equal(passesStagedEvidence(f, 'lavoro interinale', {}, normForMatch('lavoro dipendente')), false)
  // Valore interamente presente: passa come sempre
  assert.equal(passesStagedEvidence(f, 'grassi vegetali', {}, ctx), true)
})

// ─── Cross-field ─────────────────────────────────────────────────────────────

const XF_FIELDS = [
  { id: 'decorrenza', label: 'Decorrenza', type: 'date' },
  { id: 'scadenza', label: 'Scadenza', type: 'date' },
  { id: 'rcp_massimale_sinistro', label: 'Massimale per sinistro' },
  { id: 'rcp_massimale_annuo', label: 'Massimale annuo' },
  { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro' },
  { id: 'rct_massimale_annuo', label: 'Massimale annuo' },
  { id: 'rct_massimale_persona', label: 'Massimale per persona' },
  { id: 'rct_premio_imponibile', label: 'Premio imponibile' },
  { id: 'rct_imposta', label: 'Imposta' },
  { id: 'rct_premio_totale', label: 'Premio totale' },
]

test('validateCrossFields: decorrenza ≥ scadenza → decorrenza svuotata', () => {
  const best = {
    decorrenza: { valore: '31/12/2025' },
    scadenza: { valore: '31/12/2024' },
  }
  const notes = validateCrossFields(best, XF_FIELDS)
  assert.equal(best.decorrenza, undefined)
  assert.equal(best.scadenza.valore, '31/12/2024')
  assert.ok(notes.some((n) => /decorrenza/.test(n)))
})

test('validateCrossFields: massimale annuo < sinistro → annuo svuotato', () => {
  const best = {
    rcp_massimale_sinistro: { valore: '5.000.000,00' },
    rcp_massimale_annuo: { valore: '1.000.000,00' },
  }
  validateCrossFields(best, XF_FIELDS)
  assert.equal(best.rcp_massimale_annuo, undefined)
  assert.equal(best.rcp_massimale_sinistro.valore, '5.000.000,00')
})

test('validateCrossFields: persona 10.000.000 > sinistro 4.000.000 (fattore 2,5) NON svuota — annuo aggregato legittimo', () => {
  const best = {
    rct_massimale_sinistro: { valore: '4.000.000,00' },
    rct_massimale_persona: { valore: '10.000.000,00' },
  }
  validateCrossFields(best, XF_FIELDS)
  assert.equal(best.rct_massimale_persona.valore, '10.000.000,00', 'fattore 2,5: il per-persona (annuo aggregato) può superare il per-sinistro')
  assert.equal(best.rct_massimale_sinistro.valore, '4.000.000,00')
})

test('validateCrossFields: persona 6.000.000 > sinistro 2.000.000 (fattore 3) NON svuota — legittimo sul campo B/PROF.LE', () => {
  const best = {
    rct_massimale_sinistro: { valore: '2.000.000,00' },
    rct_massimale_persona: { valore: '6.000.000,00' },
  }
  const notes = validateCrossFields(best, XF_FIELDS)
  assert.equal(best.rct_massimale_persona.valore, '6.000.000,00', 'il fattore 3 è la situazione legittima (annuo aggregato > per sinistro)')
  assert.equal(best.rct_massimale_sinistro.valore, '2.000.000,00')
  assert.ok(!notes.some((n) => /massimali/.test(n)), 'nessuna nota di violazione per il caso legittimo')
})

test('validateCrossFields: persona 6.000.000 > sinistro 1.000.000 (fattore 6) NON svuota — il 5-6× è legittimo su RC-professione', () => {
  const best = {
    rct_massimale_sinistro: { valore: '1.000.000,00' },
    rct_massimale_persona: { valore: '6.000.000,00' },
  }
  const notes = validateCrossFields(best, XF_FIELDS)
  assert.equal(best.rct_massimale_persona.valore, '6.000.000,00', 'rapporto 6: persona > sinistro NON è spill, resta')
  assert.equal(best.rct_massimale_sinistro.valore, '1.000.000,00')
  assert.ok(!notes.some((n) => /persona/.test(n)))
})

test('validateCrossFields: persona > annuo valorizzato → persona svuotata (sottolimite impossibile), anche con fattore piccolo', () => {
  const best = {
    rct_massimale_sinistro: { valore: '2.000.000,00' },
    rct_massimale_annuo: { valore: '2.500.000,00' },
    rct_massimale_persona: { valore: '3.000.000,00' },
  }
  const notes = validateCrossFields(best, XF_FIELDS)
  assert.equal(best.rct_massimale_persona, undefined, 'persona > annuo è una violazione PALESE di sottolimite')
  assert.equal(best.rct_massimale_sinistro.valore, '2.000.000,00')
  assert.equal(best.rct_massimale_annuo.valore, '2.500.000,00')
  assert.ok(notes.some((n) => /sottolimite impossibile/.test(n)))
})

test('validateCrossFields: premio totale ≠ imponibile+imposta → totale dichiarato MANTENUTO (mai svuotato/calcolato)', () => {
  const best = {
    rct_premio_imponibile: { valore: '4.500,00' },
    rct_imposta: { valore: '1.001,25' },
    rct_premio_totale: { valore: '99.999,00' },
  }
  const notes = validateCrossFields(best, XF_FIELDS)
  assert.equal(best.rct_premio_totale.valore, '99.999,00', 'il totale dichiarato resta il dato reale')
  assert.equal(best.rct_imposta.valore, '1.001,25')
  assert.ok(notes.some((n) => /totale dichiarato/.test(n)), 'nota diagnostica di incoerenza presente')
})

test('validateCrossFields: golden EULIP coerente non viene toccato', () => {
  const best = {
    decorrenza: { valore: '31/12/2024' },
    scadenza: { valore: '31/12/2025' },
    rct_massimale_sinistro: { valore: '4.000.000,00' },
    rct_imposta: { valore: '1.001,25' },
    rct_premio_imponibile: { valore: '4.500,00' },
    rct_premio_totale: { valore: '5.501,25' },
  }
  const notes = validateCrossFields(best, XF_FIELDS, { hasAnnualPeriodics: true })
  assert.equal(notes.length, 0)
  assert.equal(best.decorrenza.valore, '31/12/2024')
  assert.equal(best.rct_premio_totale.valore, '5.501,25')
})

// ─── Numerico in campo TESTO: "meglio vuoto che dato sbagliato" ─────────────
// Un A/B reale sul fascicolo Cedam ha mostrato i campi la cui description è
// TESTO… uscire con numeri/importi al posto del testo (rcp_imposta→1,32 per il
// "tacito rinnovo" SÌ/NO, rcp_premio_imponibile→13.068,00 per il frazionamento,
// rct_tasso→75,00, rct_premio_imponibile→13.068,00, rct_importo_preventivo→"4",
// rcp_scoperto_min_mondo→"4"). Il guard isTextualNumericOnly ripulisce via
// sanitizeFieldValue i campi TESTO da un valore puramente numerico, SENZA mai
// toccare i campi NUMERO/IMPORTO.

const TEX_FIELD = { id: 'rcp_imposta', label: 'Imposta', description: 'TESTO (SÌ/NO). Tacito rinnovo automatico della polizza: SÌ oppure NO.', type: 'text' }
const NUM_FIELD = { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro', description: 'NUMERO/IMPORTO, es. 4.000.000,00', type: 'text' }

test('isTextualField: type FORTE esplicito vince sulla description (fonte di verità)', () => {
  // Il type esplicito è la fonte di verità: un campo dichiarato NUMERO/IMPORTO
  // (type 'number') resta numerico anche se la description sembra testuale.
  assert.equal(isTextualField({ type: 'number', description: 'TESTO. Qualcosa' }), false)
  // ... e un campo dichiarato TESTO resta testuale anche se la description tace.
  assert.equal(isTextualField({ type: 'text', description: 'VALORE qualsiasi' }), false)
})

test('isTextualField: type \'text\' è il default STORICO: decide la description', () => {
  // type:'text' è scritto su quasi tutti i campi già salvati senza valore
  // semantico: NON deve trasformare un NUMERO/IMPORTO in testo per un refuso.
  const numDesc = { id: 'x', type: 'text', description: 'NUMERO/IMPORTO (euro). Massimale…' }
  assert.equal(isTextualField(numDesc), false)
  const testoDesc = { id: 'x', type: 'text', description: 'TESTO (elenco). Sinistri…' }
  assert.equal(isTextualField(testoDesc), true)
})

test('isTextualNumericOnly: valori numerici puri su campo TESTO vengono scartati', () => {
  for (const v of ['13.068,00', '4', '1,2', '75,00', '1,32', '0', '45,6', '1.800.000']) {
    assert.equal(isTextualNumericOnly(TEX_FIELD, v), true, `"${v}" deve essere scartato su campo TESTO`)
  }
})

test('isTextualNumericOnly: non scarta valori testuali con cifre dentro', () => {
  for (const v of ['SÌ', 'No', 'annuale', 'semestrale', 'retribuzioni', 'CENTRI DIAGNOSTICI', 'produzione di olii e grassi', 'Via Roma 12', 'IVA 22%']) {
    assert.equal(isTextualNumericOnly(TEX_FIELD, v), false, `"${v}" è testo, NON va scartato`)
  }
})

test('isTextualNumericOnly: NON tocca i campi NUMERO/IMPORTO', () => {
  for (const v of ['13.068,00', '4', '75,00', '1.800.000', '1,2']) {
    assert.equal(isTextualNumericOnly(NUM_FIELD, v), false, `"${v}" su NUMERO/IMPORTO resta`)
  }
})

test('isTextualNumericOnly: sinistri non accetta l\'attività (numero/codice)', () => {
  // 6e39add8 (sinistri e circostanze) è TESTO-elenco: il modello metteva
  // l'attività "CENTRI DIAGNOSTICI" al posto dei sinistri. Un codice/numero non
  // è un elenco di sinistri: il guard lo deve scartare (meglio vuoto).
  const sinistri = { id: '6e39add8', description: 'TESTO (elenco). Sinistri e circostanze denunciate', type: 'text' }
  assert.equal(isTextualNumericOnly(sinistri, '4'), true)
  assert.equal(isTextualNumericOnly(sinistri, '001'), true)
  // L'attività come testo reale resta (non è un numero puro)
  assert.equal(isTextualNumericOnly(sinistri, 'CENTRI DIAGNOSTICI'), false)
})

// ─── Guardia "premio da copertura diversa" (PROF.LE) ────────────────────────
// Il fascicolo RC PROF.LE contiene più coperture: una RC professionale vera
// ("01. RC PROFESSIONE SANITARIA", premio 61,00) e una RC INFORTUNI (premio
// 25,00). I documenti di copertura NON-RC non possono popolare i campi premio
// della RC professionale. "Le regole scelgono, non inventano": il 25,00 resta
// valido solo se è davvero il premio RC; lo si esclude solo quando la fonte è
// un documento di altra copertura.

test('Fix PROF.LE: documento "RC INFORTUNI" È riconosciuto come copertura diversa', () => {
  assert.equal(isOtherCoverageDocName('01. RC INFORTUNI.pdf'), true)
  assert.equal(isOtherCoverageDocName('RC INFORTUNI INFORTUNI.pdf'), true)
  assert.equal(isOtherCoverageDocName('TUTELA LEGALE.pdf'), true)
  assert.equal(isOtherCoverageDocName('Certificato di guida.pdf'), true)
  assert.equal(isOtherCoverageDocName('01. RC PROFESSIONE SANITARIA.pdf'), false)
  assert.equal(isOtherCoverageDocName('polizza.pdf'), false)
  assert.equal(isOtherCoverageDocName('quietanza 2025.pdf'), false)
})

test('Fix PROF.LE: il candidato premio da "RC INFORTUNI" è vetato per i campi premio RC', () => {
  const rcpPremio = { id: 'rcp_premio_totale', label: 'Premio totale', description: 'Premio della RC professionale' }
  assert.equal(isPremiumField(rcpPremio), true)
  assert.equal(isOtherCoveragePremiumSource(rcpPremio, '01. RC INFORTUNI.pdf'), true)
})

test('Fix PROF.LE: il documento RC professionale NON veta lo stesso campo premio', () => {
  const rcpPremio = { id: 'rcp_premio_totale', label: 'Premio totale' }
  assert.equal(isOtherCoveragePremiumSource(rcpPremio, '01. RC PROFESSIONE SANITARIA.pdf'), false)
  assert.equal(isOtherCoveragePremiumSource(rcpPremio, 'polizza RC professionale.pdf'), false)
})

test('Fix PROF.LE: la guardia premio NON tocca i campi non-premio né la parola "infortuni" in un campo non-premio', () => {
  // Un campo strutturale/altro ramo non è premio: la guardia è inerte.
  const massimale = { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro' }
  assert.equal(isPremiumField(massimale), false)
  assert.equal(isOtherCoveragePremiumSource(massimale, '01. RC INFORTUNI.pdf'), false)
})

test('Fix PROF.LE: isPremiumField riconosce premio totale/imponibile/imposta ma non massimali/scoperti', () => {
  assert.equal(isPremiumField({ id: 'rcp_premio_totale', label: 'Premio totale' }), true)
  assert.equal(isPremiumField({ id: 'rct_premio_imponibile', label: 'Premio imponibile' }), true)
  assert.equal(isPremiumField({ id: 'rcp_imposta', label: 'Imposta' }), true)
  assert.equal(isPremiumField({ id: 'rct_premio_lordo_annuo', label: 'Premio lordo annuo' }), true)
  assert.equal(isPremiumField({ id: 'rct_massimale_danni', label: 'Franchigia base' }), false)
  assert.equal(isPremiumField({ id: 'rct_massimale_sinistro', label: 'Massimale per sinistro' }), false)
  // id RIUSATO con label testuale: NON è un campo premio (Frazionamento / Tacito Rinnovo)
  assert.equal(isPremiumField({ id: 'rcp_premio_imponibile', label: 'Frazionamento' }), false)
  assert.equal(isPremiumField({ id: 'rcp_imposta', label: 'Tacito Rinnovo' }), false)
})
