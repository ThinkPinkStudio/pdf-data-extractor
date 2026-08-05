'use client'

import { useEffect, useMemo, useState } from 'react'
import { useCompare } from '@/lib/compare/CompareProvider'
import CompareFileBar from '@/components/CompareFileBar'
import CompareConditions from '@/components/CompareConditions'
import CompareProfiles from '@/components/CompareProfiles'
import { sheetRows, allNegativeConditions, applyRowsProfile, rowsProfileFrom, BOTH_MODE_OPTIONS, type BothRowResult, type Condition, type RowsProfile, type Row } from '@/lib/compare/engine'
import { runInWorker } from '@/lib/compare/runWorker'
import { downloadRows } from '@/lib/compare/xlsx'

type Filter = 'all' | 'found' | 'missing'
type View = 'verdict' | 'detail'

// "CONFRONTO RIGHE" — fusione delle vecchie pagine Ricerca e In Entrambi, che
// erano due viste della STESSA operazione (abbinare le righe di A a B secondo
// condizioni) con condizioni salvate in due posti diversi. Un solo set di
// condizioni, due viste sui risultati:
//  - Esito per riga: «questa riga di A esiste in B?» (✓/✗, prima corrispondenza)
//  - Dettaglio corrispondenze: tutte le righe B abbinate a ciascuna riga A
// Il vecchio /compare/search reindirizza qui.

// JSON importato che contiene UN solo profilo invece di un dizionario: o un
// oggetto con le condizioni, o (interop) un semplice array di condizioni.
function parseRowsProfile(parsed: unknown): RowsProfile | null {
  if (Array.isArray(parsed)) {
    const conds = parsed as Condition[]
    return conds.length && typeof conds[0] === 'object' && 'columnA' in conds[0]
      ? { bothMatchConditions: conds, bothFilterConditions: [] }
      : null
  }
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as RowsProfile).bothMatchConditions)) {
    const p = parsed as RowsProfile
    return { bothMatchConditions: p.bothMatchConditions, bothFilterConditions: Array.isArray(p.bothFilterConditions) ? p.bothFilterConditions : [] }
  }
  return null
}

