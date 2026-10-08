// [flag acronimi] Consenso: varianti dello stesso nome con la SIGLA espansa
// (08/10/2026, P22 ARENA: «D.A.S. Difesa Automobilistica Sinistri» e «DAS
// S.p.A.» un voto ciascuno, vinceva «HELVETIA VITA» col suo voto).
import test from 'node:test'
import assert from 'node:assert/strict'
import { pickConsensusCandidate } from '../src/services/polizzaService.js'

const c = (valore, affinity = 0.45) => ({ valore, affinity, srcDate: '01/01/2025', file: 'a.pdf' })

test('acronimi: la sigla e il nome esteso sommano i voti e battono il corrente', () => {
  const cur = c('HELVETIA VITA', 0.48)
  const cands = [cur, c('D.A.S. Difesa Automobilistica Sinistri S.p.A.', 0.46), c('DAS S.p.A.', 0.44)]
  assert.equal(pickConsensusCandidate(cur, cands, { tierBlind: true }).changed, false)
  const r = pickConsensusCandidate(cur, cands, { tierBlind: true, acronyms: true })
  assert.equal(r.changed, true)
  assert.match(r.cand.valore, /D\.?A\.?S/)
  assert.equal(r.votes, 2)
})

test('acronimi: senza una sigla espansa nessun raggruppamento (Allianz / Allianz Viva)', () => {
  const cur = c('Allianz Viva S.p.A.', 0.5)
  const cands = [cur, c('Allianz S.p.A.'), c('Allianz Next S.p.A.')]
  const r = pickConsensusCandidate(cur, cands, { tierBlind: true, acronyms: true })
  assert.equal(r.changed, false)
})
