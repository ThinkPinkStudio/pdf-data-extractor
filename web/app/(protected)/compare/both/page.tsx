'use client'

import { useEffect, useMemo, useState } from 'react'
import { useCompare } from '@/lib/compare/CompareProvider'
import CompareFileBar from '@/components/CompareFileBar'
import CompareConditions from '@/components/CompareConditions'
import { sheetRows, BOTH_MODE_OPTIONS, type Condition, type Row } from '@/lib/compare/engine'
import { runInWorker } from '@/lib/compare/runWorker'
import { downloadRows } from '@/lib/compare/xlsx'

export default function CompareBothPage() {
  const { fileA, fileB, config, saveConfig } = useCompare()
  const [matchConds, setMatchConds] = useState<Condition[]>(config.bothMatchConditions)
  const [filterConds, setFilterConds] = useState<Condition[]>(config.bothFilterConditions)
  const [pairs, setPairs] = useState<Array<{ rowA: Row; rowB: Row }> | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setMatchConds(config.bothMatchConditions); setFilterConds(config.bothFilterConditions) }, [config.bothMatchConditions, config.bothFilterConditions])

  async function run() {
    if (!fileA || !fileB) return
    const entries = [...matchConds, ...filterConds]
    const dataA = sheetRows(fileA.wb, entries, 'a')
    const dataB = sheetRows(fileB.wb, entries, 'b')
    setBusy(true)
    try {
      const res = await runInWorker<Array<{ rowA: Row; rowB: Row }>>({
        kind: 'both', dataA, dataB,
        matchConds: matchConds.filter((c) => c.columnA && c.columnB),
        filterConds: filterConds.filter((c) => c.columnA && c.columnB),
      })
      setPairs(res)
    } finally {
      setBusy(false)
    }
  }

  // Unione colonne su TUTTE le coppie (allineamento per nome anche con dati eterogenei).
  const colsA = useMemo(() => unionCols(pairs, 'rowA'), [pairs])
  const colsB = useMemo(() => unionCols(pairs, 'rowB'), [pairs])
  const distinctA = useMemo(() => (pairs ? new Set(pairs.map((p) => JSON.stringify(p.rowA))).size : 0), [pairs])

  async function saveConds() {
    await saveConfig({ ...config, bothMatchConditions: matchConds, bothFilterConditions: filterConds })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  function exportXls() {
    if (!pairs) return
    const rows = pairs.map(({ rowA, rowB }) => {
      const out: Row = {}
      for (const [k, v] of Object.entries(rowA)) out['A_' + k] = v
      for (const [k, v] of Object.entries(rowB)) out['B_' + k] = v
      return out
    })
    downloadRows(rows, 'in_entrambi.xlsx', 'InEntrambi')
  }

  return (
    <>
      <h1 className="page-title">In Entrambi</h1>
      <p style={{ color: 'var(--c-text-secondary)', marginTop: -12, marginBottom: 18, fontSize: 14 }}>
        Trova coppie di righe presenti in entrambi i file secondo le condizioni di match; le condizioni di filtro (opzionali) restringono i risultati.
      </p>
      <CompareFileBar />

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Condizioni di match</h2>
        <CompareConditions conditions={matchConds} onChange={setMatchConds} modes={BOTH_MODE_OPTIONS} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Condizioni di filtro (opzionali)</h2>
        {filterConds.length === 0 ? (
          <button className="btn btn-secondary" onClick={() => setFilterConds([{ columnA: '', columnB: '', sheetA: '', sheetB: '', mode: 'not_equals', transform: 'none', connector: 'AND' }])}>
            + Aggiungi filtro
          </button>
        ) : (
          <CompareConditions conditions={filterConds} onChange={setFilterConds} modes={BOTH_MODE_OPTIONS} />
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={run} disabled={!fileA || !fileB || busy}>{busy ? <><span className="spinner" /> Elaborazione…</> : 'Trova'}</button>
        <button className="btn btn-secondary" onClick={saveConds}>Salva condizioni</button>
        {saved && <span style={{ color: 'var(--c-success)', fontSize: 13 }}>Salvato ✓</span>}
        {pairs && <button className="btn btn-secondary" onClick={exportXls}>Esporta XLS</button>}
        {pairs && <span style={{ fontSize: 13, color: 'var(--c-text-secondary)' }}><strong>{pairs.length}</strong> coppie · <strong>{distinctA}</strong> righe distinte di A</span>}
      </div>

      {pairs && (
        <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
          {pairs.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--c-text-muted)' }}>Nessuna coppia trovata.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  {colsA.map((c) => <th key={'a' + c}>A · {c}</th>)}
                  {colsB.map((c) => <th key={'b' + c}>B · {c}</th>)}
                </tr>
              </thead>
              <tbody>
                {pairs.map(({ rowA, rowB }, i) => (
                  <tr key={i}>
                    {colsA.map((c) => <td key={'a' + c}>{String(rowA[c] ?? '')}</td>)}
                    {colsB.map((c) => <td key={'b' + c}>{String(rowB[c] ?? '')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  )
}

function unionCols(pairs: Array<{ rowA: Row; rowB: Row }> | null, side: 'rowA' | 'rowB'): string[] {
  const set = new Set<string>()
  ;(pairs || []).forEach((p) => Object.keys(p[side]).forEach((k) => set.add(k)))
  return Array.from(set)
}
