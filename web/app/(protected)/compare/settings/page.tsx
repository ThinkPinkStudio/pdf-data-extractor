'use client'

import { useEffect, useState } from 'react'
import { useCompare } from '@/lib/compare/CompareProvider'
import { TRANSFORM_OPTIONS, defaultMatchKeys, defaultCompareConfig, workbookColumns, type CompareConfig, type MatchKey, type Transform, type Workbook } from '@/lib/compare/engine'

export default function CompareSettingsPage() {
  const { config, saveConfig, fileA, fileB } = useCompare()
  const [keys, setKeys] = useState<MatchKey[]>(config.matchKeys)
  const [fuzzy, setFuzzy] = useState({ enabled: config.fuzzyEnabled, min: config.fuzzyMinOverlap, ignore: config.fuzzyIgnoreWords, broad: config.fuzzyBroadEnabled, broadMin: config.fuzzyMinOverlapBroad })
  const [saved, setSaved] = useState(false)
  const [msg, setMsg] = useState('')
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  // Ripristina TUTTI i criteri (chiavi + fuzzy + condizioni ricerca/in-entrambi).
  function resetAll() {
    const d = defaultCompareConfig()
    setKeys(d.matchKeys)
    setFuzzy({ enabled: d.fuzzyEnabled, min: d.fuzzyMinOverlap, ignore: d.fuzzyIgnoreWords, broad: d.fuzzyBroadEnabled, broadMin: d.fuzzyMinOverlapBroad })
    saveConfig(d)
    flash('Criteri ripristinati ai valori predefiniti.')
  }

  useEffect(() => { setKeys(config.matchKeys); setFuzzy({ enabled: config.fuzzyEnabled, min: config.fuzzyMinOverlap, ignore: config.fuzzyIgnoreWords, broad: config.fuzzyBroadEnabled, broadMin: config.fuzzyMinOverlapBroad }) }, [config])

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
      fuzzyEnabled: fuzzy.enabled,
      fuzzyMinOverlap: fuzzy.min,
      fuzzyIgnoreWords: fuzzy.ignore,
      fuzzyBroadEnabled: fuzzy.broad,
      fuzzyMinOverlapBroad: fuzzy.broadMin,
    }
  }

  async function save() {
    await saveConfig(currentConfig())
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 4px', cursor: 'pointer' }}>
            <input type="checkbox" checked={fuzzy.enabled} onChange={(e) => setFuzzy({ ...fuzzy, enabled: e.target.checked })} />
            <span style={{ fontSize: 14 }}>Abilita confronto fuzzy («Da verificare»)</span>
          </label>
          <p style={{ fontSize: 11, color: 'var(--c-text-muted)', margin: '0 0 14px' }}>
            Se disattivato non viene proposta nessuna coppia «da verificare»: le righe senza corrispondenza esatta restano «Solo in A»/«Solo in B».
          </p>
          <div className="form-group">
            <label className="label">Sovrapposizione minima (chiavi)</label>
            <input type="number" min={2} value={fuzzy.min} onChange={(e) => setFuzzy({ ...fuzzy, min: parseInt(e.target.value, 10) || 4 })} style={{ width: 100 }} disabled={!fuzzy.enabled} />
          </div>
          <div className="form-group">
            <label className="label">Parole o sequenze da ignorare</label>
            <input value={fuzzy.ignore} onChange={(e) => setFuzzy({ ...fuzzy, ignore: e.target.value })} placeholder="es. totale, srl" style={{ width: '100%', maxWidth: 420 }} disabled={!fuzzy.enabled} />
            <p style={{ fontSize: 11, color: 'var(--c-text-muted)', margin: '4px 0 0' }}>
              Separate da virgola, minimo 2 caratteri. Rimosse dai valori prima del confronto fuzzy: utile per suffissi comuni a tutte le righe (es. il «Totale» delle tabelle pivot), che altrimenti generano coppie «da verificare» senza senso.
            </p>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={fuzzy.broad} onChange={(e) => setFuzzy({ ...fuzzy, broad: e.target.checked })} disabled={!fuzzy.enabled} />
            <span style={{ fontSize: 14 }}>Abilita passata fuzzy ampia (tutte le colonne)</span>
          </label>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="label">Sovrapposizione minima (ampia)</label>
            <input type="number" min={2} value={fuzzy.broadMin} onChange={(e) => setFuzzy({ ...fuzzy, broadMin: parseInt(e.target.value, 10) || 6 })} style={{ width: 100 }} disabled={!fuzzy.enabled || !fuzzy.broad} />
          </div>
        </div>

        {/* I profili salvati sono nelle pagine che li usano: Comparazione
            (chiavi + fuzzy) e Confronto righe (condizioni), separati. */}
        <p style={{ fontSize: 12, color: 'var(--c-text-muted)', margin: 0 }}>
          I profili salvati sono ora nella pagina <strong>Comparazione</strong> (chiavi di abbinamento e fuzzy) e, separatamente, in <strong>Confronto righe</strong> per le sue condizioni.
        </p>

        {msg && <div className="alert alert-success">{msg}</div>}
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
