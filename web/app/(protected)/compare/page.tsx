'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useCompare } from '@/lib/compare/CompareProvider'
import CompareFileBar from '@/components/CompareFileBar'
import { sheetRows, clampThresholds, type CompareResult, type EqualResult, type FuzzyPair, type FuzzyOpts, type Row } from '@/lib/compare/engine'
import { runInWorker } from '@/lib/compare/runWorker'
import { downloadRows } from '@/lib/compare/xlsx'

// COMPARAZIONE con due modalità sugli stessi criteri (chiavi + somiglianza +
// soglie, tutti in Configurazione):
//  - Differenze: righe solo in A / solo in B (la comparazione storica)
//  - Uguale a:   per ogni riga di A, se esiste in B (ex «Confronto righe»)
// In entrambe le coppie simili finiscono in «Da verificare» (tra le due soglie)
// o in «Accettate» (sopra la soglia alta, oppure confermate a mano).

type Mode = 'diff' | 'equal'
type DiffFilter = 'all' | 'only-a' | 'only-b' | 'fuzzy' | 'accepted'
type EqualFilter = 'all' | 'found' | 'missing' | 'fuzzy' | 'accepted'

// Coppia nella UI: `manual` = confermata a mano da «Da verificare».
type UiPair = FuzzyPair & { manual?: boolean }
type DiffView = Omit<CompareResult, 'accepted' | 'fuzzy'> & { fuzzy: UiPair[]; accepted: UiPair[] }
type EqualView = Omit<EqualResult, 'accepted' | 'fuzzy'> & { fuzzy: UiPair[]; accepted: UiPair[] }

