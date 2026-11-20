'use client'

// Programma della polizza Vita corrente (ricordato nel browser) con i suoi
// assicurati, condiviso da tutte le pagine della sezione. Gli importi si
// calcolano qui col modulo delle regole, così cambiare la data «situazione al»
// non chiede nulla al server.
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { computeInsured, fmtDate, movementOf, yearEndOf } from '@/lib/vita/rules.js'
import { clientOf } from '@/lib/vita/types'
import type { VitaInsured, VitaProgram } from '@/lib/vita/types'

const KEY = 'vitaProgram'

export interface Calc {
  rights?: number | null
  age: number | null
  rate: number | null
  target: number
  band: 'nessuna' | 'visita' | 'visita+accertamenti'
  capital: number
  scopertura: number
  net: number | null
  gross: number | null
  cover: string
  /** Categoria (calcolo per categoria): null = il livello non è di nessuna categoria. */
  category?: string | null
}

export type Row = VitaInsured & { c: Calc }

export interface Movement {
  key: string
  date: string
  kind: 'INCLUSIONE' | 'ESCLUSIONE'
  row: Row
  title: string
  source: string
  days: number
  gross: number | null
  capital: number
  transfer: boolean
}

export function useVita() {
  const [programs, setPrograms] = useState<(VitaProgram & { editor: boolean })[] | null>(null)
  const [programId, setProgramIdState] = useState<string | null>(null)
  const [program, setProgram] = useState<VitaProgram | null>(null)
  const [insured, setInsured] = useState<VitaInsured[]>([])
  const [editor, setEditor] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadPrograms = useCallback(async () => {
    const r = await fetch('/api/vita/programs')
    const j = await r.json()
    if (!r.ok) { setError(j.error || 'Errore'); setPrograms([]); return [] }
    setPrograms(j.programs)
    return j.programs as VitaProgram[]
  }, [])

  // Il programma richiesto per ultimo: la risposta di uno lasciato nel frattempo
  // non deve sovrascrivere quello scelto adesso.
  const wanted = useRef<string | null>(null)
  const load = useCallback(async (id: string) => {
    wanted.current = id
    setLoading(true)
    try {
      const r = await fetch(`/api/vita/programs/${id}`)
      const j = await r.json()
      if (wanted.current !== id) return
      if (!r.ok) { setError(j.error || 'Errore'); setProgram(null); setInsured([]); return }
      setError(null)
      setProgram(j.program)
      setInsured(j.insured)
      setEditor(!!j.editor)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    (async () => {
      const list = await loadPrograms()
      let saved: string | null = null
      try { saved = localStorage.getItem(KEY) } catch { /* senza storage: il primo */ }
      const pick = list.find((p) => p.id === saved)?.id || list[0]?.id || null
      setProgramIdState(pick)
      if (pick) await load(pick)
      else setLoading(false)
    })()
  }, [loadPrograms, load])

  const setProgramId = useCallback((id: string) => {
    setProgramIdState(id)
    try { localStorage.setItem(KEY, id) } catch { /* ignora */ }
    load(id)
  }, [load])

  const reload = useCallback(async () => {
    await loadPrograms()
    const id = wanted.current || programId
    if (id) await load(id)
  }, [programId, load, loadPrograms])

  const cfg = program?.config || null

  const rows: Row[] = useMemo(() => {
    if (!cfg) return []
    return insured.map((p) => ({ ...p, c: computeInsured(p, cfg.rates, p.entryDate || cfg.periodStart, cfg.rules) as Calc }))
  }, [insured, cfg])

  // ultimo giorno contato dal pro-rata: 31/12 o il 01/01 dopo, secondo le regole del programma
  const yearEnd = cfg ? yearEndOf(cfg) : ''

  /** Movimenti dell'anno: inclusioni dalle decorrenze, uscite dalle date di uscita. */
  const movements = useCallback((): Movement[] => {
    if (!cfg) return []
    const out: Movement[] = []
    const nameOf = (k: string) => cfg.companies.find((c) => c.key === k)?.name || k
    for (const r of rows) {
      if (r.entryDate && r.entryDate > cfg.periodStart) {
        const m = movementOf({ kind: 'INCLUSIONE', date: r.entryDate, capital: r.c.capital, rate: r.c.rate, sovrPct: r.sovrPct }, yearEnd, cfg.rules) as { days: number; gross: number | null }
        out.push({
          key: `${r.id}-in`, date: r.entryDate, kind: 'INCLUSIONE', row: r, days: m.days, gross: m.gross, capital: r.c.capital,
          title: r.entryKind === 'passaggio' ? `Passaggio a ${cfg.rules.capitalMode === 'categoria' && r.c.category ? r.c.category : nameOf(r.company)}` : 'Inclusione',
          source: r.source || r.note || '', transfer: r.entryKind === 'passaggio',
        })
      }
      if (r.exitDate) {
        // Il rimborso usa capitale e tasso pagati alla decorrenza, non ricalcolati all'uscita.
        const m = movementOf({ kind: 'ESCLUSIONE', date: r.exitDate, capital: r.c.capital, rate: r.c.rate, sovrPct: r.sovrPct, paid: { capital: r.c.capital, rate: r.c.rate as number } }, yearEnd, cfg.rules) as { days: number; gross: number | null }
        out.push({
          key: `${r.id}-out`, date: r.exitDate, kind: 'ESCLUSIONE', row: r, days: m.days, gross: m.gross, capital: r.c.capital,
          title: r.exitKind === 'passaggio' ? (cfg.rules.capitalMode === 'categoria' ? 'Passaggio ad altra categoria' : 'Passaggio ad altra polizza') : 'Esclusione',
          source: r.note || '', transfer: r.exitKind === 'passaggio',
        })
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'ESCLUSIONE' ? -1 : 1))
  }, [rows, cfg, yearEnd])

  // Clienti (Amundi, Agos…) come schede; dentro un cliente e un anno possono
  // esserci più polizze (Agos: LTC e Vita Quadri e Dirigenti).
  const clients = useMemo(() => [...new Set((programs || []).map((p) => clientOf(p)))], [programs])
  const client = program ? clientOf(program) : (clients[0] || '')
  const siblings = useMemo(() => (programs || []).filter((p) => program && clientOf(p) === client && p.year === program.year), [programs, program, client])
  const setClient = useCallback((c: string) => {
    const list = (programs || []).filter((p) => clientOf(p) === c)
    const pick = list.find((p) => program && p.year === program.year) || [...list].sort((a, b) => b.year - a.year)[0]
    if (pick) setProgramId(pick.id)
  }, [programs, program, setProgramId])

  return { programs, programId, setProgramId, program, cfg, insured, rows, movements, yearEnd, editor, loading, error, reload, clients, client, setClient, siblings }
}

export type Vita = ReturnType<typeof useVita>

/** Stato di una persona a una data. */
export function statusAt(p: VitaInsured, at: string): 'attivo' | 'uscito' | 'futuro' {
  if ((p.entryDate || '') > at) return 'futuro'
  if (p.exitDate && p.exitDate <= at) return 'uscito'
  return 'attivo'
}

// Migliaia sempre col punto: l'italiano di Intl non raggruppa le 4 cifre.
export const eur = (n: number | null | undefined) => {
  if (n == null) return '—'
  const [int, dec] = Math.abs(n).toFixed(2).split('.')
  return `${n < 0 ? '−' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`
}
export const rate4 = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(4).replace('.', ','))
export const today = () => new Date().toISOString().slice(0, 10)

