/**
 * Test del pre-controllo di pertinenza profilo↔fascicolo (parte PURA).
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeForPrecheck, parseContentKeywords, keywordVerdict, cosineSim,
  semanticScore, llmComparisonScore, decidePrecheck, topContentTerms,
  KEYWORD_MIN_RATIO, SEMANTIC_MIN, LLM_MIN,
} from '../src/main/services/polizzaPrecheck.js'

test('normalizeForPrecheck: minuscole, senza accenti, spazi singoli', () => {
  assert.equal(normalizeForPrecheck('Responsabilità   CIVILE — R.C.T./R.C.O.'), 'responsabilita civile r c t r c o')
  assert.equal(normalizeForPrecheck(''), '')
  assert.equal(normalizeForPrecheck(null), '')
})

test('parseContentKeywords: separatori virgola/;/newline, scarti corti', () => {
  assert.deepEqual(parseContentKeywords('rct, rco; prestatori di lavoro\nresponsabilità civile'),
    ['rct', 'rco', 'prestatori di lavoro', 'responsabilità civile'])
  assert.deepEqual(parseContentKeywords('a, b'), []) // < 3 char: scartate
  assert.deepEqual(parseContentKeywords(''), [])
})

test('keywordVerdict: match a sottostringa normalizzata, frasi comprese', () => {
  const text = normalizeForPrecheck('POLIZZA RESPONSABILITÀ CIVILE VERSO TERZI (R.C.T.) e prestatori di lavoro')
  const v = keywordVerdict(['responsabilità civile', 'prestatori di lavoro', 'incendio'], text)
  assert.deepEqual(v.matched, ['responsabilità civile', 'prestatori di lavoro'])
  assert.deepEqual(v.missing, ['incendio'])
  assert.ok(Math.abs(v.ratio - 2 / 3) < 1e-9)
  // nessuna keyword → ratio 0, mai lanciare
  assert.deepEqual(keywordVerdict([], text), { matched: [], missing: [], ratio: 0 })
})

test('cosineSim: vettori noti', () => {
  assert.equal(cosineSim([1, 0], [1, 0]), 1)
  assert.equal(cosineSim([1, 0], [0, 1]), 0)
  assert.ok(Math.abs(cosineSim([1, 1], [1, 0]) - Math.SQRT1_2) < 1e-9)
  assert.equal(cosineSim([0, 0], [1, 0]), 0) // vettore nullo: 0, non NaN
})

test('semanticScore: media delle affinità per campo, robusto ai buchi', () => {
  assert.equal(semanticScore([0.8, 0.4]), 0.6000000000000001)
  assert.equal(semanticScore([0.5, NaN, undefined, 0.7]), 0.6)
  assert.equal(semanticScore([]), null)
  assert.equal(semanticScore(null), null)
})

test('llmComparisonScore: overlap token rilevati↔termini profilo', () => {
  const profileTerms = ['RCT RCO (ripristino descrizioni)', 'responsabilità civile, prestatori', 'Massimale per sinistro']
  // pieno: tutti i token rilevati stanno nei termini
  assert.equal(llmComparisonScore({ type: 'responsabilità civile', keywords: ['rct', 'massimale'] }, profileTerms), 1)
  // zero: tipo completamente estraneo
  assert.equal(llmComparisonScore({ type: 'polizza incendio fabbricati', keywords: ['fiamme'] }, profileTerms), 0)
  // niente di rilevato → null (non 0: è un'assenza di input, non un mismatch)
  assert.equal(llmComparisonScore({ type: '', keywords: [] }, profileTerms), null)
})

test('decidePrecheck: verdetti ai bordi delle soglie', () => {
  const base = { hasProfile: true, hasContentKeywords: true }
  // keywords sopra/sotto soglia
  assert.equal(decidePrecheck({ ...base, mode: 'keywords', keyword: { ratio: KEYWORD_MIN_RATIO } }).verdict, 'ok')
  assert.equal(decidePrecheck({ ...base, mode: 'keywords', keyword: { ratio: KEYWORD_MIN_RATIO - 0.01 } }).verdict, 'mismatch')
  // semantic sopra/sotto
  assert.equal(decidePrecheck({ ...base, mode: 'semantic', semantic: SEMANTIC_MIN }).verdict, 'ok')
  assert.equal(decidePrecheck({ ...base, mode: 'semantic', semantic: SEMANTIC_MIN - 0.01 }).verdict, 'mismatch')
  // llm sopra/sotto
  assert.equal(decidePrecheck({ ...base, mode: 'llm', llm: LLM_MIN }).verdict, 'ok')
  assert.equal(decidePrecheck({ ...base, mode: 'llm', llm: LLM_MIN - 0.01 }).verdict, 'mismatch')
})

test('decidePrecheck: TUTTE le degradazioni → mai bloccare per guasti o configurazioni assenti', () => {
  // off → skipped
  assert.equal(decidePrecheck({ mode: 'off', hasProfile: true }).verdict, 'skipped')
  // nessun profilo (campi globali) → skipped
  assert.equal(decidePrecheck({ mode: 'keywords', hasProfile: false }).verdict, 'skipped')
  // keywords senza contentKeywords → degrada a semantic (e la usa davvero)
  const d = decidePrecheck({ mode: 'keywords', hasProfile: true, hasContentKeywords: false, semantic: 0.9 })
  assert.equal(d.mode, 'semantic')
  assert.equal(d.verdict, 'ok')
  // embeddings assenti nel modo semantic → skipped, MAI mismatch
  assert.equal(decidePrecheck({ mode: 'semantic', hasProfile: true, semantic: null }).verdict, 'skipped')
  // modello muto nel modo llm → skipped
  assert.equal(decidePrecheck({ mode: 'llm', hasProfile: true, llm: null }).verdict, 'skipped')
  // testo assente nel modo keywords → skipped
  assert.equal(decidePrecheck({ mode: 'keywords', hasProfile: true, hasContentKeywords: true, keyword: null }).verdict, 'skipped')
  // modo sconosciuto → skipped
  assert.equal(decidePrecheck({ mode: 'boh', hasProfile: true }).verdict, 'skipped')
})

test('topContentTerms: termini frequenti senza boilerplate assicurativo', () => {
  const norm = normalizeForPrecheck(
    'incendio fabbricati incendio fabbricati incendio esplosione scoppio polizza polizza assicurato compagnia euro'
  )
  const terms = topContentTerms(norm, 3)
  assert.deepEqual(terms.slice(0, 2), ['incendio', 'fabbricati'])
  assert.ok(!terms.includes('polizza') && !terms.includes('compagnia'))
})

test('decidePrecheck keywords: matchKeywords contano come hasContentKeywords (fallback)', () => {
  // Il servizio fa il fallback; la parte pura deve trattare hasContentKeywords
  // true anche quando le parole arrivano da matchKeywords, non da contentKeywords.
  const d = decidePrecheck({
    mode: 'keywords', hasProfile: true, hasContentKeywords: true, keyword: { ratio: 0.33 },
  })
  assert.equal(d.verdict, 'ok')
  assert.equal(d.mode, 'keywords')
})