export default function ComparePage() {
  const { fileA, fileB, setFileA, setFileB, config } = useCompare()
  const [mode, setMode] = useState<Mode>('diff')
  const [diff, setDiff] = useState<DiffView | null>(null)
  const [equal, setEqual] = useState<EqualView | null>(null)
  const [diffFilter, setDiffFilter] = useState<DiffFilter>('all')
  const [equalFilter, setEqualFilter] = useState<EqualFilter>('all')
  const [busy, setBusy] = useState<Mode | null>(null)

  const enabledKeys = useMemo(() => config.matchKeys.filter((k) => k.enabled !== false && (k.columnA || k.column)), [config.matchKeys])
  const { low, high } = clampThresholds(config.fuzzyThresholdLow, config.fuzzyThresholdHigh)

  const fuzzyOpts: FuzzyOpts = {
    enabled: config.fuzzyEnabled,
    minOverlap: config.fuzzyMinOverlap,
    ignoreWords: config.fuzzyIgnoreWords,
    broadEnabled: config.fuzzyBroadEnabled,
    broadMinOverlap: config.fuzzyMinOverlapBroad,
    thresholdLow: low,
    thresholdHigh: high,
  }

  async function run(m: Mode) {
    if (!fileA || !fileB) return
    const dataA = sheetRows(fileA.wb, enabledKeys, 'a')
    const dataB = sheetRows(fileB.wb, enabledKeys, 'b')
    setMode(m)
    setBusy(m)
    try {
      if (m === 'diff') {
        const res = await runInWorker<CompareResult>({ kind: 'compare', dataA, dataB, keys: enabledKeys, fuzzy: fuzzyOpts })
        setDiff(res)
        setDiffFilter('all')
      } else {
        const res = await runInWorker<EqualResult>({ kind: 'equal', dataA, dataB, keys: enabledKeys, fuzzy: fuzzyOpts })
        setEqual(res)
        setEqualFilter('all')
      }
    } finally {
      setBusy(null)
    }
  }

  function reset() {
    setFileA(null)
    setFileB(null)
    setDiff(null)
    setEqual(null)
    setDiffFilter('all')
    setEqualFilter('all')
  }

  // Decisioni sulle coppie. Differenze: ✗ = righe in Solo in A / Solo in B
  // (diffA/diffB). Uguale a: ✗ = la riga di A resta «Non in B». ✓ = coppia in
  // «Accettate» (manuale). «Rimanda a verifica» riporta una accettata indietro.
  function decideDiff(idx: number, kind: 'accept' | 'reject') {
    setDiff((r) => {
      if (!r || !r.fuzzy[idx]) return r
      const pair = r.fuzzy[idx]
      const fuzzy = r.fuzzy.filter((_, i) => i !== idx)
      if (kind === 'accept') return { ...r, fuzzy, accepted: [...r.accepted, { ...pair, manual: true }] }
      return { ...r, fuzzy, diffA: [...r.diffA, pair.rowA], diffB: [...r.diffB, pair.rowB] }
    })
  }
  function sendBackDiff(idx: number) {
    setDiff((r) => (r && r.accepted[idx] ? { ...r, accepted: r.accepted.filter((_, i) => i !== idx), fuzzy: [...r.fuzzy, { ...r.accepted[idx], manual: false }] } : r))
  }
  function decideEqual(idx: number, kind: 'accept' | 'reject') {
    setEqual((r) => {
      if (!r || !r.fuzzy[idx]) return r
      const pair = r.fuzzy[idx]
      const fuzzy = r.fuzzy.filter((_, i) => i !== idx)
      return kind === 'accept' ? { ...r, fuzzy, accepted: [...r.accepted, { ...pair, manual: true }] } : { ...r, fuzzy }
    })
  }
  function sendBackEqual(idx: number) {
    setEqual((r) => (r && r.accepted[idx] ? { ...r, accepted: r.accepted.filter((_, i) => i !== idx), fuzzy: [...r.fuzzy, { ...r.accepted[idx], manual: false }] } : r))
  }

  const fa = fileA?.name || 'File A'
  const fb = fileB?.name || 'File B'

  /* ─── Differenze ─────────────────────────────────────────────────────── */
  const countA = diff ? diff.onlyA.length + diff.diffA.length : 0
  const countB = diff ? diff.onlyB.length + diff.diffB.length : 0

  const diffRows: Array<Row & { __source: 'A' | 'B' }> = useMemo(() => {
    if (!diff) return []
    const a = [...diff.onlyA, ...diff.diffA].map((r) => ({ ...r, __source: 'A' as const }))
    const b = [...diff.onlyB, ...diff.diffB].map((r) => ({ ...r, __source: 'B' as const }))
    if (diffFilter === 'only-a') return a
    if (diffFilter === 'only-b') return b
    return [...a, ...b]
  }, [diff, diffFilter])

  const diffColumns = useMemo(() => unionColumns(diffRows, ['__source']), [diffRows])

  function exportDiff() {
    if (!diff) return
    const rows = [
      ...diff.onlyA.map((r) => ({ Origine: `Solo in A (${fa})`, ...r })),
      ...diff.diffA.map((r) => ({ Origine: `Solo in A — verificato (${fa})`, ...r })),
      ...diff.onlyB.map((r) => ({ Origine: `Solo in B (${fb})`, ...r })),
      ...diff.diffB.map((r) => ({ Origine: `Solo in B — verificato (${fb})`, ...r })),
      ...pairExportRows(diff.fuzzy, 'Da verificare', fa, fb, 0),
      ...pairExportRows(diff.accepted, 'Accettata', fa, fb, diff.fuzzy.length),
    ]
    downloadRows(rows, 'differenze_portafogli.xlsx')
  }

  /* ─── Uguale a ───────────────────────────────────────────────────────── */
  // Esito di ogni riga di A: esatta, accettata (auto/manuale), da verificare,
  // non in B. Le righe arrivano dal worker con i riferimenti condivisi
  // (structured clone), quindi rowA delle coppie è la stessa riga di rows[].
  const equalRows = useMemo(() => {
    if (!equal) return []
    const acc = new Map<Row, UiPair>()
    equal.accepted.forEach((p) => acc.set(p.rowA, p))
    const pend = new Map<Row, UiPair>()
    equal.fuzzy.forEach((p) => pend.set(p.rowA, p))
    return equal.rows.map((r) => {
      if (r.matchCount > 0) return { ...r, status: 'exact' as const, rowB: r.matches[0] as Row | undefined, pair: undefined as UiPair | undefined }
      const a = acc.get(r.rowA)
      if (a) return { ...r, status: 'accepted' as const, rowB: a.rowB, pair: a }
      const p = pend.get(r.rowA)
      if (p) return { ...r, status: 'fuzzy' as const, rowB: p.rowB, pair: p }
      return { ...r, status: 'missing' as const, rowB: undefined, pair: undefined }
    })
  }, [equal])

  const foundRows = equalRows.filter((r) => r.status === 'exact' || r.status === 'accepted')
  const missingRows = equalRows.filter((r) => r.status === 'missing')
  const shownEqual = equalFilter === 'found' ? foundRows : equalFilter === 'missing' ? missingRows : equalRows
  const colsA = useMemo(() => unionColumns(equalRows.map((r) => r.rowA)), [equalRows])
  const colsB = useMemo(() => unionColumns(equalRows.flatMap((r) => (r.rowB ? [r.rowB] : []))), [equalRows])

  function esito(r: (typeof equalRows)[number]): string {
    if (r.status === 'exact') return r.matchCount > 1 ? `✓ Uguale ×${r.matchCount}` : '✓ Uguale'
    if (r.status === 'accepted') return `✓ Accettata ${r.pair?.score ?? ''}%${r.pair?.manual ? ' (verificata)' : ''}`
    if (r.status === 'fuzzy') return `? Da verificare ${r.pair?.score ?? ''}%`
    return '✗ Non in B'
  }

  function exportEqual() {
    if (!equal) return
    const rows = equalRows.map((r) => {
      const out: Row = { Esito: esito(r).replace(/^[✓✗?]\s*/, ''), 'Somiglianza %': r.pair ? r.pair.score : '' }
      colsA.forEach((c) => { out['A: ' + c] = r.rowA[c] ?? '' })
      colsB.forEach((c) => { out['B: ' + c] = r.rowB ? (r.rowB[c] ?? '') : '' })
      return out
    })
    downloadRows(rows, 'uguale_a_esiti.xlsx')
  }

  const hasResult = mode === 'diff' ? !!diff : !!equal
  const fuzzyList = mode === 'diff' ? diff?.fuzzy ?? [] : equal?.fuzzy ?? []
  const acceptedList = mode === 'diff' ? diff?.accepted ?? [] : equal?.accepted ?? []
  const filter = mode === 'diff' ? diffFilter : equalFilter
  const autoCount = acceptedList.filter((p) => !p.manual).length

  return (
    <>
      <h1 className="page-title">Comparazione Portafogli</h1>
      <p className="view-subtitle">
        Carica due file Excel. <strong>Differenze</strong> trova le polizze che stanno in un solo file;
        <strong> Uguale a</strong> dice, riga per riga, se ogni polizza del File A esiste anche nel File B.
      </p>
      <CompareFileBar />

      <p style={{ fontSize: 12, color: 'var(--c-text-muted)', margin: '0 0 14px' }}>
        Criteri attivi: <strong>{enabledKeys.length}</strong> chiavi ·{' '}
        {config.fuzzyEnabled ? <>somiglianza: scartate sotto <strong>{low}%</strong>, accettate da <strong>{high}%</strong></> : 'somiglianza spenta'}
        {' · '}<Link href="/compare/settings" style={{ color: 'var(--c-accent, inherit)', textDecoration: 'underline' }}>modifica in Configurazione</Link>
      </p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <button className={`btn ${mode === 'diff' && diff ? 'btn-primary' : 'btn-secondary'}`} onClick={() => run('diff')} disabled={!fileA || !fileB || !!busy}>
          {busy === 'diff' ? <><span className="spinner" /> Analisi in corso…</> : 'Differenze'}
        </button>
        <button className={`btn ${mode === 'equal' && equal ? 'btn-primary' : 'btn-secondary'}`} onClick={() => run('equal')} disabled={!fileA || !fileB || !!busy}>
          {busy === 'equal' ? <><span className="spinner" /> Analisi in corso…</> : 'Uguale a'}
        </button>
        {(fileA || fileB || diff || equal) && <button className="btn btn-secondary" onClick={reset}>Azzera</button>}
        {hasResult && <button className="btn btn-secondary" onClick={mode === 'diff' ? exportDiff : exportEqual}>Esporta XLS</button>}
        {mode === 'diff' && diff && (
          <span style={{ fontSize: 13, color: 'var(--c-text-secondary)' }}>
            <strong>{countA + countB}</strong> differenze — <strong>{countA}</strong> solo in A, <strong>{countB}</strong> solo in B
            {fuzzyList.length ? <>, <strong>{fuzzyList.length}</strong> da verificare</> : null}
            {autoCount ? <>, <strong>{autoCount}</strong> accettate automaticamente</> : null}
          </span>
        )}
        {mode === 'equal' && equal && (
          <span style={{ fontSize: 13, color: 'var(--c-text-secondary)' }}>
            <strong>{foundRows.length}</strong> di <strong>{equalRows.length}</strong> righe di A presenti in B · <strong>{missingRows.length}</strong> non in B
            {fuzzyList.length ? <> · <strong>{fuzzyList.length}</strong> da verificare</> : null}
          </span>
        )}
      </div>

      {!hasResult && !busy && (
        <div className="state-box">
          <svg viewBox="0 0 24 24"><path d="M9 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M15 3h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4M9 3v18M15 3v18" /></svg>
          <p>Carica i due file e scegli <strong>Differenze</strong> o <strong>Uguale a</strong>.</p>
        </div>
      )}

      {busy && !hasResult && (
        <div className="state-box"><span className="spinner-lg" /><p>Analisi in corso…</p></div>
      )}

      {hasResult && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="filter-tabs">
              {(mode === 'diff'
                ? ([
                    ['all', `Tutte (${countA + countB})`, false],
                    ['only-a', `Solo in A (${countA})`, false],
                    ['only-b', `Solo in B (${countB})`, false],
                    ['fuzzy', 'Da verificare', true],
                    ['accepted', `Accettate (${acceptedList.length})`, false],
                  ] as [DiffFilter, string, boolean][])
                : ([
                    ['all', `Tutte (${equalRows.length})`, false],
                    ['found', `Uguali in B (${foundRows.length})`, false],
                    ['missing', `Non in B (${missingRows.length})`, false],
                    ['fuzzy', 'Da verificare', true],
                    ['accepted', `Accettate (${acceptedList.length})`, false],
                  ] as [EqualFilter, string, boolean][])
              ).map(([f, label, isFuzzy]) => (
                <button
                  key={f}
                  className={`tab-btn ${isFuzzy ? 'tab-btn--fuzzy' : ''} ${filter === f ? 'active' : ''}`}
                  onClick={() => (mode === 'diff' ? setDiffFilter(f as DiffFilter) : setEqualFilter(f as EqualFilter))}
                >
                  {label}
                  {isFuzzy ? <span className="tab-badge">{fuzzyList.length}</span> : null}
                </button>
              ))}
            </div>
          </div>

          {filter === 'fuzzy' && (
            <PairTable
              pairs={fuzzyList}
              variant="verify"
              fileAName={fa}
              fileBName={fb}
              onAccept={(i) => (mode === 'diff' ? decideDiff(i, 'accept') : decideEqual(i, 'accept'))}
              onReject={(i) => (mode === 'diff' ? decideDiff(i, 'reject') : decideEqual(i, 'reject'))}
            />
          )}

          {filter === 'accepted' && (
            <PairTable
              pairs={acceptedList}
              variant="accepted"
              fileAName={fa}
              fileBName={fb}
              onSendBack={(i) => (mode === 'diff' ? sendBackDiff(i) : sendBackEqual(i))}
            />
          )}

          {mode === 'diff' && filter !== 'fuzzy' && filter !== 'accepted' && (
            <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
              {diffRows.length === 0 ? (
                <div style={{ padding: 28, textAlign: 'center', color: 'var(--c-text-muted)' }}>Nessun risultato</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Origine</th>
                      {diffColumns.map((c) => <th key={c}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {diffRows.map((row, i) => (
                      <tr key={i} className={row.__source === 'A' ? 'row-only-a' : 'row-only-b'}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span className={`badge-origin ${row.__source === 'A' ? 'badge-a' : 'badge-b'}`}>{row.__source}</span>
                          <span style={{ color: 'var(--c-text-muted)', fontSize: 12, marginLeft: 6 }}>— {row.__source === 'A' ? fa : fb}</span>
                        </td>
                        {diffColumns.map((c) => <td key={c} title={String(row[c] ?? '')}>{String(row[c] ?? '')}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {mode === 'equal' && filter !== 'fuzzy' && filter !== 'accepted' && (
            <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
              {shownEqual.length === 0 ? (
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
                    {shownEqual.map((r, i) => (
                      <tr key={i} className={r.status === 'missing' ? 'row-only-a' : ''}>
                        <td className={r.status === 'exact' || r.status === 'accepted' ? 'score-ok' : r.status === 'fuzzy' ? 'score-mid' : 'score-ko'} style={{ whiteSpace: 'nowrap' }}>
                          {esito(r)}
                        </td>
                        {colsA.map((c) => <td key={'a' + c} title={String(r.rowA[c] ?? '')}>{String(r.rowA[c] ?? '')}</td>)}
                        {colsB.map((c) => <td key={'b' + c} title={r.rowB ? String(r.rowB[c] ?? '') : ''}>{r.rowB ? String(r.rowB[c] ?? '') : ''}</td>)}
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

function unionColumns(rows: Row[], skip: string[] = []): string[] {
  const set = new Set<string>()
  rows.forEach((r) => Object.keys(r).forEach((k) => { if (!skip.includes(k)) set.add(k) }))
  return Array.from(set)
}

// Coppie nell'export: due righe consecutive (A e B) legate da «Coppia».
function pairExportRows(pairs: UiPair[], label: string, fa: string, fb: string, offset: number): Row[] {
  return pairs.flatMap((p, i) => {
    const tag = label === 'Accettata' ? (p.manual ? 'Accettata dopo verifica' : 'Accettata automaticamente') : label
    return [
      { Origine: `${tag} — A (${fa})`, Coppia: offset + i + 1, 'Somiglianza %': p.score, ...p.rowA },
      { Origine: `${tag} — B (${fb})`, Coppia: offset + i + 1, 'Somiglianza %': p.score, ...p.rowB },
    ]
  })
}

// Tabella delle coppie (Da verificare / Accettate), con la stessa struttura
// della tabella risultati: per ogni coppia la riga di A e sotto quella di B,
// a sinistra la somiglianza e le azioni.
function PairTable({ pairs, variant, fileAName, fileBName, onAccept, onReject, onSendBack }: {
  pairs: UiPair[]
  variant: 'verify' | 'accepted'
  fileAName: string
  fileBName: string
  onAccept?: (idx: number) => void
  onReject?: (idx: number) => void
  onSendBack?: (idx: number) => void
}) {
  const columns = useMemo(() => unionColumns(pairs.flatMap((p) => [p.rowA, p.rowB])), [pairs])
  if (!pairs.length) {
    return (
      <div className="fuzzy-empty">
        <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        {variant === 'verify' ? 'Nessuna coppia da verificare — tutte le decisioni sono state prese.' : 'Nessuna coppia accettata.'}
      </div>
    )
  }
  return (
    <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
      <table>
        <thead>
          <tr>
            <th>Somiglianza</th>
            <th>Origine</th>
            {columns.map((c) => <th key={c}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {pairs.map((p, idx) => {
            const band = variant === 'accepted' ? 'ok' : 'mid'
            return [
              <tr key={idx + 'a'} className={`row-only-a pair-start ${p.kind === 'broad' ? 'pair-broad' : ''}`}>
                <td rowSpan={2} className="pair-cell">
                  <span className={`pair-score score-${band}`}>{p.score}%</span>
                  <span className="pair-kind">
                    {p.kind === 'broad' ? 'altre colonne' : 'chiavi'}
                    {variant === 'accepted' ? (p.manual ? ' · verificata' : ' · automatica') : ''}
                  </span>
                  <div className="pair-actions">
                    {variant === 'verify' ? (
                      <>
                        <button className="btn-fuzzy btn-fuzzy-same" onClick={() => onAccept?.(idx)}>✓ Stessa polizza</button>
                        <button className="btn-fuzzy btn-fuzzy-diff" onClick={() => onReject?.(idx)}>✗ Polizze diverse</button>
                      </>
                    ) : (
                      <button className="btn-fuzzy btn-fuzzy-diff" onClick={() => onSendBack?.(idx)}>↩ Rimanda a verifica</button>
                    )}
                  </div>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className="badge-origin badge-a">A</span>
                  <span style={{ color: 'var(--c-text-muted)', fontSize: 12, marginLeft: 6 }}>— {fileAName}</span>
                </td>
                {columns.map((c) => <td key={c} title={String(p.rowA[c] ?? '')}>{String(p.rowA[c] ?? '')}</td>)}
              </tr>,
              <tr key={idx + 'b'} className="row-only-b">
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className="badge-origin badge-b">B</span>
                  <span style={{ color: 'var(--c-text-muted)', fontSize: 12, marginLeft: 6 }}>— {fileBName}</span>
                </td>
                {columns.map((c) => <td key={c} title={String(p.rowB[c] ?? '')}>{String(p.rowB[c] ?? '')}</td>)}
              </tr>,
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}
