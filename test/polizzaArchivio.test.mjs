/**
 * Test del contesto storico dall'archivio Qdrant (FEATURE E): modulo PURO
 * src/main/services/polizzaArchiveContext.js.
 *
 * Esegui:  node --test test/polizzaArchivio.test.mjs
 *
 * Il blocco ARCHIVIO è SOLO supporto: mai una priorità sulla recency del documento
 * attuale. `search` è INIETTATA (mock nel test): nessun Qdrant reale. Guasto →
 * `null` silenzioso, mai throw. DEFAULT OFF: senza settings.polizzaArchivio ===
 * true la ricerca non parte.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  interpretHistorical, buildArchiveContext, loadArchiveContext,
  ARCHIVE_MIN_SCORE, ARCHIVE_SNIPPET_LEN,
} from '../src/main/services/polizzaArchiveContext.js'

// ─── interpretHistorical ─────────────────────────────────────────────────────

test('interpretHistorical: filtra per score, tronca il testo e tiene anno/doc', () => {
  const hits = [
    { score: 0.9, doc_year: 2023, file: 'quietanza-2023.pdf', text: 'Contraente: ADAMANT BIONRG SRL — parametro retribuzioni'.repeat(3) },
    { score: 0.2, doc_year: 2022, file: 'x.pdf', text: 'troppo lontano, da scartare' },       // score basso → no
    { score: 0.7, dossier: 'FASCICOLO_ABC', text: 'SOLO MENTE 2024' },
  ]
  const out = interpretHistorical(hits, { minScore: 0.6 })
  assert.equal(out.length, 2)
  assert.equal(out[0].year, '2023')
  assert.ok(out[0].text.length <= ARCHIVE_SNIPPET_LEN)
  assert.equal(out[1].doc, 'FASCICOLO_ABC')
})

test('interpretHistorical: vuoto/assente → array vuoto, mai throw', () => {
  assert.deepEqual(interpretHistorical(null), [])
  assert.deepEqual(interpretHistorical([]), [])
  assert.deepEqual(interpretHistorical(undefined), [])
  assert.deepEqual(interpretHistorical([{ score: 0.2, text: 'x' }]), [])
})

test('interpretHistorical: hit senza doc_year → year null', () => {
  const out = interpretHistorical([{ score: 0.9, text: 'un valore storico' }], { minScore: 0.5 })
  assert.equal(out.length, 1)
  assert.equal(out[0].year, null)
})

// ─── buildArchiveContext ─────────────────────────────────────────────────────

test('buildArchiveContext: hit vuoto → null', () => {
  assert.equal(buildArchiveContext({ polizzaNumero: '283618616', historical: [] }), null)
  assert.equal(buildArchiveContext({ polizzaNumero: '283618616', historical: null }), null)
  assert.equal(buildArchiveContext({ polizzaNumero: '283618616' }), null)
  assert.equal(buildArchiveContext({ polizzaNumero: '', historical: [{ text: 'x' }] }), null)
})

test('buildArchiveContext: hit con score → blocco formattato con HIT e annualità', () => {
  const block = buildArchiveContext({
    polizzaNumero: '283618616',
    historical: [
      { year: '2024', text: 'Parametro regolazione: retribuzioni', doc: 'quietanza-2024.pdf' },
      { year: null, text: 'Agenzia ACQUI TERME', doc: '' },
    ],
  })
  assert.ok(block.includes('ARCHIVIO (storico)'))
  assert.ok(block.includes('283618616'))
  assert.ok(block.includes('HIT "Parametro regolazione: retribuzioni" (annualità 2024) [quietanza-2024.pdf]'))
  assert.ok(block.includes('HIT "Agenzia ACQUI TERME" (anno non noto)'))
})

test('buildArchiveContext: istruzione di SOLA LETTURA (mai precedenza sulla recency)', () => {
  const block = buildArchiveContext({ polizzaNumero: '1', historical: [{ text: 'AGENZIA TEST', year: '2024' }] })
  assert.match(block.toLowerCase(), /solo lettura|sola lettura/i)
  assert.match(block.toLowerCase(), /più recente|piu recente/)
})

// ─── loadArchiveContext (search iniettata/mock) ───────────────────────────────

test('loadArchiveContext: default OFF → nessuna chiamata a search', async () => {
  let called = false
  const res = await loadArchiveContext({
    polizzaNumero: '283618616',
    settings: {}, // polizzaArchivio assente → OFF
    search: async () => { called = true; return [] },
  })
  assert.equal(res, null)
  assert.equal(called, false, 'search non deve essere chiamata quando OFF')
})

test('loadArchiveContext: hit vuoto → null senza throw', async () => {
  const res = await loadArchiveContext({
    polizzaNumero: '283618616',
    settings: { polizzaArchivio: true },
    search: async () => [],
  })
  assert.equal(res, null)
})

test('loadArchiveContext: hit con score → blocco formattato', async () => {
  const res = await loadArchiveContext({
    polizzaNumero: '283618616',
    settings: { polizzaArchivio: true },
    search: async () => [
      { score: 0.9, doc_year: 2024, text: 'Parametro retribuzioni', file: 'q-2024.pdf' },
    ],
  })
  assert.ok(res, 'blocco atteso')
  assert.ok(res.includes('ARCHIVIO (storico)'))
  assert.ok(res.includes('HIT "Parametro retribuzioni"'))
})

test('loadArchiveContext: Qdrant GIÙ (search lancia) → null senza throw', async () => {
  const diag = []
  const res = await loadArchiveContext({
    polizzaNumero: '283618616',
    settings: { polizzaArchivio: true },
    diag,
    search: async () => { throw new Error('ECONNREFUSED qdrant:11434') },
  })
  assert.equal(res, null)
  assert.ok(diag.some((l) => l.includes('non disponibile')))
})

test('loadArchiveContext: anno non noto resta (down anno)', async () => {
  const res = await loadArchiveContext({
    polizzaNumero: '283618616',
    settings: { polizzaArchivio: true },
    search: async () => [{ score: 0.8, text: 'ACQUI TERME', file: 'polizza.pdf' }],
  })
  assert.ok(res && res.includes('(anno non noto)'))
})

test('costanti esportate', () => {
  assert.equal(typeof ARCHIVE_MIN_SCORE, 'number')
  assert.ok(ARCHIVE_MIN_SCORE > 0 && ARCHIVE_MIN_SCORE < 1)
  assert.ok(ARCHIVE_SNIPPET_LEN > 0)
})