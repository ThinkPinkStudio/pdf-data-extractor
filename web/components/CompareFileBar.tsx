'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useCompare } from '@/lib/compare/CompareProvider'
import { readWorkbook } from '@/lib/compare/xlsx'

// Barra di caricamento dei due file Excel (A/B). Condivisa tra Comparazione,
// Ricerca e In Entrambi: i file caricati restano in memoria (context) mentre si
// naviga nella sezione.
//
// Due varianti (come l'app desktop):
//  - "full"  (default): due file-card con icona, pulsante "Sfoglia…", drop hint
//             e freccia di confronto tra le due. Usata in Comparazione.
//  - "chips": stato compatto dei file già caricati + link "vai a Comparazione".
//             Usata in Ricerca e In Entrambi (dove i file NON si caricano).
export default function CompareFileBar({ variant = 'full' }: { variant?: 'full' | 'chips' }) {
  const { fileA, fileB, setFileA, setFileB } = useCompare()
  const refA = useRef<HTMLInputElement>(null)
  const refB = useRef<HTMLInputElement>(null)
  const [err, setErr] = useState<string | null>(null)
  const [dragWhich, setDrag] = useState<'a' | 'b' | null>(null)

  async function load(which: 'a' | 'b', file: File | undefined) {
    if (!file) return
    setErr(null)
    try {
      const wb = await readWorkbook(file)
      const loaded = { name: file.name, wb }
      if (which === 'a') setFileA(loaded)
      else setFileB(loaded)
    } catch {
      setErr('Impossibile leggere il file: ' + file.name)
    }
  }

  if (variant === 'chips') {
    const Chip = ({ label, loaded }: { label: string; loaded: typeof fileA }) =>
      loaded ? (
        <div className="search-file-chip">
          <strong>{label}</strong> {loaded.name} · {(loaded.wb.length ?? 0).toLocaleString('it-IT')} righe
        </div>
      ) : (
        <div className="search-file-chip missing">
          <strong>{label}</strong> nessun file — <Link href="/compare" className="go-to-compare">vai a Comparazione</Link>
        </div>
      )
    return (
      <div className="search-files-status" style={{ marginBottom: 20 }}>
        <Chip label="File A:" loaded={fileA} />
        <Chip label="File B:" loaded={fileB} />
      </div>
    )
  }

  const Card = ({ which, loaded, inputRef }: { which: 'a' | 'b'; loaded: typeof fileA; inputRef: React.RefObject<HTMLInputElement | null> }) => (
    <div
      className={`file-card ${loaded ? 'loaded' : ''} ${dragWhich === which ? 'drag-over' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(which) }}
      onDragLeave={() => setDrag(null)}
      onDrop={(e) => { e.preventDefault(); setDrag(null); load(which, e.dataTransfer.files[0]) }}
    >
      <div className="file-card-label">File {which.toUpperCase()}</div>
      <div className="file-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
      </div>
      {loaded ? (
        <>
          <div className="file-name">{loaded.name}</div>
          <div className="file-meta">
            {(loaded.wb.length ?? 0).toLocaleString('it-IT')} righe
            {loaded.wb.sheetNames.length > 1 ? ` · ${loaded.wb.sheetNames.length} fogli` : ''}
          </div>
        </>
      ) : (
        <div className="file-meta">Nessun file selezionato</div>
      )}
      <button type="button" className="btn-browse" onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}>Sfoglia…</button>
      <div className="drop-hint">oppure trascina qui il file</div>
      <input ref={inputRef} type="file" accept=".xlsx,.xls,.xlsm" style={{ display: 'none' }} onChange={(e) => load(which, e.target.files?.[0])} />
    </div>
  )

  return (
    <div style={{ marginBottom: 20 }}>
      <div className="file-row">
        <Card which="a" loaded={fileA} inputRef={refA} />
        <div className="compare-arrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
        </div>
        <Card which="b" loaded={fileB} inputRef={refB} />
      </div>
      {err && <div className="alert alert-error" style={{ marginTop: 12 }}>{err}</div>}
    </div>
  )
}
