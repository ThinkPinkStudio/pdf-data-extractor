/**
 * Test: abbinamento profilo↔fascicolo (contenuto + percorso) e fallback
 * matchKeywords → pre-check di contenuto.
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { detectProfileForDossier, resolveContentKeywords, profilePathKeywords } from '../src/main/services/profileDetect.js'
import { normalizeForPrecheck, keywordVerdict, KEYWORD_MIN_RATIO } from '../src/main/services/polizzaPrecheck.js'

const V2 = {
  id: '1785512148086',
  name: 'RC PROF MED V2',
  matchKeywords: 'MEDICO, medico, med',
  contentKeywords: '',
}
const FAB = {
  id: 'fab-1',
  name: 'Globale Fabbricati',
  matchKeywords: 'fabbricat, incendio',
}
const ABIT = {
  id: 'abit-1',
  name: 'Globale Abitazione',
  matchKeywords: 'abitazione, digrazia',
}
const PROFILES = [V2, FAB, ABIT]

const CEDAM = 'POLIZZA RISCHI SANITARI PRIVATI — CEDAM ITALIA SRL — responsabilità civile professionale'
const FABBRICATI = 'GLOBALE FABBRICATI — INCENDIO ESPLOSIONE SCOPPIO — fabbricato in Via della Libertà'

test('resolveContentKeywords: fallback a matchKeywords se contentKeywords vuote', () => {
  const r = resolveContentKeywords(V2)
  assert.equal(r.source, 'matchKeywords')
  assert.ok(r.keywords.some((k) => k.toLowerCase() === 'medico'))
  assert.ok(r.keywords.some((k) => k.toLowerCase() === 'med'))
  const withContent = resolveContentKeywords({ ...V2, contentKeywords: 'rischi sanitari, cedam' })
  assert.equal(withContent.source, 'contentKeywords')
  assert.deepEqual(withContent.keywords, ['rischi sanitari', 'cedam'])
})

test('keywordVerdict: "prof" del nome profilo matcha "professionale" nel testo Cedam', () => {
  const norm = normalizeForPrecheck(CEDAM)
  const v = keywordVerdict(resolveContentKeywords(V2).keywords, norm)
  assert.ok(v.matched.length, JSON.stringify(v))
  assert.ok(v.ratio >= KEYWORD_MIN_RATIO, JSON.stringify(v))
})

test('detectProfileForDossier: in vigore/ (niente "med" nel path) → RC PROF MED V2 dal contenuto', () => {
  const r = detectProfileForDossier({ label: 'in vigore', contentText: CEDAM, profiles: PROFILES })
  assert.equal(r.profileId, V2.id)
  assert.equal(r.via, 'content')
  assert.ok(r.matched.length, JSON.stringify(r))
})

test('detectProfileForDossier: Fabbricati/ NON ruba il profilo sanitario', () => {
  const r = detectProfileForDossier({
    label: 'Cond Via della libertà 55',
    contentText: FABBRICATI,
    profiles: PROFILES,
  })
  assert.equal(r.profileId, FAB.id, JSON.stringify(r))
  // Path "libertà" non matcha; contenuto "fabbricat"/"incendio" sì, o path vuoto
  // con contenuto che non ha "med" abbastanza da battere Fabbricati.
  assert.notEqual(r.profileId, V2.id)
})

test('detectProfileForDossier: Abitazione/DiGrazia dal percorso', () => {
  const r = detectProfileForDossier({ label: 'DiGrazia', contentText: '', profiles: PROFILES })
  assert.equal(r.profileId, ABIT.id)
  assert.equal(r.via, 'path')
})

test('detectProfileForDossier: in vigore/ SENZA testo → nessun profilo (path non contiene med)', () => {
  const r = detectProfileForDossier({ label: 'in vigore', contentText: '', profiles: PROFILES })
  assert.equal(r.profileId, '')
  assert.equal(r.via, null)
})

test('detectProfileForDossier: contenuto incendio + path Fabbricati → profilo fabbricati (non V2)', () => {
  const r = detectProfileForDossier({
    label: 'Globale Fabbricati/polizza',
    contentText: 'il medesimo fabbricato è assicurato contro incendio',
    profiles: PROFILES,
  })
  assert.equal(r.profileId, FAB.id, JSON.stringify(r))
  assert.notEqual(r.profileId, V2.id)
})

test('profilePathKeywords: matchKeywords, altrimenti il nome', () => {
  assert.ok(profilePathKeywords(V2).some((k) => k.toLowerCase() === 'medico'))
  assert.ok(profilePathKeywords({ id: 'x', name: 'RCT RCO' }).includes('RCT RCO')
    || profilePathKeywords({ id: 'x', name: 'RCT RCO' }).length >= 1)
})
