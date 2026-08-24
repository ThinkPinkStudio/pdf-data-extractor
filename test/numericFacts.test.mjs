/**
 * Test del registro dei fatti numerici (whitelist importi/date, veto sub-limiti).
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { extractNumericFactsFromPage, buildFactsRegistry, factSupports } from '../src/main/services/numericFacts.js'

test('extractNumericFactsFromPage: importi italiani e date', () => {
  const page = 'Massimale per sinistro Euro 2.000.000,00\nFranchigia 10.000,00\nDecorrenza 31/12/2024'
  const facts = extractNumericFactsFromPage(page, 1)
  const amounts = facts.filter((f) => f.kind === 'amount').map((f) => f.numeric)
  assert.ok(amounts.includes(2000000), JSON.stringify(amounts))
  assert.ok(amounts.includes(10000), JSON.stringify(amounts))
  const dates = facts.filter((f) => f.kind === 'date').map((f) => f.date)
  assert.ok(dates.includes('31/12/2024'), JSON.stringify(dates))
})

test('factSupports: massimale pulito passa, sub-limite di clausola no', () => {
  const analyzed = [{
    name: 'polizza.pdf',
    pages: [
      'MASSIMALE PER SINISTRO Euro 2.000.000,00\n' +
      'La garanzia è prestata con un sub-limite di 10.000,00 per sinistro da inquinamento',
    ],
    dateStr: '31/12/2025',
    pos: 0,
  }]
  const registry = buildFactsRegistry(analyzed)
  const field = { id: 'rcp_massimale_sinistro', label: 'Massimale per sinistro' }
  const ok = factSupports(registry, field, '2.000.000,00', analyzed[0])
  assert.equal(ok.ok, true, JSON.stringify(ok))
  const veto = factSupports(registry, field, '10.000,00', analyzed[0])
  assert.equal(veto.ok, false, JSON.stringify(veto))
  assert.equal(veto.reason, 'solo-clausola')
})

test('factSupports: premio con finestra "premio" passa', () => {
  const analyzed = [{
    name: 'quietanza.pdf',
    pages: ['Premio totale lordo 5.300,00 di cui imposta 1.001,25'],
    dateStr: '31/12/2025',
    pos: 0,
  }]
  const registry = buildFactsRegistry(analyzed)
  const field = { id: 'rcp_premio_totale', label: 'Premio totale' }
  const r = factSupports(registry, field, '5.300,00', analyzed[0])
  assert.equal(r.ok, true, JSON.stringify(r))
})

test('factSupports: testo non numerico sempre ok', () => {
  const r = factSupports([], { id: 'attivita', label: 'Attività' }, 'chirurgia generale', null)
  assert.equal(r.ok, true)
  assert.equal(r.reason, 'non-numerico')
})

test('buildFactsRegistry: più documenti, metadati docname/page', () => {
  const reg = buildFactsRegistry([
    { name: 'a.pdf', pages: ['Euro 4.000.000,00'], dateStr: '31/12/2024', pos: 0 },
    { name: 'b.pdf', pages: ['31/12/2025'], dateStr: '31/12/2025', pos: 1 },
  ])
  assert.ok(reg.some((f) => f.docname === 'a.pdf' && f.numeric === 4000000))
  assert.ok(reg.some((f) => f.docname === 'b.pdf' && f.date === '31/12/2025'))
})
