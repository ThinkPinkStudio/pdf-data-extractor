'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState, useCallback, useEffect } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

interface FieldDef { id: string; label: string; description?: string; sheet?: string }
interface Source { file: string; page: number }

function mappingSheetNames(defaultMapping: any): string[] {
  const s = new Set<string>()
  for (const arr of Object.values(defaultMapping || {})) {
    for (const c of (arr as any[]) || []) if (c?.sheet) s.add(c.sheet)
  }
  return s.size ? [...s] : ['RCT_O', 'RCP']
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const IconUpload = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
)
const IconFile = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
)
const IconX = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
)
const IconExcel = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" /></svg>
)

export default function PolizzaPage() {
  const t = useT()
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [fields, setFields] = useState<FieldDef[]>([])
  const [defaultMapping, setDefaultMapping] = useState<any>({})

  const [extracting, setExtracting] = useState(false)
  const [visionExtracting, setVisionExtracting] = useState(false)
  const [visionMsg, setVisionMsg] = useState<null | 'extracting' | 'done' | 'error'>(null)
  const [visionErr, setVisionErr] = useState<string | null>(null)
  const [extracted, setExtracted] = useState<Record<string, string> | null>(null)
  const [sources, setSources] = useState<Record<string, Source>>({})
  const [progress, setProgress] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  // Template / gestionale
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [templateStructure, setTemplateStructure] = useState<any>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [previewChanges, setPreviewChanges] = useState<any[] | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<string | null>(null)

  // Job server-side: id corrente + nomi file (per la lista quando i File non sono
  // più in memoria, es. dopo riapertura/ricarica della pagina).
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobFileNames, setJobFileNames] = useState<string[]>([])

  const diagRef = useRef<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const tplInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    fetch('/api/polizza/fields')
      .then((r) => r.json())
      .then((d) => { setFields(d.fields || []); setDefaultMapping(d.defaultMapping || {}) })
      .catch(() => {})
  }, [])

  // Tick di liveness: re-render al secondo durante l'estrazione, così il contatore
  // mostra il tempo che passa anche durante una singola chiamata LLM lunga (es. vision
  // su una pagina) in cui File/Pag. non possono avanzare (come desktop).
  const [, setLivenessTick] = useState(0)
  useEffect(() => {
    if (!extracting && !visionExtracting) return
    const id = setInterval(() => setLivenessTick((x) => x + 1), 1000)
    return () => clearInterval(id)
  }, [extracting, visionExtracting])

  // Secondi trascorsi dall'ultimo avanzamento del progresso (liveness)
  const liveSecs = (p: any): string => {
    if (!p?.receivedAt) return ''
    const s = Math.max(0, Math.floor((Date.now() - p.receivedAt) / 1000))
    return s >= 2 ? ` · in analisi da ${s}s` : ''
  }

  const addFiles = useCallback((incoming: File[]) => {
    const pdfs = incoming.filter((f) => f.name.toLowerCase().endsWith('.pdf'))
    if (!pdfs.length) return
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name + f.size))
      return [...prev, ...pdfs.filter((f) => !seen.has(f.name + f.size))]
    })
  }, [])
  const removeFile = (name: string, size: number) => setFiles((prev) => prev.filter((f) => !(f.name === name && f.size === size)))


  // ─── Job server-side: applica uno snapshot allo stato UI ─────────────────────
  const applySnapshot = useCallback((s: any): string | null => {
    if (!s || s.jobId == null) return null
    setExtracted(s.values || {})
    setSources(s.sources || {})
    setProgress(s.progress || null)
    if (Array.isArray(s.fieldDefs) && s.fieldDefs.length) setFields(s.fieldDefs)
    if (Array.isArray(s.scannedFiles)) setJobFileNames(s.scannedFiles)
    // I log del job contengono TUTTA la diagnostica del motore (stadi, scarti,
    // chiamate Ollama): senza questo, "Scarica diagnostica" dopo un reload
    // stampava "(nessun log)" — il file inutile che non racconta niente.
    if (Array.isArray(s.logs) && s.logs.length) diagRef.current = s.logs
    const st = s.status as string
    const active = st === 'queued' || st === 'running'
    setExtracting(active)
    setVisionExtracting(active)
    setVisionMsg(active ? 'extracting' : st === 'done' ? 'done' : st === 'error' ? 'error' : null)
    setVisionErr(st === 'error' ? (s.error || null) : null)
    if (st === 'error') setError(s.error || null)
    return st
  }, [])

  // Polling dello snapshot finché il job non è in stato terminale.
  useEffect(() => {
    if (!jobId) return
    let stopped = false
    const stop = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
    const tick = async () => {
      try {
        const res = await fetch(`/api/polizza/job/${jobId}`)
        if (!res.ok) { if (res.status === 404) { localStorage.removeItem('polizzaJobId'); stopped = true; stop() } return }
        const s = await res.json()
        if (stopped) return
        const st = applySnapshot(s)
        if (st === 'done' || st === 'error' || st === 'canceled') { stopped = true; stop() }
      } catch { /* rete: riprova al prossimo tick */ }
    }
    tick()
    pollRef.current = setInterval(tick, 1500)
    return () => { stopped = true; stop() }
  }, [jobId, applySnapshot])

  // Restore all'apertura pagina: jobId salvato → o ultimo job attivo dell'utente.
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('polizzaJobId') : null
    if (saved) { setJobId(saved); return }
    fetch('/api/polizza/job/active').then((r) => r.json()).then((s) => {
      if (s && s.jobId) { localStorage.setItem('polizzaJobId', s.jobId); setJobId(s.jobId) }
    }).catch(() => {})
  }, [])

  // ─── Avvio estrazione: crea il job lato server e avvia il polling ────────────
  async function handleExtract() {
    if (!files.length) return
    setError(null); setExportMsg(null); setVisionErr(null)
    setExtracted({}); setSources({}); setProgress(null)
    setExtracting(true); setVisionExtracting(true); setVisionMsg('extracting')
    setJobFileNames(files.map((f) => f.name))
    try {
      const form = new FormData()
      files.forEach((f) => form.append('pdf', f))
      const res = await fetch('/api/polizza/job', { method: 'POST', body: form })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || t('pol.errProcessing'))
      }
      const { jobId: id } = await res.json()
      localStorage.setItem('polizzaJobId', id)
      setJobId(id) // avvia il polling
    } catch (err: any) {
      setError(err.message); setExtracting(false); setVisionExtracting(false); setVisionMsg('error'); setVisionErr(err.message)
    }
  }

  // ─── Rilancia: rifà l'estrazione sugli STESSI PDF già salvati nel job ───────
  // (motore e impostazioni correnti, cache OCR inclusa): niente ri-upload — il
  // job torna in coda e il polling riparte da solo.
  async function handleRelaunch() {
    if (!jobId || extracting) return
    setError(null); setExportMsg(null); setVisionErr(null)
    try {
      const res = await fetch(`/api/polizza/job/${jobId}/retry`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || t('pol.errProcessing'))
      }
      setExtracted({}); setSources({}); setProgress(null)
      setExtracting(true); setVisionExtracting(true); setVisionMsg('extracting')
      // Riavvia il polling (l'effetto è agganciato a jobId: forziamo un tick)
      const id = jobId
      setJobId(null); setTimeout(() => setJobId(id), 50)
    } catch (err: any) {
      setError(err.message); setVisionMsg('error'); setVisionErr(err.message)
    }
  }

  // ─── Nuova polizza: annulla l'eventuale job in corso e azzera la UI ──────────
  async function handleNewPolizza() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    const id = jobId
    localStorage.removeItem('polizzaJobId')
    setJobId(null); setJobFileNames([]); setFiles([])
    setExtracted(null); setSources({}); setProgress(null)
    setExtracting(false); setVisionExtracting(false); setVisionMsg(null); setVisionErr(null)
    setError(null); setExportMsg(null)
    if (id) { try { await fetch(`/api/polizza/job/${id}/cancel`, { method: 'POST' }) } catch { /* best-effort */ } }
  }

  // ─── Export Excel nuovo ──────────────────────────────────────────────────────
  async function handleExportNew() {
    if (!extracted) return
    setExporting(true); setExportMsg(null)
    try {
      const suggestedName = `polizza_${extracted.polizza_numero || 'rc'}_${(extracted.contraente || 'dati').split(' ')[0]}`
      const res = await fetch('/api/polizza/export-new', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: extracted, suggestedName }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export fallito')
      downloadBlob(await res.blob(), `${suggestedName}.xlsx`)
      setExportMsg(t('pol.fileExcelDownloaded'))
    } catch (err: any) {
      setExportMsg('✗ ' + err.message)
    } finally {
      setExporting(false)
    }
  }

  // ─── Template gestionale ─────────────────────────────────────────────────────
  async function handleLoadTemplate(file: File) {
    setTemplateFile(file); setExportMsg(null); setError(null)
    const form = new FormData(); form.append('template', file)
    const r = await fetch('/api/polizza/template/structure', { method: 'POST', body: form }).then((x) => x.json())
    if (r.success) setTemplateStructure(r.structure)
    else setError(t('pol.errTemplateRead', { msg: r.error }))
  }
  async function handlePreviewChanges() {
    if (!extracted || !templateFile) return
    setLoadingPreview(true); setExportMsg(null); setError(null)
    try {
      const form = new FormData()
      form.append('template', templateFile)
      form.append('data', JSON.stringify(extracted))
      form.append('mapping', JSON.stringify({}))
      const r = await fetch('/api/polizza/template/preview', { method: 'POST', body: form }).then((x) => x.json())
      if (!r.success) throw new Error(r.error)
      setPreviewChanges((r.changes || []).map((c: any) => ({ ...c, approved: true })))
      setShowPreview(true)
    } catch (err: any) {
      setError(t('pol.errPreview', { msg: err.message }))
    } finally {
      setLoadingPreview(false)
    }
  }
  async function handleExportApproved(approved: any[]) {
    if (!templateFile) return
    setExporting(true); setExportMsg(null)
    try {
      const form = new FormData()
      form.append('template', templateFile)
      form.append('approvedChanges', JSON.stringify(approved))
      const res = await fetch('/api/polizza/template/export-approved', { method: 'POST', body: form })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export fallito')
      downloadBlob(await res.blob(), templateFile.name.replace(/\.xlsx?$/i, '') + '_aggiornato.xlsx')
      setExportMsg(t('pol.templateUpdated')); setShowPreview(false); setPreviewChanges(null)
    } catch (err: any) {
      setExportMsg('✗ ' + err.message)
    } finally {
      setExporting(false)
    }
  }

  function handleDownloadLog() {
    // Dopo un reload `files` (File objects) è vuoto ma i nomi restano nello
    // snapshot del job: senza il fallback la sezione FILE usciva vuota.
    const fileNames = files.length ? files.map((f) => f.name) : jobFileNames
    const lines = [
      '=== DIAGNOSTICA ESTRAZIONE POLIZZA ===',
      `Data/ora: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
      ...(jobId ? [`Job: ${jobId}`] : []),
      ...(visionErr ? [`Errore: ${visionErr}`] : []),
      '', '=== FILE ===', ...(fileNames.length ? fileNames.map((n, i) => `${i + 1}. ${n}`) : ['(nessun file)']),
      '', '=== LOG ===', ...(diagRef.current.length ? diagRef.current : ['(nessun log)']),
      '', '=== DATI ESTRATTI ===',
      ...(extracted ? Object.entries(extracted).map(([k, v]) => `${k}: ${v || '(vuoto)'}`) : ['(nessun dato)']),
    ]
    downloadBlob(new Blob([lines.join('\n')], { type: 'text/plain' }), 'polizza_diagnostica.txt')
  }

  const loading = extracting
  // "Ha valori" = almeno un campo estratto. Uno snapshot con extracted={} (job appena
  // avviato) NON conta come risultato: così mostriamo il pannello di avanzamento e non
  // una tabella vuota.
  const hasValues = !!extracted && Object.keys(extracted).length > 0
  const jobActive = extracting || visionExtracting
  const isCSA = templateStructure && mappingSheetNames(defaultMapping).some((n) => Object.keys(templateStructure).includes(n))

  return (
    <div className="polizza-page">
      <style>{POLIZZA_CSS}</style>

      <div className="polizza-header">
        <h1>{t('pol.title')}</h1>
        <p>{t('pol.subtitle')}</p>
      </div>

      <div className="polizza-body">
        {/* Pannello sinistro */}
        <div className="polizza-left">
          <div className="polizza-left-inner">
            {!jobId && (
              <div
                className={`polizza-dropzone${dragging ? ' dragging' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(Array.from(e.dataTransfer.files)) }}
                onClick={() => inputRef.current?.click()}
                role="button" tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
              >
                <div className="dz-icon"><IconUpload /></div>
                <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--c-text-primary)' }}>{t('pol.dropPrimary')}</p>
                <p>{t('pol.dropSecondary')}</p>
                <button className="dz-btn" onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}>{t('pol.selectFiles')}</button>
                <input ref={inputRef} type="file" accept=".pdf,application/pdf" multiple style={{ display: 'none' }}
                  onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
              </div>
            )}

            {(files.length > 0 || jobFileNames.length > 0) && (
              <div>
                <div className="section-title">{t('pol.docsLoaded', { n: files.length || jobFileNames.length })}</div>
                <div className="polizza-file-list">
                  {(files.length > 0
                    ? files.map((f) => ({ name: f.name, size: f.size, removable: !jobId }))
                    : jobFileNames.map((n) => ({ name: n, size: 0, removable: false }))
                  ).map((f) => (
                    <div key={f.name + f.size} className="polizza-file-item">
                      <IconFile />
                      <span className="polizza-file-name" title={f.name}>{f.name}</span>
                      {f.removable && <button className="polizza-file-remove" onClick={() => removeFile(f.name, f.size)} aria-label={t('pol.remove', { name: f.name })}><IconX /></button>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Template Excel */}
            <div className="polizza-template-block">
              <div className="polizza-template-label">{t('pol.templateLabel')}</div>
              {templateFile
                ? <div className="polizza-template-file"><IconExcel /> {templateFile.name}</div>
                : <div style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{t('pol.noTemplate')}</div>}
              {isCSA && <div style={{ fontSize: 10, color: 'var(--c-success)' }}>{t('pol.csaRecognized')}</div>}
              <button className="btn btn-secondary" style={{ fontSize: 11, padding: '6px 10px', width: '100%' }} onClick={() => tplInputRef.current?.click()}>
                <IconExcel /> {templateFile ? t('pol.changeTemplate') : t('pol.loadTemplate')}
              </button>
              <input ref={tplInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLoadTemplate(f); e.target.value = '' }} />
            </div>
          </div>

          <div className="polizza-actions">
            {error && <div className="polizza-error">⚠ {error}</div>}
            {jobId ? (
              <>
                <button className="btn btn-secondary" style={{ width: '100%', borderRadius: 'var(--r-md)' }} onClick={handleNewPolizza}>
                  {loading ? <><span className="spinner" /> {t('pol.newPolizzaStop')}</> : t('pol.newPolizza')}
                </button>
                {!loading && (
                  <button className="btn btn-secondary" style={{ width: '100%', borderRadius: 'var(--r-md)' }}
                    title={t('polizze.relaunchTitle')} onClick={handleRelaunch}>
                    ↻ {t('polizze.relaunch')}
                  </button>
                )}
              </>
            ) : (
              <button className="btn btn-primary" style={{ width: '100%', borderRadius: 'var(--r-md)' }} onClick={handleExtract} disabled={!files.length || loading} aria-busy={loading}>
                {loading ? <><span className="spinner" /> {t('pol.extracting')}</> : <>{t('pol.extractBtn')}</>}
              </button>
            )}

            {(visionExtracting || visionMsg) && (
              <div className={`vision-box ${visionMsg}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {visionExtracting && <span className="spinner" />}
                  {visionMsg === 'extracting' && t('pol.visionRunning')}
                  {visionMsg === 'done' && t('pol.visionDone')}
                  {visionMsg === 'error' && t('pol.visionError')}
                </div>
                {visionMsg === 'error' && visionErr && <div style={{ opacity: 0.85, marginTop: 4 }}>{t('pol.reason', { msg: visionErr })}</div>}
              </div>
            )}

            {extracted && (
              <>
                <button className="btn btn-success" style={{ width: '100%' }} onClick={handleExportNew} disabled={exporting}><IconExcel /> {t('pol.exportNew')}</button>
                {templateFile && (
                  <button className="btn btn-secondary" style={{ width: '100%' }} onClick={handlePreviewChanges} disabled={exporting || loadingPreview}>
                    {loadingPreview ? <span className="spinner" /> : <IconExcel />} {t('pol.reviewTemplate')}
                  </button>
                )}
              </>
            )}
            {(extracted || error) && (
              <button className="btn btn-secondary" style={{ width: '100%', fontSize: 11, opacity: 0.8 }} onClick={handleDownloadLog}>{t('pol.downloadDiag')}</button>
            )}
            {exportMsg && <div className={`export-msg${exportMsg.startsWith('✗') ? ' error' : ''}`}>{exportMsg}</div>}
          </div>
        </div>

        {/* Pannello destro */}
        <div className="polizza-right">
          <div className="polizza-results">
            {!hasValues && !loading && (
              <div className="polizza-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="52" height="52"><path d="M9 12h6M9 16h6M17 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V8l-4-6z" /></svg>
                <h3>{t('pol.emptyTitle')}</h3>
                <p>{t('pol.emptyText')}</p>
              </div>
            )}
            {loading && !hasValues && (
              <div className="polizza-empty">
                <span className="spinner" style={{ width: 28, height: 28 }} />
                <h3>{t('pol.extracting')}</h3>
                {progress ? (
                  <>
                    <div className="progress-bar" style={{ width: 220, margin: '8px auto 10px' }}>
                      <div className="progress-bar-fill" style={{ width: `${Math.round((progress.docIndex / Math.max(1, progress.docTotal)) * 100)}%` }} />
                    </div>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.8 }}>
                      {progress.docName}<br />
                      {t('pol.progressFile', { a: progress.docIndex + 1, b: progress.docTotal })}
                      {progress.pageTotal > 0 && ` · ${t('pol.progressPage', { p: progress.pageIndex, t: progress.pageTotal })}`}
                      {liveSecs(progress)}
                      {progress.totalPagesProcessed > 0 && <><br />{t('pol.pagesProcessed', { n: progress.totalPagesProcessed })}</>}
                    </p>
                  </>
                ) : <p>{t('pol.analyzing')}</p>}
              </div>
            )}
            {hasValues && (
              <>
                {jobActive && (
                  <div className="progress-banner">
                    <div className="progress-bar progress-bar-thin">
                      <div className="progress-bar-fill" style={{ width: `${progress ? Math.round((progress.docIndex / Math.max(1, progress.docTotal)) * 100) : 0}%` }} />
                    </div>
                    <div className="progress-banner-row">
                      <span className="spinner" />
                      <span>
                        {progress ? <>
                          {t('pol.progressFile', { a: progress.docIndex + 1, b: progress.docTotal })} · {progress.docName}
                          {progress.pageTotal > 0 && ` · ${t('pol.progressPage', { p: progress.pageIndex, t: progress.pageTotal })}`}
                          {progress.totalPagesProcessed > 0 && ` · ${t('pol.pagesProcessedShort', { n: progress.totalPagesProcessed })}`}
                          {liveSecs(progress)}
                        </> : t('pol.analyzing')}
                      </span>
                    </div>
                  </div>
                )}
                <div className="ai-note">{t('pol.aiNote')}</div>
                <ExtractedTable fields={fields} data={extracted} sources={sources}
                  onUpdate={(id, val) => !extracting && !visionExtracting && setExtracted((prev) => ({ ...(prev || {}), [id]: val }))} />
              </>
            )}
          </div>
        </div>
      </div>

      {showPreview && previewChanges && (
        <ChangePreviewModal changes={previewChanges} exporting={exporting} onChange={setPreviewChanges}
          onConfirm={handleExportApproved} onClose={() => { setShowPreview(false); setPreviewChanges(null) }} />
      )}
    </div>
  )
}

// ─── Tabella risultati editabile ──────────────────────────────────────────────
function ExtractedTable({ fields, data, sources, onUpdate }: { fields: FieldDef[]; data: Record<string, string>; sources: Record<string, Source>; onUpdate: (id: string, val: string) => void }) {
  const t = useT()
  return (
    <table className="polizza-table">
      <thead><tr><th style={{ width: '32%' }}>{t('pol.colField')}</th><th>{t('pol.colValueEditable')}</th><th style={{ width: '22%' }}>{t('pol.colSource')}</th></tr></thead>
      <tbody>
        {fields.map((f) => {
          const val = data[f.id]
          const isEmpty = val === null || val === undefined || val === ''
          const src = sources?.[f.id]
          return (
            <tr key={f.id}>
              <td title={f.description}>{f.label}</td>
              <td className={isEmpty ? 'value-null' : 'value-ok'}>
                {isEmpty ? <span style={{ fontStyle: 'italic', color: 'var(--c-text-muted)' }}>—</span>
                  : <input className="editable-cell" value={val ?? ''} onChange={(e) => onUpdate(f.id, e.target.value)} aria-label={f.label} />}
              </td>
              <td style={{ fontSize: 11, color: 'var(--c-text-muted)', fontFamily: 'var(--font-mono)' }}>
                {src ? <span>{src.file}<br /><span style={{ opacity: 0.7 }}>{t('pol.page', { n: src.page })}</span></span> : <span style={{ fontStyle: 'italic' }}>—</span>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ─── Modale anteprima modifiche ───────────────────────────────────────────────
function ChangePreviewModal({ changes, exporting, onChange, onConfirm, onClose }: { changes: any[]; exporting: boolean; onChange: (c: any[]) => void; onConfirm: (approved: any[]) => void; onClose: () => void }) {
  const t = useT()
  const approved = changes.filter((c) => c.approved)
  const allChecked = approved.length === changes.length
  const toggle = (idx: number) => onChange(changes.map((c, i) => (i === idx ? { ...c, approved: !c.approved } : c)))
  const toggleAll = () => onChange(changes.map((c) => ({ ...c, approved: !allChecked })))
  const totalChanged = changes.filter((c) => c.oldValue !== c.newValue && c.newValue !== '').length

  return (
    <div className="mapping-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mapping-modal" role="dialog" aria-modal="true">
        <div className="mapping-header">
          <div>
            <h2>{t('pol.modalTitle')}</h2>
            <p>{t('pol.modalSubtitle', { a: approved.length, b: changes.length, c: totalChanged })}</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 10px' }} onClick={toggleAll}>{allChecked ? t('pol.deselectAll') : t('pol.approveAll')}</button>
            <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={onClose}>{t('common.cancel')}</button>
          </div>
        </div>
        <div className="mapping-body">
          <table className="polizza-table">
            <thead><tr><th></th><th>{t('pol.colFieldCell')}</th><th>{t('pol.colCurrent')}</th><th>{t('pol.colNew')}</th></tr></thead>
            <tbody>
              {changes.map((row, idx) => {
                const isChanged = row.oldValue !== row.newValue
                return (
                  <tr key={idx} onClick={() => toggle(idx)} style={{ cursor: 'pointer', opacity: row.approved ? 1 : 0.5 }}>
                    <td style={{ width: 28 }}><input type="checkbox" checked={!!row.approved} onChange={() => toggle(idx)} onClick={(e) => e.stopPropagation()} style={{ width: 14, accentColor: 'var(--c-accent)' }} /></td>
                    <td>{row.label}<br /><span style={{ fontSize: 10, color: 'var(--c-text-muted)', fontFamily: 'var(--font-mono)' }}>{row.sheet}!{row.cell}</span></td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: row.oldValue ? 'var(--c-text-primary)' : 'var(--c-text-muted)' }}>{row.oldValue || '—'}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: isChanged ? 'var(--c-success)' : 'var(--c-text-secondary)', fontWeight: isChanged ? 600 : 400 }}>{row.newValue || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="mapping-footer">
          <div style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{approved.length === 0 ? t('pol.selectAtLeastOne') : t('pol.willWrite', { n: approved.length })}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={onClose} disabled={exporting}>{t('common.cancel')}</button>
            <button className="btn btn-success" onClick={() => onConfirm(approved)} disabled={approved.length === 0 || exporting} aria-busy={exporting}>
              {exporting ? <span className="spinner" /> : '✓'} {approved.length === 1 ? t('pol.confirmOne', { n: approved.length }) : t('pol.confirmMany', { n: approved.length })}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const POLIZZA_CSS = `
.polizza-page { margin: -24px -28px; height: 100vh; display: flex; flex-direction: column; overflow: hidden; background: var(--c-bg-content); }
.polizza-header { padding: 20px 24px 14px; border-bottom: 1px solid var(--c-border); flex-shrink: 0; }
.polizza-header h1 { font-size: 18px; font-weight: 700; margin-bottom: 2px; color: var(--c-text-primary); }
.polizza-header p { font-size: 12px; color: var(--c-text-muted); }
.polizza-body { display: flex; flex: 1; overflow: hidden; }
.polizza-left { width: 340px; min-width: 280px; max-width: 380px; border-right: 1px solid var(--c-border); display: flex; flex-direction: column; overflow: hidden; }
.polizza-left-inner { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.polizza-dropzone { border: 2px dashed var(--c-border); border-radius: var(--r-md); padding: 22px 14px; text-align: center; cursor: pointer; transition: border-color .22s, background .22s; background: var(--c-bg-card); }
.polizza-dropzone.dragging, .polizza-dropzone:hover { border-color: var(--c-accent); background: var(--c-accent-faint); }
.polizza-dropzone .dz-icon { color: var(--c-accent); display: flex; justify-content: center; margin-bottom: 6px; }
.polizza-dropzone p { font-size: 12px; color: var(--c-text-secondary); margin: 2px 0; }
.polizza-dropzone .dz-btn { margin-top: 8px; font-size: 12px; font-weight: 600; color: var(--c-accent); background: none; border: none; cursor: pointer; padding: 4px 8px; border-radius: var(--r-sm); }
.polizza-dropzone .dz-btn:hover { background: var(--c-accent-faint); }
.section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--c-text-muted); margin-bottom: 6px; }
.polizza-file-list { display: flex; flex-direction: column; gap: 6px; }
.polizza-file-item { background: var(--c-bg-card); border: 1px solid var(--c-border); border-radius: var(--r-sm); padding: 8px 10px; display: flex; align-items: center; gap: 6px; }
.polizza-file-name { flex: 1; font-size: 11px; color: var(--c-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.polizza-file-remove { flex-shrink: 0; background: none; border: none; cursor: pointer; color: var(--c-text-muted); padding: 2px; width: auto; }
.polizza-file-remove:hover { color: var(--c-error); }
.polizza-template-block { background: var(--c-bg-card-alt); border: 1px solid var(--c-border); border-radius: var(--r-sm); padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.polizza-template-label { font-size: 10px; font-weight: 600; color: var(--c-text-muted); text-transform: uppercase; letter-spacing: .05em; }
.polizza-template-file { font-size: 11px; color: var(--c-accent); display: flex; align-items: center; gap: 4px; }
.polizza-actions { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; padding: 12px 16px; border-top: 1px solid var(--c-border); }
.polizza-error { padding: 10px 14px; background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.25); border-radius: var(--r-sm); font-size: 12px; color: var(--c-error); }
.vision-box { font-size: 11px; padding: 6px 10px; border-radius: var(--r-sm); background: rgba(59,130,246,.08); border: 1px solid rgba(59,130,246,.25); color: var(--c-info); }
.vision-box.done { background: rgba(34,197,94,.08); border-color: rgba(34,197,94,.25); color: var(--c-success); }
.vision-box.error { background: rgba(239,68,68,.08); border-color: rgba(239,68,68,.25); color: var(--c-error); }
.export-msg { font-size: 11px; color: var(--c-success); padding: 6px 8px; background: rgba(34,197,94,.08); border-radius: var(--r-sm); border: 1px solid rgba(34,197,94,.2); }
.export-msg.error { color: var(--c-error); background: rgba(239,68,68,.08); border-color: rgba(239,68,68,.2); }
.polizza-right { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.polizza-results { flex: 1; overflow-y: auto; padding: 16px; }
.polizza-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--c-text-muted); text-align: center; gap: 8px; }
.polizza-empty svg { opacity: .3; }
.polizza-empty h3 { font-size: 15px; font-weight: 600; }
.polizza-empty p { font-size: 12px; }
.progress-banner { margin: 0 0 8px; border-radius: 6px; background: rgba(59,130,246,.07); border: 1px solid rgba(59,130,246,.2); font-size: 11px; color: var(--c-info); font-family: var(--font-mono); overflow: hidden; }
.progress-banner-row { padding: 5px 10px; display: flex; align-items: center; gap: 8px; }
.progress-bar { height: 4px; background: rgba(59,130,246,.15); border-radius: 2px; overflow: hidden; }
.progress-bar-thin { height: 3px; border-radius: 0; }
.progress-bar-fill { height: 100%; background: var(--c-info); border-radius: inherit; transition: width .4s; }
.ai-note { margin: 0 0 10px; padding: 7px 12px; border-radius: 6px; background: rgba(234,179,8,.1); border: 1px solid rgba(234,179,8,.3); color: var(--c-text-secondary); font-size: 12px; }
.polizza-table { width: 100%; border-collapse: collapse; }
.polizza-table th, .polizza-table td { padding: 8px 12px; text-align: left; font-size: 12px; border-bottom: 1px solid var(--c-separator); }
.polizza-table th { font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--c-text-muted); background: var(--c-bg-card); position: sticky; top: 0; z-index: 1; }
.polizza-table td:first-child { color: var(--c-text-secondary); font-weight: 500; }
.polizza-table tr:hover td { background: var(--c-bg-hover); }
.value-null { color: var(--c-text-muted); font-style: italic; }
.value-ok { color: var(--c-text-primary); font-weight: 500; }
.editable-cell { width: 100%; background: transparent; border: none; outline: none; color: inherit; font: inherit; padding: 0; }
.editable-cell:focus { background: var(--c-bg-input); border-radius: 3px; padding: 2px 4px; }
.mapping-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; z-index: 100; }
.mapping-modal { background: var(--c-bg-card); border: 1px solid var(--c-border); border-radius: var(--r-lg); width: min(900px, 95vw); max-height: 85vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: var(--shadow-lg); }
.mapping-header { padding: 16px 20px; border-bottom: 1px solid var(--c-border); display: flex; align-items: center; justify-content: space-between; }
.mapping-header h2 { font-size: 15px; font-weight: 700; }
.mapping-header p { font-size: 11px; color: var(--c-text-muted); margin-top: 2px; }
.mapping-body { flex: 1; overflow-y: auto; }
.mapping-footer { padding: 12px 20px; border-top: 1px solid var(--c-border); display: flex; justify-content: space-between; align-items: center; gap: 8px; }
@media (max-width: 900px) { .polizza-body { flex-direction: column; } .polizza-left { width: 100%; max-width: none; border-right: none; border-bottom: 1px solid var(--c-border); } }
`
