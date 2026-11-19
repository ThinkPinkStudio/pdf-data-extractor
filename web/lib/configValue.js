// VALORE CONFIGURABILE (19/11/2026, regola dell'utente: «ogni cosa che è
// percentuale deve poter essere espressa come valore fisso, o come percentuale
// di altri campi»). Usato da RSM e Vita per ogni importo o percentuale delle
// regole: quota associativa, tariffe di un legame rispetto al titolare,
// rimborso al netto dell'imposta, quota d'entrata del secondo semestre,
// diritti, ecc.
//
// Forme accettate (le configurazioni vecchie hanno un numero semplice):
//   12                                   → importo fisso 12
//   { mode: 'fisso', value: 12 }         → importo fisso 12
//   { mode: 'percentuale', value: 50, of: ['premio'] } → 50% del premio
//   { mode: 'permille', value: 1.96, of: ['capitale'] } → 1,96‰ del capitale
// `of` è un elenco di chiavi della base: si sommano i loro valori nel contesto
// del calcolo (es. «premio + quota»). Una chiave sconosciuta vale 0.

/** @typedef {{ mode: 'fisso', value: number } | { mode: 'percentuale' | 'permille', value: number, of: string[] }} ConfigValue */

const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number(String(v ?? '').replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/**
 * Valore normalizzato. `legacy` dice come leggere un numero semplice delle
 * configurazioni vecchie: { mode: 'percentuale', of: ['premio'] } per una
 * percentuale storica (secondSemesterPct = 50), assente = importo fisso.
 * @returns {ConfigValue}
 */
export function normValue(v, legacy) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const mode = v.mode === 'percentuale' || v.mode === 'permille' ? v.mode : 'fisso'
    if (mode === 'fisso') return { mode, value: num(v.value) }
    const of = Array.isArray(v.of) ? v.of.map(String).filter(Boolean) : []
    return { mode, value: num(v.value), of }
  }
  if (legacy && (legacy.mode === 'percentuale' || legacy.mode === 'permille')) return { mode: legacy.mode, value: num(v), of: [...(legacy.of || [])] }
  return { mode: 'fisso', value: num(v) }
}

/** Somma delle basi del valore nel contesto (chiave → numero). */
export function baseOf(v, ctx) {
  const n = normValue(v)
  if (n.mode === 'fisso') return null
  return n.of.reduce((s, k) => s + (Number(ctx && ctx[k]) || 0), 0)
}

/**
 * Valore calcolato: l'importo fisso, o la percentuale (per mille) della somma
 * delle basi nel contesto. Mai arrotondato qui: arrotonda chi lo usa.
 */
export function evalValue(v, ctx, legacy) {
  const n = normValue(v, legacy)
  if (n.mode === 'fisso') return n.value
  const base = n.of.reduce((s, k) => s + (Number(ctx && ctx[k]) || 0), 0)
  return n.mode === 'permille' ? (base * n.value) / 1000 : (base * n.value) / 100
}

/** Il valore usa la base `key`? (per evitare riferimenti circolari nelle schermate) */
export const usesBase = (v, key) => { const n = normValue(v); return n.mode !== 'fisso' && n.of.includes(key) }

/** Testo leggibile: «12,00 €», «50% del premio», «1,96‰ di capitale + diritti». */
export function describeValue(v, labels = {}, legacy) {
  const n = normValue(v, legacy)
  const it = (x) => String(Math.round(x * 10000) / 10000).replace('.', ',')
  if (n.mode === 'fisso') return `${it(n.value)} €`
  const bases = n.of.map((k) => labels[k] || k).join(' + ') || '—'
  return `${it(n.value)}${n.mode === 'permille' ? '‰' : '%'} di ${bases}`
}
