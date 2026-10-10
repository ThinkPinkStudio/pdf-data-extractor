'use client'
// RIEPILOGHI — dati del dettaglio: GET a ogni cambio dei parametri di vista
// (anno, gruppo, a, b, campo), PATCH che restituisce il dettaglio aggiornato,
// ricarica ed export. Durante un ricaricamento restano visibili i dati di
// prima. Le risposte arrivano in ordine di richiesta: una GET partita prima
// di un PATCH non sovrascrive il suo esito (numero di sequenza). Se una GET
// fallisce dopo il primo caricamento, i filtri TORNANO a quelli dei dati
// mostrati (mai «2023» sopra i numeri di tutti gli anni) e `refreshError`
// dice cosa è successo; `retry` riprova la vista chiesta.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SummaryDetail, SummaryPatchBody, SummaryPatchResult } from '@/lib/summaryTypes'
import { downloadBlob } from '@/components/jobs/model'

export interface SummaryQuery {
  anno: string | null
  gruppo: string | null
  a: string | null
  b: string | null
  campo: string | null
}

export const QUERY_KEYS: (keyof SummaryQuery)[] = ['anno', 'gruppo', 'a', 'b', 'campo']

export function readQuery(sp: { get: (k: string) => string | null }): SummaryQuery {
  const year = (v: string | null) => (v && /^\d{4}$/.test(v) ? v : null)
  const anno = sp.get('anno')
  return {
    anno: anno === 'none' ? 'none' : year(anno),
    gruppo: sp.get('gruppo') || null,
    a: year(sp.get('a')),
    b: year(sp.get('b')),
    campo: sp.get('campo') || null,
  }
}

export function queryString(q: SummaryQuery): string {
  const p = new URLSearchParams()
  for (const k of QUERY_KEYS) if (q[k]) p.set(k, q[k] as string)
  return p.toString()
}

export type PatchOutcome =
  | { ok: true; detail: SummaryDetail; result: SummaryPatchResult | null }
  | { ok: false; status: number; body: { error?: string; code?: string; refused?: { jobId: string; name: string; reason: string; detail?: string | null }[]; errors?: unknown[] } }

export interface SummaryState {
  data: SummaryDetail | null
  status: 'loading' | 'ok' | 'notFound' | 'error'
  error: string
  /** GET fallita con dati già mostrati (i filtri sono tornati a quelli dei dati). */
  refreshError: string
  /** Riprova la vista che non si è caricata (o ricarica). */
  retry: () => void
  loading: boolean
  q: SummaryQuery
  setQ: (patch: Partial<SummaryQuery>) => void
  patch: (body: SummaryPatchBody, nextQ?: Partial<SummaryQuery>) => Promise<PatchOutcome>
  reload: () => void
  exportExcel: (lang: string) => Promise<boolean>
  exporting: boolean
}

/** Testo di un errore dell'API nella lingua dell'utente (apiErrorText con la sua t). */
export type ErrText = (body: { error?: string; code?: string } | null, status: number) => string

