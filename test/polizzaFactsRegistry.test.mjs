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