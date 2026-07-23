'use client'

import { useMemo, useState } from 'react'
import { useCompare } from '@/lib/compare/CompareProvider'
import CompareFileBar from '@/components/CompareFileBar'
import { sheetRows, type CompareResult, type Row } from '@/lib/compare/engine'
import { runInWorker } from '@/lib/compare/runWorker'
import { downloadRows } from '@/lib/compare/xlsx'

type Filter = 'all' | 'only-a' | 'only-b' | 'fuzzy'

export default function ComparePage() {
  const { fileA, fileB, setFileA, setFileB, config } = useCompare()
  const [result, setResult] = useState<CompareResult | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState(false)

  const enabledKeys = useMemo(() => config.matchKeys.filter((k) => k.enabled !== false && (k.columnA || k.column)), [config.matchKeys])

  async function run() {
    if (!fileA || !fileB) return
    const dataA = sheetRows(fileA.wb, enabledKeys, 'a')
    const dataB = sheetRows(fileB.wb, enabledKeys, 'b')
    setBusy(true)
    try {
      const res = await runInWorker<CompareResult>({
        kind: 'compare', dataA, dataB, keys: enabledKeys,
        minOverlap: config.fuzzyMinOverlap,
        broadOpts: { enabled: config.fuzzyBroadEnabled, minOverlap: config.fuzzyMinOverlapBroad },
      })
      setResult(res)
      setFilter('all')
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setFileA(null)
    setFileB(null)
    setResult(null)
    setFilter('all')
  }

  // Decisione su una coppia "da verificare": accettata = stessa entità (nessuna
  // differenza, si rimuove); rifiutata = entità diverse (le righe diventano
  // "Solo in A"/"Solo in B", cioè diffA/diffB).
  function decide(idx: number, kind: 'accept' | 'reject') {
    setResult((r) => {
      if (!r) return r
      const pair = r.fuzzy[idx]
      if (!pair) return r
      const fuzzy = r.fuzzy.filter((_, i) => i !== idx)
      if (kind === 'accept') return { ...r, fuzzy }
      return { ...r, fuzzy, diffA: [...r.diffA, pair.rowA], diffB: [...r.diffB, pair.rowB] }
    })
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
    const fa = fileA?.name || 'File A'
    const fb = fileB?.name || 'File B'
    const rows = [
      ...result.onlyA.map((r) => ({ Origine: `Solo in A (${fa})`, ...r })),
      ...result.diffA.map((r) => ({ Origine: `Solo in A — verificato (${fa})`, ...r })),
      ...result.onlyB.map((r) => ({ Origine: `Solo in B (${fb})`, ...r })),
      ...result.diffB.map((r) => ({ Origine: `Solo in B — verificato (${fb})`, ...r })),
    ]
    downloadRows(rows, 'differenze_portafogli.xlsx')
  }

  return (
    <>
      <h1 className="page-title">Comparazione Portafogli</h1>
      <CompareFileBar />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={run} disabled={!fileA || !fileB || busy}>{busy ? <><span className="spinner" /> Analisi in corso…</> : 'Confronta'}</button>
        {(fileA || fileB || result) && <button className="btn btn-secondary" onClick={reset}>Azzera</button>}
        {result && <button className="btn btn-secondary" onClick={exportXls}>Esporta XLS</button>}
        {result && (
          <span style={{ fontSize: 13, color: 'var(--c-text-secondary)' }}>
            <strong>{countA + countB}</strong> differenze — <strong>{countA}</strong> solo in A, <strong>{countB}</strong> solo in B
            {fuzzyCount ? <>, <strong>{fuzzyCount}</strong> da verificare</> : null}
          </span>
        )}
      </div>

      {!result && !busy && (
        <div className="card" style={{ textAlign: 'center', color: 'var(--c-text-muted)', padding: 40 }}>
          Carica i due file e premi <strong>Confronta</strong> per iniziare la comparazione.
        </div>
      )}

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
            <FuzzyList result={result} onDecide={decide} />
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
                        <td style={{ whiteSpace: 'nowrap' }}><span style={{ color: row.__source === 'A' ? 'var(--c-info)' : 'var(--c-accent)', fontWeight: 700 }}>{row.__source}</span> <span style={{ color: 'var(--c-text-muted)', fontSize: 12 }}>— {row.__source === 'A' ? (fileA?.name || 'File A') : (fileB?.name || 'File B')}</span></td>
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

function FuzzyList({ result, onDecide }: { result: CompareResult; onDecide: (idx: number, kind: 'accept' | 'reject') => void }) {
  if (!result.fuzzy.length) {
    return <div className="card" style={{ textAlign: 'center', color: 'var(--c-text-muted)' }}>Nessuna coppia da verificare — tutte le decisioni sono state prese.</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {result.fuzzy.map((pair, idx) => {
        const cols = Array.from(new Set([...Object.keys(pair.rowA), ...Object.keys(pair.rowB)]))
        return (
          <div key={idx} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--c-text-secondary)' }}>
                {pair.kind === 'broad'
                  ? '🔎 Corrispondenza estesa (solo lettere/numeri, tutte le colonne) — verificare manualmente'
                  : 'Corrispondenza parziale — verificare manualmente'}
              </span>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => onDecide(idx, 'accept')}>✓ Stessa polizza</button>
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => onDecide(idx, 'reject')}>✗ Polizze diverse</button>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr><th>Campo</th><th>A</th><th>B</th></tr>
                </thead>
                <tbody>
                  {cols.map((c) => {
                    const va = String(pair.rowA[c] ?? '')
                    const vb = String(pair.rowB[c] ?? '')
                    return (
                      <tr key={c}>
                        <td style={{ color: 'var(--c-text-muted)' }}>{c}</td>
                        <td style={va !== vb ? { color: 'var(--c-warning)' } : undefined}>{va}</td>
                        <td style={va !== vb ? { color: 'var(--c-warning)' } : undefined}>{vb}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
