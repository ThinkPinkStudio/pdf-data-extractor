'use client'

// Programma RSM corrente (ricordato nel browser) con le sue righe, condiviso
// da tutte le pagine della sezione. Gli importi si calcolano qui col modulo
// delle regole, così cambiare la data «situazione al» non chiede nulla al server.
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { computeMember } from '@/lib/rsm/rules.js'
import type { RsmCalc, RsmMember, RsmProgram } from '@/lib/rsm/types'

const KEY = 'rsmProgram'

export type Row = RsmMember & { c: RsmCalc }

export function useRsm() {
  const [programs, setPrograms] = useState<(RsmProgram & { editor: boolean })[] | null>(null)
  const [programId, setProgramIdState] = useState<string | null>(null)
  const [program, setProgram] = useState<RsmProgram | null>(null)
  const [members, setMembers] = useState<RsmMember[]>([])
  const [editor, setEditor] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadPrograms = useCallback(async () => {
    const r = await fetch('/api/rsm/programs')
    const j = await r.json()
    if (!r.ok) { setError(j.error || 'Errore'); setPrograms([]); return [] }
    setPrograms(j.programs)
    return j.programs as RsmProgram[]
  }, [])

  const load = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const r = await fetch(`/api/rsm/programs/${id}`)
      const j = await r.json()
      if (!r.ok) { setError(j.error || 'Errore'); setProgram(null); setMembers([]); return }
      setError(null)
      setProgram(j.program)
      setMembers(j.members)
      setEditor(!!j.editor)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    (async () => {
      const list = await loadPrograms()
      let saved: string | null = null
      try { saved = localStorage.getItem(KEY) } catch { /* senza storage: primo programma */ }
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
    if (programId) await load(programId)
  }, [programId, load, loadPrograms])

  const rows: Row[] = useMemo(
    () => (program ? members.map((m) => ({ ...m, c: computeMember(program.config, m) as RsmCalc })) : []),
    [program, members],
  )

  return { programs, programId, setProgramId, program, members, rows, editor, loading, error, reload }
}

export type Rsm = ReturnType<typeof useRsm>

// Migliaia sempre col punto: l'italiano di Intl non raggruppa le 4 cifre («9146,00»).
export const eur = (n: number) => {
  const [int, dec] = Math.abs(n).toFixed(2).split('.')
  return `${n < 0 ? '−' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`
}
export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Intestazione delle pagine: titolo, scelta del programma, azioni. */
export function RsmHeader({ rsm, title, children }: { rsm: Rsm; title: string; children?: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="rsm-head">
      <div>
        <div className="rsm-kicker">
          {rsm.programs && rsm.programs.length > 1 ? (
            <select aria-label={t('rsm.program')} value={rsm.programId || ''} onChange={(e) => rsm.setProgramId(e.target.value)}
              style={{ height: 30, padding: '0 8px', fontSize: 12, width: 'auto' }}>
              {rsm.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : (rsm.program?.name || '')}
          {rsm.program && !rsm.editor && <span className="rsm-pill off" style={{ marginLeft: 8 }}>{t('rsm.readOnly')}</span>}
        </div>
        <h1 className="page-title">{title}</h1>
      </div>
      <div className="rsm-row">{children}</div>
    </div>
  )
}

/** Stato vuoto: nessun programma ancora, si crea dalle Impostazioni. */
export function RsmGate({ rsm, children }: { rsm: Rsm; children: React.ReactNode }) {
  const { t } = useI18n()
  if (rsm.loading && !rsm.program) return <div className="rsm-empty"><span className="spinner" /></div>
  if (rsm.error) return <div className="alert alert-error">{rsm.error}</div>
  if (!rsm.program) {
    return (
      <div className="rsm-box"><div className="rsm-empty">
        <p>{t('rsm.noProgram')}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link className="btn btn-primary" href="/rsm/import">{t('rsm.noProgramImport')}</Link>
          <Link className="btn btn-secondary" href="/rsm/settings">{t('rsm.goSettings')}</Link>
        </div>
      </div></div>
    )
  }
  return <>{children}</>
}

export async function downloadExport(programId: string, body: Record<string, unknown>) {
  const r = await fetch(`/api/rsm/programs/${programId}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Errore export')
  const blob = await r.blob()
  const cd = r.headers.get('Content-Disposition') || ''
  const name = /filename="([^"]+)"/.exec(cd)?.[1] || 'rsm.xlsx'
  saveBlob(blob, name)
}

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

export async function api(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Errore')
  return j
}

/* ─── Messaggio dopo un'operazione, con «Annulla» ───────────────────────── */

export interface Flash { ok: boolean; text: string; opId?: string }

/**
 * Messaggio di esito. Se l'operazione è registrata (opId), offre «Annulla»:
 * il server la annulla solo se è ancora l'ultima del programma.
 */
export function useFlash(rsm: Rsm) {
  const { t } = useI18n()
  const [flash, setFlash] = useState<Flash | null>(null)
  const [busy, setBusy] = useState(false)
  async function undo() {
    if (!flash?.opId || !rsm.programId) return
    setBusy(true)
    try {
      const j = await api(`/api/rsm/programs/${rsm.programId}/ops`, 'POST', { opId: flash.opId })
      await rsm.reload()
      setFlash({ ok: true, text: t('rsm.op.undone', { l: j.label }) })
    } catch (e) { setFlash({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }
  const node = flash ? (
    <div className={`alert ${flash.ok ? 'alert-success' : 'alert-error'}`} role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <span>{flash.text}</span>
      <span style={{ display: 'flex', gap: 6 }}>
        {flash.opId && rsm.editor && <button className="rsm-mini" disabled={busy} onClick={undo}>{t('rsm.op.undo')}</button>}
        <button className="rsm-mini" aria-label={t('rsm.close')} onClick={() => setFlash(null)}>×</button>
      </span>
    </div>
  ) : null
  return { flash, setFlash, node }
}
