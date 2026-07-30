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
  looseAmount,
  isSuspectStructuralOverride,
  isRinvioAttivita,
  isCompanyNameAsAgency,
  isInsurerFooterPIva,
  pickSemanticCandidate,
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
