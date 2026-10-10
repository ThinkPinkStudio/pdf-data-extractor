// RIEPILOGHI — formattazione dei numeri e piccole regole PURE dell'interfaccia
// (nessun fetch, nessun JSX). I tipi dei campi arrivano già decisi dal server
// (dalla DESCRIZIONE, mai dalla label): qui si decide solo come si scrivono.
import type { AggValue, Delta, MinMax, SummaryField } from '@/lib/summaryTypes'
import type { T } from '@/components/jobs/types'

export type NumKind = Pick<SummaryField, 'kind' | 'unit'> | null | undefined

export const isMinMax = (v: unknown): v is MinMax => !!v && typeof v === 'object' && 'min' in (v as object) && 'max' in (v as object)

export function localeOf(lang: string): string {
  return lang === 'en' ? 'en-GB' : 'it-IT'
}

/** Plurale a 1: usa `<chiave>1` se esiste (niente libreria di plurali). */
export function tn(t: T, key: string, n: number, vars: Record<string, string | number> = {}): string {
  const one = `${key}1`
  if (n === 1) {
    const s = t(one, { n, ...vars })
    if (s !== one) return s
  }
  return t(key, { n, ...vars })
}

/** Prima lettera minuscola, ma non per le sigle («Decorrenza» → «decorrenza», «P. IVA» resta). */
export function lcFirst(s: string): string {
  if (!s || s.length < 2) return s
  const second = s[1]
  return second === second.toLowerCase() && second !== second.toUpperCase() ? s[0].toLowerCase() + s.slice(1) : s
}

export interface Fmt {
  locale: string
  /** Valore aggregato con «€» se l'importo è in euro (KPI, statistiche, carte). */
  agg: (v: AggValue | undefined, f: NumKind) => string
  /** Valore aggregato senza unità (tabella, etichette dei grafici). */
  bare: (v: AggValue | undefined, f: NumKind) => string
  /** Valore di UNA polizza: decimali solo se ci sono. */
  one: (v: number | null | undefined, f: NumKind, withUnit?: boolean) => string
  /** Frazione 0..1 → «45%». */
  pct: (p: number | null | undefined) => string
  int: (n: number | null | undefined) => string
  /** Data da secondi epoch. */
  date: (sec: number | null | undefined) => string
  dateTime: (sec: number | null | undefined) => string
}

const DASH = '—'

export function makeFmt(lang: string): Fmt {
  const locale = localeOf(lang)
  // Separatore delle migliaia SEMPRE (in italiano Intl lo omette sotto 10.000: «5958» invece di «5.958»).
  const grouping = { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions
  const nf = (min: number, max: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: max, ...grouping })
  const f0 = nf(0, 0)
  const f2 = nf(2, 2)
  const upTo2 = nf(0, 2)
  const upTo3 = nf(0, 3)
  const num = (n: number, f: NumKind): string => {
    if (f?.kind === 'rate') return upTo3.format(n)
    if (f?.unit === 'num') return Math.abs(n) >= 100 ? f0.format(n) : upTo2.format(n)
    return Math.abs(n) >= 100 ? f0.format(n) : f2.format(n)
  }
  const eur = (f: NumKind) => f?.kind === 'amount' && f?.unit === 'eur'
  const bare = (v: AggValue | undefined, f: NumKind): string => {
    if (v == null) return DASH
    if (isMinMax(v)) return `${num(v.min, f)}–${num(v.max, f)}`
    return num(v, f)
  }
  const agg = (v: AggValue | undefined, f: NumKind): string => {
    const s = bare(v, f)
    return s !== DASH && eur(f) ? `€ ${s}` : s
  }
  const one = (v: number | null | undefined, f: NumKind, withUnit = false): string => {
    if (v == null) return DASH
    const s = f?.kind === 'rate' ? upTo3.format(v) : Number.isInteger(v) ? f0.format(v) : f2.format(v)
    return withUnit && eur(f) ? `€ ${s}` : s
  }
  const pct = (p: number | null | undefined): string => (p == null ? DASH : `${f0.format(Math.round(p * 100))}%`)
  const int = (n: number | null | undefined): string => (n == null ? DASH : f0.format(n))
  const date = (sec: number | null | undefined): string => (sec ? new Date(sec * 1000).toLocaleDateString(locale) : DASH)
  const dateTime = (sec: number | null | undefined): string => (sec ? new Date(sec * 1000).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : DASH)
  return { locale, agg, bare, one, pct, int, date, dateTime }
}

export type DeltaTone = 'up' | 'down' | 'flat'

/**
 * UNA regola per il colore di uno scarto, in tutte le viste (mockup Tabella e
 * Confronto): aumento verde, calo o parità neutri. Un totale incompleto
 * (delta.partial: somma con polizze senza valore in uno dei due anni) resta
 * neutro anche se aumenta.
 */
