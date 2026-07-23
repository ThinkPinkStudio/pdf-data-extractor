'use client'

import { useEffect, useState } from 'react'

interface Row { id: string; cognome: string; nome: string; targa: string; data_fine: string }
interface Groups { past: Row[]; current: Row[]; next: Row[] }

const SECTIONS: { key: keyof Groups; label: string; color: string }[] = [
  { key: 'past', label: 'Mese scorso (scadute)', color: 'var(--c-error)' },
  { key: 'current', label: 'Mese corrente', color: 'var(--c-warning)' },
  { key: 'next', label: 'Mese prossimo', color: 'var(--c-info)' },
]

export default function AdesioniScadenzePage() {
  const [groups, setGroups] = useState<Groups>({ past: [], current: [], next: [] })

  useEffect(() => {
    fetch('/api/adesioni/scadenze').then((r) => r.json()).then((d) => setGroups({ past: d.past || [], current: d.current || [], next: d.next || [] })).catch(() => {})
  }, [])

  return (
    <>
      <h1 className="page-title">Scadenze</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {SECTIONS.map((s) => (
          <div key={s.key} className="card">
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: s.color }}>{s.label} ({groups[s.key].length})</h2>
            {groups[s.key].length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--c-text-muted)', margin: 0 }}>Nessuna scadenza.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {groups[s.key].map((r) => (
                  <div key={r.id} style={{ fontSize: 13, borderBottom: '1px solid var(--c-separator)', paddingBottom: 6 }}>
                    <strong>{r.cognome} {r.nome}</strong>
                    <div style={{ color: 'var(--c-text-secondary)' }}>{r.targa} · scade {r.data_fine}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
