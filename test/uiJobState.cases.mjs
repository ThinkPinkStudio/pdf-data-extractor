// Casi dello stato «Non valido» (web/lib/jobValidity.ts + web/components/jobs/model.ts).
// Non si lancia da solo: lo esegue uiJobState.test.mjs con
// --experimental-strip-types, perché i moduli sono TypeScript; l'alias «@/» e
// gli import senza estensione li risolve test/helpers/tsResolveHook.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = pathToFileURL(join(here, '..', 'web') + '/').href
register(pathToFileURL(join(here, 'helpers', 'tsResolveHook.mjs')).href, { data: { webRoot } })

const v = await import(pathToFileURL(join(here, '..', 'web', 'lib', 'jobValidity.ts')).href)
const m = await import(pathToFileURL(join(here, '..', 'web', 'components', 'jobs', 'model.ts')).href)

const t = (k, p) => (p ? `${k}${JSON.stringify(p)}` : k)
const job = (over) => ({ jobId: 'j1', dossierName: 'ALZAIA NAVIGLIO PAVESE 101 Tutela legale DAS', status: 'mismatch', values: {}, error: null, precheck: null, ...over })

test('isNotValidJob: prefisso «Non valido», flag del precheck o polizza «assente»; i vecchi «Accantonato» NO (forzabili)', () => {
  const nuovo = job({ error: v.notValidError('nessuna polizza tra i documenti letti: solo una quietanza di pagamento', 'quietanza.pdf') })
  assert.ok(nuovo.error.startsWith('Non valido — '))
  assert.equal(v.isNotValidJob(nuovo), true)
  assert.equal(v.isNotValidJob(job({ error: 'qualunque', precheck: { notValid: true } })), true)
  assert.equal(v.isNotValidJob(job({ error: 'qualunque', precheck: { polizza: { esito: 'assente' } } })), true)
  // vecchi «Accantonato» (anche dalla regex «polizza vera», con falsi negativi
  // veri): forzabili, la guardia del worker chiede al modello
  const old = job({ error: 'Accantonato — cartella senza polizza principale. Documenti letti: q.pdf.', precheck: { setAside: true } })
  assert.equal(v.isNotValidJob(old), false)
  assert.equal(v.isLegacySetAside(old), true)
  assert.equal(v.isLegacySetAside(job({ error: 'Accantonato — x' })), true)
  assert.equal(v.isLegacySetAside(nuovo), false)
  // restano forzabili: Non pertinente, Scartato, Da verificare
  assert.equal(v.isNotValidJob(job({ error: 'Non pertinente al profilo "TL" — copertura non operante.' })), false)
  assert.equal(v.isNotValidJob(job({ error: 'Scartato — parola da evitare.' })), false)
  assert.equal(v.isNotValidJob(job({ status: 'review', error: 'Da verificare — dubbio.', precheck: { polizza: { esito: 'non determinabile' } } })), false)
  // rimesso in coda (Riabbina): non è più Non valido, anche se il testo è rimasto
  assert.equal(v.isNotValidJob(job({ status: 'queued', error: 'Non valido — x', precheck: { notValid: true } })), false)
  assert.equal(v.isNotValidJob(null), false)
})

test('notValidRefusal: il 409 delle route proceed / extract / reuse / bulk', () => {
  const r = v.notValidRefusal(job({ error: 'Non valido — nessuna polizza.' }))
  assert.equal(r.code, 'not-valid')
  assert.equal(r.error, v.NOT_VALID_REFUSAL)
  assert.match(r.error, /Riabbina rifà il controllo sugli stessi documenti/)
  assert.equal(v.notValidRefusal(job({ error: 'Accantonato — x' })), null, 'vecchio Accantonato: Procedi comunque ammesso (decide il modello)')
  assert.equal(v.notValidRefusal(job({ error: 'Non pertinente al profilo "TL" — x' })), null, 'Procedi comunque resta ammesso')
  assert.equal(v.notValidRefusal(job({ status: 'matched', error: null })), null, 'Estrai resta ammesso sugli abbinati')
  assert.equal(v.notValidRefusal(null), null)
})

