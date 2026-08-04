'use client'

import { useEffect, useMemo, useState } from 'react'
import { useCompare } from '@/lib/compare/CompareProvider'
import CompareFileBar from '@/components/CompareFileBar'
import CompareConditions from '@/components/CompareConditions'
import { sheetRows, allNegativeConditions, BOTH_MODE_OPTIONS, type BothRowResult, type Condition, type Row } from '@/lib/compare/engine'
import { runInWorker } from '@/lib/compare/runWorker'
import { downloadRows } from '@/lib/compare/xlsx'

type Filter = 'all' | 'found' | 'missing'

// "In Entrambi" = VERDETTO PER RIGA: per ogni riga del File A dice se esiste
// in B (mostrando la prima corrispondenza). La vecchia versione emetteva TUTTE
// le coppie A×B che soddisfacevano le condizioni — con una condizione debole o
// negativa esplodeva in una matrice NxM, e le righe SENZA riscontro (che sono
// l'informazione utile) non comparivano da nessuna parte.
export default function CompareBothPage() {
  const { fileA, fileB, config, saveConfig } = useCompare()
  const [matchConds, setMatchConds] = useState<Condition[]>(config.bothMatchConditions)
  const [filterConds, setFilterConds] = useState<Condition[]>(config.bothFilterConditions)
  const [results, setResults] = useState<BothRowResult[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
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
      const res = await runInWorker<BothRowResult[]>({
        kind: 'both', dataA, dataB,
        matchConds: matchConds.filter((c) => c.columnA && c.columnB),
        filterConds: filterConds.filter((c) => c.columnA && c.columnB),
      })
      setResults(res)
      setFilter('all')
    } finally {
      setBusy(false)
    }
  }

  const found = useMemo(() => (results || []).filter((r) => r.matchCount > 0), [results])
  const missing = useMemo(() => (results || []).filter((r) => r.matchCount === 0), [results])
  const shown = useMemo(() => {
    if (!results) return []
    if (filter === 'found') return found
    if (filter === 'missing') return missing
    return results
  }, [results, filter, found, missing])

  // Unione colonne per lato (allineamento per nome anche con dati eterogenei).
  const colsA = useMemo(() => {
    const set = new Set<string>()
    ;(results || []).forEach((r) => Object.keys(r.rowA).forEach((k) => set.add(k)))
    return Array.from(set)
  }, [results])
  const colsB = useMemo(() => {
    const set = new Set<string>()
    ;(results || []).forEach((r) => r.matches.forEach((m) => Object.keys(m).forEach((k) => set.add(k))))
    return Array.from(set)
  }, [results])

  // Condizioni tutte negative: abbinano quasi ogni coppia → ogni riga "trovata",
  // risultato senza significato. Avviso esplicito: i negativi vanno nei filtri.
  const negativeMatch = useMemo(() => allNegativeConditions(matchConds), [matchConds])

  async function saveConds() {
    await saveConfig({ ...config, bothMatchConditions: matchConds, bothFilterConditions: filterConds })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  function exportXls() {
    if (!results) return
    // Una riga per riga di A: esito + conteggio + PRIMA corrispondenza di B.
    const rows = results.map(({ rowA, matchCount, matches }) => {
      const out: Row = { 'Esito': matchCount > 0 ? `TROVATA (${matchCount})` : 'NON TROVATA' }
      colsA.forEach((c) => { out['A: ' + c] = rowA[c] ?? '' })
      const first = matches[0]
      colsB.forEach((c) => { out['B: ' + c] = first ? (first[c] ?? '') : '' })
      return out
    })
    downloadRows(rows, 'righe_in_entrambi.xlsx')
  }

  return (
    <>
      <h1 className="page-title">Righe in Entrambi i File</h1>
      <p className="view-subtitle">
        Per ogni riga del File A dice se esiste nel File B secondo le condizioni di abbinamento; le condizioni di filtro (opzionali) restringono le corrispondenze.
      </p>
      <CompareFileBar variant="chips" />

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Condizioni di abbinamento</h2>
        <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 0, marginBottom: 14 }}>Le celle vuote non soddisfano mai una condizione (nemmeno «Diverso da»).</p>
        <CompareConditions conditions={matchConds} onChange={setMatchConds} modes={BOTH_MODE_OPTIONS} />
        {negativeMatch && (
          <p style={{ fontSize: 12, color: 'var(--c-warning, #d97706)', fontWeight: 600, marginTop: 10, marginBottom: 0 }}>
            ⚠ Tutte le condizioni di abbinamento sono negative («Diverso da»/«Non contiene»): abbinano quasi ogni coppia e ogni riga risulterà «trovata».
            Per l&apos;abbinamento usa «Uguale a»/«Contiene» (es. sul numero di polizza); le condizioni negative vanno nei <strong>filtri</strong>, per trovare coppie con un valore cambiato.
          </p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Condizioni di filtro (facoltative)</h2>
        <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 0, marginBottom: 14 }}>Restringono gli abbinamenti: es. «Diverso da» per trovare coppie con un valore cambiato.</p>
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
        {results && <button className="btn btn-secondary" onClick={exportXls}>Esporta XLS</button>}
        {results && (
          <span style={{ fontSize: 13, color: 'var(--c-text-secondary)' }}>
            <strong>{found.length}</strong> di <strong>{results.length}</strong> righe di A trovate in B · <strong>{missing.length}</strong> non trovate
          </span>
        )}
      </div>

      {results && (
        <>
          <div className="filter-tabs" style={{ marginBottom: 14 }}>
            {([
              ['all', `Tutte (${results.length})`],
              ['found', `Trovate (${found.length})`],
              ['missing', `Non trovate (${missing.length})`],
            ] as [Filter, string][]).map(([f, label]) => (
              <button key={f} className={`tab-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{label}</button>
            ))}
          </div>

          <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
            {shown.length === 0 ? (
              <div style={{ padding: 28, textAlign: 'center', color: 'var(--c-text-muted)' }}>Nessuna riga in questa categoria.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Esito</th>
                    {colsA.map((c) => <th key={'a' + c} className="col-a">A: {c}</th>)}
                    {colsB.map((c) => <th key={'b' + c} className="col-b">B: {c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {shown.map(({ rowA, matchCount, matches }, i) => {
                    const first = matches[0]
                    return (
                      <tr key={i}>
                        <td style={{ whiteSpace: 'nowrap', fontWeight: 700, color: matchCount > 0 ? 'var(--c-success)' : 'var(--c-warning, #d97706)' }}>
                          {matchCount > 0 ? `✓ Trovata${matchCount > 1 ? ` ×${matchCount}` : ''}` : '✗ Non trovata'}
                        </td>
                        {colsA.map((c) => <td key={'a' + c}>{String(rowA[c] ?? '')}</td>)}
                        {colsB.map((c) => <td key={'b' + c}>{first ? String(first[c] ?? '') : ''}</td>)}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
          {found.some((r) => r.matchCount > 1) && (
            <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 8 }}>
              Le righe «×N» hanno più corrispondenze in B: qui e nell&apos;export si mostra la prima. Per vedere tutte le corrispondenze di una riga usa la pagina Ricerca.
            </p>
          )}
        </>
      )}
    </>
  )
}
