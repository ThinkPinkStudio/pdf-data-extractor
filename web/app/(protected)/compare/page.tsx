'use client'

import { useMemo, useState } from 'react'
import { useCompare } from '@/lib/compare/CompareProvider'
import CompareFileBar from '@/components/CompareFileBar'
import { compare, sheetRows, type CompareResult, type Row } from '@/lib/compare/engine'
import { downloadRows } from '@/lib/compare/xlsx'

type Filter = 'all' | 'only-a' | 'only-b' | 'fuzzy'

export default function ComparePage() {
  const { fileA, fileB, config } = useCompare()
  const [result, setResult] = useState<CompareResult | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const enabledKeys = useMemo(() => config.matchKeys.filter((k) => k.enabled !== false), [config.matchKeys])

  function run() {
    if (!fileA || !fileB) return
    const dataA = sheetRows(fileA.wb, enabledKeys, 'a')
    const dataB = sheetRows(fileB.wb, enabledKeys, 'b')
    const res = compare(dataA, dataB, enabledKeys, config.fuzzyMinOverlap, {
      enabled: config.fuzzyBroadEnabled,
      minOverlap: config.fuzzyMinOverlapBroad,
    })
    setResult(res)
    setFilter('all')
  }

  const countA = result ? result.onlyA.length + result.diffA.length : 0
  const countB = result ? result.onlyB.length + result.diffB.length : 0
  const fuzzyCount = result ? result.fuzzy.length : 0

  const tableRows: Array<Row & { __source: 'A' | 'B' }> = useMemo(() => {
    if (!result) return []
    const a = [...result.onlyA, ...result.diffA].map((r) => ({ ...r, __source: 'A' as const }))
    const b = [...result.onlyB, ...result.diffB].map((r) => ({ ...r, __source: 'B' as const }))
    if (filter === 'only-a') return a
    if (filter === 'only-b') return b
    return [...a, ...b]
  }, [result, filter])

  const columns = useMemo(() => {
    const set = new Set<string>()
    tableRows.forEach((r) => Object.keys(r).forEach((k) => { if (k !== '__source') set.add(k) }))
    return Array.from(set)
  }, [tableRows])

  function exportXls() {
    if (!result) return
    const rows = [
      ...[...result.onlyA, ...result.diffA].map((r) => ({ Origine: 'A', ...r })),
      ...[...result.onlyB, ...result.diffB].map((r) => ({ Origine: 'B', ...r })),
    ]
    downloadRows(rows, 'comparazione.xlsx')
  }

  return (
    <>
      <h1 className="page-title">Comparazione</h1>
      <CompareFileBar />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={run} disabled={!fileA || !fileB}>Confronta</button>
        {result && <button className="btn btn-secondary" onClick={exportXls}>Esporta XLS</button>}
        {result && (
          <span style={{ fontSize: 13, color: 'var(--c-text-secondary)' }}>
            <strong>{countA + countB}</strong> differenze — <strong>{countA}</strong> solo in A, <strong>{countB}</strong> solo in B
            {fuzzyCount ? <>, <strong>{fuzzyCount}</strong> da verificare</> : null}
          </span>
        )}
      </div>

      {result && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {([
              ['all', `Tutte (${countA + countB})`],
              ['only-a', `Solo in A (${countA})`],
              ['only-b', `Solo in B (${countB})`],
              ['fuzzy', `Da verificare${fuzzyCount ? ` (${fuzzyCount})` : ''}`],
            ] as [Filter, string][]).map(([f, label]) => (
              <button
                key={f}
                className={`btn ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: 13, padding: '6px 12px' }}
                onClick={() => setFilter(f)}
              >
                {label}
              </button>
            ))}
          </div>

          {filter === 'fuzzy' ? (
            <FuzzyList result={result} />
          ) : (
            <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
              {tableRows.length === 0 ? (
                <div style={{ padding: 28, textAlign: 'center', color: 'var(--c-text-muted)' }}>Nessun risultato</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Origine</th>
                      {columns.map((c) => <th key={c}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, i) => (
                      <tr key={i}>
                        <td><span style={{ color: row.__source === 'A' ? 'var(--c-info)' : 'var(--c-accent)', fontWeight: 700 }}>{row.__source}</span></td>
                        {columns.map((c) => <td key={c} title={String(row[c] ?? '')}>{String(row[c] ?? '')}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}

function FuzzyList({ result }: { result: CompareResult }) {
  if (!result.fuzzy.length) {
    return <div className="card" style={{ textAlign: 'center', color: 'var(--c-text-muted)' }}>Nessuna coppia da verificare.</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {result.fuzzy.map((pair, idx) => {
        const cols = Array.from(new Set([...Object.keys(pair.rowA), ...Object.keys(pair.rowB)]))
        return (
          <div key={idx} className="card">
            <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>
              Coppia da verificare · match {pair.kind === 'broad' ? 'ampio' : 'per chiave'}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr><th>Campo</th><th>A</th><th>B</th></tr>
                </thead>
                <tbody>
                  {cols.map((c) => (
                    <tr key={c}>
                      <td style={{ color: 'var(--c-text-muted)' }}>{c}</td>
                      <td>{String(pair.rowA[c] ?? '')}</td>
                      <td>{String(pair.rowB[c] ?? '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
