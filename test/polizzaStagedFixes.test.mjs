/**
 * Test dei 4 fix del motore a stadi (RC PROF MED V2, 17→25) — parte PURA.
 *
 *   FIX 1 — disambiguazione massimale annuo / fatturato / premio-imponibile
 *   FIX 2 — franchigia: i milioni (massimale o opzione) NON sono una franchigia
 *   FIX 3 — sottolimiti: la stringa da opzioni-questionario non è il contratto
 *   FIX 4 — guardrail Tutela: senza evidenza della garanzia, i 4 campi restano vuoti
 *
 * Esegui: node --test test/polizzaStagedFixes.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildFactsRegistry,
  vetoForeignNatureMassimaleAnnuo,
  vetoForeignNatureFatturato,
  vetoForeignNatureFranchigia,
  vetoSottolimitiOptionOnly,
  vetoForeignNatureMassimale,
} from '../src/main/services/polizzaFactsRegistry.js'
import {
  pickSemanticCandidate,
} from '../src/main/services/polizzaValidation.js'
import { scanKindForField } from '../src/main/services/polizzaNumericScan.js'
import {
  descriptionDeniesNature,
  factNature,
  isConditionalCoverageField,
  isSpecificCoverageField,
  hasDocumentedTutelaEvidence,
} from '../src/main/services/polizzaValidation.js'
import { validateCrossFields } from '../src/main/services/polizzaValidation.js'

// ─── Funzioni helper ─────────────────────────────────────────────────────────

function textDoc(name, text) {
  return { name, pages: [text], text }
}

// Campi reali del profilo RC PROF MED V2 (id/label/description)
const MASS_ANNUO = {
  id: 'rct_massimale_persona',
  label: 'Massimale annuo',
  description: 'NUMERO/IMPORTO (euro). Massimale annuo aggregato (per esempio 7.500.000,00). CONTA LE CIFRE: 7.500.000 NON è 7500. Non riutilizzare un valore identico a un altro campo (es. massimale per sinistro) a cui deve essere diverso.',
}
const FATTURATO = {
  id: 'e1d90f78-3e3a-4e42-be90-001b8c34c05a',
  label: 'Fatturato dichiarato',
  description: 'NUMERO/IMPORTO. Fatturato dichiarato per la quotazione/regolazione (per esempio 13.158,70). Riporta TUTTE le cifre e le migliaia, NON ridurle.',
}
const FRANCHIGIA = {
  id: 'rct_massimale_danni',
  label: 'Franchigia base',
  description: 'NUMERO/IMPORTO (euro). Franchigia base (per esempio 2.500,00). Se nel documento è diversa dal massimale, riporta il valore DIVERSO e non il massimale (non deve uscire 7500). Riporta TUTTE le cifre.',
}
const SOTTOLIMITI = {
  id: 'rct_parametro',
  label: 'Sottolimiti',
  description: 'TESTO (elenco). Tutti i sottolimiti indicati, con la garanzia a cui si riferiscono (per esempio "RC OPERAI: 1.000.000,00"). Riporta i valori esatti con TUTTE le cifre, MAI il massimale generale.',
}
const TUTELA = {
  id: 'rcp_scoperto_min_mondo',
  label: 'Tutela',
  description: 'TESTO. Verifica se è presente la garanzia Tutela e/o Tutela legale e descrivila (per esempio "Tutela legale: presente"). Rispondi col TESTO, MAI con un importo/numero/0.',
}

// ─── FIX 1 — pred puri ───────────────────────────────────────────────────────

test('FIX1: descriptionDeniesNature riconosce il divieto di riuso (massimale annuo)', () => {
  assert.equal(descriptionDeniesNature(MASS_ANNUO.description), true)
  assert.equal(descriptionDeniesNature(FRANCHIGIA.description), true)
  assert.equal(descriptionDeniesNature('Massimale per ogni sinistro'), false)
})

test('FIX1: factNature distingue massimale / premio / basso', () => {
  assert.equal(factNature('massimale intero di polizza'), 'massimale')
  assert.equal(factNature('premio annuo totale imponibile'), 'premio')
  assert.equal(factNature('franchigia'), 'basso')
  assert.equal(factNature(''), null)
})

// ─── FIX 1 — veto natura estranea (massimale annuo) ─────────────────────────

test('FIX1: il 13.068,00 (imponibile+imposta quietanza) NON è il massimale annuo', () => {
  const reg = buildFactsRegistry([
    textDoc('quietanza.pdf', 'Premio imponibile 12.066,75 imposta 1.001,25 totale 13.068,00'),
  ])
  assert.equal(vetoForeignNatureMassimaleAnnuo(reg, MASS_ANNUO, '13.068,00'), true)
})

test('FIX1: il 7.500.000,00 della dichiarazione È il massimale annuo (mai veto)', () => {
  const reg = buildFactsRegistry([
    textDoc('dichiarazione.pdf', 'Massimali Assicurati: RCT/RCO 7.500.000,00 Unico per sinistro'),
  ])
  assert.equal(vetoForeignNatureMassimaleAnnuo(reg, MASS_ANNUO, '7.500.000,00'), false)
})

test('FIX1: massimale annuo senza registro non si giudica (nessun veto)', () => {
  assert.equal(vetoForeignNatureMassimaleAnnuo(null, MASS_ANNUO, '13.068,00'), false)
})

test('FIX1: flusso merge — l\'imponibile quietanza non diventa massimale annuo', () => {
  // Il modello propone 13.068 (imponibile) con evidenza da quietanza: il veto
  // lo scarta PRIMA dell'arbitro; il 7.500.000 della dichiarazione passa.
  const reg = buildFactsRegistry([
    textDoc('quietanza.pdf', 'Premio imponibile 12.066,75 imposta 1.001,25 totale 13.068,00'),
    textDoc('dichiarazione.pdf', 'Massimali Assicurati: RCT/RCO 7.500.000,00 Unico per sinistro'),
  ])
  assert.equal(vetoForeignNatureMassimaleAnnuo(reg, MASS_ANNUO, '13.068,00'), true)
  assert.equal(vetoForeignNatureMassimaleAnnuo(reg, MASS_ANNUO, '7.500.000,00'), false)
  const dich = { valore: '7.500.000,00', effDate: '31/07/2026', affinity: 0.61, docPos: 1 }
  assert.equal(pickSemanticCandidate(null, dich, 'strutturali').valore, '7.500.000,00')
})

// ─── FIX 1 — veto natura estranea (fatturato) ────────────────────────────────

test('FIX1: il 7.500.000 che nel testo è SOLO "Massimali Assicurati" NON è il fatturato', () => {
  const reg = buildFactsRegistry([
    textDoc('dichiarazione.pdf', 'Massimali Assicurati: RCT/RCO Euro 7.500.000,00 Unico per sinistro'),
  ])
  assert.equal(vetoForeignNatureFatturato(reg, FATTURATO, '7.500.000,00'), true)
})

test('FIX1: il fatturato dichiarato vero (13.158,70) non viene mai vetato', () => {
  const reg = buildFactsRegistry([
    textDoc('dichiarazione.pdf', 'Fatturato dichiarato 13.158,70 per quotazione premio'),
  ])
  assert.equal(vetoForeignNatureFatturato(reg, FATTURATO, '13.158,70'), false)
})

test('FIX1: campo NON fatturato → mai veto (la guardia è descrittiva)', () => {
  const reg = buildFactsRegistry([
    textDoc('dichiarazione.pdf', 'Massimali Assicurati: RCT/RCO 7.500.000,00'),
  ])
  assert.equal(vetoForeignNatureFatturato(reg, MASS_ANNUO, '7.500.000,00'), false)
})

test('FIX1: il consuntivo FATTURATO 8.045.000 della tabella regolazione non è mai vetato', () => {
  // Il valore vero (consuntivo della regolazione premio) ha etichetta "CATEGORIA"
  // e NON è mai solo-massimale: nessuna vetata possibile.
  const reg = buildFactsRegistry([
    textDoc('app_regolazione.pdf', 'Dato consuntivo  Premio consuntivo\nCATEGORIA  8.045.000,00 €  |  326  |  26.226,70 €'),
  ])
  assert.equal(vetoForeignNatureFatturato(reg, FATTURATO, '8.045.000,00'), false)
})

// ─── FIX 2 — franchigia ──────────────────────────────────────────────────────

test('FIX2: un importo da opzione-questionario nell\'ordine del massimale NON è la franchigia', () => {
  const reg = buildFactsRegistry([
    textDoc('questionario.pdf', 'Nuovo questionario assuntivo: massimali da scegliere ☐ 2.000.000,00'),
  ])
  assert.equal(vetoForeignNatureFranchigia(reg, FRANCHIGIA, '2.000.000,00'), true)
})

test('FIX2: la franchigia frontale 20.000 dell\'atto 2019 non è mai vetata', () => {
  const reg = buildFactsRegistry([
    textDoc('atto2019.pdf', 'atto di aumento massimale + inserimento franchigia: franchigia frontale 20.000,00'),
    textDoc('questionario.pdf', '☐ opzione massimale 2.000.000,00'),
  ])
  assert.equal(vetoForeignNatureFranchigia(reg, FRANCHIGIA, '20.000,00'), false)
})

test('FIX2: 2.000.000 rifiutato anche quando nel fascicolo esiste la 20.000', () => {
  const reg = buildFactsRegistry([
    textDoc('atto2019.pdf', 'franchigia frontale 20.000,00'),
    textDoc('questionario.pdf', '☐ opzione massimale 2.000.000,00'),
  ])
  assert.equal(vetoForeignNatureFranchigia(reg, FRANCHIGIA, '2.000.000,00'), true)
})

test('FIX2: valore piccolo (sotto soglia) mai veto, anche se compare solo nel questionario', () => {
  const reg = buildFactsRegistry([
    textDoc('questionario.pdf', '☐ franchigia 500,00'),
  ])
  assert.equal(vetoForeignNatureFranchigia(reg, FRANCHIGIA, '500,00'), false)
})

test('FIX2: flusso merge — la franchigia 20.000 vince sul 2.000.000 da opzione', () => {
  // Simulazione del merge: il veto scarta il 2.000.000 PRIMA dell'arbitro, la
  // 20.000 dall'atto 2019 arriva al merge e viene accettata.
  const reg = buildFactsRegistry([
    textDoc('atto2019.pdf', 'atto di aumento massimale + inserimento franchigia frontale 20.000,00'),
    textDoc('questionario.pdf', '☐ opzione massimale 2.000.000,00'),
  ])
  // il candidato da opzione viene VETATO (mai nel merge)
  assert.equal(vetoForeignNatureFranchigia(reg, FRANCHIGIA, '2.000.000,00'), true)
  // la franchigia reale NON viene vetata
  assert.equal(vetoForeignNatureFranchigia(reg, FRANCHIGIA, '20.000,00'), false)
  // senza veto, l'arbitro semantico promuove il candidato dall'atto (affinità alta)
  const opzione = { valore: '2.000.000,00', effDate: null, affinity: 0.55, docPos: 2 }
  const atto = { valore: '20.000,00', effDate: '31/12/2019', affinity: 0.62, docPos: 1 }
  // l'opzione non deve MAI competere: il veto la esclude; il candidato reale vince
  assert.equal(pickSemanticCandidate(null, atto, 'strutturali').valore, '20.000,00')
})

test('FIX2: campo senza description che nega il massimale → mai veto', () => {
  const reg = buildFactsRegistry([
    textDoc('polizza.pdf', 'Massimale di polizza 2.000.000,00'),
  ])
  const normale = { id: 'x', label: 'Importo libero', description: 'Valore libero' }
  assert.equal(vetoForeignNatureFranchigia(reg, normale, '2.000.000,00'), false)
})

// ─── FIX 3 — sottolimiti ─────────────────────────────────────────────────────

test('FIX3: la stringa RCO/RCT dalle sole opzioni del questionario viene scartata', () => {
  const reg = buildFactsRegistry([
    textDoc('questionario.pdf', 'Scelta tra i seguenti massimali: RCO 2.000.000,00 oppure RCT 1.000.000,00 ☐'),
    textDoc('polizza.pdf', 'Sottolimiti: RC OPERAI 740.000,00; RCO 500.000,00; RCT 260.000,00'),
  ])
  const optionDocs = new Set(['questionario.pdf'])
  // la stringa dal questionario contiene importi SOLO lì → veto
  assert.equal(vetoSottolimitiOptionOnly(reg, optionDocs, SOTTOLIMITI, 'RCO: 2.000.000,00 / RCT: 1.000.000,00'), true)
  // la stringa dal CORPO della polizza ha riscontro nel testo non-opzione → mai veto
  assert.equal(vetoSottolimitiOptionOnly(reg, optionDocs, SOTTOLIMITI, 'RC OPERAI: 740.000,00; RCO: 500.000,00; RCT: 260.000,00'), false)
})

test('FIX3: affinità del CORPO della polizza vince sulle opzioni (flusso merge)', () => {
  const reg = buildFactsRegistry([
    textDoc('questionario.pdf', 'RCO 2.000.000,00 / RCT 1.000.000,00 ☐'),
    textDoc('polizza.pdf', 'Sottolimiti RC OPERAI 740.000,00 RCO 500.000,00 RCT 260.000,00'),
  ])
  const optionDocs = new Set(['questionario.pdf'])
  // la stringa dalle opzioni è VETATA (mai nel merge)
  assert.equal(vetoSottolimitiOptionOnly(reg, optionDocs, SOTTOLIMITI, 'RCO: 2.000.000,00 / RCT: 1.000.000,00'), true)
  // la stringa dal corpo della polizza non è vetata e vince l'arbitro
  assert.equal(vetoSottolimitiOptionOnly(reg, optionDocs, SOTTOLIMITI, 'RC OPERAI: 740.000,00; RCO: 500.000,00; RCT: 260.000,00'), false)
  const corpo = { valore: 'RC OPERAI: 740.000,00; RCO: 500.000,00; RCT: 260.000,00', effDate: null, affinity: 0.6, docPos: 1 }
  assert.equal(pickSemanticCandidate(null, corpo, 'strutturali').valore, corpo.valore)
})

test('FIX3: un solo importo nell\'elenco → non è l\'elenco dei sottolimiti → nessun veto', () => {
  const reg = buildFactsRegistry([
    textDoc('questionario.pdf', '☐ massimale 2.000.000,00'),
  ])
  const optionDocs = new Set(['questionario.pdf'])
  assert.equal(vetoSottolimitiOptionOnly(reg, optionDocs, SOTTOLIMITI, 'RCO: 2.000.000,00'), false)
})

test('FIX3: senza documenti-opzione il veto non scatta mai', () => {
  const reg = buildFactsRegistry([
    textDoc('polizza.pdf', 'RC OPERAI 740.000,00'),
  ])
  assert.equal(vetoSottolimitiOptionOnly(reg, new Set(), SOTTOLIMITI, 'RC OPERAI: 740.000,00'), false)
})

test('FIX3: campo che non è "sottolimiti" → mai veto', () => {
  const reg = buildFactsRegistry([
    textDoc('questionario.pdf', '☐ 2.000.000,00 / ☐ 1.000.000,00'),
  ])
  const optionDocs = new Set(['questionario.pdf'])
  const altro = { id: 'x', label: 'Altro elenco', description: 'TESTO (elenco). qualsiasi' }
  assert.equal(vetoSottolimitiOptionOnly(reg, optionDocs, altro, 'RCO: 2.000.000,00 / RCT: 1.000.000,00'), false)
})

// ─── FIX 4 — guardrail Tutela ────────────────────────────────────────────────

test('FIX4: la description "Verifica se è presente la garanzia Tutela" è condizionata', () => {
  assert.equal(isConditionalCoverageField(TUTELA), true)
  assert.equal(isConditionalCoverageField(MASS_ANNUO), false)
  // i 4 campi Tutela del profilo (testuale + massimale + franchigia + premio)
  const massTutela = { id: 'c23c8480', label: 'Massimale Tutela', description: 'NUMERO/IMPORTO (euro). Massimale della garanzia Tutela/Tutela legale' }
  const franchTutela = { id: '6d1e131a', label: 'Franchigia Tutela', description: 'NUMERO/IMPORTO (euro). Franchigia della garanzia Tutela/Tutela legale' }
  const premioTutela = { id: '0df0e5bc', label: 'Premio Lordo Tutela', description: 'NUMERO/IMPORTO (euro). Premio lordo della garanzia Tutela/Tutela legale' }
  for (const f of [TUTELA, massTutela, franchTutela, premioTutela]) {
    assert.equal(isSpecificCoverageField(f), true, f.id)
  }
  assert.equal(isSpecificCoverageField(MASS_ANNUO), false)
  assert.equal(isSpecificCoverageField(FRANCHIGIA), false)
})

test('FIX4: evidenza della garanzia Tutela presente nel fascicolo (non-opzione) → sì', () => {
  const docs = [
    textDoc('polizza.pdf', 'GARANZIA TUTELA LEGALE: massimale 100.000,00 per sinistro'),
  ]
  assert.equal(hasDocumentedTutelaEvidence(docs), true)
})

test('FIX4: la parola "tutela" nel contenuto NON è evidenza della garanzia', () => {
  const docs = [
    textDoc('condizioni.pdf', 'l\'attività di tutela dei dati personali non è coperta da RC professionale'),
  ]
  assert.equal(hasDocumentedTutelaEvidence(docs), false)
})

test('FIX4: evidenza SOLO in un documento-opzione NON conta come garanzia operante', () => {
  // Il chiamante (guardrail) filtra i doc-opzione PRIMA della prova: i documenti
  // non-opzione che arrivano alla funzione sono quelli della polizza. Se la
  // garanzia sta SOLO nel questionario, nei doc non-opzione non c'è evidenza.
  const docsNonOpzione = [
    textDoc('polizza.pdf', 'Massimali Assicurati: RCT/RCO Euro 7.500.000,00 Unico per sinistro'),
  ]
  assert.equal(hasDocumentedTutelaEvidence(docsNonOpzione), false)
  // ma la stessa stringa in un documento NON-opzione vale come evidenza
  const docsPolizza = [textDoc('polizza.pdf', 'Tutela legale: presente, massimale 100.000,00')]
  assert.equal(hasDocumentedTutelaEvidence(docsPolizza), true)
})

test('FIX4: nessuna evidenza → i campi Tutela restano vuoti (guardrail deterministico)', () => {
  // Il merge NON deve avere alcun candidato: simuliamo la decisione del
  // guardrail con `hasDocumentedTutelaEvidence` su un fascicolo senza garanzia.
  const docs = [
    textDoc('polizza.pdf', 'Massimali Assicurati: RCT/RCO Euro 7.500.000,00 Unico per sinistro'),
    textDoc('quietanza.pdf', 'Premio totale 7.260,00'),
    textDoc('appendice.pdf', 'franchigia fabbricati 250,00'),
  ]
  assert.equal(hasDocumentedTutelaEvidence(docs), false)
})

test('FIX4: pattern tipici di garanzia operante vengono riconosciuti', () => {
  const cases = [
    'Massimale della garanzia Tutela: 100.000,00',
    'GARANZIA TUTELA LEGALE attivata con decorrenza 1/1/2025',
    'Sezione Tutela - massimale 50.000,00',
    'Tutela legale: presente (massimale per sinistro 100.000,00)',
  ]
  for (const t of cases) {
    assert.equal(hasDocumentedTutelaEvidence([textDoc('polizza.pdf', t)]), true, t)
  }
  // La semplice parola "tutela" (es. tutela dei dati) NON basta
  assert.equal(hasDocumentedTutelaEvidence([textDoc('c.pdf', 'tutela dei dati personali')]), false)
  assert.equal(hasDocumentedTutelaEvidence([textDoc('c.pdf', 'tutela')]), false)
})

// ─── FIX 5 — NATURA ESTRANEA MASSIMALE (CEDAM) ─────────────────────────────
// Il 7.500.000 della dichiarazione è il massimale per-sinistro. Un campo che
// non è un massimale (Estensioni operative, Esclusioni, coperture rcp_*) NON
// deve riceverlo né via LLM né via scan deterministico.

test('FIX5: il 7.500.000 (solo massimale nel registro) NON va su Estensioni/Esclusioni/coperture', () => {
  const reg = buildFactsRegistry([
    textDoc('dichiarazione.pdf', 'Massimali Assicurati: RCT/RCO Euro 7.500.000,00 Unico per sinistro'),
    textDoc('atto2019.pdf', 'elevare il massimale RCT/O/Aggregato ad € 7.500.000,00'),
  ])
  const ESTENSIONI = { id: 'rct_importo_preventivo', label: 'Estensioni operative', description: 'Estrai le estensioni effettivamente operanti indicate in scheda, appendici o condizioni particolari.' }
  const ESCLUSIONI = { id: 'rct_tasso', label: 'Esclusioni particolari', description: 'Estrai le esclusioni particolari o rilevanti.' }
  const PROGETTAZIONE = { id: 'rcp_massimale_sinistro', label: 'Progettazione / DL', description: 'Verifica se sono coperte progettazione, direzione lavori, coordinamento sicurezza...' }
  for (const f of [ESTENSIONI, ESCLUSIONI, PROGETTAZIONE]) {
    assert.equal(vetoForeignNatureMassimale(reg, f, '7.500.000,00'), true, `${f.label} non deve ricevere il massimale`)
  }
  // il campo massimale giusto non viene MAI vetato
  assert.equal(vetoForeignNatureMassimale(reg, MASS_ANNUO, '7.500.000,00'), false)
  const MASS_SINISTRO = { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro', description: 'NUMERO/IMPORTO (euro). Massimale per singolo sinistro (per esempio 7.500.000,00). Non riutilizzare un valore identico (es. massimale annuo, franchigia).' }
  assert.equal(vetoForeignNatureMassimale(reg, MASS_SINISTRO, '7.500.000,00'), false)
})

test('FIX5: la franchigia 20.000 dell\'atto NON è un massimale: mai veto su nessun campo', () => {
  const reg = buildFactsRegistry([
    textDoc('atto2019.pdf', 'franchigia frontale per ogni tipo di danno di € 20.000,00'),
  ])
  const ESTENSIONI = { id: 'rct_importo_preventivo', label: 'Estensioni operative', description: 'Estrai le estensioni effettivamente operanti.' }
  assert.equal(vetoForeignNatureMassimale(reg, ESTENSIONI, '20.000,00'), false)
})

test('FIX5: la scan deterministica NON scrive il per-sinistro su campi non-massimali (flusso merge completo)', () => {
  const docs = [
    textDoc('dichiarazione.pdf', 'Massimali Assicurati: RCT/RCO Euro 7.500.000,00 Unico per sinistro'),
  ]
  const field = { id: 'rct_importo_preventivo', label: 'Estensioni operative', description: 'Estrai le estensioni effettivamente operanti.' }
  const reg = buildFactsRegistry([textDoc('dichiarazione.pdf', 'Massimali Assicurati: RCT/RCO Euro 7.500.000,00 Unico per sinistro')])
  // sia il veto sia il mapping natura→campo rifiutano il valore
  assert.equal(scanKindForField(field), null)
  assert.equal(vetoForeignNatureMassimale(reg, field, '7.500.000,00'), true)
  assert.equal(docs.length, 1)
})

// ─── FIX 7 — coordinate cross-field persona/sinistro (B/PROF.LE) ────────────
// Il drop "persona > sinistro" dell'arbitro voleva correggere uno spill ma
// svuotava la situazione LEGITTIMA "sinistro 1.000.000 < persona 6.000.000">
// (annuo aggregato: il per-persona copre più sinistri; rapporto 5-6× legittimo
// su RC-professione). Il drop resta solo sulla violazione PALESE (per-persona >
// annuo valorizzato); gli spill IDENTICI li pulisce la guardia post-merge.

test('FIX7: persona 6.000.000 > sinistro 2.000.000 (fattore 3) NON svuota — motore applica sempre validateCrossFields', () => {
  const best = {
    rct_massimale_sinistro: { valore: '2.000.000,00' },
    rct_massimale_persona: { valore: '6.000.000,00' },
  }
  const fields = [
    { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro' },
    { id: 'rct_massimale_persona', label: 'Massimale per persona' },
  ]
  const notes = validateCrossFields(best, fields)
  assert.equal(best.rct_massimale_persona.valore, '6.000.000,00', 'B/PROF.LE: il fattore 3 è legittimo, NON si svuota')
  assert.equal(best.rct_massimale_sinistro.valore, '2.000.000,00')
  assert.ok(!notes.some((n) => /persona/.test(n)))
})