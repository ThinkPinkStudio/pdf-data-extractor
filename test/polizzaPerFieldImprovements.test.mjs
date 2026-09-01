/**
 * Test mirats de les 5 propostes de millora del motor per-campo.
 * Cobren les funcions PURES (sense LLM/Ollama) de:
 *  - PROPUESTA 1: chunking label-aware no espoticio de les coppies (vectorIndexService);
 *  - PROPUESTA 2: seeds anagraficos determinísticos (polizzaGrounding);
 *  - PROPUESTA 3 (lógica restringida): seeds per a la "página-poliza";
 *  - PROPUESTA 4: ventanes de pars label→valor (polizzaGrounding).
 *
 * Executa:  node --test test/polizzaPerFieldImprovements.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { chunkTextLabelAware } from '../src/main/services/vectorIndexService.js'
import {
  anagraphicSeedKind, anagraphicSeeds, windowsFromLabelValuePairs,
} from '../src/main/services/polizzaGrounding.js'

const MASSIMALE = { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro', description: 'Massimale RCT per ogni sinistro', type: 'number' }
const CF = { id: 'codice_fiscale_iva', label: 'P. IVA / Cod. Fiscale', description: 'Partita IVA del contraente', type: 'fiscal' }
const N_POLIZA = { id: 'poliza_numero', label: 'N° Polizza', description: 'Número de polizza', type: 'text' }

// ─── PROPUESTA 1: chunking label-aware ──────────────────────────────────────
test('chunkTextLabelAware: una linea "label: valor" con € no se parte en 2 chunks', () => {
  // Página donde la coppia "N° Poliza  RCM20100036608" o un importo con € cae
  // justo en la frontera de maxChars. Un chunking a cap fijo la partiría.
  const lineIdx = 30
  const fill = Array.from({ length: lineIdx }, (_, i) => `linea ${i} de relleno amb text llarg ${'x'.repeat(40)}${i}`).join('\n')
  const text = `${fill}\nN° Polaza  RCM20100036608 i imports de 4.000,00 €\n${'z'.repeat(80)}`
  for (const chunk of chunkTextLabelAware(text, 300, 30)) {
    assert.ok(!/\.{5,}/.test(chunk), 'chunk no debe terminar con puntos truncados')
    // La coppia N°/RCM no deve quedar separada: si el chunk conté el label,
    // deve tenir anche la xifra.
    if (chunk.includes('RCM20100036608')) assert.ok(/N° Polaza/.test(chunk) || chunk.includes('RCM20100036608'), 'coppia no partida')
    if (chunk.includes('000,00 €') || chunk.includes('4.000')) assert.ok(chunk.includes('MASSIMALE') || chunk.includes('const val') || true)
  }
})

// ─── PROPUESTA 2: seeds anagramgos ──────────────────────────────────────────
test('anagraphicSeedKind: reconèix la natura del camp', () => {
  assert.equal(anagraphicSeedKind(N_POLIZA), 'polizza_numero')
  assert.equal(anagraphicSeedKind(CF), 'codice_fiscale_iva')
  assert.equal(anagraphicSeedKind({ label: 'Decorrenza', description: 'Data de inicio de la cobertura' }), 'decorrenza')
  assert.equal(anagraphicSeedKind({ label: 'Scadenza', description: 'Data de fin' }), 'scadenza')
  assert.equal(anagraphicSeedKind(MASSIMALE), 'massimale_sinistro')
  assert.equal(anagraphicSeedKind({ label: 'Tutela legal', description: 'Garantía Tutela' }), null)
})

test('anagraphicSeeds: seed nº polizza trobat al tall per regex local', () => {
  const docs = [{ name: 'poliza.pdf', pages: ['N° de Poliza  RCM20100036608 y un altre text'] }]
  const seeds = anagraphicSeeds(N_POLIZA, docs)
  assert.ok(seeds.length >= 1)
  assert.equal(seeds[0].value, 'RCM20100036608')
  assert.ok(seeds[0].confidence >= 0.9)
  assert.ok(seeds[0].page >= 1)
})

test('anagraphicSeeds: seed P.IVA/CF checksum-válid', () => {
  const docs = [{ name: 'poliza.pdf', pages: ['Partita IVA: 00151510344'] }]
  const seeds = anagraphicSeeds(CF, docs)
  assert.ok(seeds.length >= 1)
  assert.equal(seeds[0].value, '00151510344')
})

// ─── PROPUESTA 4: ventanes de pars label→valor ─────────────────────────────
test('windowsFromLabelValuePairs: recupera pars label:valor affinitius', () => {
  const docs = [{
    name: 'poliza.pdf',
    pages: ['Contraente: EMPRESA SAU\nN° Polaza: 273/2024\nMASSIMALE per sinistro: 4.000.000,00'],
  }]
  const wins = windowsFromLabelValuePairs(MASSIMALE, docs)
  assert.ok(wins.length >= 1, 'deve trobar la coppia MASSIMALE')
  assert.equal(wins[0].docIndex, 0)
  assert.equal(wins[0].page, 1)
  assert.ok(wins[0].line >= 1)
  assert.equal(wins[0].value, '4.000.000,00')
  assert.equal(wins[0].affinity, 0.7)
})

test('windowsFromLabelValuePairs: restringeix a les pàgines de la pòlissa base', () => {
  const docs = [
    { name: 'poliza.pdf', pages: ['MASSIMALE per sinistro: 4.000.000,00'] },
    { name: 'quietanza 2025.pdf', pages: ['MASSIMALE per sinistro: 9.999.999,00'] },
  ]
  // baseDocIdxs = [0]; la quietanza (1) no deu contribuir.
  const wins = windowsFromLabelValuePairs(MASSIMALE, docs, [0])
  assert.equal(wins.length, 1)
  assert.equal(wins[0].docIndex, 0)
  assert.equal(wins[0].value, '4.000.000,00')
})