/** Nome della polizza senza cliente e anno: «LTC», «Vita Quadri e Dirigenti». */
export function policyLabel(p: VitaProgram): string {
  const c = clientOf(p)
  const n = p.name.replace(new RegExp(`\\b${p.year}\\b`), '').replace(new RegExp(`^\\s*${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), '').replace(/\s+/g, ' ').replace(/^[\s\-–·]+|[\s\-–·]+$/g, '').trim()
  return n || p.name
}

/**
 * Intestazione delle pagine: una scheda per cliente (Amundi, Agos…), poi le
 * polizze del cliente in quell'anno (se sono più di una) e l'anno.
 */
export function VitaHeader({ vita, title, kicker, children }: { vita: Vita; title: string; kicker?: string; children?: React.ReactNode }) {
  const p = vita.program
  const ofClient = (vita.programs || []).filter((x) => clientOf(x) === vita.client)
  const years = [...new Set(ofClient.map((x) => x.year))].sort((a, b) => b - a)
  const pickYear = (y: number) => {
    const same = ofClient.filter((x) => x.year === y)
    const want = p ? policyLabel(p) : ''
    const hit = same.find((x) => policyLabel(x) === want) || same[0]
    if (hit) vita.setProgramId(hit.id)
  }
  return (
    <div className="rsm-head-wrap">
      {vita.clients.length > 0 && (
        <nav className="rsm-companies" aria-label="Clienti">
          {vita.clients.map((c) => (
            <button key={c} type="button" className={c === vita.client ? 'on' : ''} aria-current={c === vita.client ? 'true' : undefined}
              onClick={() => c !== vita.client && vita.setClient(c)}>{c}</button>
          ))}
        </nav>
      )}
      <div className="rsm-head">
        <div>
          <div className="rsm-kicker">
            {p && <span>{vita.client}</span>}
            {p && vita.siblings.length <= 1 && policyLabel(p) !== p.name && <span>&nbsp;· {policyLabel(p)}</span>}
            {years.length > 1 ? (
              <select aria-label="Anno" value={p?.year || ''} onChange={(e) => pickYear(Number(e.target.value))}
                style={{ height: 28, padding: '0 8px', fontSize: 12, width: 'auto', marginLeft: 8 }}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            ) : p ? <span>&nbsp;· {p.year}</span> : null}
            {kicker ? <span>&nbsp;· {kicker}</span> : null}
            {p && !vita.editor && <span className="rsm-pill off" style={{ marginLeft: 8 }}>sola consultazione</span>}
          </div>
          {vita.siblings.length > 1 && (
            <nav className="rsm-programs rsm-tabs" aria-label="Polizze">
              {vita.siblings.map((x) => (
                <button key={x.id} type="button" className={`rsm-tab${x.id === vita.programId ? ' on' : ''}`} aria-current={x.id === vita.programId ? 'true' : undefined}
                  onClick={() => x.id !== vita.programId && vita.setProgramId(x.id)}>{policyLabel(x)}</button>
              ))}
            </nav>
          )}
          <h1 className="page-title">{title}</h1>
        </div>
        <div className="rsm-row">{children}</div>
      </div>
    </div>
  )
}

/** Nessun programma ancora: si crea dalle Impostazioni o si importa il file. */
export function VitaGate({ vita, children }: { vita: Vita; children: React.ReactNode }) {
  if (vita.loading && !vita.program) return <div className="rsm-empty"><span className="spinner" /></div>
  if (vita.error) return <div className="alert alert-error">{vita.error}</div>
  if (!vita.program) {
    return (
      <div className="rsm-box"><div className="rsm-empty">
        <p>Nessun programma della polizza vita.</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link className="btn btn-primary" href="/vita/settings">Crea il programma</Link>
        </div>
      </div></div>
    )
  }
  return <>{children}</>
}

/** Niente assicurati: si dice che cosa manca, non si mostra una tabella vuota. */
export function VitaEmpty({ what }: { what: string }) {
  return (
    <div className="rsm-box"><div className="rsm-empty">
      <p>Nessun assicurato nel programma: {what}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 8 }}>
        <Link className="btn btn-primary" href="/vita/import">Importa lo stato di rischio</Link>
      </div>
    </div></div>
  )
}

// stesse chiamate di Anagrafiche RSM: errori con codice e motivi per il pannello di avviso
import { api } from '@/components/rsm/useRsm'
export { api }

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export async function downloadExport(programId: string, body: Record<string, unknown>) {
  const r = await fetch(`/api/vita/programs/${programId}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Errore export')
  const blob = await r.blob()
  const cd = r.headers.get('Content-Disposition') || ''
  saveBlob(blob, /filename="([^"]+)"/.exec(cd)?.[1] || 'polizza-vita.xlsx')
}

/* ─── Messaggio dopo un'operazione, con «Annulla» ───────────────────────── */

export interface Flash { ok: boolean; text: string; opId?: string }

export function useFlash(vita: Vita) {
  const [flash, setFlash] = useState<Flash | null>(null)
  const [busy, setBusy] = useState(false)
  async function undo() {
    if (!flash?.opId || !vita.programId) return
    setBusy(true)
    try {
      const j = await api(`/api/vita/programs/${vita.programId}/ops`, 'POST', { opId: flash.opId })
      await vita.reload()
      setFlash({ ok: true, text: `Annullato: ${j.label}` })
    } catch (e) { setFlash({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }
  const node = flash ? (
    <div className={`alert ${flash.ok ? 'alert-success' : 'alert-error'}`} role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <span>{flash.text}</span>
      <span style={{ display: 'flex', gap: 6 }}>
        {flash.opId && vita.editor && <button className="rsm-mini" disabled={busy} onClick={undo}>Annulla</button>}
        <button className="rsm-mini" aria-label="Chiudi" onClick={() => setFlash(null)}>×</button>
      </span>
    </div>
  ) : null
  return { flash, setFlash, node }
}

export { fmtDate }
