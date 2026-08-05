'use client'

import { useEffect, useState } from 'react'

// Pannello «Profili salvati» del Comparatore, condiviso dalle pagine ma NON
// condiviso nei contenuti: ogni pagina passa la propria chiave di impostazioni
// e il proprio snapshot. La Comparazione salva chiavi di abbinamento + fuzzy,
// il Confronto righe le condizioni di abbinamento/filtro. Caricare un profilo
// di una pagina non tocca mai i criteri dell'altra.
export default function CompareProfiles<T>({
  settingsKey,
  fileName,
  snapshot,
  onLoad,
  parseSingle,
  hint,
}: {
  settingsKey: string
  fileName: string
  // Criteri correnti da salvare nel profilo (null = niente da salvare).
  snapshot: () => T | null
  onLoad: (profile: T, name: string) => void
  // Interop: JSON che contiene UNA sola configurazione invece di un dizionario
  // di profili (es. export del desktop). Restituisce il profilo o null.
  parseSingle?: (parsed: unknown) => T | null
  hint?: string
}) {
  const [profiles, setProfiles] = useState<Record<string, T>>({})
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  useEffect(() => {
    let alive = true
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d: Record<string, unknown>) => {
        if (!alive) return
        const p = d[settingsKey]
        if (p && typeof p === 'object') setProfiles(p as Record<string, T>)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [settingsKey])

  async function persist(next: Record<string, T>) {
    setProfiles(next)
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [settingsKey]: next }),
    })
  }

  async function saveAs() {
    const n = name.trim()
    if (!n) return
    const snap = snapshot()
    if (!snap) return
    if (profiles[n] && !window.confirm(`Sovrascrivere il profilo «${n}»?`)) return
    await persist({ ...profiles, [n]: snap })
    setName('')
    flash(`Profilo «${n}» salvato.`)
  }

  function load(n: string) {
    const p = profiles[n]
    if (!p) return
    onLoad(p, n)
    flash(`Profilo «${n}» caricato.`)
  }

  async function remove(n: string) {
    if (!window.confirm(`Eliminare il profilo «${n}»?`)) return
    const next = { ...profiles }
    delete next[n]
    await persist(next)
    flash(`Profilo «${n}» eliminato.`)
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(profiles, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
  }

  async function importJson(file: File | undefined) {
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!parsed || typeof parsed !== 'object') return
      const single = parseSingle?.(parsed)
      if (single) {
        const n = file.name.replace(/\.json$/i, '') || 'importato'
        await persist({ ...profiles, [n]: single })
        flash(`Profilo «${n}» importato.`)
        return
      }
      const incoming = parsed as Record<string, T>
      await persist({ ...profiles, ...incoming })
      flash(`${Object.keys(incoming).length} profili importati.`)
    } catch {
      flash('File non valido: nessun profilo importato.')
    }
  }

  const names = Object.keys(profiles)

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: hint ? 4 : 14 }}>Profili salvati</h2>
      {hint && <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 0, marginBottom: 14 }}>{hint}</p>}
      <div style={{ display: 'flex', gap: 8, marginBottom: names.length ? 12 : 0, flexWrap: 'wrap' }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') saveAs() }}
          placeholder="Nome profilo"
          style={{ flex: 1, minWidth: 180 }}
        />
        <button className="btn btn-secondary" onClick={saveAs} disabled={!name.trim()}>Salva come profilo</button>
        <button className="btn btn-secondary" onClick={exportJson} disabled={!names.length}>Esporta JSON</button>
        <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
          Importa JSON
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => { importJson(e.target.files?.[0]); e.target.value = '' }} />
        </label>
      </div>
      {names.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {names.map((n) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontSize: 14 }}>{n}</span>
              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => load(n)}>Carica</button>
              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => remove(n)}>Elimina</button>
            </div>
          ))}
        </div>
      )}
      {msg && <div className="alert alert-success" style={{ marginTop: 12 }}>{msg}</div>}
    </div>
  )
}
