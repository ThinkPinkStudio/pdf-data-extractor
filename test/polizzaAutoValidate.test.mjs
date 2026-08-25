/**
 * Test di auto-validazione "zero-shot" (FEATURE B): modulo PURO
 * src/main/services/polizzaAutoValidate.js.
 *
 * Esegui:  node --test test/polizzaAutoValidate.test.mjs
 *
 * Dopo il merge, una SECONDA chiamata LLM compatta conferma o scarta i candidati
 * TESTUALI senza checksum e CON poca affidabilità. DEFAULT OFF: senza
 * settings.polizzaAutoVerify === true non si chiama nulla.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  selectFieldsToDoubleCheck, buildDoubleCheckPrompt, parseDoubleCheck,
  runAutoValidation, DEFAULT_MAX_FIELDS, AUTO_VERIFY_SYSTEM,
} from '../src/main/services/polizzaAutoValidate.js'

const mkField = (id, label, desc, type = 'text') => ({ id, label, description: desc, type })

const FIELDS = {
  attivita: mkField('attivita', 'Attività', 'Descrizione attività svolta'),
  agenzia: mkField('agenzia', 'Agenzia', 'Nome agenzia'),
  contraente: mkField('contraente', 'Contraente', 'Ragione sociale'),
  massimale: mkField('rct_massimale_sinistro', 'Massimale', 'Importo massimale'),
  codice_iva: mkField('codice_fiscale_iva', 'P.IVA', 'Partita IVA del contraente'),
  decorrenza: mkField('decorrenza', 'Decorrenza', 'Data di inizio', 'date'),
}

const bestWith = (values) =>
  Object.fromEntries(Object.entries(values).map(([id, v]) => [id, { valore: v }]))

// ─── selectFieldsToDoubleCheck ───────────────────────────────────────────────

test('selezione: solo campi TESTUALI, a bassa affidabilità, senza checksum', () => {
  const best = bestWith({
    attivita: 'produzione di olii e grassi', // testero, faible → da verificare
    agenzia: 'ACQUI TERME',                  // testero ma affidabilità alta → no
    massimale: '4.000.000,00',                 // importo → fuori
    codice_iva: '00151510344',                // P.IVA → fuori (checksum)
    decorrenza: '31/12/2024',                 // data → fuori
  })
  const reliability = {
    attivita: { reliable: 0.2 },
    agenzia: { reliable: 0.9 },
    massimale: { reliable: 0.1 },
    codice_iva: { reliable: 0.5 },
    decorrenza: { reliable: 0.3 },
  }
  const ids = selectFieldsToDoubleCheck(best, reliability, FIELDS, {
    checksumsById: { codice_iva: true },
  })
  assert.deepEqual(ids, ['attivita'])
})

test('selezione: campo con valore numerico/importo escluso anche se affidabilità bassa', () => {
  const best = bestWith({ massimale: '4.000.000,00' })
  const reliability = { massimale: { reliable: 0 } }
  assert.deepEqual(selectFieldsToDoubleCheck(best, reliability, FIELDS, {}), [])
})

test('selezione: campo data e campo P.IVA esclusi', () => {
  const best = bestWith({
    decorrenza: '31/12/2024',
    codice_iva: '00151510344',
    attivita: 'produzione di olii',
  })
  const reliability = { decorrenza: { reliable: 0 }, codice_iva: { reliable: 0 }, attivita: { reliable: 0 } }
  const ids = selectFieldsToDoubleCheck(best, reliability, FIELDS, {})
  assert.deepEqual(ids, ['attivita'])
})

test('selezione: ordina i più dubbi PRIMA (reliable crescente) e applica il max', () => {
  const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  const fields = Object.fromEntries(keys.map((k) => [k, mkField(k, k, k)]))
  const best = bestWith(Object.fromEntries(keys.map((k) => [k, k + '-valore'])))
  // affidabilità: a=0.6, b=0.5, c=0.4, d=0.3, e=0.2, f=0.1, g=0.0
  const reliability = Object.fromEntries(keys.map((k, i) => [k, { reliable: (6 - i) * 0.1 }]))
  assert.deepEqual(selectFieldsToDoubleCheck(best, reliability, fields, {}),
    ['g', 'f', 'e', 'd', 'c'])
  assert.deepEqual(selectFieldsToDoubleCheck(best, reliability, fields, { max: 2 }), ['g', 'f'])
  // threshold 0.5: a(0.6) e b(0.5) sono sopra soglia → fuori; restano c,d,e,f,g = 5
  const manyTest = selectFieldsToDoubleCheck(best, reliability, fields, { max: 100 })
  assert.equal(manyTest.length, 5)
})

test('DEFAULT_MAX_FIELDS esportato = 8', () => {
  assert.equal(DEFAULT_MAX_FIELDS, 8)
})

// ─── buildDoubleCheckPrompt / parseDoubleCheck ────────────────────────────────

test('buildDoubleCheckPrompt: include campo, coppia, valore ed evidenza', () => {
  const prompt = buildDoubleCheckPrompt({
    field: FIELDS.attivita,
    candidate: { valore: 'produzione di olii' },
    evidenza: '…produzione di olii e grassi vegetali…',
  })
  assert.ok(prompt.includes('attivita'))
  assert.ok(prompt.includes('produzione di olii'))
  assert.ok(prompt.includes('Descrizione attività svolta'))
  assert.ok(prompt.includes('produzione di olii e grassi vegetali'))
  assert.ok(prompt.includes('"ok"'))
})

test('parseDoubleCheck: JSON pulito', () => {
  assert.deepEqual(parseDoubleCheck('{"ok": true, "motivo": "coerente"}'), { ok: true, motivo: 'coerente' })
  assert.deepEqual(parseDoubleCheck('{"ok": false, "motivo": "fuori luogo"}'), { ok: false, motivo: 'fuori luogo' })
})

test('parseDoubleCheck: tofu JSON con testo attorno, stringhe con virgolette', () => {
  const raw = 'Ecco il mio giudizio: {"ok": false, "motivo": "non è il \\"parametro\\" giusto"} fine.'
  assert.deepEqual(parseDoubleCheck(raw), { ok: false, motivo: 'non è il "parametro" giusto' })
})

test('parseDoubleCheck: risposta non parsabile → ok:null (chiamante conserva)', () => {
  assert.deepEqual(parseDoubleCheck(''), { ok: null, motivo: null })
  assert.deepEqual(parseDoubleCheck('troppo bello vero, nessuna decisione'), { ok: null, motivo: null })
  assert.deepEqual(parseDoubleCheck('{"ok": "forse"}'), { ok: null, motivo: null })
})

// ─── runAutoValidation (LLM iniettato/stub) ────────────────────────────────
// Regola ferrea: errore o parse fallito → CONSERVA (mai bloccare per un
// fallimento del modello, come il pre-check).

test('runAutoValidation: flag OFF → 0 chiamate, best intatto', async () => {
  const best = bestWith({ attivita: 'produzione di olii' })
  const called = []
  const r = await runAutoValidation({
    best, fieldsById: FIELDS, reliabilityById: { attivita: { reliable: 0.1 } },
    settings: {}, // polizzaAutoVerify assente → OFF
    callModel: async () => { called.push(1); return '{"ok":false,"motivo":"x"}' },
  })
  assert.equal(r.calls, 0)
  assert.equal(called.length, 0)
  assert.ok(best.attivita, 'best non deve essere toccato')
})

test('runAutoValidation: ok:false motivato → SCARTA il candidato', async () => {
  const best = { attivita: { valore: 'produzione di olii' } }
  let usedPrompt = null
  const r = await runAutoValidation({
    best, fieldsById: FIELDS, reliabilityById: { attivita: { reliable: 0.1 } },
    settings: { polizzaAutoVerify: true },
    callModel: async (prompt) => { usedPrompt = prompt; return '{"ok": false, "motivo": "valore fuori luogo"}' },
  })
  assert.equal(r.calls, 1)
  assert.equal(r.scartati, 1)
  assert.equal(r.kept, 0)
  assert.ok(!('attivita' in best), 'campo scartato')
  assert.ok(usedPrompt.includes('produzione di olii'))
})

test('runAutoValidation: ok:true → CONSERVA il candidato', async () => {
  const best = { attivita: { valore: 'produzione di olii' } }
  const r = await runAutoValidation({
    best, fieldsById: FIELDS, reliabilityById: { attivita: { reliable: 0.1 } },
    settings: { polizzaAutoVerify: true },
    callModel: async () => '{"ok": true, "motivo": "coerente"}',
  })
  assert.equal(r.calls, 1)
  assert.equal(r.scartati, 0)
  assert.equal(r.kept, 1)
  assert.ok(best.attivita, 'il campo è conservato')
})

test('runAutoValidation: errore/piro del modello → CONSERVA (mai bloccare)', async () => {
  const best = { attivita: { valore: 'produzione di olii' } }
  const r = await runAutoValidation({
    best, fieldsById: FIELDS, reliabilityById: { attivita: { reliable: 0.1 } },
    settings: { polizzaAutoVerify: true },
    callModel: async () => { throw new Error('Ollama down') },
  })
  assert.equal(r.calls, 1)
  assert.equal(r.scartati, 0)
  assert.equal(r.kept, 1)
  assert.ok(best.attivita, 'il campo è conservato (errore → conserva)')
})

test('runAutoValidation: parse fallito / risposta vuota → CONSERVA', async () => {
  for (const raw of ['', 'non una decisione', 'null']) {
    const best = { attivita: { valore: 'produzione' } }
    const r = await runAutoValidation({
      best, fieldsById: FIELDS, reliabilityById: { attivita: { reliable: 0.1 } },
      settings: { polizzaAutoVerify: true },
      callModel: async () => raw,
    })
    assert.equal(r.scartati, 0, `raw=${JSON.stringify(raw)}`)
    assert.ok(best.attivita)
  }
})

test('runAutoValidation: ok:false SENZA motivo → NON scarta (conserva)', async () => {
  const best = { attivita: { valore: 'produzione' } }
  const r = await runAutoValidation({
    best, fieldsById: FIELDS, reliabilityById: { attivita: { reliable: 0.1 } },
    settings: { polizzaAutoVerify: true },
    callModel: async () => '{"ok": false}',
  })
  assert.equal(r.scartati, 0)
  assert.ok(best.attivita)
})

test('runAutoValidation: molti campi dubbi ma cap massimo rispettato (una chiamata per campo)', async () => {
  const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
  const fields = Object.fromEntries(keys.map((k) => [k, mkField(k, k, k)]))
  const best = bestWith(Object.fromEntries(keys.map((k) => [k, k + '-val'])))
  const reliability = Object.fromEntries(keys.map((k, i) => [k, { reliable: i * 0.05 }]))
  let calls = 0
  const r = await runAutoValidation({
    best, fieldsById: fields, reliabilityById: reliability,
    settings: { polizzaAutoVerify: true },
    callModel: async () => { calls++; return '{"ok": true, "motivo": "ok"}' },
    opts: { max: 5 },
  })
  assert.equal(calls, 5)
  assert.equal(r.calls, 5)
})

// ─── AUTO_VERIFY_SYSTEM ───────────────────────────────────────────────────────

test('AUTO_VERIFY_SYSTEM istruisce a rispondere con ok/motivo', () => {
  assert.ok(AUTO_VERIFY_SYSTEM.includes('"ok"'))
  assert.ok(AUTO_VERIFY_SYSTEM.includes('motivo'))
})