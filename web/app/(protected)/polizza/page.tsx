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
const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)
const IconSpinner = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }}>
    <circle cx="12" cy="12" r="10" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
  </svg>
)
const IconMap = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
  </svg>
)

interface PolizzaField { id: string; label: string; description?: string; enabled?: boolean }
interface Source { file: string; page: string }
interface CellTarget { sheet: string; cell: string }
interface Change { sheet: string; cell: string; label: string; oldValue: string; newValue: string; approved?: boolean }
interface RollingProgress {
  docIndex: number; docTotal: number; pageIndex: number; pageTotal: number
  docName: string; totalPagesProcessed: number; receivedAt?: number
}

function mappingSheetNames(defaultMapping: Record<string, CellTarget[]>): string[] {
  const s = new Set<string>()
  for (const arr of Object.values(defaultMapping || {})) for (const c of arr || []) if (c?.sheet) s.add(c.sheet)
  return s.size ? [...s] : ['RCT_O', 'RCP']
}

function ExtractedTable({ fields, data, sources, onUpdate }: {
  fields: PolizzaField[]; data: Record<string, string>; sources: Record<string, Source>; onUpdate: (id: string, val: string) => void
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
                {isEmpty ? <span style={{ color: 'var(--c-text-muted)', fontStyle: 'italic' }}>—</span>
                  : <input className="editable-cell" value={val ?? ''} onChange={(e) => onUpdate(f.id, e.target.value)} aria-label={f.label} />}
              </td>
              <td style={{ fontSize: 11, color: src ? 'var(--c-text-secondary)' : 'var(--c-text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }} title={src ? `${src.file} · pag. ${src.page}` : ''}>
                {src ? <span>{src.file}<br /><span style={{ color: 'var(--c-text-muted)' }}>pag. {src.page}</span></span> : <span style={{ fontStyle: 'italic' }}>—</span>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function MappingModal({ fields, mapping, defaultMapping, useAutoMapping, templateStructure, sheetNames, onUpdate, onToggleAuto, onClose }: {
  fields: PolizzaField[]; mapping: Record<string, CellTarget | undefined>; defaultMapping: Record<string, CellTarget[]>
  useAutoMapping: boolean; templateStructure: Record<string, unknown> | null; sheetNames: string[]
  onUpdate: (id: string, sheet: string, cell: string) => void; onToggleAuto: () => void; onClose: () => void
}) {
  const sheets = templateStructure ? Object.keys(templateStructure) : []
  const knownSheets = sheetNames && sheetNames.length > 0 ? sheetNames : ['RCT_O', 'RCP']
  const isCSATemplate = knownSheets.some((name) => sheets.includes(name))
  return (
    <div className="mapping-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mapping-modal" role="dialog" aria-modal="true" aria-label="Mappatura celle Excel">
        <div className="mapping-header">
          <div>
            <h2>Mappatura campi → celle Excel</h2>
            <p>{isCSATemplate ? 'Gestionale CSA riconosciuto — puoi usare la mappatura automatica o personalizzarla' : 'Indica in quale foglio e cella del gestionale inserire ciascun campo estratto'}</p>
          </div>
          <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={onClose}>Chiudi</button>
        </div>
        <div className="mapping-body">
          {isCSATemplate && (
            <div style={{ padding: '10px 14px', background: useAutoMapping ? 'rgba(34,197,94,0.08)' : 'var(--c-bg-card-alt)', border: '1px solid', borderColor: useAutoMapping ? 'rgba(34,197,94,0.3)' : 'var(--c-border)', borderRadius: 'var(--r-sm)', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: useAutoMapping ? 'var(--c-success)' : 'var(--c-text-secondary)' }}>
                  {useAutoMapping ? '✓ Mappatura automatica Gestionale CSA attiva' : 'Mappatura manuale personalizzata'}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--c-text-muted)', marginTop: '2px' }}>
                  {useAutoMapping ? `I dati verranno scritti nelle celle corrette di ${knownSheets.join(' e ')} automaticamente` : 'Specifica manualmente foglio e cella per ogni campo'}
                </div>
              </div>
              <button className="btn-secondary" style={{ fontSize: '11px', padding: '5px 10px', minWidth: '130px' }} onClick={onToggleAuto}>
                {useAutoMapping ? 'Usa mappatura manuale' : 'Usa auto-CSA'}
              </button>
            </div>
          )}
          {sheets.length > 0 && <div style={{ marginBottom: '8px', fontSize: '10px', color: 'var(--c-text-muted)' }}>Fogli nel template: {sheets.join(', ')}</div>}
          <table className="mapping-table">
            <thead>
              <tr>
                <th>Campo estratto</th>
                <th>Celle nel gestionale</th>
                <th style={{ display: useAutoMapping ? 'none' : undefined }}>Foglio</th>
                <th style={{ display: useAutoMapping ? 'none' : undefined }}>Cella</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => {
                const m = mapping[f.id] || ({} as CellTarget)
                const autoTargets = defaultMapping[f.id] || []
                const autoDesc = autoTargets.length > 0 ? autoTargets.map((t) => `${t.sheet}!${t.cell}`).join(', ') : '—'
                return (
                  <tr key={f.id}>
                    <td title={f.description}>{f.label}</td>
                    <td>
                      {useAutoMapping ? (
                        <span style={{ fontSize: '10px', color: autoTargets.length > 0 ? 'var(--c-success)' : 'var(--c-text-muted)', fontFamily: 'var(--font-mono)' }}>{autoDesc}</span>
                      ) : (
                        <input className="mapping-input" placeholder="RCT_O" value={m.sheet || ''} onChange={(e) => onUpdate(f.id, e.target.value, m.cell || '')} />
                      )}
                    </td>
                    {!useAutoMapping && (
                      <td>
                        <input className="mapping-input" placeholder="Es. C5" value={m.cell || ''} onChange={(e) => onUpdate(f.id, m.sheet || '', e.target.value)} style={{ maxWidth: '80px' }} />
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="mapping-footer">
          <button className="btn-secondary" onClick={onClose}>Chiudi e conferma</button>
        </div>
      </div>
    </div>
  )
}

function ChangePreviewModal({ changes, exporting, onChange, onConfirm, onClose }: {
  changes: Change[]; exporting: boolean; onChange: (updater: (prev: Change[]) => Change[]) => void
  onConfirm: (approved: Change[]) => void; onClose: () => void
}) {
  const approved = changes.filter((c) => c.approved)
  const allChecked = approved.length === changes.length
  const noneChecked = approved.length === 0
  const toggle = (idx: number) => onChange((prev) => prev.map((c, i) => (i === idx ? { ...c, approved: !c.approved } : c)))
  const toggleAll = () => onChange((prev) => prev.map((c) => ({ ...c, approved: !allChecked })))
  const bySheet: Record<string, (Change & { _idx: number })[]> = {}
  changes.forEach((c, idx) => {
    if (!bySheet[c.sheet]) bySheet[c.sheet] = []
    bySheet[c.sheet].push({ ...c, _idx: idx })
  })
  const totalChanged = changes.filter((c) => c.oldValue !== c.newValue && c.newValue !== '').length
  return (
    <div className="mapping-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mapping-modal" role="dialog" aria-modal="true" aria-label="Anteprima modifiche gestionale" style={{ width: 'min(900px, 95vw)', maxHeight: '85vh' }}>
        <div className="mapping-header">
          <div>
            <h2>Rivedi le modifiche al gestionale</h2>
            <p>{approved.length} di {changes.length} campi selezionati · <span style={{ color: 'var(--c-warning)' }}>{totalChanged} con valore precedente</span></p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="btn-secondary" style={{ fontSize: '11px', padding: '5px 10px' }} onClick={toggleAll}>{allChecked ? 'Deseleziona tutto' : 'Approva tutto'}</button>
            <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={onClose}>Annulla</button>
          </div>
        </div>
        <div className="mapping-body" style={{ padding: '0' }}>
          {Object.entries(bySheet).map(([sheetName, rows]) => (
            <div key={sheetName}>
              <div style={{ padding: '8px 20px', background: 'var(--c-bg-card-alt)', borderBottom: '1px solid var(--c-separator)', borderTop: '1px solid var(--c-separator)', fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ padding: '2px 8px', background: sheetName === 'RCT_O' ? 'rgba(59,130,246,0.15)' : 'rgba(34,197,94,0.15)', color: sheetName === 'RCT_O' ? 'var(--c-info)' : 'var(--c-success)', borderRadius: 'var(--r-full)', fontFamily: 'var(--font-mono)' }}>{sheetName}</span>
                {rows.filter((r) => r.approved).length} / {rows.length} selezionati
              </div>
              {rows.map((row) => {
                const hasOldValue = row.oldValue !== '' && row.oldValue !== '0'
                const isChanged = row.oldValue !== row.newValue
                return (
                  <div key={row._idx} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 80px 1fr 1fr', alignItems: 'center', padding: '0', borderBottom: '1px solid var(--c-separator)', background: row.approved ? 'transparent' : 'rgba(0,0,0,0.06)', opacity: row.approved ? 1 : 0.55, transition: 'background 0.12s, opacity 0.12s', cursor: 'pointer' }} onClick={() => toggle(row._idx)} role="row">
                    <div style={{ padding: '10px 0 10px 14px', display: 'flex', alignItems: 'center' }}>
                      <input type="checkbox" checked={row.approved} onChange={() => toggle(row._idx)} onClick={(e) => e.stopPropagation()} style={{ width: '14px', height: '14px', cursor: 'pointer', accentColor: 'var(--c-accent)' }} aria-label={`Approva ${row.label}`} />
                    </div>
                    <div style={{ padding: '10px 8px', fontSize: '11px', color: 'var(--c-text-secondary)', fontWeight: 500 }}>
                      <div>{row.label}</div>
                      <div style={{ fontSize: '10px', color: 'var(--c-text-muted)', fontFamily: 'var(--font-mono)' }}>cella {row.cell}</div>
                    </div>
                    <div style={{ padding: '10px 4px', textAlign: 'center' }}>
                      {isChanged ? <span style={{ fontSize: '9px', padding: '2px 5px', background: 'rgba(245,158,11,0.15)', color: 'var(--c-warning)', borderRadius: 'var(--r-full)', fontWeight: 700 }}>AGGIORNA</span>
                        : <span style={{ fontSize: '9px', padding: '2px 5px', background: 'rgba(107,114,128,0.12)', color: 'var(--c-text-muted)', borderRadius: 'var(--r-full)' }}>invariato</span>}
                    </div>
                    <div style={{ padding: '10px 8px', fontSize: '11px', borderLeft: '1px solid var(--c-separator)' }}>
                      <div style={{ fontSize: '9px', color: 'var(--c-text-muted)', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Attuale</div>
                      <div style={{ color: hasOldValue ? 'var(--c-text-primary)' : 'var(--c-text-muted)', fontStyle: hasOldValue ? 'normal' : 'italic', fontFamily: hasOldValue ? 'var(--font-mono)' : 'inherit', fontSize: hasOldValue ? '11px' : '10px', wordBreak: 'break-word' }}>{hasOldValue ? row.oldValue : '—'}</div>
                    </div>
                    <div style={{ padding: '10px 8px', fontSize: '11px', borderLeft: '1px solid var(--c-separator)' }}>
                      <div style={{ fontSize: '9px', color: 'var(--c-text-muted)', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Nuovo</div>
                      <div style={{ color: isChanged ? 'var(--c-success)' : 'var(--c-text-secondary)', fontWeight: isChanged ? 600 : 400, fontFamily: 'var(--font-mono)', fontSize: '11px', wordBreak: 'break-word' }}>{row.newValue || '—'}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <div className="mapping-footer" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '11px', color: 'var(--c-text-muted)' }}>
            {noneChecked ? 'Seleziona almeno un campo per procedere' : `Verranno scritti ${approved.length} campi nel gestionale`}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn-secondary" onClick={onClose} disabled={exporting}>Annulla</button>
            <button className="btn-success" onClick={() => onConfirm(approved)} disabled={noneChecked || exporting} style={{ minWidth: '160px' }} aria-busy={exporting}>
              {exporting ? <IconSpinner /> : <IconCheck />}
              {exporting ? 'Scrittura in corso…' : `Conferma ${approved.length} ${approved.length === 1 ? 'modifica' : 'modifiche'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
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

  // Template gestionale Excel
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [templateName, setTemplateName] = useState<string | null>(null)
  const [templateStructure, setTemplateStructure] = useState<Record<string, unknown> | null>(null)
  const [defaultMapping, setDefaultMapping] = useState<Record<string, CellTarget[]>>({})
  const [mapping, setMapping] = useState<Record<string, CellTarget | undefined>>({})
  const [showMapping, setShowMapping] = useState(false)
  const [useAutoMapping, setUseAutoMapping] = useState(true)
  const [previewChanges, setPreviewChanges] = useState<Change[] | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const templateInputRef = useRef<HTMLInputElement>(null)

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

  const openTemplatePicker = () => templateInputRef.current?.click()
  async function handleLoadTemplate(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      const form = new FormData()
      form.append('template', file)
      const res = await fetch('/api/polizza/template-structure', { method: 'POST', body: form })
      if (!res.ok) throw new Error('Lettura template fallita')
      const d = await res.json()
      setTemplateFile(file); setTemplateName(file.name); setTemplateStructure(d.structure || null); setDefaultMapping(d.defaultMapping || {}); setUseAutoMapping(true)
    } catch (err) {
      setError('Errore template: ' + (err as Error).message)
    } finally {
      e.target.value = ''
    }
  }
  async function handlePreviewChanges() {
    if (!extracted || !templateFile) return
    setLoadingPreview(true); setExportMsg(null); setError(null)
    try {
      const effectiveMapping = useAutoMapping ? {} : mapping
      const form = new FormData()
      form.append('template', templateFile)
      form.append('data', JSON.stringify(extracted))
      form.append('mapping', JSON.stringify(effectiveMapping))
      const res = await fetch('/api/polizza/preview', { method: 'POST', body: form })
      if (!res.ok) throw new Error('Preview fallita')
      const d = await res.json()
      setPreviewChanges((d.changes || []).map((c: Change) => ({ ...c, approved: true })))
      setShowPreview(true)
    } catch (err) {
      setError('Errore preview: ' + (err as Error).message)
    } finally {
      setLoadingPreview(false)
    }
  }
  async function handleExportApproved(approvedChanges: Change[]) {
    if (!templateFile) return
    setExporting(true); setExportMsg(null)
    try {
      const form = new FormData()
      form.append('template', templateFile)
      form.append('approvedChanges', JSON.stringify(approvedChanges))
      const res = await fetch('/api/polizza/export-template', { method: 'POST', body: form })
      if (!res.ok) throw new Error('Scrittura gestionale fallita')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = templateName || 'gestionale.xlsx'; a.click()
      URL.revokeObjectURL(url)
      setExportMsg('✓ Gestionale aggiornato: ' + (templateName || ''))
      setShowPreview(false); setPreviewChanges(null)
    } catch (err) {
      setExportMsg('✗ ' + (err as Error).message)
    } finally {
      setExporting(false)
    }
  }
  const updateMapping = (fieldId: string, sheet: string, cell: string) =>
    setMapping((prev) => ({ ...prev, [fieldId]: sheet && cell ? { sheet, cell: cell.toUpperCase() } : undefined }))

  const visibleFields = fields.filter((f) => f.enabled !== false)
  const isCSARecognized = !!templateStructure && mappingSheetNames(defaultMapping).some((name) => Object.keys(templateStructure).includes(name))

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
      a.href = url; a.download = 'polizza_rc.xlsx'; a.click()
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
        .polizza-template-block { background: var(--c-bg-card-alt); border: 1px solid var(--c-border); border-radius: var(--r-sm); padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
        .polizza-template-label { font-size: 10px; font-weight: 600; color: var(--c-text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .polizza-template-file { font-size: 11px; color: var(--c-accent); display: flex; align-items: center; gap: 4px; }
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
        .mapping-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 100; }
        .mapping-modal { background: var(--c-bg-card); border: 1px solid var(--c-border); border-radius: var(--r-lg); width: min(820px, 92vw); max-height: 80vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: var(--shadow-lg); }
        .mapping-header { padding: 16px 20px; border-bottom: 1px solid var(--c-border); display: flex; align-items: center; justify-content: space-between; }
        .mapping-header h2 { font-size: 15px; font-weight: 700; }
        .mapping-header p { font-size: 11px; color: var(--c-text-muted); margin-top: 2px; }
        .mapping-body { flex: 1; overflow-y: auto; padding: 16px 20px; }
        .mapping-table { width: 100%; border-collapse: collapse; }
        .mapping-table th, .mapping-table td { padding: 6px 8px; font-size: 11px; border-bottom: 1px solid var(--c-separator); text-align: left; }
        .mapping-table th { font-weight: 600; font-size: 10px; text-transform: uppercase; color: var(--c-text-muted); background: var(--c-bg-card-alt); }
        .mapping-table td:first-child { color: var(--c-text-secondary); width: 38%; }
        .mapping-input { padding: 4px 7px; background: var(--c-bg-input); border: 1px solid var(--c-border); border-radius: var(--r-sm); color: var(--c-text-primary); font-size: 11px; width: 100%; }
        .mapping-input:focus { border-color: var(--c-accent); outline: none; }
        .mapping-footer { padding: 12px 20px; border-top: 1px solid var(--c-border); display: flex; justify-content: flex-end; gap: 8px; }
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
              onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onClick={openFilePicker}
              role="button" tabIndex={0} aria-label="Trascina PDF della polizza o clicca per selezionarli"
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

            <div className="polizza-template-block">
              <div className="polizza-template-label">Gestionale Excel (opzionale)</div>
              {templateName ? (
                <>
                  <div className="polizza-template-file"><IconExcel /> {templateName}</div>
                  {isCSARecognized && (
                    <div style={{ fontSize: '10px', color: 'var(--c-success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <IconCheck /> Gestionale CSA riconosciuto — mappatura automatica attiva
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: '11px', color: 'var(--c-text-muted)' }}>Nessun template caricato</div>
              )}
              <button className="btn-secondary" style={{ fontSize: '11px', padding: '6px 10px' }} onClick={openTemplatePicker}>
                <IconExcel /> {templateName ? 'Cambia template…' : 'Carica gestionale Excel…'}
              </button>
              <input ref={templateInputRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={handleLoadTemplate} />
              {templateName && (
                <button className="btn-secondary" style={{ fontSize: '11px', padding: '6px 10px', borderColor: 'var(--c-accent)', color: 'var(--c-accent)' }} onClick={() => setShowMapping(true)}>
                  <IconMap /> {useAutoMapping ? 'Verifica/modifica mappatura…' : 'Configura mappatura celle…'}
                </button>
              )}
            </div>
          </div>

          <div className="polizza-actions">
            {error && <div className="polizza-error">⚠ {error}</div>}
            <button className="btn-primary" onClick={handleExtract} disabled={!files.length || extracting} aria-busy={extracting}>
              {extracting ? <IconSpinner /> : '⚡'}
              {extracting ? 'Estrazione in corso…' : 'Estrai dati polizza'}
            </button>
            {extracted && (
              <button className="btn-success" onClick={handleExportNew} disabled={exporting}>
                <IconExcel /> Esporta nuovo Excel
              </button>
            )}
            {extracted && templateName && (
              <button className="btn-secondary" onClick={handlePreviewChanges} disabled={exporting || loadingPreview} style={{ borderColor: 'var(--c-info)', color: 'var(--c-info)' }}>
                {loadingPreview ? <IconSpinner /> : <IconExcel />}
                {loadingPreview ? 'Lettura template…' : 'Rivedi e popola gestionale…'}
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
                <ExtractedTable fields={visibleFields} data={extracted} sources={sources} onUpdate={(id, val) => !extracting && setExtracted((prev) => ({ ...(prev || {}), [id]: val }))} />
              </>
            )}
          </div>
        </div>
      </div>

      {showMapping && (
        <MappingModal
          fields={visibleFields} mapping={mapping} defaultMapping={defaultMapping} useAutoMapping={useAutoMapping}
          templateStructure={templateStructure} sheetNames={mappingSheetNames(defaultMapping)}
          onUpdate={updateMapping} onToggleAuto={() => setUseAutoMapping((v) => !v)} onClose={() => setShowMapping(false)}
        />
      )}
      {showPreview && previewChanges && (
        <ChangePreviewModal
          changes={previewChanges} exporting={exporting} onChange={(updater) => setPreviewChanges((prev) => (prev ? updater(prev) : prev))}
          onConfirm={handleExportApproved} onClose={() => { setShowPreview(false); setPreviewChanges(null) }}
        />
      )}
    </div>
  )
}
