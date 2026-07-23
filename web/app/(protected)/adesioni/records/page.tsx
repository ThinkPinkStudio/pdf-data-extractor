'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import AdesioniRecordForm, { type AdesioniRecord } from '@/components/AdesioniRecordForm'
import { defaultAdesioniConfig, type AdesioniConfig } from '@/lib/adesioni/config'
import { validateRecord } from '@/lib/adesioni/recordMapper.js'

interface Row {
  id: string
  saved_by: string
  status: 'pending' | 'archived'
  cognome: string
  nome: string
  codice_fiscale: string
  targa: string
  identificativo: string
  data_fine: string
  data: AdesioniRecord
}
type StatusFilter = 'all' | 'pending' | 'archived'

export default function AdesioniRecordsPage() {
  const [config, setConfig] = useState<AdesioniConfig>(defaultAdesioniConfig())
  const [rows, setRows] = useState<Row[]>([])
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Row | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const appendRef = useRef<HTMLInputElement>(null)

  const load = useCallback((query = '', status: StatusFilter = 'all') => {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (status !== 'all') params.set('status', status)
    fetch('/api/adesioni/records' + (params.toString() ? `?${params}` : ''))
      .then((r) => { if (!r.ok) throw new Error(); return r.json() })
      .then((d) => setRows(d.records || []))
      .catch(() => setMsg({ ok: false, text: 'Impossibile caricare i record.' }))
  }, [])

  useEffect(() => {
    fetch('/api/adesioni/config').then((r) => r.json()).then((c) => { if (c?.fields) setConfig(c) }).catch(() => {})
  }, [])
  useEffect(() => { load(q, statusFilter) }, [load, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const ids = () => Array.from(sel)

  async function doExport(reexport: boolean) {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/adesioni/records/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ids(), reexport }) })
      if (!res.ok) throw new Error((await res.json()).error || 'Errore export')
      download(await res.blob(), 'tracciato.xlsx')
      setMsg({ ok: true, text: reexport ? 'Ri-esportazione completata (stato invariato).' : 'Esportazione completata: record archiviati.' })
      setSel(new Set()); load(q, statusFilter)
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }
  async function exportAppend(file: File | undefined) {
    if (!file) return
    setBusy(true)
    const form = new FormData()
    form.append('file', file); form.append('ids', ids().join(','))
    try {
      const res = await fetch('/api/adesioni/records/export', { method: 'POST', body: form })
      if (res.ok) { download(await res.blob(), 'tracciato_aggiornato.xlsx'); setMsg({ ok: true, text: 'Append completato: record archiviati.' }); setSel(new Set()); load(q, statusFilter) }
    } finally { setBusy(false) }
  }
  async function renew() {
    if (!sel.size) return
    setBusy(true)
    const res = await fetch('/api/adesioni/records/renew', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ids(), years: 1 }) })
    const d = await res.json(); setBusy(false)
    if (res.ok) { setMsg({ ok: true, text: `${d.records.length} record rinnovati (+1 anno).` }); setSel(new Set()); load(q, statusFilter) }
    else setMsg({ ok: false, text: d.error })
  }
  async function ftp(target: 'staging' | 'prod') {
    if (!sel.size) return
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/adesioni/ftp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, ids: ids() }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Errore FTP')
      setMsg({ ok: true, text: `Pubblicato su ${target}: ${d.remotePath || 'ok'} (${d.count} record).` })
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }
  async function del() {
    if (!sel.size || !confirm(`Eliminare ${sel.size} record?`)) return
    for (const id of ids()) await fetch(`/api/adesioni/records/${id}`, { method: 'DELETE' })
    setSel(new Set()); load(q, statusFilter); setMsg({ ok: true, text: 'Record eliminati.' })
  }

  async function saveEdit() {
    if (!editing) return
    const { errors: errs, valid } = validateRecord(editing.data, config.fields) as { errors: Record<string, string>; valid: boolean }
    setErrors(errs)
    if (!valid) { setMsg({ ok: false, text: 'Correggi i campi evidenziati.' }); return }
    const res = await fetch(`/api/adesioni/records/${editing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ record: editing.data }) })
    if (res.ok) { setMsg({ ok: true, text: 'Record aggiornato.' }); setEditing(null); load(q, statusFilter) }
    else setMsg({ ok: false, text: (await res.json()).error || 'Errore salvataggio' })
  }

  return (
    <>
      <h1 className="page-title">Record</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(q, statusFilter)} placeholder="Cerca per nome, CF, targa, identificativo…" style={{ flex: 1, minWidth: 240 }} />
        <button className="btn btn-secondary" onClick={() => load(q, statusFilter)}>Cerca</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {([['all', 'Tutti'], ['pending', 'Da esportare'], ['archived', 'Archiviati']] as [StatusFilter, string][]).map(([f, label]) => (
          <button key={f} className={`btn ${statusFilter === f ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: 13, padding: '6px 12px' }} onClick={() => setStatusFilter(f)}>{label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-secondary" onClick={() => doExport(false)} disabled={busy}>Esporta &amp; archivia {sel.size ? `(${sel.size})` : '(tutti)'}</button>
        <button className="btn btn-secondary" onClick={() => doExport(true)} disabled={busy}>Ri-esporta (no archivio)</button>
        <button className="btn btn-secondary" onClick={() => appendRef.current?.click()} disabled={busy}>Append su file…</button>
        <input ref={appendRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={(e) => exportAppend(e.target.files?.[0])} />
        <button className="btn btn-secondary" onClick={renew} disabled={!sel.size || busy}>Rinnova +1 anno</button>
        <button className="btn btn-secondary" onClick={() => ftp('staging')} disabled={busy || !sel.size} title={!sel.size ? 'Seleziona almeno un record' : ''}>Pubblica FTP staging{sel.size ? ` (${sel.size})` : ''}</button>
        <button className="btn btn-secondary" onClick={() => ftp('prod')} disabled={busy || !sel.size} title={!sel.size ? 'Seleziona almeno un record' : ''}>Pubblica FTP prod{sel.size ? ` (${sel.size})` : ''}</button>
        <button className="btn btn-secondary" onClick={del} disabled={!sel.size}>Elimina</button>
      </div>

      {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      <div className="card" style={{ overflowX: 'auto', padding: 0, marginBottom: 20 }}>
        {rows.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--c-text-muted)' }}>Nessun record.</div>
        ) : (
          <table>
            <thead>
              <tr><th></th><th>Stato</th><th>Cognome</th><th>Nome</th><th>CF / P.IVA</th><th>Targa</th><th>Identificativo</th><th>Fine copertura</th><th>Salvato da</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Seleziona ${r.cognome} ${r.nome}`} /></td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{r.cognome}</td><td>{r.nome}</td><td>{r.codice_fiscale}</td><td>{r.targa}</td><td>{r.identificativo}</td><td>{r.data_fine}</td>
                  <td style={{ fontSize: 12, color: 'var(--c-text-secondary)' }}>{r.saved_by || '—'}</td>
                  <td><button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => { setEditing(r); setErrors({}) }}>Modifica</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Modifica record</h2>
            <button className="btn btn-secondary" onClick={() => setEditing(null)}>Chiudi</button>
          </div>
          <AdesioniRecordForm config={config} record={editing.data} errors={errors} onChange={(rec) => setEditing({ ...editing, data: rec })} />
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={saveEdit}>Salva modifiche</button>
        </div>
      )}
    </>
  )
}

function StatusBadge({ status }: { status: 'pending' | 'archived' }) {
  const archived = status === 'archived'
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
      color: archived ? 'var(--c-text-muted)' : 'var(--c-accent)',
      background: archived ? 'var(--c-bg-card-alt)' : 'var(--c-accent-faint)',
      whiteSpace: 'nowrap',
    }}>{archived ? 'Archiviato' : 'Da esportare'}</span>
  )
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
