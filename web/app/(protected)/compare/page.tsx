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
        fuzzy: {
          enabled: config.fuzzyEnabled,
          minOverlap: config.fuzzyMinOverlap,
          ignoreWords: config.fuzzyIgnoreWords,
          broadEnabled: config.fuzzyBroadEnabled,
          broadMinOverlap: config.fuzzyMinOverlapBroad,
        },
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
      // Coppie «da verificare» non ancora decise: due righe consecutive per
      // coppia, legate dal numero in «Coppia» (prima non venivano esportate).
      ...result.fuzzy.flatMap((p, i) => [
        { Origine: `Da verificare — A (${fa})`, Coppia: i + 1, ...p.rowA },
        { Origine: `Da verificare — B (${fb})`, Coppia: i + 1, ...p.rowB },
      ]),
    ]
    downloadRows(rows, 'differenze_portafogli.xlsx')
  }

  const fa = fileA?.name || 'File A'
  const fb = fileB?.name || 'File B'

  return (
    <>
      <h1 className="page-title">Comparazione Portafogli</h1>
      <p className="view-subtitle">Carica due file Excel per trovare le polizze non coincidenti.</p>
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
        <div className="state-box">
          <svg viewBox="0 0 24 24"><path d="M9 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M15 3h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4M9 3v18M15 3v18" /></svg>
          <p>Carica i due file per iniziare la comparazione.</p>
        </div>
      )}

      {busy && !result && (
        <div className="state-box"><span className="spinner-lg" /><p>Analisi in corso…</p></div>
      )}

      {result && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="filter-tabs">
              {([
                ['all', `Tutte (${countA + countB})`, false],
                ['only-a', `Solo in A (${countA})`, false],
                ['only-b', `Solo in B (${countB})`, false],
                ['fuzzy', 'Da verificare', true],
              ] as [Filter, string, boolean][]).map(([f, label, isFuzzy]) => (
                <button
                  key={f}
                  className={`tab-btn ${isFuzzy ? 'tab-btn--fuzzy' : ''} ${filter === f ? 'active' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {label}
                  {isFuzzy && fuzzyCount ? <span className="tab-badge">{fuzzyCount}</span> : null}
                </button>
              ))}
            </div>
          </div>

          {filter === 'fuzzy' ? (
            <FuzzyList result={result} onDecide={decide} fileAName={fa} fileBName={fb} />
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
                      <tr key={i} className={row.__source === 'A' ? 'row-only-a' : 'row-only-b'}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span className={`badge-origin ${row.__source === 'A' ? 'badge-a' : 'badge-b'}`}>{row.__source}</span>
                          <span style={{ color: 'var(--c-text-muted)', fontSize: 12, marginLeft: 6 }}>— {row.__source === 'A' ? fa : fb}</span>
                        </td>
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

function FuzzyList({ result, onDecide, fileAName, fileBName }: { result: CompareResult; onDecide: (idx: number, kind: 'accept' | 'reject') => void; fileAName: string; fileBName: string }) {
  if (!result.fuzzy.length) {
    return (
      <div className="fuzzy-empty">
        <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="#2E7D32" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        Nessuna coppia da verificare — tutte le decisioni sono state prese.
      </div>
    )
  }
  return (
    <div className="fuzzy-list">
      {result.fuzzy.map((pair, idx) => {
        const cols = Array.from(new Set([...Object.keys(pair.rowA), ...Object.keys(pair.rowB)]))
        return (
          <div key={idx} className={`fuzzy-pair ${pair.kind === 'broad' ? 'fuzzy-pair--broad' : ''}`}>
            <div className="fuzzy-pair-rows">
              <div className="fuzzy-pair-side fuzzy-pair-side--a">
                <div className="fuzzy-pair-label">A — {fileAName}</div>
                <div className="fuzzy-pair-data">
                  {cols.map((c) => (
                    <div className="fuzzy-field" key={c}>
                      <span className="fuzzy-field-name" title={c}>{c}</span>
                      <span className="fuzzy-field-val" title={String(pair.rowA[c] ?? '')}>{String(pair.rowA[c] ?? '')}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="fuzzy-pair-side fuzzy-pair-side--b">
                <div className="fuzzy-pair-label">B — {fileBName}</div>
                <div className="fuzzy-pair-data">
                  {cols.map((c) => (
                    <div className="fuzzy-field" key={c}>
                      <span className="fuzzy-field-name" title={c}>{c}</span>
                      <span className="fuzzy-field-val" title={String(pair.rowB[c] ?? '')}>{String(pair.rowB[c] ?? '')}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="fuzzy-pair-actions">
              <button className="btn-fuzzy btn-fuzzy-same" onClick={() => onDecide(idx, 'accept')}>✓ Stessa polizza</button>
              <button className="btn-fuzzy btn-fuzzy-diff" onClick={() => onDecide(idx, 'reject')}>✗ Polizze diverse</button>
              <span className="fuzzy-pair-hint">
                {pair.kind === 'broad' ? '🔎 Corrispondenza estesa — verificare manualmente' : 'Corrispondenza parziale — verificare manualmente'}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
