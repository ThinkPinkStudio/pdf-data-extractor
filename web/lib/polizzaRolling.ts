/* eslint-disable @typescript-eslint/no-explicit-any */
// Helper sullo stato rolling strutturato del desktop ({ id: { valore, data_validita, fonte } }).
// Identici a quelli usati nel client (polizza/page.tsx), centralizzati per riuso server.

export interface Source { file: string; page: number }

export function flattenRollingState(state: any): Record<string, string> {
  const flat: Record<string, string> = {}
  for (const [key, entry] of Object.entries(state || {})) {
    if (entry == null) continue
    if (typeof entry === 'object' && 'valore' in (entry as any)) {
      const v = (entry as any).valore
      if (v != null && v !== '') flat[key] = v
    } else if (typeof entry === 'string' && entry !== '') {
      flat[key] = entry
    }
  }
  return flat
}

export function buildSources(state: any): Record<string, Source> {
  const out: Record<string, Source> = {}
  for (const [key, entry] of Object.entries(state || {})) {
    const e = entry as any
    if (e && typeof e === 'object' && e.valore != null && e.valore !== '' && e.fonte) out[key] = e.fonte
  }
  return out
}

// Scaffold iniziale dello stato (replica initRollingState del servizio condiviso).
export function initRollingState(fields: { id: string }[]): Record<string, any> {
  const s: Record<string, any> = {}
  for (const f of fields) s[f.id] = { valore: null, data_validita: null }
  return s
}
