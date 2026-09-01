/**
 * Test del Registro dei fatti numerici (parte PURA, zero LLM).
 *
 * Esegui:  node --test test/polizzaFactsRegistry.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildFactsRegistry, isFactPlausible, vetoMergeCandidate,
  LARGE_AMOUNT_THRESHOLD,
} from '../src/main/services/polizzaFactsRegistry.js'

const MASSIMALE = { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro' }
const PREMIO = { id: 'rct_premio_totale', label: 'Premio totale' }

test('buildFactsRegistry: arricchisce coppie numero→label (massimale e premio)', () => {
  const docs = [
    { name: 'polizza.pdf', pages: ['Massimale sinistro: 4.000.000,00'] },
    { name: 'quietanza.pdf', pages: ['Premio annuo totale 5.501,25'] },
  ]
  const reg = buildFactsRegistry(docs)
  assert.equal(reg.facts.length, 2)
  const mass = reg.facts.find((f) => f.value === 4_000_000)
  assert.ok(mass, 'manca la voce del massimale')
  assert.equal(mass.kind, 'amount')
  assert.equal(mass.doc, 'polizza.pdf')
  assert.equal(mass.page, 1)
  assert.ok(mass.cats.includes('massimale'))
  const prem = reg.facts.find((f) => f.value === 5_501.25)
  assert.ok(prem, 'manca la voce del premio')
  assert.ok(prem.cats.includes('premio'))
})

test('buildFactsRegistry: accetta anche array di soli testi (no name)', () => {
  const reg = buildFactsRegistry(['Premio 1.000,00'])
  assert.equal(reg.facts.length, 1)
  assert.equal(reg.facts[0].doc, 'doc')
  assert.equal(reg.facts[0].value, 1000)
})

test('isFactPlausible: massimale vero = true, fantasma enorme = false', () => {
  const reg = buildFactsRegistry([
    { name: 'polizza.pdf', pages: ['Massimale sinistro: 4.000.000,00'] },
    { name: 'quietanza.pdf', pages: ['Premio annuo 5.501,25'] },
  ])
  assert.equal(isFactPlausible(reg, MASSIMALE, '4.000.000,00'), true)
  assert.equal(isFactPlausible(reg, MASSIMALE, 999_999_999_999), false)
  assert.equal(isFactPlausible(reg, PREMIO, '5.501,25'), true)
})

test('isFactPlausible: importo "rata" che esiste non viene mai vetato', () => {
  const reg = buildFactsRegistry([{ name: 'quietanza.pdf', pages: ['Rata 1.000,00'] }])
  // la cifra esiste → mai `false`, anche con label non coerente col campo
  assert.equal(isFactPlausible(reg, MASSIMALE, '1.000,00'), null)
  assert.equal(isFactPlausible(reg, PREMIO, '1.000,00'), null)
})

test('isFactPlausible: cifra esistente ma label assente → null (non blocca)', () => {
  const reg = buildFactsRegistry([{ name: 'polizza.pdf', pages: ['4.000.000,00'] }])
  // il numero esiste nudo, senza label anagrafica: NON è un veto di per sé
  assert.equal(isFactPlausible(reg, MASSIMALE, '4.000.000,00'), null)
})

test('isFactPlausible: campo non classificabile → null conservativo', () => {
  const reg = buildFactsRegistry([{ name: 'polizza.pdf', pages: ['Massimale sinistro: 4.000.000,00'] }])
  assert.equal(isFactPlausible(reg, { id: 'campo_sconosciuto', label: 'Descrizione libera' }, '4.000.000,00'), null)
})

test('boilerplate (anni, date, PAG.) non generano fatti-importo né blocchi', () => {
  const reg = buildFactsRegistry([
    { name: 'polizza.pdf', pages: ['2024  31/12/2024  Pag. 1', 'Decorrenza 31.12.2024'] },
  ])
  // gli anni e le date (anche puntinate) NON diventano importo da whitelist:
  // nessun fatto-importo coincide con un anno o con una data puntinta
  const amountFacts = reg.facts.filter((f) => f.kind === 'amount')
  assert.ok(!amountFacts.some((f) => [2024, dateToNumber('31.12.2024')].includes(f.value)),
    'anni/date diventati importo')
  // e comunque un fantasma largo resta fantasticato (non reso plausibile)
  assert.equal(isFactPlausible(reg, MASSIMALE, 4_000_000), false)
  // un anno singolo (piccolo) non viene bloccato, ma nemmeno fatto plausibile
  assert.equal(isFactPlausible(reg, MASSIMALE, 2024), null)
})

function dateToNumber(raw) {
  return parseFloat(String(raw).replace(/\./g, ''))
}

test('vetoMergeCandidate: conservatore — ambiguo → null (lascia decidere il merge)', () => {
  const reg = buildFactsRegistry([{ name: 'polizza.pdf', pages: ['Massimale sinistro: 4.000.000,00'] }])
  // best presente, cand è testuale/non importo → null
  assert.equal(vetoMergeCandidate({ valore: '4.000.000,00' }, { valore: 'una clausola' }, reg), null)
  // cand importo piccolo (< soglia) → null, anche se non nel registro
  assert.equal(vetoMergeCandidate({ valore: '4.000.000,00' }, { valore: '1.000,00' }, reg), null)
  // senza best → null (mai bloccare per difetto dell'input)
  assert.equal(vetoMergeCandidate(null, { valore: '9.000.000,00' }, reg), null)
})

test('vetoMergeCandidate: importo largo fantasma (mai nel fascicolo) → false (tieni best)', () => {
  const reg = buildFactsRegistry([{ name: 'polizza.pdf', pages: ['Massimale sinistro: 4.000.000,00'] }])
  const best = { valore: '4.000.000,00' }
  // 9.000.000 non compare in nessun documento, è largo, e best quasi esiste confermato
  assert.equal(vetoMergeCandidate(best, { valore: '9.000.000,00' }, reg), false)
  // la cifra vera è nel registro → non si vieta l'override
  assert.equal(vetoMergeCandidate(best, { valore: '4.000.000,00' }, reg), null)
})

test('type-blind: il registro non distingue tipi documento', () => {
  const reg = buildFactsRegistry([
    { name: 'Incendio.txt', pages: ['Massimale incendio 2.000.000,00'] },
    { name: 'Casa.txt', pages: ['Premio casa 450,00'] },
  ])
  assert.equal(reg.facts.length, 2)
  // i due "tipi" sono solo nomi file; nessun campo `type` nei fatti
  for (const f of reg.facts) assert.equal('type' in f, false)
  // la plausibilità dipende dalla cifra, non dal tipo: nessun tipo prioritario
  assert.equal(isFactPlausible(reg, MASSIMALE, '2.000.000,00'), true)
  assert.equal(isFactPlausible(reg, { id: 'x_casa', label: 'Premio casa' }, '450,00'), true)
})

// ─── Nuove funzioni di veto (Problema 1: opzioni questionario + duplicati) ───
import {
  detectOptionLikeText, vetoOptionSourceOnly, vetoStructuralDuplicate,
  demandsDistinctValue, factDocCount,
} from '../src/main/services/polizzaFactsRegistry.js'
import {
  vetoForeignNatureMassimale,
} from '../src/main/services/polizzaFactsRegistry.js'

test('detectOptionLikeText: riconosce un questionario dal contenuto, senza considerare il nome file', () => {
  assert.equal(detectOptionLikeText('Domanda 1: che massimale vuole? ☐ 1.000.000 ☐ 5.000.000'), true)
  assert.equal(detectOptionLikeText('Scelta tra i seguenti massimali'), true)
  assert.equal(detectOptionLikeText('Nuovo questionario assuntivo struttura sanitaria'), true)
  assert.equal(detectOptionLikeText('Polizza base: massimale sinistro 7.500.000,00'), false) // testo polizza pulito
})

test('vetoOptionSourceOnly: cifra presente SOLO in un doc-questionario → veto (true)', () => {
  const q = 'Questionario: ☐ 1.000.000,00'
  const reg = { facts: [{ kind: 'amount', value: 1_000_000, doc: 'questionario.pdf' }], index: new Map() }
  const optionDocs = new Set(['questionario.pdf'])
  assert.equal(vetoOptionSourceOnly(reg, optionDocs, { valore: '1.000.000,00' }), true)
})

test('vetoOptionSourceOnly: cifra presente anche in polizza (non-opzione) → NON vetta', () => {
  const reg = { facts: [
    { kind: 'amount', value: 7_500_000, doc: 'questionario.pdf' },
    { kind: 'amount', value: 7_500_000, doc: 'polizza.pdf' },
  ], index: new Map() }
  const optionDocs = new Set(['questionario.pdf'])
  assert.equal(vetoOptionSourceOnly(reg, optionDocs, { valore: '7.500.000,00' }), false)
})

test('vetoOptionSourceOnly: cifra solo in doc-opzione ma piccola → non vetta', () => {
  const reg = { facts: [{ kind: 'amount', value: 500, doc: 'questionario.pdf' }], index: new Map() }
  const optionDocs = new Set(['questionario.pdf'])
  assert.equal(vetoOptionSourceOnly(reg, optionDocs, { valore: '500,00' }), false) // sotto soglia
})

test('vetoOptionSourceOnly PER-PAGINA: la cifra della SCHEDA REALE non è vetata anche se il file contiene il questionario', () => {
  // Fascicolo AmTrust B: un solo file con la scheda (p2: 2.000.000,00) e il
  // modulo (p10: opzioni). Prima il file era marcato INTERO come opzione e il
  // massimale reale della scheda veniva bloccato ([veto:opzione-questionario]).
  const reg = { facts: [
    { kind: 'amount', value: 2_000_000, doc: 'B-polizza.pdf', page: 2 },
    { kind: 'amount', value: 2_000_000, doc: 'B-polizza.pdf', page: 10 },
  ], index: new Map() }
  const optionDocs = new Set(['B-polizza.pdf'])
  const optionPages = new Set(['B-polizza.pdf|10'])
  // La cifra esiste alla pagina 2 (scheda, NON opzione) → non vettare.
  assert.equal(vetoOptionSourceOnly(reg, optionDocs, { valore: '2.000.000,00' }, optionPages), false)
})

test('vetoOptionSourceOnly PER-PAGINA: la cifra SOLO in pagine-opzione resta vetata', () => {
  const reg = { facts: [
    { kind: 'amount', value: 1_000_000, doc: 'questionario.pdf', page: 14 },
    { kind: 'amount', value: 1_000_000, doc: 'questionario.pdf', page: 16 },
  ], index: new Map() }
  const optionDocs = new Set(['questionario.pdf'])
  const optionPages = new Set(['questionario.pdf|14', 'questionario.pdf|16'])
  assert.equal(vetoOptionSourceOnly(reg, optionDocs, { valore: '1.000.000,00' }, optionPages), true)
})

test('vetoOptionSourceOnly PER-PAGINA: senza optionPages resta il comportamento storico per-file', () => {
  // Back-compat: se il chiamante non passa le pagine-opzione, il veto usa solo i
  // nomi documento — un file marcato opzione blocca tutte le sue cifre.
  const reg = { facts: [
    { kind: 'amount', value: 2_000_000, doc: 'B-polizza.pdf', page: 2 },
  ], index: new Map() }
  const optionDocs = new Set(['B-polizza.pdf'])
  assert.equal(vetoOptionSourceOnly(reg, optionDocs, { valore: '2.000.000,00' }), true)
})

test('demandsDistinctValue: solo quando la description vieta il riuso', () => {
  assert.equal(demandsDistinctValue({ description: 'DEVE essere diverso dal massimale (non 7500)' }), true)
  assert.equal(demandsDistinctValue({ description: 'non riutilizzare il massimale' }), true)
  assert.equal(demandsDistinctValue({ description: 'Massimale per ogni sinistro' }), false)
  assert.equal(demandsDistinctValue({ description: 'Tacito rinnovo Sì o No' }), false)
})

test('vetoStructuralDuplicate: veto su spill di un importo in campo che esige valore distinto', () => {
  const campoDistinto = { description: 'Franchigia base. DEVE essere diversa dal massimale, non 7500' }
  const best = { massimale: { valore: '7.500.000,00' } }
  // 7.500.000 è già nel campo massimale diverso → spill → veto
  assert.equal(vetoStructuralDuplicate(campoDistinto, { valore: '7.500.000,00' }, best, 'franchigia'), true)
  // valore DIVERSO (2500) → no veto
  assert.equal(vetoStructuralDuplicate(campoDistinto, { valore: '2.500,00' }, best, 'franchigia'), false)
})

test('vetoStructuralDuplicate: campo che NON esige valore distinto → mai veto', () => {
  const campoNormale = { description: 'Massimale per singolo sinistro' }
  const best = { altro: { valore: '7.500.000,00' } }
  assert.equal(vetoStructuralDuplicate(campoNormale, { valore: '7.500.000,00' }, best, 'cand'), false)
})

test('factDocCount: numero di documenti distinti che testimoniano una cifra', () => {
  const reg = { facts: [
    { kind: 'amount', value: 7_500_000, doc: 'q.pdf' },
    { kind: 'amount', value: 7_500_000, doc: 'polizza.pdf' },
    { kind: 'amount', value: 4_000_000, doc: 'appendice.pdf' },
  ], index: new Map() }
  assert.equal(factDocCount(reg, 7_500_000), 2)
  assert.equal(factDocCount(reg, 4_000_000), 1)
  assert.equal(factDocCount(reg, 999_999), 0)
})

// ─── NATURA ESTRANEA MASSIMALE (generalizzazione CEDAM) ─────────────────────
// Il 7.500.000 della dichiarazione è un MASSIMALE. Un campo che non è un
// massimale NON deve riceverlo (spill di natura). Regola MONOTONA: mai
// euristiche "non presente" per decidere — si giudica solo se il REGISTRO
// dimostra che l'importo è esclusivamente un massimale.
// ───────────────────────────────────────────────────────────────────────────

function registryWithMassimaleOnly() {
  return buildFactsRegistry([
    { name: 'dichiarazione.pdf', pages: ['Massimali Assicurati: RCT/RCO Euro 7.500.000,00 Unico per sinistro'] },
  ])
}

test('vetoForeignNatureMassimale: il 7.500.000 (solo massimale nel registro) NON va su un campo non-massimale', () => {
  const reg = registryWithMassimaleOnly()
  const campoEstensioni = { id: 'rct_importo_preventivo', label: 'Estensioni operative', description: 'Estrai le estensioni effettivamente operanti.' }
  assert.equal(vetoForeignNatureMassimale(reg, campoEstensioni, '7.500.000,00'), true)
  const campoEsclusioni = { id: 'rct_tasso', label: 'Esclusioni particolari', description: 'Estrai le esclusioni particolari o rilevanti.' }
  assert.equal(vetoForeignNatureMassimale(reg, campoEsclusioni, '7.500.000,00'), true)
  const campoTutela = { id: 'rcp_scoperto_min_mondo', label: 'Attività giudiziale', description: 'Verifica se coperte attività giudiziale...' }
  assert.equal(vetoForeignNatureMassimale(reg, campoTutela, '7.500.000,00'), true)
})

test('vetoForeignNatureMassimale: MAI su un campo massimale (per sinistro o annuo), anche con lo stesso importo', () => {
  const reg = registryWithMassimaleOnly()
  const campoMassimaleSinistro = {
    id: 'rct_massimale_sinistro',
    label: 'Massimale per sinistro',
    description: 'NUMERO/IMPORTO (euro). Massimale per singolo sinistro (per esempio 7.500.000,00). Non riutilizzare un valore identico (es. massimale annuo, franchigia).',
  }
  assert.equal(vetoForeignNatureMassimale(reg, campoMassimaleSinistro, '7.500.000,00'), false)
  const campoMassimaleAnnuo = { id: 'rct_massimale_persona', label: 'Massimale annuo', description: 'Massimale annuo aggregato' }
  assert.equal(vetoForeignNatureMassimale(reg, campoMassimaleAnnuo, '7.500.000,00'), false)
})

test('vetoForeignNatureMassimale: un campo con "massimale" per un\'ALTRA garanzia (RC Prodotti) NON è il massimale del contratto → veto', () => {
  const reg = registryWithMassimaleOnly()
  const coperturaConMassimale = { id: 'rcp_massimale_mat', label: 'Visto pesante / bonus edilizi', description: 'Massimale RC Prodotti per danni materiali, es. 5.000.000,00' }
  // Il 7.500.000 della dichiarazione è un massimale per sinistro del contratto,
  // non il massimale RC Prodotti: il campo delle coperture non deve riceverlo.
  assert.equal(vetoForeignNatureMassimale(reg, coperturaConMassimale, '7.500.000,00'), true)
})

test('vetoForeignNatureMassimale: un importo che nel registro NON è solo massimale NON viene vetato (premio/fatturato)', () => {
  const reg = buildFactsRegistry([
    { name: 'dichiarazione.pdf', pages: ['Fatturato dichiarato 7.500.000,00 per quotazione premio'] },
  ])
  const campoNonMassimale = { id: 'rct_importo_preventivo', label: 'Estensioni operative', description: 'Estrai le estensioni.' }
  // L'importo ha natura "premio/fatturato", non "solo massimale" → mai veto
  assert.equal(vetoForeignNatureMassimale(reg, campoNonMassimale, '7.500.000,00'), false)
})

test('vetoForeignNatureMassimale: senza registro, o per importo piccolo, nessun veto (mai euristiche di assenza)', () => {
  const reg = buildFactsRegistry([
    { name: 'dichiarazione.pdf', pages: ['Massimali Assicurati: RCT/RCO Euro 7.500.000,00 Unico per sinistro'] },
  ])
  const f = { id: 'rct_importo_preventivo', label: 'Estensioni operative', description: '' }
  // importo piccolo: mai veto
  assert.equal(vetoForeignNatureMassimale(reg, f, '20.000,00'), false)
  // nessun registro → non si giudica (mai veto per assenza di dati)
  assert.equal(vetoForeignNatureMassimale(null, f, '7.500.000,00'), false)
})