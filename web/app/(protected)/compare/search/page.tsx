'use client'

import { useEffect, useState } from 'react'
import { useCompare } from '@/lib/compare/CompareProvider'
import CompareFileBar from '@/components/CompareFileBar'
import CompareConditions from '@/components/CompareConditions'
import { runInclusionSearch, sheetRows, type Condition, type Row } from '@/lib/compare/engine'
import { downloadRows } from '@/lib/compare/xlsx'

const SEARCH_MODES: { value: 'contains' | 'equals'; label: string }[] = [
  { value: 'contains', label: 'Contiene' },
  { value: 'equals', label: 'Uguale a' },
]

export default function CompareSearchPage() {
  const { fileA, fileB, config, saveConfig } = useCompare()
  const [conditions, setConditions] = useState<Condition[]>(config.searchConditions)
  const [results, setResults] = useState<Array<{ rowA: Row; matches: Row[] }> | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => { setConditions(config.searchConditions) }, [config.searchConditions])

  function run() {
    if (!fileA || !fileB) return
    const dataA = sheetRows(fileA.wb, conditions, 'a')
    const dataB = sheetRows(fileB.wb, conditions, 'b')
    setResults(runInclusionSearch(dataA, dataB, conditions.filter((c) => c.columnA && c.columnB)))
  }

  async function saveConds() {
    await saveConfig({ ...config, searchConditions: conditions })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  function exportXls() {
    if (!results) return
    const rows: Row[] = []
    results.forEach(({ rowA, matches }) => {
      if (!matches.length) return
      matches.forEach((m) => rows.push({ ...prefix(rowA, 'A_'), ...prefix(m, 'B_') }))
    })
    downloadRows(rows, 'ricerca_inclusione.xlsx', 'Ricerca')
  }

  const withMatches = results ? results.filter((r) => r.matches.length) : []

  return (
    <>
      <h1 className="page-title">Ricerca</h1>
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

      <div style={{ display: 'flex', gap: 10, marginBottom: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={run} disabled={!fileA || !fileB}>Cerca</button>
        {results && <button className="btn btn-secondary" onClick={exportXls}>Esporta XLS</button>}
        {results && <span style={{ fontSize: 13, color: 'var(--c-text-secondary)' }}><strong>{withMatches.length}</strong> righe A con corrispondenze</span>}
      </div>

      {results && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {withMatches.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', color: 'var(--c-text-muted)' }}>Nessuna corrispondenza.</div>
          ) : (
            withMatches.map(({ rowA, matches }, i) => (
              <div key={i} className="card">
                <div style={{ fontSize: 12, color: 'var(--c-text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>Riga A · {matches.length} corrispondenze</div>
                <div style={{ fontSize: 13, marginBottom: 10 }}>{Object.entries(rowA).map(([k, v]) => `${k}: ${v ?? ''}`).join('  ·  ')}</div>
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead><tr>{Object.keys(matches[0]).map((c) => <th key={c}>{c}</th>)}</tr></thead>
                    <tbody>
                      {matches.map((m, j) => (
                        <tr key={j}>{Object.keys(matches[0]).map((c) => <td key={c}>{String(m[c] ?? '')}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </>
  )
}

function prefix(row: Row, p: string): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(row)) out[p + k] = v
  return out
}
