/**
 * Codici configurazione 00005 (Pacchetto D) e 00006 (Pacchetto D Plus) di CSA
 * Adesioni: premio, opzione nel modulo e allineamento di una configurazione
 * già salvata nel DB (che vince sui default).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { DEFAULT_FIELDS, DEFAULT_PREZZI, withDefaultCodes } from '../web/lib/adesioni/tracciato.js'
import { premioFor, opzioneLabelFor } from '../web/lib/adesioni/premioService.js'

test('premio e pacchetto dei codici nuovi', () => {
  assert.deepEqual(premioFor('00005'), { pacchetto: 'D', premio: '40,00' })
  assert.deepEqual(premioFor('00006'), { pacchetto: 'D Plus', premio: '65,00' })
  assert.match(opzioneLabelFor('00005'), /Pacchetto D – assistenza stradale$/)
  assert.match(opzioneLabelFor('00006'), /Pacchetto D Plus/)
})

test('la select del codice configurazione offre 00005 e 00006', () => {
  const values = DEFAULT_FIELDS.find((f) => f.id === 'codice_configurazione').options.map((o) => o.value)
  assert.deepEqual(values, ['00001', '00002', '00003', '00005', '00006'])
})

test('configurazione salvata: aggiunge i codici mancanti, non tocca quelli salvati', () => {
  const savedFields = DEFAULT_FIELDS.map((f) => f.id === 'codice_configurazione'
    ? { ...f, options: f.options.slice(0, 3).map((o) => ({ ...o, label: o.label + ' (mia)' })) }
    : f)
  const savedPrezzi = { '00001': { pacchetto: 'A', premio: '25,00' }, '00002': { pacchetto: 'B', premio: '20,00' }, '00003': { pacchetto: 'C', premio: '39,00', formula: 'premio' } }
  const { fields, prezzi } = withDefaultCodes(savedFields, savedPrezzi)
  const opts = fields.find((f) => f.id === 'codice_configurazione').options
  assert.deepEqual(opts.map((o) => o.value), ['00001', '00002', '00003', '00005', '00006'])
  assert.equal(opts[0].label, '00001 — Assistenza (mia)')
  assert.equal(prezzi['00001'].premio, '25,00')
  assert.equal(prezzi['00003'].formula, 'premio')
  assert.deepEqual(prezzi['00005'], DEFAULT_PREZZI['00005'])
  assert.deepEqual(prezzi['00006'], DEFAULT_PREZZI['00006'])
  // idempotente
  assert.deepEqual(withDefaultCodes(fields, prezzi), { fields, prezzi })
})

test('il modulo predefinito ha le tabelle D e D Plus coi premi della tabella', () => {
  const html = readFileSync(new URL('../web/assets/adesioni/modulo_html/page-1.xhtml', import.meta.url), 'utf8')
  assert.match(html, /PACCHETTO D – ASSISTENZA STRADALE - PREMIO UNITARIO/)
  assert.match(html, /PACCHETTO D PLUS – ASSISTENZA STRADALE E TUTELA LEGALE - PREMIO UNITARIO/)
  for (const v of ['35,56', '4,44', '40,00', '30,04', '3,76', '33,80', '27,73', '3,47', '31,20', '57,78', '7,22', '65,00']) {
    assert.ok(html.includes(`>${v}</p>`), v)
  }
})