test('policyGate (guardia del worker prima di estrarre): da soli solo con la polizza VISTA', () => {
  const pres = { esito: 'presente', documento: 1, pagina: 1 }
  const abs = { esito: 'assente', reason: 'solo quietanza' }
  const nd = { esito: 'non determinabile', reason: 'x' }
  const nv = { esito: 'non verificata', reason: 'pagine non mostrate' }
  const err = { esito: 'non verificata', reason: 'Ollama giù', error: true }
  assert.equal(v.policyGate(pres), 'extract')
  assert.equal(v.policyGate(abs), 'notValid')
  assert.equal(v.policyGate(abs, { override: true, informed: true }), 'notValid', 'assente: nemmeno Procedi comunque')
  // polizza non vista: da soli mai; job senza profilo, pre-controllo in errore, ▶ → review
  assert.equal(v.policyGate(nd), 'review')
  assert.equal(v.policyGate(nv), 'review')
  // Procedi comunque premuto CONOSCENDO l'esito: estrae (decisione dell'operatore)
  assert.equal(v.policyGate(nd, { override: true, informed: true }), 'extract')
  assert.equal(v.policyGate(nv, { override: true, informed: true }), 'extract')
  // Procedi comunque premuto prima che l'esito esistesse (vecchi job): prima si mostra l'esito
  assert.equal(v.policyGate(nd, { override: true, informed: false }), 'review')
  // guasto: si rifà il controllo, anche forzando
  assert.equal(v.policyGate(err, { override: true, informed: true }), 'review')
  assert.equal(v.policyGate(null), 'review')
  assert.equal(v.policyGate({ esito: 'presente', error: true }), 'review')
})

test('forcedWithoutPolicy: i valori estratti forzando una polizza non vista non si riusano', () => {
  assert.equal(v.forcedWithoutPolicy(job({ status: 'done', precheck: { override: true } })), true, 'ALZAIA estratta prima del 26/09')
  assert.equal(v.forcedWithoutPolicy(job({ status: 'done', precheck: { override: true, polizza: { esito: 'non determinabile' } } })), true)
  assert.equal(v.forcedWithoutPolicy(job({ status: 'done', precheck: { override: true, polizza: { esito: 'presente' } } })), false)
  assert.equal(v.forcedWithoutPolicy(job({ status: 'done', precheck: { verdict: 'ok' } })), false, 'estrazione normale')
  assert.equal(v.forcedWithoutPolicy(null), false)
})

test('polizzaLine: riga «polizza: …» della motivazione (colonna Pertinenza)', () => {
  assert.equal(v.polizzaLine(null), '')
  assert.equal(v.polizzaLine({ esito: 'presente', documento: 2, pagina: 1, motivo: 'frontespizio' }), ' · polizza: presente — Documento 2 pag. 1: frontespizio')
  assert.equal(v.polizzaLine({ esito: 'assente', reason: 'nessuna polizza' }), ' · polizza: assente: nessuna polizza')
})

