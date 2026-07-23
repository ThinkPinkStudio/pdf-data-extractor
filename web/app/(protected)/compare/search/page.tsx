'use client'

import { useEffect, useMemo, useState } from 'react'
import { useCompare } from '@/lib/compare/CompareProvider'
import CompareFileBar from '@/components/CompareFileBar'
import CompareConditions from '@/components/CompareConditions'
import { sheetRows, type Condition, type Row } from '@/lib/compare/engine'
import { runInWorker } from '@/lib/compare/runWorker'
import { downloadRows } from '@/lib/compare/xlsx'

const SEARCH_MODES: { value: 'contains' | 'equals'; label: string }[] = [
  { value: 'contains', label: 'Contiene' },
  { value: 'equals', label: 'Uguale a' },
]

type Filter = 'all' | 'with' | 'without'

export default function CompareSearchPage() {
  const { fileA, fileB, config, saveConfig } = useCompare()
  const [conditions, setConditions] = useState<Condition[]>(config.searchConditions)
  const [results, setResults] = useState<Array<{ rowA: Row; matches: Row[] }> | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setConditions(config.searchConditions) }, [config.searchConditions])

  async function run() {
    if (!fileA || !fileB) return
    const active = conditions.filter((c) => c.columnA && c.columnB)
    const dataA = sheetRows(fileA.wb, active, 'a')
    const dataB = sheetRows(fileB.wb, active, 'b')
    setBusy(true)
    try {
      const res = await runInWorker<Array<{ rowA: Row; matches: Row[] }>>({ kind: 'search', dataA, dataB, conditions: active })
      setResults(res)
      setFilter('all')
    } finally {
      setBusy(false)
    }
  }

  async function saveConds() {
    await saveConfig({ ...config, searchConditions: conditions })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  function exportXls() {
    if (!results) return
    // Come il desktop: righe con match → A: … / B: … (nessun Esito); righe senza
    // match → A: … + colonna Esito (ultima). Foglio 'Differenze'.
    const rows: Row[] = []
    results.forEach(({ rowA, matches }) => {
      if (!matches.length) {
        rows.push({ ...prefix(rowA, 'A: '), Esito: 'Nessuna corrispondenza' })
      } else {
        matches.forEach((m) => rows.push({ ...prefix(rowA, 'A: '), ...prefix(m, 'B: ') }))
      }
    })
    downloadRows(rows, 'ricerca_inclusione.xlsx')
  }

  const withMatches = results ? results.filter((r) => r.matches.length) : []
  const withoutMatches = results ? results.filter((r) => !r.matches.length) : []
  const shown = useMemo(() => {
    if (!results) return []
    if (filter === 'with') return withMatches
    if (filter === 'without') return withoutMatches
    return results
  }, [results, filter, withMatches, withoutMatches])

  // Unione delle colonne su TUTTI i match (dati eterogenei allineati per nome).
  const matchColumns = useMemo(() => {
    const set = new Set<string>()
    withMatches.forEach(({ matches }) => matches.forEach((m) => Object.keys(m).forEach((k) => set.add(k))))
    return Array.from(set)
  }, [withMatches])

  return (
    <>
      <h1 className="page-title">Ricerca per Inclusione</h1>
      <p style={{ color: 'var(--c-text-secondary)', marginTop: -12, marginBottom: 18, fontSize: 14 }}>
        Per ogni riga del File A, trova le righe del File B che soddisfano le condizioni.
      </p>
      <CompareFileBar />

      <div className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Condizioni</h2>
        <CompareConditions conditions={conditions} onChange={setConditions} modes={SEARCH_MODES} />
        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={saveConds}>Salva condizioni</button>
          {saved && <span style={{ color: 'var(--c-success)', fontSize: 13 }}>Salvato ✓</span>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={run} disabled={!fileA || !fileB || busy}>{busy ? <><span className="spinner" /> Elaborazione…</> : 'Cerca'}</button>
        {results && <button className="btn btn-secondary" onClick={exportXls}>Esporta XLS</button>}
        {results && <span style={{ fontSize: 13, color: 'var(--c-text-secondary)' }}><strong>{results.length}</strong> righe A analizzate · <strong>{withMatches.length}</strong> con riscontro · <strong>{withoutMatches.length}</strong> senza</span>}
      </div>

      {results && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {([
              ['all', `Tutte (${results.length})`],
              ['with', `Con riscontro (${withMatches.length})`],
              ['without', `Senza riscontro (${withoutMatches.length})`],
            ] as [Filter, string][]).map(([f, label]) => (
              <button key={f} className={`btn ${filter === f ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: 13, padding: '6px 12px' }} onClick={() => setFilter(f)}>{label}</button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {shown.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', color: 'var(--c-text-muted)' }}>Nessuna riga in questa categoria.</div>
            ) : (
              shown.map(({ rowA, matches }, i) => (
                <div key={i} className="card">
                  <div style={{ fontSize: 12, color: matches.length ? 'var(--c-text-muted)' : 'var(--c-warning)', marginBottom: 6, textTransform: 'uppercase' }}>
                    Riga A · {matches.length ? `${matches.length} corrispondenze` : 'nessuna corrispondenza'}
                  </div>
                  <div style={{ fontSize: 13, marginBottom: matches.length ? 10 : 0 }}>{Object.entries(rowA).map(([k, v]) => `${k}: ${v ?? ''}`).join('  ·  ')}</div>
                  {matches.length > 0 && (
                    <div style={{ overflowX: 'auto' }}>
                      <table>
                        <thead><tr>{matchColumns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                        <tbody>
                          {matches.map((m, j) => (
                            <tr key={j}>{matchColumns.map((c) => <td key={c}>{String(m[c] ?? '')}</td>)}</tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </>
  )
}

function prefix(row: Row, p: string): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(row)) out[p + k] = v
  return out
}
