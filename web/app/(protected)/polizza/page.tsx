'use client'

import { useRef, useState, useCallback } from 'react'

interface FieldDef { id: string; label: string; description?: string; sheet?: string }
interface Source { file: string; page: number }
interface PolizzaResponse {
  values: Record<string, string>
  sources: Record<string, Source>
  scannedFiles: string[]
  fieldDefs: FieldDef[]
  log: string[]
}

const IconUpload = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)
const IconFile = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
)
const IconX = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

export default function PolizzaPage() {
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [result, setResult] = useState<PolizzaResponse | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((incoming: File[]) => {
    const pdfs = incoming.filter((f) => f.name.toLowerCase().endsWith('.pdf'))
    if (!pdfs.length) return
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name + f.size))
      return [...prev, ...pdfs.filter((f) => !seen.has(f.name + f.size))]
    })
  }, [])

  const removeFile = (name: string, size: number) =>
    setFiles((prev) => prev.filter((f) => !(f.name === name && f.size === size)))

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }, [addFiles])

  async function handleExtract() {
    if (!files.length) return
    setStatus('loading')
    setResult(null)
    setErrorMsg('')

    const form = new FormData()
    files.forEach((f) => form.append('pdf', f))

    try {
      const res = await fetch('/api/polizza', { method: 'POST', body: form })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErrorMsg(data.error || "Errore durante l'elaborazione.")
        setStatus('error')
        return
      }
      const data: PolizzaResponse = await res.json()
      setResult(data)
      setStatus('done')
    } catch (err) {
      setErrorMsg(String(err))
      setStatus('error')
    }
  }

  const loading = status === 'loading'

  return (
    <div className="polizza-page">
      <style>{`
        .polizza-page {
          margin: -24px -28px;
          height: 100vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: var(--c-bg-content);
        }
        .polizza-header {
          padding: 20px 24px 14px;
          border-bottom: 1px solid var(--c-border);
          flex-shrink: 0;
        }
        .polizza-header h1 { font-size: 18px; font-weight: 700; margin-bottom: 2px; color: var(--c-text-primary); }
        .polizza-header p { font-size: 12px; color: var(--c-text-muted); }
        .polizza-body { display: flex; flex: 1; overflow: hidden; }
        .polizza-left {
          width: 340px; min-width: 280px; max-width: 380px;
          border-right: 1px solid var(--c-border);
          display: flex; flex-direction: column; overflow: hidden;
        }
        .polizza-left-inner { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
        .polizza-dropzone {
          border: 2px dashed var(--c-border);
          border-radius: var(--r-md);
          padding: 22px 14px; text-align: center; cursor: pointer;
          transition: border-color var(--t-normal), background var(--t-normal);
          background: var(--c-bg-card);
        }
        .polizza-dropzone.dragging, .polizza-dropzone:hover { border-color: var(--c-accent); background: var(--c-accent-faint); }
        .polizza-dropzone .dz-icon { color: var(--c-accent); display: flex; justify-content: center; margin-bottom: 6px; }
        .polizza-dropzone p { font-size: 12px; color: var(--c-text-secondary); margin: 2px 0; }
        .polizza-dropzone .dz-btn {
          margin-top: 8px; font-size: 12px; font-weight: 600; color: var(--c-accent);
          background: none; border: none; cursor: pointer; padding: 4px 8px; border-radius: var(--r-sm);
        }
        .polizza-dropzone .dz-btn:hover { background: var(--c-accent-faint); }
        .section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--c-text-muted); margin-bottom: 6px; }
        .polizza-file-list { display: flex; flex-direction: column; gap: 6px; }
        .polizza-file-item {
          background: var(--c-bg-card); border: 1px solid var(--c-border); border-radius: var(--r-sm);
          padding: 8px 10px; display: flex; align-items: center; gap: 6px;
        }
        .polizza-file-name { flex: 1; font-size: 11px; color: var(--c-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .polizza-file-remove {
          flex-shrink: 0; background: none; border: none; cursor: pointer; color: var(--c-text-muted);
          padding: 2px; border-radius: 3px; line-height: 1; width: auto;
        }
        .polizza-file-remove:hover { color: var(--c-error); }
        .polizza-actions { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; padding: 12px 16px; border-top: 1px solid var(--c-border); }
        .polizza-actions .btn-primary, .polizza-actions .btn-secondary { width: 100%; border-radius: var(--r-md); padding: 10px 16px; }
        .polizza-error {
          padding: 10px 14px; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.25);
          border-radius: var(--r-sm); font-size: 12px; color: var(--c-error);
        }
        .polizza-right { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .polizza-results { flex: 1; overflow-y: auto; padding: 16px; }
        .polizza-empty {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          height: 100%; color: var(--c-text-muted); text-align: center; gap: 8px;
        }
        .polizza-empty svg { opacity: 0.3; }
        .polizza-empty h3 { font-size: 15px; font-weight: 600; }
        .polizza-empty p { font-size: 12px; }
        .polizza-table { width: 100%; border-collapse: collapse; }
        .polizza-table th, .polizza-table td { padding: 8px 12px; text-align: left; font-size: 12px; border-bottom: 1px solid var(--c-separator); }
        .polizza-table th {
          font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
          color: var(--c-text-muted); background: var(--c-bg-card); position: sticky; top: 0; z-index: 1;
        }
        .polizza-table td:first-child { color: var(--c-text-secondary); width: 38%; font-weight: 500; }
        .polizza-table tr:hover td { background: var(--c-bg-hover); }
        .value-null { color: var(--c-text-muted); font-style: italic; }
        .value-ok { color: var(--c-text-primary); font-weight: 500; }
        .ai-note {
          margin: 0 0 10px 0; padding: 7px 12px; border-radius: 6px;
          background: rgba(234,179,8,0.1); border: 1px solid rgba(234,179,8,0.3);
          color: var(--c-text-secondary); font-size: 12px;
        }
        .scanned-note {
          margin: 0 0 10px 0; padding: 7px 12px; border-radius: 6px;
          background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.25);
          color: var(--c-info); font-size: 12px;
        }
        @media (max-width: 900px) {
          .polizza-body { flex-direction: column; }
          .polizza-left { width: 100%; max-width: none; border-right: none; border-bottom: 1px solid var(--c-border); }
        }
      `}</style>

      <div className="polizza-header">
        <h1>🛡️ Polizze</h1>
        <p>Estrazione automatica dati da polizze Responsabilità Civile (RCT/O/P) · fogli Excel RCT_O e RCP</p>
      </div>

      <div className="polizza-body">
        {/* Pannello sinistro: caricamento */}
        <div className="polizza-left">
          <div className="polizza-left-inner">
            <div
              className={`polizza-dropzone${dragging ? ' dragging' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
              aria-label="Trascina i PDF della polizza o clicca per selezionarli"
            >
              <div className="dz-icon"><IconUpload /></div>
              <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--c-text-primary)' }}>Trascina i PDF della polizza</p>
              <p>Carica tutti i documenti: polizza, appendici, condizioni</p>
              <button className="dz-btn" onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}>
                Seleziona file PDF
              </button>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,application/pdf"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
              />
            </div>

            {files.length > 0 && (
              <div>
                <div className="section-title">Documenti caricati ({files.length})</div>
                <div className="polizza-file-list">
                  {files.map((f) => (
                    <div key={f.name + f.size} className="polizza-file-item">
                      <IconFile />
                      <span className="polizza-file-name" title={f.name}>{f.name}</span>
                      <button
                        className="polizza-file-remove"
                        onClick={() => removeFile(f.name, f.size)}
                        aria-label={`Rimuovi ${f.name}`}
                      >
                        <IconX />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="polizza-actions">
            {status === 'error' && <div className="polizza-error">⚠ {errorMsg}</div>}
            <button className="btn btn-primary" onClick={handleExtract} disabled={!files.length || loading} aria-busy={loading}>
              {loading ? <><span className="spinner" /> Estrazione in corso…</> : <>⚡ Estrai dati polizza</>}
            </button>
          </div>
        </div>

        {/* Pannello destro: risultati */}
        <div className="polizza-right">
          <div className="polizza-results">
            {!result && !loading && (
              <div className="polizza-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="52" height="52">
                  <path d="M9 12h6M9 16h6M17 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V8l-4-6z" />
                </svg>
                <h3>Nessun dato estratto</h3>
                <p>Carica i PDF della polizza e premi «Estrai dati polizza»</p>
              </div>
            )}

            {loading && (
              <div className="polizza-empty">
                <span className="spinner" style={{ width: 28, height: 28 }} />
                <h3>Estrazione in corso…</h3>
                <p>L&apos;AI sta analizzando i documenti di polizza</p>
              </div>
            )}

            {result && !loading && (
              <>
                {result.scannedFiles.length > 0 && (
                  <div className="scanned-note">
                    {result.scannedFiles.length} documento/i risultano scansionati (solo immagine): il testo non è
                    estraibile lato server. Usa l&apos;app desktop per l&apos;OCR visivo di questi file.
                  </div>
                )}
                <div className="ai-note">Risultati generati da AI — verificare sempre prima dell&apos;uso</div>
                <table className="polizza-table">
                  <thead>
                    <tr>
                      <th style={{ width: '38%' }}>Campo</th>
                      <th>Valore estratto</th>
                      <th style={{ width: '22%', whiteSpace: 'nowrap' }}>Sorgente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.fieldDefs.map((f) => {
                      const val = result.values[f.id]
                      const isEmpty = val === null || val === undefined || val === ''
                      const src = result.sources[f.id]
                      return (
                        <tr key={f.id}>
                          <td title={f.description}>{f.label}</td>
                          <td className={isEmpty ? 'value-null' : 'value-ok'}>{isEmpty ? '—' : val}</td>
                          <td style={{ fontSize: 11, color: 'var(--c-text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                            {src ? `${src.file} · pag. ${src.page}` : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
