/**
 * Test del pre-controllo di pertinenza profilo↔fascicolo (parte PURA).
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeForPrecheck, parseContentKeywords, keywordVerdict, contentExcludeVerdict, cosineSim,
  semanticScore, llmComparisonScore, decidePrecheck, topContentTerms,
  KEYWORD_MIN_RATIO, SEMANTIC_MIN, LLM_MIN,
} from '../src/services/polizzaPrecheck.js'

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

test('fallback contentKeywords→matchKeywords: profilo senza contentKeywords ma con matchKeywords medico', () => {
  // Simula il profilo RC PROF MED V2: contentKeywords assente, matchKeywords con "MEDICO, medico, med".
  // Stessa logica di runPrecheck: parseContentKeywords(undefined) → [] che è truthy,
  // quindi il fallback va deciso sulla LUNGHEZZA, non con ||.
  const profile = { contentKeywords: undefined, matchKeywords: 'MEDICO, medico, med' }
  const contentKws = parseContentKeywords(profile?.contentKeywords)
  const kws = contentKws.length ? contentKws : parseContentKeywords(profile?.matchKeywords)
  assert.deepEqual(kws, ['MEDICO', 'medico', 'med'])
  // documento RCT/Cedac rischi sanitari: il testo contiene MEDICO e medico → ratio alto
  const okText = normalizeForPrecheck('RC professionale rischi sanitari — MEDICO e medico assicurato')
  const vOk = keywordVerdict(kws, okText)
  assert.ok(vOk.ratio >= KEYWORD_MIN_RATIO, `ratio ${vOk.ratio} < ${KEYWORD_MIN_RATIO}`)
  assert.equal(decidePrecheck({ mode: 'keywords', hasProfile: true, hasContentKeywords: true, keyword: vOk }).verdict, 'ok')
  // documento estraneo (fabbricati): nessuna keyword → mismatch
  const noText = normalizeForPrecheck('Incendio fabbricati — esplosione scoppio danni alle cose')
  const vNo = keywordVerdict(kws, noText)
  assert.deepEqual(vNo.matched, [])
  assert.equal(decidePrecheck({ mode: 'keywords', hasProfile: true, hasContentKeywords: true, keyword: vNo }).verdict, 'mismatch')
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

test('contentExcludeVerdict: parole del contenuto "da evitare" trovate/non trovate', () => {
  const text = normalizeForPrecheck('Polizza incendio fabbricati — esplosione scoppio danni alle cose')
  const v = contentExcludeVerdict(['incendio', 'fabbricati'], text)
  assert.deepEqual(v.matched, ['incendio', 'fabbricati'])
  assert.ok(v.ratio >= KEYWORD_MIN_RATIO)
  // parola assente → nessun match
  const v2 = contentExcludeVerdict(['responsabilità civile'], text)
  assert.deepEqual(v2.matched, [])
  assert.equal(v2.ratio, 0)
})

test('decidePrecheck: blocco "da evitare" SEMPRE, anche a switch off', () => {
  // Profilo con contentExcludeKeywords e una parola da evitare presente nel testo
  const base = { mode: 'off', hasProfile: true, hasContentKeywords: true, hasContentExclude: true }
  const contentExclude = contentExcludeVerdict(['incendio'], normalizeForPrecheck('incendio fabbricati'))
  const d = decidePrecheck({ ...base, contentExclude })
  assert.equal(d.verdict, 'mismatch')
  assert.match(d.reason, /da evitare/)
  // Nessuna parola da evitare nel testo → lo switch 'off' resta skipped
  const d2 = decidePrecheck({ ...base, contentExclude: contentExcludeVerdict(['incendio'], normalizeForPrecheck('polizza rc')) })
  assert.equal(d2.verdict, 'skipped')
  // Modo keywords + parola da evitare presente → prevale il blocco da evitare
  const d3 = decidePrecheck({ mode: 'keywords', hasProfile: true, hasContentKeywords: true, hasContentExclude: true, keyword: { ratio: 1 }, contentExclude: contentExcludeVerdict(['incendio'], normalizeForPrecheck('incendio')) })
  assert.equal(d3.verdict, 'mismatch')
  assert.match(d3.reason, /da evitare/)
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
