'use client'

import { useRef, useState } from 'react'
import { useCompare } from '@/lib/compare/CompareProvider'
import { readWorkbook } from '@/lib/compare/xlsx'

// Barra di caricamento dei due file Excel (A/B). Condivisa tra Comparazione,
// Ricerca e In Entrambi: i file caricati restano in memoria (context) mentre
// si naviga nella sezione.
export default function CompareFileBar() {
  const { fileA, fileB, setFileA, setFileB } = useCompare()
  const refA = useRef<HTMLInputElement>(null)
  const refB = useRef<HTMLInputElement>(null)
  const [err, setErr] = useState<string | null>(null)

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

  const Card = ({ which, loaded, inputRef }: { which: 'a' | 'b'; loaded: typeof fileA; inputRef: React.RefObject<HTMLInputElement | null> }) => (
    <div
      className="card"
      style={{ flex: 1, minWidth: 240, cursor: 'pointer', borderStyle: loaded ? 'solid' : 'dashed' }}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        load(which, e.dataTransfer.files[0])
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
        File {which.toUpperCase()}
      </div>
      {loaded ? (
        <>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{loaded.name}</div>
          <div style={{ fontSize: 12, color: 'var(--c-text-secondary)', marginTop: 2 }}>
            {(loaded.wb.length ?? 0).toLocaleString('it-IT')} righe
            {loaded.wb.sheetNames.length > 1 ? ` · ${loaded.wb.sheetNames.length} fogli` : ''}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 14, color: 'var(--c-text-secondary)' }}>Trascina un Excel o clicca per selezionare</div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.xlsm"
        style={{ display: 'none' }}
        onChange={(e) => load(which, e.target.files?.[0])}
      />
    </div>
  )

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Card which="a" loaded={fileA} inputRef={refA} />
        <Card which="b" loaded={fileB} inputRef={refB} />
      </div>
      {err && <div className="alert alert-error" style={{ marginTop: 12 }}>{err}</div>}
    </div>
  )
}
