'use client'

import { useEffect, useState } from 'react'
import { useCompare } from '@/lib/compare/CompareProvider'
import { TRANSFORM_OPTIONS, defaultMatchKeys, type CompareConfig, type MatchKey, type Transform, type Workbook } from '@/lib/compare/engine'

export default function CompareSettingsPage() {
  const { config, saveConfig, fileA, fileB } = useCompare()
  const [keys, setKeys] = useState<MatchKey[]>(config.matchKeys)
  const [fuzzy, setFuzzy] = useState({ min: config.fuzzyMinOverlap, broad: config.fuzzyBroadEnabled, broadMin: config.fuzzyMinOverlapBroad })
  const [saved, setSaved] = useState(false)
  const [profiles, setProfiles] = useState<Record<string, CompareConfig>>({})
  const [profileName, setProfileName] = useState('')

  useEffect(() => { setKeys(config.matchKeys); setFuzzy({ min: config.fuzzyMinOverlap, broad: config.fuzzyBroadEnabled, broadMin: config.fuzzyMinOverlapBroad }) }, [config])
  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((d) => { if (d.compareProfiles) setProfiles(d.compareProfiles) }).catch(() => {})
  }, [])

  function updKey(i: number, patch: Partial<MatchKey>) {
    setKeys((ks) => ks.map((k, idx) => (idx === i ? { ...k, ...patch } : k)))
  }
  function move(i: number, dir: -1 | 1) {
    setKeys((ks) => {
      const j = i + dir
      if (j < 0 || j >= ks.length) return ks
      const next = [...ks]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function currentConfig(): CompareConfig {
    return {
      ...config,
      matchKeys: keys,
      fuzzyMinOverlap: fuzzy.min,
      fuzzyBroadEnabled: fuzzy.broad,
      fuzzyMinOverlapBroad: fuzzy.broadMin,
    }
  }

  async function save() {
    await saveConfig(currentConfig())
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  async function saveProfiles(next: Record<string, CompareConfig>) {
    setProfiles(next)
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ compareProfiles: next }) })
  }
  async function saveAsProfile() {
    const name = profileName.trim()
    if (!name) return
    await saveProfiles({ ...profiles, [name]: currentConfig() })
    setProfileName('')
  }
  function loadProfile(name: string) {
    const p = profiles[name]
    if (p) { setKeys(p.matchKeys || defaultMatchKeys()); setFuzzy({ min: p.fuzzyMinOverlap, broad: p.fuzzyBroadEnabled, broadMin: p.fuzzyMinOverlapBroad }); saveConfig(p) }
  }
  async function deleteProfile(name: string) {
    const next = { ...profiles }
    delete next[name]
    await saveProfiles(next)
  }
  function exportProfiles() {
    const blob = new Blob([JSON.stringify(profiles, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'profili_compare.json'; a.click()
    URL.revokeObjectURL(url)
  }
  async function importProfiles(file: File | undefined) {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      // Interop col desktop: se il JSON è una SINGOLA config (ha matchKeys) lo si
      // importa come profilo nominato dal file. Altrimenti è un dizionario di profili.
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as CompareConfig).matchKeys)) {
        const name = file.name.replace(/\.json$/i, '') || 'importato'
        await saveProfiles({ ...profiles, [name]: parsed as CompareConfig })
      } else {
        await saveProfiles({ ...profiles, ...(parsed as Record<string, CompareConfig>) })
      }
    } catch { /* file non valido: ignora */ }
  }

  return (
    <>
      <h1 className="page-title">Configurazione confronto</h1>
      <div style={{ maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Match keys */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700 }}>Chiavi di corrispondenza</h2>
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setKeys([...keys, { label: 'Nuova chiave', columnA: '', columnB: '', sheetA: '', sheetB: '', enabled: true, transform: 'none' }])}>+ Aggiungi</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {keys.map((k, i) => (
              <div key={i} className="card" style={{ background: 'var(--c-bg-card-alt)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 1fr 1fr 150px auto', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={k.enabled !== false} onChange={(e) => updKey(i, { enabled: e.target.checked })} title="Abilitata" aria-label="Chiave abilitata" />
                  <input value={k.label} onChange={(e) => updKey(i, { label: e.target.value })} placeholder="Etichetta" />
                  <input value={k.columnA ?? k.column ?? ''} onChange={(e) => updKey(i, { columnA: e.target.value })} placeholder="Colonna A" />
                  <input value={k.columnB ?? k.column ?? ''} onChange={(e) => updKey(i, { columnB: e.target.value })} placeholder="Colonna B" />
                  <select value={k.transform || 'none'} onChange={(e) => updKey(i, { transform: e.target.value as Transform })}>
                    {TRANSFORM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => move(i, -1)} title="Su">↑</button>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => move(i, 1)} title="Giù">↓</button>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => setKeys(keys.filter((_, idx) => idx !== i))} title="Rimuovi">✕</button>
                  </div>
                </div>
                {/* Foglio A/B: mostrati solo per file multi-foglio caricati */}
                {(hasSheets(fileA?.wb) || hasSheets(fileB?.wb)) && (
                  <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 1fr auto', gap: 8, alignItems: 'center' }}>
                    <span />
                    <SheetSelect wb={fileA?.wb ?? null} value={k.sheetA || ''} onSet={(v) => updKey(i, { sheetA: v })} label="Foglio A" />
                    <SheetSelect wb={fileB?.wb ?? null} value={k.sheetB || ''} onSet={(v) => updKey(i, { sheetB: v })} label="Foglio B" />
                    <span />
                  </div>
                )}
              </div>
            ))}
          </div>
          <button className="btn btn-secondary" style={{ fontSize: 12, marginTop: 10 }} onClick={() => setKeys(defaultMatchKeys())}>Ripristina predefinite</button>
        </div>

        {/* Fuzzy */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Fuzzy matching</h2>
          <div className="form-group">
            <label className="label">Sovrapposizione minima (chiavi)</label>
            <input type="number" min={2} value={fuzzy.min} onChange={(e) => setFuzzy({ ...fuzzy, min: parseInt(e.target.value, 10) || 4 })} style={{ width: 100 }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={fuzzy.broad} onChange={(e) => setFuzzy({ ...fuzzy, broad: e.target.checked })} />
            <span style={{ fontSize: 14 }}>Abilita passata fuzzy ampia (tutte le colonne)</span>
          </label>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="label">Sovrapposizione minima (ampia)</label>
            <input type="number" min={2} value={fuzzy.broadMin} onChange={(e) => setFuzzy({ ...fuzzy, broadMin: parseInt(e.target.value, 10) || 6 })} style={{ width: 100 }} disabled={!fuzzy.broad} />
          </div>
        </div>

        {/* Profili */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Profili salvati</h2>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Nome profilo" style={{ flex: 1, minWidth: 180 }} />
            <button className="btn btn-secondary" onClick={saveAsProfile}>Salva come profilo</button>
            <button className="btn btn-secondary" onClick={exportProfiles}>Esporta JSON</button>
            <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
              Importa JSON
              <input type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => importProfiles(e.target.files?.[0])} />
            </label>
          </div>
          {Object.keys(profiles).length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--c-text-muted)', margin: 0 }}>Nessun profilo salvato.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.keys(profiles).map((name) => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 14 }}>{name}</span>
                  <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => loadProfile(name)}>Carica</button>
                  <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => deleteProfile(name)}>Elimina</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {saved && <div className="alert alert-success">Configurazione salvata.</div>}
        <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={save}>Salva configurazione</button>
      </div>
    </>
  )
}

function hasSheets(wb?: Workbook | null): boolean {
  return !!wb && wb.sheetNames.length > 1
}

function SheetSelect({ wb, value, onSet, label }: { wb: Workbook | null; value: string; onSet: (v: string) => void; label: string }) {
  if (!hasSheets(wb)) return <span />
  return (
    <select value={value} onChange={(e) => onSet(e.target.value)} aria-label={label} title={label}>
      <option value="">{label}: (1° foglio)</option>
      {wb!.sheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  )
}
