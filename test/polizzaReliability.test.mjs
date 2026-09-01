/**
 * Test del punteggio di affidabilità per campo/scelta (FEATURE F): modulo PURO
 * src/services/polizzaReliability.js.
 *
 * Esegui:  node --test test/polizzaReliability.test.mjs
 *
 * Calcolo A-POSTERIORI, deterministico, senza chiamate LLM. Documenti TUTTI
 * UGUALI: il punteggio non assegna MAI priorità al tipo documento.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  computeFieldReliability,
  buildReliabilityMap,
  RELIABILITY_THRESHOLD,
} from '../src/services/polizzaReliability.js'

// ─── Checkbox base ─────────────────────────────────────────────────────────

test('campo assente / valore nullo → reliable 0 senza tag', () => {
  const r = computeFieldReliability({ id: 'x', candidate: null })
  assert.equal(r.reliable, 0)
  assert.deepEqual(r.tipoDiVerifica, [])
  assert.equal(computeFieldReliability({ id: 'x', candidate: { valore: null } }).reliable, 0)
  assert.equal(computeFieldReliability({ id: 'x', candidate: { valore: '   ' } }).reliable, 0)
})

test('valore placeholder (assenza-dato) → reliable 0', () => {
  const r = computeFieldReliability({ id: 'x', candidate: { valore: 'non specificato' } })
  assert.equal(r.reliable, 0)
})

test('candidato verificato da checksum + file+pagina → reliable>=0.8 e tag checksum', () => {
  const r = computeFieldReliability({
    id: 'codice_fiscale_iva',
    candidate: {
      valore: '00151510344', effDate: '31/12/2024', affinity: 0.8,
      file: 'quietanza.pdf', page: 2,
    },
    field: { id: 'codice_fiscale_iva', label: 'P.IVA contraente', description: 'Partita IVA del contraente' },
    verifiedBy: { checksum: true },
  })
  assert.ok(r.reliable >= 0.8, `reliable=${r.reliable}`)
  assert.ok(r.tipoDiVerifica.includes('checksum'), String(r.tipoDiVerifica))
})

test('candidato solo con affinità alta ma senza file/page → reliable basso (0.2)', () => {
  const r = computeFieldReliability({
    id: 'attivita',
    candidate: { valore: 'produzione di olii e grassi vegetali', affinity: 0.95 },
  })
  assert.equal(r.reliable, 0.2)
  assert.ok(r.tipoDiVerifica.includes('affinity'))
})

test('valore ripetuto in più documenti (seenCount>=2) → tag piu_doc e reliable migliore', () => {
  const multi = computeFieldReliability({
    id: 'polizza_numero',
    candidate: { valore: '283618616', effDate: '31/12/2025', file: 'polizza.pdf', page: 1 },
    seenCount: 3,
  })
  assert.ok(multi.tipoDiVerifica.includes('piu_doc'), String(multi.tipoDiVerifica))
  // rispetto a un candidato senza evidenza multi-doc, è più alto
  const single = computeFieldReliability({
    id: 'polizza_numero',
    candidate: { valore: '283618616', effDate: '31/12/2025', file: 'polizza.pdf', page: 1 },
    seenCount: 1,
  })
  assert.ok(multi.reliable > single.reliable, `${multi.reliable} vs ${single.reliable}`)
})

test('reliable clampata in [0,1] e arrotondata a 2 decimali', () => {
  const r = computeFieldReliability({
    id: 'x',
    candidate: { valore: 'v', effDate: '31/12/2025', file: 'a.pdf', page: 1, affinity: 0.5 },
    verifiedBy: { checksum: true },
    seenCount: 5,
  })
  assert.ok(r.reliable >= 0 && r.reliable <= 1, String(r.reliable))
  assert.equal(r.reliable, Math.round(r.reliable * 100) / 100)
})

// ─── buildReliabilityMap ────────────────────────────────────────────────────

test('buildReliabilityMap su best sintetico → mappa corretta, arrotondata', () => {
  // 0.5 (evidenza 0.3 + recency 0.2) — si sommano, c'è il candidato datato
  const best = {
    polizza_numero: { valore: '283618616', file: 'polizza.pdf', page: 1 },
    attivita: { valore: 'produzione di olii', affinity: 0.9 },
    vuoto: { valore: 'non specificato' },
  }
  const fieldsById = {
    polizza_numero: { id: 'polizza_numero', label: 'N° Polizza' },
    attivita: { id: 'attivita', label: 'Attività' },
    vuoto: { id: 'vuoto', label: 'Vuoto' },
  }
  const map = buildReliabilityMap(best, fieldsById, {})
  assert.ok(map.polizza_numero.reliable === 0.3, `polizza_numero=${map.polizza_numero.reliable}`)
  assert.ok(map.attivita.reliable === 0.2, `attivita=${map.attivita.reliable}`)
  assert.equal(map.vuoto.reliable, 0)
  for (const [id, r] of Object.entries(map)) {
    assert.equal(r.reliable, Math.round(r.reliable * 100) / 100, `arrotondamento ${id}`)
  }
})

test('buildReliabilityMap: checksumsById e seenCountsById firmato → affidabilità piena', () => {
  const best = {
    'codice_fiscale_iva': { valore: '00151510344', file: 'quietanza.pdf', page: 2 },
  }
  const fieldsById = {
    'codice_fiscale_iva': { id: 'codice_fiscale_iva', label: 'P.IVA', description: 'Partita IVA del contraente' },
  }
  const map = buildReliabilityMap(best, fieldsById, {
    checksumsById: { 'codice_fiscale_iva': true },
  })
  assert.ok(map['codice_fiscale_iva'].reliable >= 0.5, `reliable=${map['codice_fiscale_iva'].reliable}`)
  assert.ok(map['codice_fiscale_iva'].tipoDiVerifica.includes('checksum'))
})

// ─── Type-blind (Documenti TUTTI UGUALI) ─────────────────────────────────────
test('un valore in un doc "Incendio" o "Casa" non cambia il punteggio (nessuna priorità per tipo)', () => {
  const base = {
    id: 'scadenza',
    candidate: { valore: '31/12/2025', effDate: '31/12/2025', file: 'qualsiasi.pdf', page: 1 },
  }
  const incendio = computeFieldReliability({ ...base, candidate: { ...base.candidate, docType: 'Incendio' } })
  const casa = computeFieldReliability({ ...base, candidate: { ...base.candidate, docType: 'Casa' } })
  const nulla = computeFieldReliability({ ...base, candidate: { ...base.candidate, docType: undefined } })
  // Il docType NON deve comparire né nei tag né nel peso
  assert.equal(incendio.reliable, casa.reliable)
  assert.equal(casa.reliable, nulla.reliable)
})

test('RELIABILITY_THRESHOLD esportata è 0.5', () => {
  assert.equal(RELIABILITY_THRESHOLD, 0.5)
})