'use client'

import { useEffect, useState } from 'react'
import { useCompare } from '@/lib/compare/CompareProvider'
import { TRANSFORM_OPTIONS, defaultMatchKeys, defaultCompareConfig, workbookColumns, type CompareConfig, type MatchKey, type Transform, type Workbook } from '@/lib/compare/engine'

export default function CompareSettingsPage() {
  const { config, saveConfig, fileA, fileB } = useCompare()
  const [keys, setKeys] = useState<MatchKey[]>(config.matchKeys)
  const [fuzzy, setFuzzy] = useState({ min: config.fuzzyMinOverlap, broad: config.fuzzyBroadEnabled, broadMin: config.fuzzyMinOverlapBroad })
  const [saved, setSaved] = useState(false)
  const [profiles, setProfiles] = useState<Record<string, CompareConfig>>({})
  const [profileName, setProfileName] = useState('')
  const [profileMsg, setProfileMsg] = useState('')
  const flashProfile = (m: string) => { setProfileMsg(m); setTimeout(() => setProfileMsg(''), 2500) }

  // Ripristina TUTTI i criteri (chiavi + fuzzy + condizioni ricerca/in-entrambi).
  function resetAll() {
    const d = defaultCompareConfig()
    setKeys(d.matchKeys)
    setFuzzy({ min: d.fuzzyMinOverlap, broad: d.fuzzyBroadEnabled, broadMin: d.fuzzyMinOverlapBroad })
    saveConfig(d)
    flashProfile('Criteri ripristinati ai valori predefiniti.')
  }

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
    flashProfile(`Profilo «${name}» salvato.`)
  }
  function loadProfile(name: string) {
    const p = profiles[name]
    if (p) { setKeys(p.matchKeys || defaultMatchKeys()); setFuzzy({ min: p.fuzzyMinOverlap, broad: p.fuzzyBroadEnabled, broadMin: p.fuzzyMinOverlapBroad }); saveConfig(p); flashProfile(`Profilo «${name}» caricato.`) }
  }
  async function deleteProfile(name: string) {
    const next = { ...profiles }
    delete next[name]
    await saveProfiles(next)
    flashProfile(`Profilo «${name}» eliminato.`)
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
      <h1 className="page-title">Configurazione Criteri</h1>
      <div style={{ maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Match keys */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700 }}>Chiavi di abbinamento</h2>
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setKeys([...keys, { label: 'Nuova chiave', columnA: '', columnB: '', sheetA: '', sheetB: '', sameColumn: true, enabled: true, transform: 'none' }])}>+ Aggiungi</button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 0, marginBottom: 14 }}>Applicate nell&apos;ordine indicato: la prima chiave attiva con corrispondenza determina l&apos;abbinamento.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {keys.map((k, i) => {
              const same = k.sameColumn !== false
              const setCol = (side: 'a' | 'b', v: string) => same ? updKey(i, { columnA: v, columnB: v }) : updKey(i, side === 'a' ? { columnA: v } : { columnB: v })
              const setSheet = (side: 'a' | 'b', v: string) => same ? updKey(i, { sheetA: v, sheetB: v }) : updKey(i, side === 'a' ? { sheetA: v } : { sheetB: v })
              const toggleSame = (v: boolean) => updKey(i, v ? { sameColumn: true, columnB: k.columnA ?? k.column ?? '', sheetB: k.sheetA ?? '' } : { sameColumn: false })
              return (
                <div key={i} className="card" style={{ background: 'var(--c-bg-card-alt)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 150px auto', gap: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={k.enabled !== false} onChange={(e) => updKey(i, { enabled: e.target.checked })} title="Abilitata" aria-label="Chiave abilitata" />
                    <input value={k.label} onChange={(e) => updKey(i, { label: e.target.value })} placeholder="Etichetta" />
                    <select value={k.transform || 'none'} onChange={(e) => updKey(i, { transform: e.target.value as Transform })} aria-label="Trasformazione">
                      {TRANSFORM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => move(i, -1)} title="Su">↑</button>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => move(i, 1)} title="Giù">↓</button>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => setKeys(keys.filter((_, idx) => idx !== i))} title="Rimuovi">✕</button>
                    </div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input type="checkbox" checked={same} onChange={(e) => toggleSame(e.target.checked)} /> Stessa colonna in entrambi i file
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                    <ColField label={same ? 'Nome colonna' : 'Colonna File A'} wb={fileA?.wb ?? null} sheet={k.sheetA} value={k.columnA ?? k.column ?? ''} onSet={(v) => setCol('a', v)} />
                    <SheetField label={same ? 'Foglio (opz.)' : 'Foglio File A (opz.)'} wb={fileA?.wb ?? null} value={k.sheetA || ''} onSet={(v) => setSheet('a', v)} />
                    {!same && <ColField label="Colonna File B" wb={fileB?.wb ?? null} sheet={k.sheetB} value={k.columnB ?? ''} onSet={(v) => setCol('b', v)} />}
                    {!same && <SheetField label="Foglio File B (opz.)" wb={fileB?.wb ?? null} value={k.sheetB || ''} onSet={(v) => setSheet('b', v)} />}
                  </div>
                </div>
              )
            })}
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
          {profileMsg && <div className="alert alert-success" style={{ marginTop: 12 }}>{profileMsg}</div>}
        </div>

        {saved && <div className="alert alert-success">Configurazione salvata.</div>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={save}>Salva configurazione</button>
          <button className="btn btn-secondary" onClick={resetAll}>Ripristina tutti i criteri</button>
        </div>
      </div>
    </>
  )
}

// Campo Colonna: dropdown popolato dalle colonne del file (foglio scelto) se
// caricato, altrimenti input libero.
function ColField({ label, wb, sheet, value, onSet }: { label: string; wb: Workbook | null; sheet?: string; value: string; onSet: (v: string) => void }) {
  const cols = workbookColumns(wb, sheet)
  return (
    <label style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{label}
      {cols.length ? (
        <select value={value} onChange={(e) => onSet(e.target.value)}>
          <option value="">— seleziona colonna —</option>
          {cols.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      ) : (
        <input value={value} onChange={(e) => onSet(e.target.value)} placeholder="Nome colonna" />
      )}
    </label>
  )
}

// Campo Foglio: dropdown dei fogli del file (sempre visibile, con "(1° foglio)")
// se il file è caricato; altrimenti input libero.
function SheetField({ label, wb, value, onSet }: { label: string; wb: Workbook | null; value: string; onSet: (v: string) => void }) {
  return (
    <label style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{label}
      {wb && wb.sheetNames.length ? (
        <select value={value} onChange={(e) => onSet(e.target.value)}>
          <option value="">(1° foglio)</option>
          {wb.sheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      ) : (
        <input value={value} onChange={(e) => onSet(e.target.value)} placeholder="(1° foglio)" />
      )}
    </label>
  )
}