export function useSummary(id: string, initial: SummaryQuery, errText: ErrText): SummaryState {
  const errTextRef = useRef(errText)
  errTextRef.current = errText
  const [q, setQState] = useState<SummaryQuery>(initial)
  const [data, setData] = useState<SummaryDetail | null>(null)
  const [status, setStatus] = useState<SummaryState['status']>('loading')
  const [error, setError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [loading, setLoading] = useState(true)
  // Vista dei dati mostrati e vista che non si è caricata (per «Riprova»).
  const shownQ = useRef<SummaryQuery | null>(null)
  const failedQ = useRef<SummaryQuery | null>(null)
  const [nonce, setNonce] = useState(0)
  const [exporting, setExporting] = useState(false)
  const seq = useRef(0)
  // Chiave già caricata da un PATCH: la GET dello stesso stato non si ripete.
  const loadedKey = useRef<string | null>(null)
  const qs = queryString(q)
  const base = `/api/polizza/summaries/${encodeURIComponent(id)}`

  useEffect(() => {
    const key = `${qs}#${nonce}`
    if (loadedKey.current === key) return
    const my = ++seq.current
    let alive = true
    const asked = q
    setLoading(true)
    const failed = (msg: string) => {
      setError(msg)
      setLoading(false)
      if (shownQ.current) {
        // Dati già mostrati: restano, e i filtri tornano ai loro.
        failedQ.current = asked
        setRefreshError(msg)
        loadedKey.current = `${queryString(shownQ.current)}#${nonce}`
        setQState(shownQ.current)
      } else {
        setStatus('error')
      }
    }
    fetch(`${base}${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json().catch(() => null)
        if (!alive || my !== seq.current) return
        if (r.status === 404) { setStatus('notFound'); setData(null); return }
        if (!r.ok || !d) { failed(errTextRef.current(d, r.status)); return }
        loadedKey.current = key
        shownQ.current = asked
        failedQ.current = null
        setData(d as SummaryDetail)
        setStatus('ok')
        setError('')
        setRefreshError('')
      })
      .catch(() => { if (alive && my === seq.current) failed(errTextRef.current(null, 0)) })
      .finally(() => { if (alive && my === seq.current) setLoading(false) })
    return () => { alive = false }
    // q è già in qs: la dipendenza è la sua forma testuale
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, qs, nonce])

  const setQ = useCallback((p: Partial<SummaryQuery>) => setQState((cur) => ({ ...cur, ...p })), [])

  const patch = useCallback(async (body: SummaryPatchBody, nextQ?: Partial<SummaryQuery>): Promise<PatchOutcome> => {
    const target = nextQ ? { ...q, ...nextQ } : q
    const tqs = queryString(target)
    const my = ++seq.current
    setLoading(true)
    try {
      const r = await fetch(`${base}${tqs ? `?${tqs}` : ''}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) return { ok: false, status: r.status, body: d || {} }
      const { result, ...detail } = d as SummaryDetail & { result?: SummaryPatchResult }
      if (my === seq.current) {
        loadedKey.current = `${tqs}#${nonce}`
        shownQ.current = target
        failedQ.current = null
        if (nextQ) setQState(target)
        setData(detail as SummaryDetail)
        setStatus('ok')
        setError('')
        setRefreshError('')
      }
      return { ok: true, detail: detail as SummaryDetail, result: result || null }
    } catch (e) {
      return { ok: false, status: 0, body: { error: String((e as Error)?.message || e) } }
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [base, q, nonce])

  const reload = useCallback(() => { loadedKey.current = null; setRefreshError(''); setNonce((n) => n + 1) }, [])

  const retry = useCallback(() => {
    const f = failedQ.current
    failedQ.current = null
    setRefreshError('')
    if (f && queryString(f) !== qs) setQState(f)
    else { loadedKey.current = null; setNonce((n) => n + 1) }
  }, [qs])

  const exportExcel = useCallback(async (lang: string): Promise<boolean> => {
    setExporting(true)
    try {
      const p = new URLSearchParams({ lang: lang === 'en' ? 'en' : 'it' })
      const cmp = data?.compare
      if (cmp && !('error' in cmp)) { p.set('a', String(cmp.yearA)); p.set('b', String(cmp.yearB)) }
      const r = await fetch(`${base}/export?${p.toString()}`)
      if (!r.ok) return false
      const cd = r.headers.get('Content-Disposition') || ''
      const m = /filename="([^"]+)"/.exec(cd)
      downloadBlob(await r.blob(), m ? m[1] : 'riepilogo.xlsx')
      return true
    } catch {
      return false
    } finally {
      setExporting(false)
    }
  }, [base, data])

  return { data, status, error, refreshError, retry, loading, q, setQ, patch, reload, exportExcel, exporting }
}