test('uiState / filtri: «Non valido» è notValid, non una decisione da prendere; i vecchi «Accantonato» sono decisioni', () => {
  const nv = job({ error: 'Non valido — nessuna polizza.' })
  const old = job({ error: 'Accantonato — senza polizza principale.' })
  const np = job({ error: 'Non pertinente al profilo "TL" — non operante.' })
  const sc = job({ error: 'Scartato — parola da evitare.' })
  const rv = job({ status: 'review', error: 'Da verificare — dubbio.' })
  assert.equal(m.uiState(nv), 'notValid')
  assert.equal(m.uiState(old), 'mismatch')
  assert.equal(m.uiState(np), 'mismatch')
  assert.equal(m.uiState(sc), 'discarded')
  assert.equal(m.filterOf(nv), 'notValid')
  // niente Procedi comunque (collettivo e tasto P) per i Non validi
  assert.equal(m.needsDecision(nv), false)
  assert.equal(m.needsDecision(old), true, 'vecchio Accantonato: forzabile')
  assert.equal(m.needsDecision(np), true)
  assert.equal(m.needsDecision(sc), true)
  assert.equal(m.needsDecision(rv), true)
  assert.ok(m.FILTERS.includes('notValid') && !m.FILTERS.includes('setAside'))
  assert.equal(m.FILTER_LABEL_KEY.notValid, 'jobsDash.chipNotValid')
  // link salvati con ?stato=setAside
  assert.equal(m.parseFilter('setAside'), 'notValid')
  assert.equal(m.parseFilter('notValid'), 'notValid')
  assert.equal(m.parseFilter('boh'), null)
  assert.equal(m.errorText(nv), 'nessuna polizza.')
  const c = m.countByFilter([nv, old, np, sc, rv])
  assert.equal(c.notValid, 1); assert.equal(c.mismatch, 3); assert.equal(c.review, 1)
})

test('reasonLine: per un Non valido dice che manca la polizza, MAI l\'esito di operatività', () => {
  const nv = job({
    error: 'Non valido — nessuna polizza tra i documenti letti: solo una quietanza. Documenti letti: q.pdf.',
    precheck: {
      verdict: 'mismatch', notValid: true,
      operativita: { esito: 'non operante', documento: 1, pagina: 1, evidenza: 'Tutela Legale ESCLUSA 31.000,00' },
      polizza: { esito: 'assente', documento: 1, pagina: 1, motivo: 'solo una quietanza di pagamento del premio' },
    },
  })
  const r = m.reasonLine(nv, t)
  assert.equal(r.head, 'jobsDash.noPolicyHead')
  assert.match(r.body, /quietanza di pagamento/)
  assert.ok(!/ESCLUSA/.test(r.body), r.body)
  // vecchio Accantonato (22/09: operante + sole quietanze): la sua testa, MAI
  // «prova respinta» (nessuno l'ha respinta), il testo errore senza prefisso
  const old = m.reasonLine(job({
    error: 'Accantonato — copertura operante ma senza polizza principale.',
    precheck: { verdict: 'mismatch', setAside: true, operativita: { esito: 'operante', documento: 1, pagina: 1, evidenza: 'Tutela Legale 240,00' } },
  }), t)
  assert.equal(old.head, 'jobsDash.legacySetAsideHead')
  assert.equal(old.body, 'copertura operante ma senza polizza principale.')
  // assente: nessun «dove» (documento/pagina null) → il motivo del modello
  const nd = m.reasonLine(job({ error: 'Non valido — x', precheck: { notValid: true, polizza: { esito: 'assente', documento: null, pagina: null, motivo: 'solo una quietanza' } } }), t)
  assert.equal(nd.body, 'solo una quietanza')
})

test('riepiloghi dei batch: i Non validi non «aspettano una decisione» e non tengono il batch da confermare', () => {
  const b = { id: 'b', label: 'L', email: '', created_at: 0, total: 5, queued: 0, running: 0, done: 2, error: 0, canceled: 0, mismatch: 3, matched: 0, review: 0, notValid: 2 }
  const c = m.countsFromBatch(b)
  assert.equal(c.notValid, 2); assert.equal(c.mismatch, 1)
  assert.equal(m.decisionCount(b), 1)
  assert.equal(m.batchStatus(b), 'mismatch')
  assert.equal(m.batchStatus({ ...b, mismatch: 2, done: 3 }), 'done', 'solo Non validi: il batch è finito')
  // riepiloghi vecchi senza notValid: come prima
  assert.equal(m.decisionCount({ ...b, notValid: undefined }), 3)
  const s = m.summarizeJobs([job({ error: 'Non valido — x' }), job({ error: 'Accantonato — y' }), job({ error: 'Non pertinente al profilo "T" — z' }), job({ status: 'done' })])
  assert.equal(s.mismatch, 3); assert.equal(s.notValid, 1); assert.equal(s.done, 1)
})
