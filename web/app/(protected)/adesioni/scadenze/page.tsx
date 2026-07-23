'use client'

import { useCallback, useEffect, useState } from 'react'

interface Row { id: string; cognome: string; nome: string; targa: string; data_fine: string }
interface Groups { past: Row[]; current: Row[]; next: Row[] }

const SECTIONS: { key: keyof Groups; label: string; color: string }[] = [
  { key: 'past', label: 'Mese scorso (scadute)', color: 'var(--c-error)' },
  { key: 'current', label: 'Mese corrente', color: 'var(--c-warning)' },
  { key: 'next', label: 'Mese prossimo', color: 'var(--c-info)' },
]

export default function AdesioniScadenzePage() {
  const [groups, setGroups] = useState<Groups>({ past: [], current: [], next: [] })
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetch('/api/adesioni/scadenze').then((r) => { if (!r.ok) throw new Error(); return r.json() })
      .then((d) => setGroups({ past: d.past || [], current: d.current || [], next: d.next || [] }))
      .catch(() => setMsg({ ok: false, text: 'Impossibile caricare le scadenze.' }))
  }, [])
  useEffect(() => { load() }, [load])

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function renew() {
    if (!sel.size) return
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/adesioni/records/renew', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: Array.from(sel), years: 1 }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Errore rinnovo')
      setMsg({ ok: true, text: `${d.records.length} record rinnovati (+1 anno).` })
      setSel(new Set()); load()
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Scadenze</h1>
        <button className="btn btn-primary" onClick={renew} disabled={!sel.size || busy}>Rinnova selezionati +1 anno{sel.size ? ` (${sel.size})` : ''}</button>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {SECTIONS.map((sec) => (
          <div key={sec.key} className="card">
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: sec.color, flexShrink: 0 }} />
              {sec.label} ({groups[sec.key].length})
            </h2>
            {groups[sec.key].length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--c-text-muted)', margin: 0 }}>Nessuna scadenza.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {groups[sec.key].map((r) => (
                  <label key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, borderBottom: '1px solid var(--c-separator)', paddingBottom: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} style={{ marginTop: 2 }} />
                    <span>
                      <strong>{r.cognome} {r.nome}</strong>
                      <span style={{ display: 'block', color: 'var(--c-text-secondary)' }}>{r.targa} · scade {r.data_fine}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