export default function CompareBothPage() {
  const { fileA, fileB, config, saveConfig } = useCompare()
  const [matchConds, setMatchConds] = useState<Condition[]>(config.bothMatchConditions)
  const [filterConds, setFilterConds] = useState<Condition[]>(config.bothFilterConditions)
  const [results, setResults] = useState<BothRowResult[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [view, setView] = useState<View>('verdict')
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
    downloadRows(rows, 'confronto_righe_esiti.xlsx')
  }

  // Export in stile «Ricerca»: una riga per CORRISPONDENZA (fino al tetto del
  // motore per riga), con il conteggio totale sempre onesto in colonna.
  function exportMatchesXls() {
    if (!results) return
    const rows: Row[] = []
    results.forEach(({ rowA, matchCount, matches }) => {
      if (!matchCount) {
        const out: Row = { 'Esito': 'NON TROVATA', 'Corrispondenze totali': 0 }
        colsA.forEach((c) => { out['A: ' + c] = rowA[c] ?? '' })
        rows.push(out)
        return
      }
      matches.forEach((m) => {
        const out: Row = { 'Esito': 'TROVATA', 'Corrispondenze totali': matchCount }
        colsA.forEach((c) => { out['A: ' + c] = rowA[c] ?? '' })
        colsB.forEach((c) => { out['B: ' + c] = m[c] ?? '' })
        rows.push(out)
      })
    })
    downloadRows(rows, 'confronto_righe_corrispondenze.xlsx')
  }

  return (
    <>
      <h1 className="page-title">Confronto righe (A in B)</h1>
      <p className="view-subtitle">
        Per ogni riga del File A dice se esiste nel File B secondo le condizioni di abbinamento; la vista Dettaglio mostra tutte le corrispondenze. Le condizioni di filtro (opzionali) restringono gli abbinamenti.
      </p>
      <CompareFileBar variant="chips" />

      {/* Profili di QUESTA pagina: solo le condizioni. Indipendenti da quelli
          della Comparazione (chiave di impostazioni e lista separate). */}
      <CompareProfiles<RowsProfile>
        settingsKey="compareBothProfiles"
        fileName="profili_confronto_righe.json"
        hint="Condizioni di abbinamento e di filtro di questa pagina. Sono indipendenti dai profili della Comparazione."
        snapshot={() => rowsProfileFrom({ bothMatchConditions: matchConds, bothFilterConditions: filterConds })}
        onLoad={(p) => {
          const next = applyRowsProfile(config, p)
          setMatchConds(next.bothMatchConditions)
          setFilterConds(next.bothFilterConditions)
          saveConfig(next)
        }}
        parseSingle={parseRowsProfile}
      />

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
        {results && <button className="btn btn-secondary" onClick={exportXls}>Esporta esiti (XLS)</button>}
        {results && <button className="btn btn-secondary" onClick={exportMatchesXls}>Esporta corrispondenze (XLS)</button>}
        {results && (
          <span style={{ fontSize: 13, color: 'var(--c-text-secondary)' }}>
            <strong>{found.length}</strong> di <strong>{results.length}</strong> righe di A trovate in B · <strong>{missing.length}</strong> non trovate
          </span>
        )}
      </div>

      {results && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="filter-tabs">
              {([
                ['all', `Tutte (${results.length})`],
                ['found', `Trovate (${found.length})`],
                ['missing', `Non trovate (${missing.length})`],
              ] as [Filter, string][]).map(([f, label]) => (
                <button key={f} className={`tab-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{label}</button>
              ))}
            </div>
            {/* Vista: Esito compatto (ex In Entrambi) o Dettaglio corrispondenze (ex Ricerca) */}
            <div className="filter-tabs">
              {([
                ['verdict', 'Esito per riga'],
                ['detail', 'Dettaglio corrispondenze'],
              ] as [View, string][]).map(([v, label]) => (
                <button key={v} className={`tab-btn ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>{label}</button>
              ))}
            </div>
          </div>

          {view === 'verdict' && (
            <>
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
                  Le righe «×N» hanno più corrispondenze in B: qui si mostra la prima — passa alla vista «Dettaglio corrispondenze» per vederle tutte.
                </p>
              )}
            </>
          )}

          {view === 'detail' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {shown.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', color: 'var(--c-text-muted)' }}>Nessuna riga in questa categoria.</div>
              ) : (
                shown.map(({ rowA, matchCount, matches }, i) => (
                  <div key={i} className="card">
                    <div style={{ fontSize: 12, color: matchCount ? 'var(--c-text-muted)' : 'var(--c-warning)', marginBottom: 6, textTransform: 'uppercase' }}>
                      Riga A · {matchCount ? `${matchCount} corrispondenze` : 'nessuna corrispondenza'}
                    </div>
                    <div style={{ fontSize: 13, marginBottom: matchCount ? 10 : 0 }}>{Object.entries(rowA).map(([k, v]) => `${k}: ${v ?? ''}`).join('  ·  ')}</div>
                    {matches.length > 0 && (
                      <div style={{ overflowX: 'auto' }}>
                        <table>
                          <thead><tr>{colsB.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                          <tbody>
                            {matches.map((m, j) => (
                              <tr key={j}>{colsB.map((c) => <td key={c}>{String(m[c] ?? '')}</td>)}</tr>
                            ))}
                          </tbody>
                        </table>
                        {matchCount > matches.length && (
                          <p style={{ fontSize: 11, color: 'var(--c-text-muted)', margin: '6px 0 0' }}>
                            …e altre {matchCount - matches.length} corrispondenze. Così tante per una sola riga indicano una condizione troppo lasca.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}
