/**
 * Nomenclatura del file tracciato inviato via SFTP (CSA Adesioni).
 *
 * Legenda AXA I14 vers.15: "{polizza}_{aaaammgg}.xlsx"
 * Esempio: "191025_20251021.xlsx"
 *
 * Esegui:  node --test test/adesioniFtpFilename.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_FIELDS,
  DEFAULT_POLICY_NUMBER,
  policyNumberFromFields,
  yyyymmddRome,
  trackExportFileName,
} from '../web/lib/adesioni/tracciato.js'

test('l\'esempio della legenda AXA è {polizza}_{aaaammgg}.xlsx', () => {
  const d = new Date('2025-10-21T12:00:00+02:00')
  assert.equal(trackExportFileName(DEFAULT_FIELDS, d), '191025_20251021.xlsx')
})

test('il numero polizza di default è quello del contratto CSA (191025)', () => {
  assert.equal(DEFAULT_POLICY_NUMBER, '191025')
  assert.equal(policyNumberFromFields(DEFAULT_FIELDS), '191025')
})

test('usa il numero polizza configurato nella maschera', () => {
  const fields = [{ id: 'numero_polizza', type: 'fixed', fixed: '999888' }]
  const d = new Date('2025-01-05T10:00:00+01:00')
  assert.equal(trackExportFileName(fields, d), '999888_20250105.xlsx')
})

test('se il campo manca o è vuoto, ricade su 191025', () => {
  const d = new Date('2025-10-21T12:00:00+02:00')
  assert.equal(trackExportFileName([], d), '191025_20251021.xlsx')
  assert.equal(trackExportFileName([{ id: 'numero_polizza', fixed: '   ' }], d), '191025_20251021.xlsx')
})

test('mezzanotte a Roma non usa il giorno UTC precedente', () => {
  // 00:30 CET = 23:30 UTC del giorno prima: il nome file deve restare il 15.
  const d = new Date('2026-01-15T00:30:00+01:00')
  assert.equal(yyyymmddRome(d), '20260115')
  assert.equal(trackExportFileName(DEFAULT_FIELDS, d), '191025_20260115.xlsx')
})

test('il nome file non contiene staging/prod né il prefisso tracciato_', () => {
  const name = trackExportFileName(DEFAULT_FIELDS, new Date('2025-10-21T12:00:00+02:00'))
  assert.match(name, /^\d+_20\d{6}\.xlsx$/)
  assert.doesNotMatch(name, /tracciato|staging|prod/i)
})
