'use client'

import { useState, useRef, useEffect } from 'react'

// ─── Icone inline (identiche all'app) ─────────────────────────────────────────
const IconUpload = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)
const IconFile = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
  </svg>
)
const IconX = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)
const IconExcel = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" />
  </svg>
)
const IconSpinner = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }}>
    <circle cx="12" cy="12" r="10" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
  </svg>
)

interface PolizzaField { id: string; label: string; description?: string; enabled?: boolean }
interface Source { file: string; page: string }
interface RollingProgress {
  docIndex: number; docTotal: number; pageIndex: number; pageTotal: number
  docName: string; totalPagesProcessed: number; receivedAt?: number
}

function ExtractedTable({ fields, data, sources, onUpdate }: {
  fields: PolizzaField[]
  data: Record<string, string>
  sources: Record<string, Source>
  onUpdate: (id: string, val: string) => void
}) {
  return (
    <table className="polizza-table">
      <thead>
        <tr>
          <th style={{ width: '32%' }}>Campo</th>
          <th>Valore estratto (modificabile)</th>
          <th style={{ width: '22%', whiteSpace: 'nowrap' }}>Sorgente</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((f) => {
          const val = data[f.id]
          const isEmpty = val === null || val === undefined || val === ''
          const src = sources?.[f.id]
          return (
            <tr key={f.id}>
              <td title={f.description}>{f.label}</td>
              <td className={isEmpty ? 'value-null' : 'value-ok'}>
                {isEmpty ? (
                  <span style={{ color: 'var(--c-text-muted)', fontStyle: 'italic' }}>—</span>
                ) : (
                  <input className="editable-cell" value={val ?? ''} onChange={(e) => onUpdate(f.id, e.target.value)} aria-label={f.label} />
                )}
              </td>
              <td style={{ fontSize: 11, color: src ? 'var(--c-text-secondary)' : 'var(--c-text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }} title={src ? `${src.file} · pag. ${src.page}` : ''}>
                {src ? (
                  <span>{src.file}<br /><span style={{ color: 'var(--c-text-muted)' }}>pag. {src.page}</span></span>
                ) : (
                  <span style={{ fontStyle: 'italic' }}>—</span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default function PolizzaPage() {
  const [files, setFiles] = useState<{ name: string; file: File }[]>([])
  const [dragging, setDragging] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState<Record<string, string> | null>(null)
  const [sources, setSources] = useState<Record<string, Source>>({})
  const [fields, setFields] = useState<PolizzaField[]>([])
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const [rollingProgress, setRollingProgress] = useState<RollingProgress | null>(null)
  const [, setLivenessTick] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/polizza/fields').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.all) setFields(d.all) }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!extracting) return
    const t = setInterval(() => setLivenessTick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [extracting])

  const liveSecs = (p: RollingProgress | null) => {
    if (!p?.receivedAt) return ''
    const s = Math.max(0, Math.floor((Date.now() - p.receivedAt) / 1000))
    return s >= 2 ? ` · in analisi da ${s}s` : ''
  }

  const addFiles = (list: FileList | File[]) => {
    const pdfs = Array.from(list).filter((f) => /\.pdf$/i.test(f.name))
    setFiles((prev) => {
      const names = new Set(prev.map((p) => p.name))
      return [...prev, ...pdfs.filter((f) => !names.has(f.name)).map((f) => ({ name: f.name, file: f }))]
    })
  }
  const openFilePicker = () => inputRef.current?.click()
  const removeFile = (name: string) => setFiles((prev) => prev.filter((f) => f.name !== name))
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true) }
  const onDragLeave = () => setDragging(false)
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragging(false); if (e.dataTransfer?.files) addFiles(e.dataTransfer.files) }

  const visibleFields = fields.filter((f) => f.enabled !== false)

  async function handleExtract() {
    if (!files.length || extracting) return
    setExtracting(true); setError(null); setExtracted(null); setSources({}); setRollingProgress(null); setExportMsg(null)
    try {
      const form = new FormData()
      files.forEach((f) => form.append('pdf', f.file, f.name))
      const res = await fetch('/api/polizza/stream', { method: 'POST', body: form })
      if (!res.ok || !res.body) throw new Error('Errore avvio estrazione')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const line = frame.startsWith('data: ') ? frame.slice(6) : frame
          if (!line.trim()) continue
          const evt = JSON.parse(line)
          if (evt.type === 'progress') setRollingProgress({ ...evt.progress, receivedAt: Date.now() })
          else if (evt.type === 'done') { setExtracted(evt.data || {}); setSources(evt.sources || {}) }
          else if (evt.type === 'error') setError(evt.error)
        }
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setExtracting(false); setRollingProgress(null)
    }
  }

  async function handleExportNew() {
    if (!extracted) return
    setExporting(true); setExportMsg(null)
    try {
      const res = await fetch('/api/polizza/export-new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: extracted }) })
      if (!res.ok) throw new Error('Export fallito')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'polizza_rc.xlsx'
      a.click()
      URL.revokeObjectURL(url)
      setExportMsg('✓ Excel esportato')
    } catch (err) {
      setExportMsg('✗ ' + (err as Error).message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="polizza-page">
      <style jsx global>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .polizza-page { display: flex; flex-direction: column; height: 100%; overflow: hidden; background: var(--c-bg-content); }
        .polizza-header { padding: 20px 24px 14px; border-bottom: 1px solid var(--c-border); flex-shrink: 0; }
        .polizza-header h1 { font-size: 18px; font-weight: 700; margin-bottom: 2px; color: var(--c-text-primary); }
        .polizza-header p { font-size: 12px; color: var(--c-text-muted); }
        .polizza-body { display: flex; flex: 1; overflow: hidden; gap: 0; }
        .polizza-left { width: 340px; min-width: 280px; max-width: 380px; border-right: 1px solid var(--c-border); display: flex; flex-direction: column; overflow: hidden; }
        .polizza-left-inner { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
        .polizza-dropzone { border: 2px dashed var(--c-border); border-radius: var(--r-md); padding: 22px 14px; text-align: center; cursor: pointer; transition: border-color var(--t-normal), background var(--t-normal); background: var(--c-bg-card); }
        .polizza-dropzone.dragging, .polizza-dropzone:hover { border-color: var(--c-accent); background: var(--c-accent-faint); }
        .polizza-dropzone .dz-icon { color: var(--c-accent); margin-bottom: 6px; }
        .polizza-dropzone p { font-size: 12px; color: var(--c-text-secondary); margin: 2px 0; }
        .polizza-dropzone .dz-btn { margin-top: 8px; font-size: 12px; font-weight: 600; color: var(--c-accent); background: none; border: none; cursor: pointer; padding: 4px 8px; border-radius: var(--r-sm); transition: background var(--t-fast); }
        .polizza-dropzone .dz-btn:hover { background: var(--c-accent-faint); }
        .polizza-file-list { display: flex; flex-direction: column; gap: 6px; }
        .polizza-file-item { background: var(--c-bg-card); border: 1px solid var(--c-border); border-radius: var(--r-sm); padding: 8px 10px; display: flex; flex-direction: column; gap: 5px; }
        .polizza-file-row { display: flex; align-items: center; gap: 6px; }
        .polizza-file-name { flex: 1; font-size: 11px; color: var(--c-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .polizza-file-remove { flex-shrink: 0; background: none; border: none; cursor: pointer; color: var(--c-text-muted); padding: 2px; border-radius: 3px; line-height: 1; transition: color var(--t-fast); }
        .polizza-file-remove:hover { color: var(--c-error); }
        .polizza-actions { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; padding: 12px 16px; border-top: 1px solid var(--c-border); }
        .polizza-page .btn-primary { display: flex; align-items: center; justify-content: center; gap: 7px; padding: 10px 16px; background: var(--gradient-accent, var(--c-accent)); color: #fff; border: none; border-radius: var(--r-md); font-size: 13px; font-weight: 600; cursor: pointer; transition: opacity var(--t-fast); }
        .polizza-page .btn-primary:hover:not(:disabled) { opacity: 0.88; }
        .polizza-page .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
        .polizza-page .btn-secondary { display: flex; align-items: center; justify-content: center; gap: 7px; padding: 8px 14px; background: var(--c-bg-card); color: var(--c-text-primary); border: 1px solid var(--c-border); border-radius: var(--r-md); font-size: 12px; font-weight: 500; cursor: pointer; transition: background var(--t-fast), border-color var(--t-fast); }
        .polizza-page .btn-secondary:hover:not(:disabled) { background: var(--c-bg-hover); border-color: var(--c-accent); }
        .btn-success { display: flex; align-items: center; justify-content: center; gap: 7px; padding: 8px 14px; background: var(--c-success); color: #fff; border: none; border-radius: var(--r-md); font-size: 12px; font-weight: 600; cursor: pointer; opacity: 0.9; transition: opacity var(--t-fast); }
        .btn-success:hover:not(:disabled) { opacity: 1; }
        .btn-success:disabled { opacity: 0.4; cursor: not-allowed; }
        .export-msg { font-size: 11px; color: var(--c-success); padding: 6px 8px; background: rgba(34,197,94,0.08); border-radius: var(--r-sm); border: 1px solid rgba(34,197,94,0.2); }
        .export-msg.error { color: var(--c-error); background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.2); }
        .polizza-right { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .polizza-results { flex: 1; overflow-y: auto; padding: 16px; }
        .polizza-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--c-text-muted); text-align: center; gap: 8px; }
        .polizza-empty svg { opacity: 0.3; }
        .polizza-empty h3 { font-size: 15px; font-weight: 600; }
        .polizza-empty p { font-size: 12px; }
        .polizza-table { width: 100%; border-collapse: collapse; }
        .polizza-table th, .polizza-table td { padding: 8px 12px; text-align: left; font-size: 12px; border-bottom: 1px solid var(--c-separator); }
        .polizza-table th { font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--c-text-muted); background: var(--c-bg-card); position: sticky; top: 0; z-index: 1; }
        .polizza-table td:first-child { color: var(--c-text-secondary); width: 42%; font-weight: 500; }
        .polizza-table td:last-child { color: var(--c-text-primary); font-weight: 400; }
        .polizza-table tr:hover td { background: var(--c-bg-hover); }
        .value-null { color: var(--c-text-muted) !important; font-style: italic; }
        .value-ok { color: var(--c-success) !important; font-weight: 500 !important; }
        .editable-cell { width: 100%; background: transparent; border: none; outline: none; color: inherit; font: inherit; padding: 0; }
        .editable-cell:focus { background: var(--c-bg-input); border-radius: 3px; padding: 2px 4px; }
        .polizza-error { margin: 0; padding: 10px 14px; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.25); border-radius: var(--r-sm); font-size: 12px; color: var(--c-error); flex-shrink: 0; }
        .section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--c-text-muted); margin-bottom: 6px; }
      `}</style>

      <div className="polizza-header">
        <h1>🛡️ Polizze</h1>
        <p>Estrazione automatica dati da polizze Responsabilità Civile (RCT/O/P) · fogli Excel RCT_O e RCP</p>
      </div>

      <div className="polizza-body">
        <div className="polizza-left">
          <div className="polizza-left-inner">
            <div
              className={`polizza-dropzone${dragging ? ' dragging' : ''}`}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={openFilePicker}
              role="button"
              tabIndex={0}
              aria-label="Trascina PDF della polizza o clicca per selezionarli"
              onKeyDown={(e) => e.key === 'Enter' && openFilePicker()}
            >
              <div className="dz-icon"><IconUpload /></div>
              <p style={{ fontWeight: 600, fontSize: '13px', color: 'var(--c-text-primary)' }}>Trascina i PDF della polizza</p>
              <p>Carica tutti i documenti: polizza, appendici, condizioni</p>
              <button className="dz-btn" onClick={(e) => { e.stopPropagation(); openFilePicker() }}>Seleziona file PDF</button>
              <input ref={inputRef} type="file" accept=".pdf" multiple style={{ display: 'none' }} onChange={(e) => e.target.files && addFiles(e.target.files)} />
            </div>

            {files.length > 0 && (
              <div>
                <div className="section-title">Documenti caricati ({files.length})</div>
                <div className="polizza-file-list">
                  {files.map((f) => (
                    <div key={f.name} className="polizza-file-item">
                      <div className="polizza-file-row">
                        <IconFile />
                        <span className="polizza-file-name" title={f.name}>{f.name}</span>
                        <button className="polizza-file-remove" onClick={() => removeFile(f.name)} aria-label={`Rimuovi ${f.name}`}><IconX /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="polizza-actions">
            {error && <div className="polizza-error">⚠ {error}</div>}
            <button className="btn-primary" onClick={handleExtract} disabled={!files.length || extracting} aria-busy={extracting}>
              {extracting ? <IconSpinner /> : '⚡'}
              {extracting ? 'Estrazione in corso…' : 'Estrai dati polizza'}
            </button>
            {extracted && (
              <button className="btn-success" onClick={handleExportNew} disabled={exporting}>
                <IconExcel />
                Esporta nuovo Excel
              </button>
            )}
            {exportMsg && <div className={`export-msg${exportMsg.startsWith('✗') ? ' error' : ''}`}>{exportMsg}</div>}
          </div>
        </div>

        <div className="polizza-right">
          <div className="polizza-results" role="tabpanel">
            {!extracted && !extracting && (
              <div className="polizza-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="52" height="52">
                  <path d="M9 12h6M9 16h6M17 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V8l-4-6z" />
                </svg>
                <h3>Nessun dato estratto</h3>
                <p>Carica i PDF della polizza e premi «Estrai dati polizza»</p>
              </div>
            )}
            {extracting && !extracted && (
              <div className="polizza-empty">
                <IconSpinner />
                <h3>Estrazione in corso…</h3>
                {rollingProgress ? (
                  <>
                    <div style={{ width: 220, height: 4, background: 'rgba(59,130,246,0.15)', borderRadius: 2, margin: '8px auto 10px' }}>
                      <div style={{ width: `${Math.round((rollingProgress.docIndex / rollingProgress.docTotal) * 100)}%`, height: '100%', background: 'var(--c-info)', borderRadius: 2, transition: 'width 0.4s' }} />
                    </div>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-secondary)', lineHeight: 1.8 }}>
                      {rollingProgress.docName}<br />
                      File {rollingProgress.docIndex + 1} di {rollingProgress.docTotal}
                      {rollingProgress.pageTotal > 0 && ` · Pag. ${rollingProgress.pageIndex}/${rollingProgress.pageTotal}`}
                      {liveSecs(rollingProgress)}
                      {rollingProgress.totalPagesProcessed > 0 && (<><br />{rollingProgress.totalPagesProcessed} pagine elaborate</>)}
                    </p>
                  </>
                ) : (
                  <p>L&apos;AI sta analizzando i documenti di polizza</p>
                )}
              </div>
            )}
            {extracted && (
              <>
                <div role="note" style={{ margin: '0 0 10px 0', padding: '7px 12px', borderRadius: 6, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', color: 'var(--c-text-secondary)', fontSize: 12 }}>
                  Risultati generati da AI — verificare sempre prima dell&apos;uso
                </div>
                <ExtractedTable
                  fields={visibleFields}
                  data={extracted}
                  sources={sources}
                  onUpdate={(id, val) => !extracting && setExtracted((prev) => ({ ...(prev || {}), [id]: val }))}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
