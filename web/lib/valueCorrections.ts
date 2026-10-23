/* eslint-disable @typescript-eslint/no-explicit-any */
// VALORI CORRETTI di un dossier estratto (19/10/2026, decisione dell'utente:
// «sovrascriverle, aggiungendo un'estrazione nello storico … non come
// correzione manuale: vanno solo corretti i valori»). I valori nuovi
// SOSTITUISCONO quelli nella rolling_state del job e il salvataggio chiude una
// run come un'estrazione: lo Storico mostra il prima/dopo campo per campo.
// Nessun segno di «correzione» nel dossier; il backup del prima lo tiene chi
// applica le correzioni.
//
// Questo modulo è PURO (niente DB): lo usano lo store e i test.

import { flattenRollingState } from './polizzaRolling'

export interface ValueCorrection {
  fieldId: string
  /** Valore nuovo; '' o null = campo svuotato. */
  value: string | null
  /** Dove sta il valore nei documenti (facoltativo). */
  fonte?: { file: string; page: number } | null
}

export interface CorrectionChange { fieldId: string; label: string; before: string; after: string }

export type CorrectionResult =
  | { ok: true; state: Record<string, any>; sources: Record<string, any>; changed: CorrectionChange[] }
  | { ok: false; code: 'unknown-field' | 'bad-input'; fieldId?: string }

/**
 * Applica i valori corretti a rolling_state e sources di un job. Un campo il
 * cui valore non cambia non conta. La fonte di un valore cambiato è quella
 * indicata; senza indicazione si toglie (la vecchia puntava al valore di prima).
 */
export function applyCorrections(
  rollingState: Record<string, any> | null | undefined,
  sources: Record<string, any> | null | undefined,
  fieldDefs: { id: string; label?: string }[] | null | undefined,
  corrections: ValueCorrection[] | null | undefined,
): CorrectionResult {
  if (!Array.isArray(corrections) || !corrections.length) return { ok: false, code: 'bad-input' }
  const defs = new Map((fieldDefs || []).map((f) => [f.id, f]))
  const state: Record<string, any> = { ...(rollingState || {}) }
  const src: Record<string, any> = { ...(sources || {}) }
  const flat = flattenRollingState(state)
  const changed: CorrectionChange[] = []
  const seen = new Set<string>()
  for (const c of corrections) {
    if (!c || typeof c.fieldId !== 'string') return { ok: false, code: 'bad-input' }
    const def = defs.get(c.fieldId)
    if (!def) return { ok: false, code: 'unknown-field', fieldId: c.fieldId }
    if (seen.has(c.fieldId)) return { ok: false, code: 'bad-input', fieldId: c.fieldId }
    seen.add(c.fieldId)
    const before = String(flat[c.fieldId] ?? '').trim()
    const after = String(c.value ?? '').trim()
    if (before === after) continue
    const fonte = c.fonte && typeof c.fonte.file === 'string' && Number.isFinite(Number(c.fonte.page))
      ? { file: c.fonte.file, page: Number(c.fonte.page) }
      : null
    if (!after) {
      delete state[c.fieldId]
      delete src[c.fieldId]
    } else {
      state[c.fieldId] = { valore: after, fonte }
      if (fonte) src[c.fieldId] = fonte
      else delete src[c.fieldId]
    }
    changed.push({ fieldId: c.fieldId, label: def.label || c.fieldId, before, after })
  }
  return { ok: true, state, sources: src, changed }
}
