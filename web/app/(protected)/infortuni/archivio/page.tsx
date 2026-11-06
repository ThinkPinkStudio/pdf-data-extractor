'use client'

import { useCallback, useEffect, useState } from 'react'
import { useConfirmPanel } from '@/components/ConfirmPanel'
import InfortuniForm, { Warnings, downloadBlob, fileNameOf, type InfConfig, type InfRecord } from '@/components/infortuni/InfortuniForm'
import { defaultConfig, validateAdesione, normalizeAdesione, optionOf, fmtDate, splitAddresses } from '@/lib/infortuni/rules.js'
import { useT } from '@/lib/i18n/I18nProvider'

interface Row {
  id: string
  numero: string
  status: 'pending' | 'sent'
  saved_by: string
  cognome: string
  nome: string
  codice_fiscale: string
  targa: string
  opzione: string
  data_adesione: string
  data_scadenza: string
  sent_at: number | null
  sent_to: string | null
  data: InfRecord
}
type Filter = 'all' | 'pending' | 'sent'

export default function InfortuniArchivePage() {
  const t = useT()
  const [config, setConfig] = useState<InfConfig>(defaultConfig() as InfConfig)
  const [rows, setRows] = useState<Row[]>([])
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Row | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const { ask, panel } = useConfirmPanel()

  const load = useCallback((query: string, f: Filter) => {
    const p = new URLSearchParams()
    if (query.trim()) p.set('q', query.trim())
    if (f !== 'all') p.set('status', f)
    fetch(`/api/infortuni/records${p.toString() ? `?${p}` : ''}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json() })
      .then((d) => setRows(d.records || []))
      .catch(() => setMsg({ ok: false, text: t('inf.arc.loadError') }))
    fetch('/api/infortuni/records?status=pending').then((r) => r.json()).then((d) => setPendingCount((d.records || []).length)).catch(() => {})
  }, [t])

  useEffect(() => {
    fetch('/api/infortuni/config').then((r) => r.json()).then((d) => { if (d.config) setConfig(d.config) }).catch(() => {})
  }, [])
  useEffect(() => { load(q, filter) }, [load, filter]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allShown = rows.length > 0 && rows.every((r) => sel.has(r.id))
  const toggleAll = () => setSel(allShown ? new Set() : new Set(rows.map((r) => r.id)))
  const ids = Array.from(sel)
  const scope = sel.size ? t('inf.arc.bdxScopeSel', { n: sel.size }) : t('inf.arc.bdxScopePending', { n: pendingCount })
  const reload = () => { setSel(new Set()); load(q, filter) }

  async function run(fn: () => Promise<void>) {
    setBusy(true); setMsg(null)
    try { await fn() } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  const docs = () => run(async () => {
    const res = await fetch('/api/infortuni/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'PDF')
    downloadBlob(await res.blob(), fileNameOf(res, 'adesioni.zip'))
  })

  const bdxDownload = () => run(async () => {
    const res = await fetch('/api/infortuni/bdx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, send: false }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'BDX')
    downloadBlob(await res.blob(), fileNameOf(res, 'BDX Inclusioni CSA.xlsx'))
  })

  async function bdxSend() {
    const to = splitAddresses(config.mailTo)
    if (!to.length) { setMsg({ ok: false, text: t('inf.arc.noRecipients') }); return }
    const n = sel.size || pendingCount
    const already = rows.filter((r) => sel.has(r.id) && r.status === 'sent').length
    const text = t('inf.arc.confirmSend', { n, to: to.join(', ') }) + (already ? `\n\n${t('inf.arc.confirmResend', { n: already })}` : '')
    if (!(await ask(text))) return
    await run(async () => {
      const res = await fetch('/api/infortuni/bdx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, send: true }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'BDX')
      setMsg({ ok: true, text: t('inf.arc.sentOk', { n: d.count, to: d.to }) })
      reload()
    })
  }

  async function del(r: Row) {
    if (!(await ask(t('inf.arc.confirmDelete', { n: r.numero, who: `${r.cognome} ${r.nome}` }), { danger: true }))) return
    await run(async () => {
      const res = await fetch(`/api/infortuni/records/${r.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Errore')
      if (editing?.id === r.id) setEditing(null)
      setMsg({ ok: true, text: t('inf.arc.deleted', { n: r.numero }) })
      reload()
    })
  }

  async function saveEdit() {
    if (!editing) return
    const clean = normalizeAdesione(editing.data, config)
    const v = validateAdesione(clean, config) as { errors: Record<string, string>; valid: boolean }
    setErrors(v.errors)
    if (!v.valid) { setMsg({ ok: false, text: t('inf.fix') }); return }
    await run(async () => {
      const res = await fetch(`/api/infortuni/records/${editing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ record: clean }) })
      const d = await res.json()
      if (!res.ok) { if (d.errors) setErrors(d.errors); throw new Error(d.error || t('inf.fix')) }
      setMsg({ ok: true, text: t('inf.arc.updated', { n: editing.numero }) })
      setEditing(null)
      load(q, filter)
    })
  }

  const editWarnings = editing ? (validateAdesione(normalizeAdesione(editing.data, config), config) as { warnings: string[] }).warnings : []

  return (
    <>
      {panel}
      <h1 className="page-title">{t('nav.infArchive')}</h1>
      <p className="view-subtitle">{t('inf.arc.subtitle')}</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(q, filter)} placeholder={t('inf.arc.search')} style={{ flex: 1, minWidth: 240 }} />
        {([['all', t('inf.arc.all')], ['pending', t('inf.arc.pending')], ['sent', t('inf.arc.sent')]] as [Filter, string][]).map(([f, label]) => (
          <button key={f} className={`btn ${filter === f ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: 13, padding: '6px 12px' }} onClick={() => { setFilter(f); setSel(new Set()) }}>{label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={bdxSend} disabled={busy || (!sel.size && !pendingCount)}>{t('inf.arc.bdxSend')} {scope}</button>
        <button className="btn btn-secondary" onClick={bdxDownload} disabled={busy || (!sel.size && !pendingCount)}>{t('inf.arc.bdxDownload')} {scope}</button>
        <button className="btn btn-secondary" onClick={docs} disabled={busy || !sel.size}>{t('inf.arc.docs')}{sel.size ? ` (${sel.size})` : ''}</button>
        {busy && <span className="spinner" />}
        {sel.size > 0 && <span style={{ fontSize: 12, color: 'var(--c-text-muted)', marginLeft: 'auto' }}>{t('inf.arc.selected', { n: sel.size })}</span>}
      </div>

      {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 16, whiteSpace: 'pre-line' }}>{msg.text}</div>}

      <div className="card" style={{ overflowX: 'auto', padding: 0, marginBottom: 20 }}>
        {rows.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--c-text-muted)' }}>{t('inf.arc.empty')}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" checked={allShown} onChange={toggleAll} aria-label={t('inf.arc.all')} /></th>
                <th>{t('inf.arc.colNumero')}</th><th>{t('inf.arc.colCliente')}</th><th>{t('inf.arc.colCf')}</th><th>{t('inf.arc.colTarga')}</th>
                <th>{t('inf.arc.colOpzione')}</th><th>{t('inf.arc.colAdesione')}</th><th>{t('inf.arc.colScadenza')}</th><th>{t('inf.arc.colStato')}</th><th>{t('inf.arc.colBy')}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={editing?.id === r.id ? { background: 'var(--c-accent-faint)' } : undefined}>
                  <td><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`${r.numero} ${r.cognome} ${r.nome}`} /></td>
                  <td style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{r.numero}</td>
                  <td>{r.cognome} {r.nome}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.codice_fiscale}</td>
                  <td>{r.targa}</td>
                  <td>{(optionOf(config, r.opzione) as { name: string } | null)?.name || r.opzione}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.data_adesione)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.data_scadenza)}</td>
                  <td><Status row={r} t={t} /></td>
                  <td style={{ fontSize: 12, color: 'var(--c-text-secondary)' }}>{r.saved_by || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => { setEditing({ ...r, data: { ...r.data, questionario: { ...(r.data.questionario || {}) } } }); setErrors({}) }}>{t('inf.arc.edit')}</button>
                    <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px', marginLeft: 6 }} onClick={() => del(r)} disabled={busy}>{t('inf.arc.delete')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>{t('inf.arc.editTitle', { n: editing.numero })}</h2>
            <button className="btn btn-secondary" onClick={() => setEditing(null)}>{t('inf.arc.close')}</button>
          </div>
          <InfortuniForm config={config} record={editing.data} errors={errors} onChange={(d) => setEditing({ ...editing, data: d })} />
          <Warnings items={editWarnings} title={t('inf.warnTitle')} />
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={saveEdit} disabled={busy}>{t('inf.arc.saveEdit')}</button>
        </div>
      )}
    </>
  )
}

function Status({ row, t }: { row: Row; t: (k: string, v?: Record<string, string | number>) => string }) {
  const sent = row.status === 'sent'
  const d = sent && row.sent_at ? new Date(row.sent_at * 1000).toLocaleDateString('it-IT') : ''
  return (
    <span title={sent ? row.sent_to || '' : ''} style={{
      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap',
      color: sent ? 'var(--c-text-muted)' : 'var(--c-accent)',
      background: sent ? 'var(--c-bg-card-alt)' : 'var(--c-accent-faint)',
    }}>{sent ? t('inf.arc.statusSent', { d }) : t('inf.arc.statusPending')}</span>
  )
}