export function deltaClass(sign: number | null | undefined, partial = false): string {
  return !partial && sign != null && sign > 0 ? 'jb-c-ok' : 'neu'
}

/** Titolo (tooltip) di un delta incompleto: quante polizze hanno il valore nei due anni. */
export function partialTitle(t: T, d: Delta | null | undefined, a: number | string, b: number | string): string | undefined {
  if (!d?.partial || !d.cov) return undefined
  return t('rp.partialDelta', { nA: d.cov.a.n, ofA: d.cov.a.of, nB: d.cov.b.n, ofB: d.cov.b.of, a, b })
}

/**
 * Messaggio di un errore dell'API nella lingua dell'utente: il server manda
 * sempre un `code` (rp.err.<code>); il suo testo italiano resta solo un ripiego.
 */
export function apiErrorText(t: T, body: { error?: string; code?: string } | null | undefined, status: number): string {
  const code = body?.code || (status === 401 ? 'unauthorized' : status === 0 ? 'network' : '')
  if (code) {
    const k = `rp.err.${code}`
    const s = t(k)
    if (s !== k) return s
  }
  return body?.error || `HTTP ${status}`
}

/** Scarto in percentuale: «=» sotto lo 0,5%. */
export function pctTone(d: Delta | null | undefined): { tone: DeltaTone; pct: number } | null {
  if (!d || d.pct == null) return null
  if (Math.abs(d.pct) < 0.005) return { tone: 'flat', pct: 0 }
  return { tone: d.pct > 0 ? 'up' : 'down', pct: Math.abs(d.pct) }
}

/** «▲ 14%» / «▼ 3%» / «=». */
export function pctText(d: Delta | null | undefined, fmt: Fmt): string {
  const x = pctTone(d)
  if (!x) return DASH
  if (x.tone === 'flat') return '='
  return `${x.tone === 'up' ? '▲' : '▼'} ${fmt.pct(x.pct)}`
}

/** «+14%» / «−3%» / «=» (carte del confronto). */
export function pctSigned(d: Delta | null | undefined, fmt: Fmt): string {
  const x = pctTone(d)
  if (!x) return DASH
  if (x.tone === 'flat') return '='
  return `${x.tone === 'up' ? '+' : '−'}${fmt.pct(x.pct)}`
}

/** Scarto assoluto di un conteggio: «+1» / «−1» / «=». */
export function countSigned(n: number | null | undefined, fmt: Fmt): string {
  if (n == null) return DASH
  if (n === 0) return '='
  return `${n > 0 ? '+' : '−'}${fmt.int(Math.abs(n))}`
}

/** Scarto in punti di una percentuale (verifiche): «+3 pt». */
export function pointsSigned(abs: number | null | undefined, fmt: Fmt): string {
  if (abs == null) return DASH
  const pts = Math.round(abs * 100)
  if (pts === 0) return '='
  return `${pts > 0 ? '+' : '−'}${fmt.int(Math.abs(pts))} pt`
}

/** Scarto firmato di un importo di UNA polizza (tabella del confronto). */
export function amountSigned(n: number | null | undefined, f: NumKind, fmt: Fmt): string {
  if (n == null) return DASH
  if (n === 0) return '='
  return `${n > 0 ? '+' : '−'}${fmt.one(Math.abs(n), f)}`
}

/** Etichetta di una fascia o di un valore della distribuzione. */
export function bucketLabel(it: { from: number | null; to: number | null; open: 'below' | 'above' | null }, mode: 'values' | 'bands', f: NumKind, fmt: Fmt, withUnit: boolean): string {
  const v = (n: number | null) => (withUnit ? fmt.agg(n, f) : fmt.bare(n, f))
  if (mode === 'values') return v(it.from)
  if (it.open === 'below') return `< ${v(it.to)}`
  if (it.open === 'above') return `≥ ${v(it.from)}`
  return `${fmt.bare(it.from, f)}–${fmt.bare(it.to, f)}`
}

/** Link alla polizza nella pagina del suo batch (o delle estrazioni singole). */
export function policyHref(jobId: string, batchId: string | null | undefined): string {
  return `/polizza/jobs/${batchId || 'singole'}?polizza=${encodeURIComponent(jobId)}`
}

/** Operazione in parole per le etichette («somma», «media», «minimo–massimo»). */
export function opWord(t: T, op: string | null | undefined): string {
  if (op === 'sum') return t('rp.op.sumWord')
  if (op === 'avg') return t('rp.op.avgWord')
  if (op === 'minmax') return t('rp.op.minmaxWord')
  if (op === 'count') return t('rp.op.count')
  return op || ''
}

/** Scala «tonda» per le righe guida dei grafici: il passo più piccolo ≥ x. */
export function niceStep(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(x)))
  for (const k of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * mag >= x * (1 - 1e-9)) return k * mag
  return 10 * mag
}
