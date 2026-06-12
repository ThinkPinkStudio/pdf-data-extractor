import { useState, useRef, useCallback, useEffect } from 'react'

// ─── Icone inline ─────────────────────────────────────────────────────────────

const IconUpload = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)

const IconFile = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
)

const IconX = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const IconExcel = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18" />
  </svg>
)

const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const IconSpinner = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }}>
    <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
  </svg>
)

const IconMap = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
    <line x1="8" y1="2" x2="8" y2="18" />
    <line x1="16" y1="6" x2="16" y2="22" />
  </svg>
)

// ─── Icone cicliche per i tab polizza ─────────────────────────────────────────
const TAB_ICONS = ['🔵', '🟢', '🟠', '🟡', '🟣', '🔴']

// ─── Etichette dei tipi documento ────────────────────────────────────────────

const DOC_TYPES = [
  { id: 'polizza', label: 'Polizza principale', hint: 'Es. Polizza_RCTOP.pdf — frontespizio con premi e massimali' },
  { id: 'appendice', label: 'App. rinnovo / variazione', hint: 'Es. App_rinnovo_2024.pdf, App_R4_per_premio.pdf' },
  { id: 'allegato', label: 'App. n.1 / allegati', hint: 'Es. App.n._1_polizza.pdf — condizioni particolari' },
  { id: 'cga', label: 'Condizioni generali (CGA)', hint: 'Es. CGA_PMI_GENERAIMPRESA.pdf (opzionale, migliora contesto)' }
]

// ─── Campi per i due fogli ────────────────────────────────────────────────────

const SHEET_LABELS = {
  'RCT_O': 'RC verso Terzi e verso Operai (RCT_O)',
  'RCP': 'RC Prodotti (RCP)'
}

// ─── Componente principale ────────────────────────────────────────────────────

export default function Polizza({ visible }) {
  const [files, setFiles] = useState([])           // { path, name, type }
  const [dragging, setDragging] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState(null)  // { fieldId: value }
  const [sources, setSources] = useState({})         // { fieldId: { file, page } }
  const [fields, setFields] = useState([])           // ALL_POLIZZA_FIELDS
  const [error, setError] = useState(null)
  const [polizzaTypes, setPolizzaTypes] = useState([
    { id: 'RCT_O', label: 'RC Terzi / Operai' },
    { id: 'RCP', label: 'RC Prodotti' }
  ])
  const [activeTab, setActiveTab] = useState('RCT_O')
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState(null)

  // Vision OCR (PDF scansionati)
  const [visionExtracting, setVisionExtracting] = useState(false)
  const [visionMsg, setVisionMsg] = useState(null)  // null | 'extracting' | 'done' | 'error'
  const [scannedFiles, setScannedFiles] = useState([])

  // Template
  const [templatePath, setTemplatePath] = useState(null)
  const [templateName, setTemplateName] = useState(null)
  const [templateStructure, setTemplateStructure] = useState(null)  // { sheetName: [{addr, value}] }
  const [defaultMapping, setDefaultMapping] = useState({})  // CSA mapping from backend
  const [mapping, setMapping] = useState({})   // { fieldId: { sheet, cell } } custom override
  const [showMapping, setShowMapping] = useState(false)
  const [useAutoMapping, setUseAutoMapping] = useState(true)  // usa il mapping CSA predefinito

  // Preview modifiche
  const [previewChanges, setPreviewChanges] = useState(null)  // Array<change> | null
  const [showPreview, setShowPreview] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)

  // Progresso rolling (aggiornato via IPC durante l'estrazione)
  const [rollingProgress, setRollingProgress] = useState(null)
  // { docIndex, docTotal, pageIndex, pageTotal, docName, state, receivedAt }

  // Tick di liveness: re-render al secondo durante l'estrazione, così il
  // contatore mostra il tempo che passa anche durante una singola chiamata
  // LLM lunga (es. vision su una pagina) in cui File/Pag. non possono avanzare
  const [, setLivenessTick] = useState(0)
  useEffect(() => {
    if (!extracting && !visionExtracting) return
    const t = setInterval(() => setLivenessTick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [extracting, visionExtracting])

  // Secondi trascorsi dall'ultimo avanzamento del progresso (liveness)
  const liveSecs = (p) => {
    if (!p?.receivedAt) return ''
    const s = Math.max(0, Math.floor((Date.now() - p.receivedAt) / 1000))
    return s >= 2 ? ` · in analisi da ${s}s` : ''
  }

  // True mentre un'estrazione è in corso: gli eventi di progresso arrivati
  // fuori da un run attivo vengono ignorati
  const runActiveRef = useRef(false)
  const diagLogsRef = useRef([])
  const lastSettingsRef = useRef(null)
  const [showDiagBtn, setShowDiagBtn] = useState(false)
  const [diagSaved, setDiagSaved] = useState(false)

  const buildDiagText = () => {
    const s = lastSettingsRef.current || {}
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
    const provider = s.llmProvider || 'ollama'
    const modelLine = provider === 'openai'
      ? `Modello: ${s.openaiModel || '(non impostato)'}`
      : provider === 'anthropic'
        ? `Modello: ${s.anthropicModel || '(non impostato)'}`
        : `Modello testo: ${s.ollamaModel || '(non impostato)'}  Modello vision: ${s.ollamaVisionModel || '(non impostato)'}  URL: ${s.ollamaUrl || ''}`
    const lines = [
      '=== DIAGNOSTICA ESTRAZIONE POLIZZA ===',
      `Data/ora:     ${ts}`,
      `Provider LLM: ${provider}`,
      modelLine,
      '',
      '=== FILE CARICATI ===',
      ...files.map((f, i) => `${i + 1}. ${f.name} [${f.type || 'polizza'}]`),
      '',
      '=== LOG ESTRAZIONE ===',
      ...(diagLogsRef.current.length ? diagLogsRef.current : ['(nessun log disponibile)']),
      '',
      '=== DATI ESTRATTI ===',
    ]
    if (extracted) {
      for (const [k, v] of Object.entries(extracted)) {
        lines.push(`${k}: ${v !== null && v !== undefined && v !== '' ? String(v) : '(vuoto)'}`)
      }
    } else {
      lines.push('(nessun dato estratto)')
    }
    if (error) lines.push('', '=== ERRORE FINALE ===', error)
    return lines.join('\n')
  }

  const handleSaveDiagnostics = async () => {
    const content = buildDiagText()
    const res = await window.electronAPI.polizzaSaveDiagnostics(content)
    if (res?.success) {
      setDiagSaved(true)
      setTimeout(() => setDiagSaved(false), 3000)
    }
  }

  // Listener di progresso registrato UNA volta al mount (non per-run): la
  // registrazione per-click + removeAllListeners nel finally poteva perdere
  // gli eventi al minimo disallineamento, lasciando il contatore fermo
  useEffect(() => {
    window.electronAPI.onPolizzaRollingProgress((progress) => {
      if (!runActiveRef.current) return
      const _progMsg = `File ${(progress.docIndex ?? 0) + 1}/${progress.docTotal} · pag ${progress.pageIndex}/${progress.pageTotal}`
      console.log(`[polizza:ui] progresso: ${_progMsg}`)
      diagLogsRef.current.push(`[${new Date().toTimeString().slice(0, 8)}] ${_progMsg}`)
      setRollingProgress({ ...progress, receivedAt: Date.now() })
      const flat = flattenRollingState(progress.state)
      if (Object.keys(flat).length > 0) setExtracted(flat)
    })
    return () => window.electronAPI.removePolizzaRollingListeners()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const inputRef = useRef(null)

  // Carica (o ricarica) i campi e i tipi ogni volta che la pagina diventa visibile
  useEffect(() => {
    if (visible === false) return
    window.electronAPI.polizzaGetFields().then(setFields).catch(() => { })
    window.electronAPI.polizzaGetDefaultMapping().then(setDefaultMapping).catch(() => { })
    window.electronAPI.polizzaGetTypes().then(types => {
      if (types?.length) {
        setPolizzaTypes(types)
        setActiveTab(prev => types.some(t => t.id === prev) ? prev : types[0].id)
      }
    }).catch(() => { })
  }, [visible])

  // ─── Drag & drop ────────────────────────────────────────────────────────────

  const addFilePaths = useCallback((paths) => {
    const newFiles = paths.map(p => ({
      path: p,
      name: p.split(/[\\/]/).pop(),
      type: guessDocType(p)
    }))
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.path))
      return [...prev, ...newFiles.filter(f => !existing.has(f.path))]
    })
  }, [])

  const onDragOver = (e) => { e.preventDefault(); setDragging(true) }
  const onDragLeave = () => setDragging(false)
  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const paths = Array.from(e.dataTransfer.files)
      .filter(f => f.name.toLowerCase().endsWith('.pdf'))
      .map(f => f.path)
    if (paths.length) addFilePaths(paths)
  }, [addFilePaths])

  const openFilePicker = async () => {
    const paths = await window.electronAPI.openMultiplePDFsDialog()
    if (paths?.length) addFilePaths(paths)
  }

  const removeFile = (path) => setFiles(prev => prev.filter(f => f.path !== path))

  const setFileType = (path, type) =>
    setFiles(prev => prev.map(f => f.path === path ? { ...f, type } : f))

  // ─── Estrazione rolling ──────────────────────────────────────────────────────

  // Appiattisce lo stato rolling {field: {valore, data_validita}} → {field: value}
  const flattenRollingState = (state) => {
    const flat = {}
    for (const [key, entry] of Object.entries(state || {})) {
      if (entry == null) continue
      if (typeof entry === 'object' && 'valore' in entry) {
        if (entry.valore != null && entry.valore !== '') flat[key] = entry.valore
      } else if (typeof entry === 'string' && entry !== '') {
        flat[key] = entry
      }
    }
    return flat
  }

  const handleExtract = async () => {
    if (!files.length) return
    setExtracting(true)
    setError(null)
    setExtracted(null)
    setSources({})
    setExportMsg(null)
    setVisionMsg(null)
    setScannedFiles([])
    setRollingProgress(null)
    setShowDiagBtn(false)
    setDiagSaved(false)
    diagLogsRef.current = []
    runActiveRef.current = true

    try {
      const s = await window.electronAPI.getSettings().catch(() => null)
      if (s) {
        const { openaiApiKey: _ok, anthropicApiKey: _ak, ...safeSettings } = s
        lastSettingsRef.current = safeSettings
      }
    } catch { /* settings non critiche per l'estrazione */ }
    diagLogsRef.current.push(`[${new Date().toTimeString().slice(0, 8)}] Inizio estrazione - ${files.length} file`)

    try {
      const filesWithTypes = files.map(f => ({ path: f.path, type: f.type }))
      const res = await window.electronAPI.polizzaExtractRolling(filesWithTypes)
      if (!res.success) throw new Error(res.error)

      diagLogsRef.current.push(`[${new Date().toTimeString().slice(0, 8)}] Estrazione testo completata`)

      // Usa lo stato rolling strutturato se disponibile, altrimenti data piatto
      const flatData = flattenRollingState(res.rollingState)
      setExtracted(Object.keys(flatData).length > 0 ? flatData : (res.data || {}))
      setSources(res.sources || {})

      // PDF scansionati: vision rolling pagina per pagina
      if (res.scannedFiles?.length > 0) {
        setScannedFiles(res.scannedFiles)
        await handleVisionRolling(res.scannedFiles, res.rollingState || {})
      }
    } catch (err) {
      diagLogsRef.current.push(`[${new Date().toTimeString().slice(0, 8)}] ERRORE: ${err.message}`)
      setError(err.message)
    } finally {
      runActiveRef.current = false
      setExtracting(false)
      setRollingProgress(null)
      setShowDiagBtn(true)
    }
  }

  // ─── Vision rolling: PDF scansionati pagina per pagina ───────────────────────

  // Processa i PDF scansionati una pagina alla volta, aggiornando lo stato rolling
  // dopo ogni immagine. Tiene aperto il doc pdfjs per l'intero documento, poi lo libera.
  const handleVisionRolling = async (scannedFilesList, initialRollingState) => {
    if (!scannedFilesList?.length) return

    setVisionExtracting(true)
    setVisionMsg('extracting')

    // Importa pdfjs una volta sola per tutto il ciclo vision
    let pdfjs
    try {
      const pdfjsLib = await import('pdfjs-dist')
      pdfjs = pdfjsLib.default || pdfjsLib
      if (pdfjs.GlobalWorkerOptions) {
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'
      }
    } catch (err) {
      console.error('[vision:rolling] pdfjs non disponibile:', err.message)
      setVisionMsg('error')
      setVisionExtracting(false)
      return
    }

    diagLogsRef.current.push(`[${new Date().toTimeString().slice(0, 8)}] OCR visivo: inizio - ${scannedFilesList.length} file scansionati`)
    let currentState = { ...initialRollingState }
    let totalPagesProcessed = 0
    let consecutiveFailures = 0

    try {
      for (let sfIdx = 0; sfIdx < scannedFilesList.length; sfIdx++) {
        const sf = scannedFilesList[sfIdx]
        const docName = sf.path.split(/[\\/]/).pop()

        const bufResult = await window.electronAPI.polizzaGetFileBuffer(sf.path)
        if (!bufResult.success) {
          console.warn(`[vision:rolling] Buffer non disponibile per ${docName}`)
          continue
        }

        let doc
        try {
          doc = await pdfjs.getDocument({ data: new Uint8Array(bufResult.buffer) }).promise
        } catch (err) {
          console.warn(`[vision:rolling] Apertura PDF fallita per ${docName}:`, err.message)
          continue
        }

        const totalPages = doc.numPages
        console.log(`[vision:rolling] ${docName}: ${totalPages} pagine`)

        try {
          for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            totalPagesProcessed++
            setRollingProgress({
              docIndex: sfIdx,
              docTotal: scannedFilesList.length,
              pageIndex: pageNum,
              pageTotal: totalPages,
              docName,
              totalPagesProcessed,
              state: currentState,
              receivedAt: Date.now()
            })

            let imageBase64
            try {
              const page = await doc.getPage(pageNum)
              // Limita il lato lungo a ~1600px: le scansioni ad alta risoluzione
              // a scala fissa 2.0 producono immagini enormi che rallentano
              // drasticamente (o mandano in timeout) il modello vision
              const baseViewport = page.getViewport({ scale: 1 })
              const scale = Math.min(2, 1600 / Math.max(baseViewport.width, baseViewport.height))
              const viewport = page.getViewport({ scale })
              const canvas = document.createElement('canvas')
              canvas.width = viewport.width
              canvas.height = viewport.height
              await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
              imageBase64 = canvas.toDataURL('image/jpeg', 0.85)
              page.cleanup()
            } catch (err) {
              console.warn(`[vision:rolling] Rendering pag. ${pageNum} fallito:`, err.message)
              continue
            }

            const res = await window.electronAPI.polizzaRollingVisionUpdate({
              state: currentState,
              imageBase64,
              docType: sf.type || 'polizza',
              pageNum,
              totalPages
            })

            if (res.success) {
              currentState = res.state
              consecutiveFailures = 0
              diagLogsRef.current.push(`[${new Date().toTimeString().slice(0, 8)}] OCR vision pag. ${pageNum}/${totalPages} di ${docName}: OK`)
              setExtracted(flattenRollingState(currentState))
            } else {
              consecutiveFailures++
              diagLogsRef.current.push(`[${new Date().toTimeString().slice(0, 8)}] OCR vision pag. ${pageNum}/${totalPages} di ${docName}: ${res.error}`)
              console.warn(`[vision:rolling] Pag. ${pageNum}/${totalPages} di ${docName}: ${res.error}`)
              // Ollama spento → inutile insistere; timeout/errori ripetuti → stop
              if (res.connectionError ||
                  (res.timeoutError && consecutiveFailures >= 2) ||
                  consecutiveFailures >= 3) {
                throw new Error(res.error)
              }
            }
          }
        } finally {
          try { await doc.destroy() } catch { /* già distrutto */ }
        }
      }

      diagLogsRef.current.push(`[${new Date().toTimeString().slice(0, 8)}] OCR visivo completato (${totalPagesProcessed} pagine)`)
      setVisionMsg('done')
    } catch (err) {
      diagLogsRef.current.push(`[${new Date().toTimeString().slice(0, 8)}] OCR visivo ERRORE: ${err.message}`)
      console.error('[vision:rolling] Errore:', err.message)
      setVisionMsg('error')
      setError('Vision OCR: ' + err.message)
    } finally {
      setVisionExtracting(false)
      setRollingProgress(null)
    }
  }

  // ─── Export nuovo Excel ──────────────────────────────────────────────────────

  const handleExportNew = async () => {
    if (!extracted) return
    setExporting(true)
    setExportMsg(null)
    try {
      const suggestedName = `polizza_${extracted.polizza_numero || 'rc'}_${extracted.contraente?.split(' ')[0] || 'dati'}`
      const res = await window.electronAPI.polizzaExportNew(extracted, suggestedName)
      if (res.success) setExportMsg('✓ File Excel salvato: ' + res.filePath.split(/[\\/]/).pop())
      else if (!res.canceled) throw new Error(res.error)
    } catch (err) {
      setExportMsg('✗ ' + err.message)
    } finally {
      setExporting(false)
    }
  }

  // ─── Template Excel ──────────────────────────────────────────────────────────

  const handleLoadTemplate = async () => {
    const path = await window.electronAPI.openExcelDialog()
    if (!path) return
    setTemplatePath(path)
    setTemplateName(path.split(/[\\/]/).pop())
    setExportMsg(null)
    try {
      const res = await window.electronAPI.polizzaReadTemplateStructure(path)
      if (res.success) {
        setTemplateStructure(res.structure)
        // Riconosci automaticamente il Gestionale CSA
        const sheets = Object.keys(res.structure)
        if (polizzaTypes.some(t => sheets.includes(t.id))) {
          setUseAutoMapping(true)
        }
      } else throw new Error(res.error)
    } catch (err) {
      setError('Errore lettura template: ' + err.message)
    }
  }

  // Step 1: carica il diff vecchio→nuovo e apre il modal di review
  const handlePreviewChanges = async () => {
    if (!extracted || !templatePath) return
    setLoadingPreview(true)
    setExportMsg(null)
    setError(null)
    try {
      const effectiveMapping = useAutoMapping ? {} : mapping
      const res = await window.electronAPI.polizzaPreviewChanges(templatePath, extracted, effectiveMapping)
      if (!res.success) throw new Error(res.error)
      // Inizializza tutte le modifiche come approvate
      const withApproval = res.changes.map(c => ({ ...c, approved: true }))
      setPreviewChanges(withApproval)
      setShowPreview(true)
    } catch (err) {
      setError('Errore preview: ' + err.message)
    } finally {
      setLoadingPreview(false)
    }
  }

  // Step 2: scrivi solo i campi approvati
  const handleExportApproved = async (approvedChanges) => {
    if (!templatePath) return
    setExporting(true)
    setExportMsg(null)
    try {
      const res = await window.electronAPI.polizzaExportApproved(templatePath, approvedChanges)
      if (res.success) {
        setExportMsg('✓ Gestionale aggiornato: ' + res.filePath.split(/[\\/]/).pop())
        setShowPreview(false)
        setPreviewChanges(null)
      } else if (!res.canceled) throw new Error(res.error)
    } catch (err) {
      setExportMsg('✗ ' + err.message)
    } finally {
      setExporting(false)
    }
  }

  // Aggiorna mappatura campo → cella Excel
  const updateMapping = (fieldId, sheet, cell) => {
    setMapping(prev => ({
      ...prev,
      [fieldId]: sheet && cell ? { sheet, cell: cell.toUpperCase() } : undefined
    }))
  }

  // ─── Campi per sheet attivo ──────────────────────────────────────────────────

  const sheetFields = fields.filter(f => f.sheet === activeTab)

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="polizza-page">
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }

        .polizza-page {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
          background: var(--c-bg-content);
        }
        .polizza-header {
          padding: 20px 24px 14px;
          border-bottom: 1px solid var(--c-border);
          flex-shrink: 0;
        }
        .polizza-header h1 {
          font-size: 18px;
          font-weight: 700;
          margin-bottom: 2px;
          color: var(--c-text-primary);
        }
        .polizza-header p {
          font-size: 12px;
          color: var(--c-text-muted);
        }
        .polizza-body {
          display: flex;
          flex: 1;
          overflow: hidden;
          gap: 0;
        }
        /* ─ Pannello sinistra: caricamento file */
        .polizza-left {
          width: 340px;
          min-width: 280px;
          max-width: 380px;
          border-right: 1px solid var(--c-border);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .polizza-left-inner {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        /* ─ Dropzone */
        .polizza-dropzone {
          border: 2px dashed var(--c-border);
          border-radius: var(--r-md);
          padding: 22px 14px;
          text-align: center;
          cursor: pointer;
          transition: border-color var(--t-normal), background var(--t-normal);
          background: var(--c-bg-card);
        }
        .polizza-dropzone.dragging,
        .polizza-dropzone:hover {
          border-color: var(--c-accent);
          background: var(--c-accent-faint);
        }
        .polizza-dropzone .dz-icon {
          color: var(--c-accent);
          margin-bottom: 6px;
        }
        .polizza-dropzone p {
          font-size: 12px;
          color: var(--c-text-secondary);
          margin: 2px 0;
        }
        .polizza-dropzone .dz-btn {
          margin-top: 8px;
          font-size: 12px;
          font-weight: 600;
          color: var(--c-accent);
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: var(--r-sm);
          transition: background var(--t-fast);
        }
        .polizza-dropzone .dz-btn:hover { background: var(--c-accent-faint); }
        /* ─ Lista file */
        .polizza-file-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .polizza-file-item {
          background: var(--c-bg-card);
          border: 1px solid var(--c-border);
          border-radius: var(--r-sm);
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .polizza-file-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .polizza-file-name {
          flex: 1;
          font-size: 11px;
          color: var(--c-text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .polizza-file-remove {
          flex-shrink: 0;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--c-text-muted);
          padding: 2px;
          border-radius: 3px;
          line-height: 1;
          transition: color var(--t-fast);
        }
        .polizza-file-remove:hover { color: var(--c-error); }
        .polizza-file-type {
          font-size: 10px;
          padding: 2px 6px;
          background: var(--c-bg-hover);
          border-radius: var(--r-full);
          color: var(--c-text-secondary);
          border: none;
          cursor: pointer;
          width: 100%;
          text-align: left;
        }
        .polizza-type-select {
          font-size: 10px;
          width: 100%;
          padding: 3px 6px;
          background: var(--c-bg-input);
          border: 1px solid var(--c-border);
          border-radius: var(--r-sm);
          color: var(--c-text-secondary);
          cursor: pointer;
        }
        /* ─ Azioni */
        .polizza-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex-shrink: 0;
          padding: 12px 16px;
          border-top: 1px solid var(--c-border);
        }
        .btn-primary {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          padding: 10px 16px;
          background: var(--gradient-accent);
          color: #fff;
          border: none;
          border-radius: var(--r-md);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity var(--t-fast);
        }
        .btn-primary:hover:not(:disabled) { opacity: 0.88; }
        .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-secondary {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          padding: 8px 14px;
          background: var(--c-bg-card);
          color: var(--c-text-primary);
          border: 1px solid var(--c-border);
          border-radius: var(--r-md);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background var(--t-fast), border-color var(--t-fast);
        }
        .btn-secondary:hover:not(:disabled) { background: var(--c-bg-hover); border-color: var(--c-accent); }
        .btn-secondary:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-success {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          padding: 8px 14px;
          background: var(--c-success);
          color: #fff;
          border: none;
          border-radius: var(--r-md);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          opacity: 0.9;
          transition: opacity var(--t-fast);
        }
        .btn-success:hover:not(:disabled) { opacity: 1; }
        .btn-success:disabled { opacity: 0.4; cursor: not-allowed; }
        /* ─ Template block */
        .polizza-template-block {
          background: var(--c-bg-card-alt);
          border: 1px solid var(--c-border);
          border-radius: var(--r-sm);
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .polizza-template-label {
          font-size: 10px;
          font-weight: 600;
          color: var(--c-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .polizza-template-file {
          font-size: 11px;
          color: var(--c-accent);
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .export-msg {
          font-size: 11px;
          color: var(--c-success);
          padding: 6px 8px;
          background: rgba(34,197,94,0.08);
          border-radius: var(--r-sm);
          border: 1px solid rgba(34,197,94,0.2);
        }
        .export-msg.error {
          color: var(--c-error);
          background: rgba(239,68,68,0.08);
          border-color: rgba(239,68,68,0.2);
        }
        /* ─ Pannello destra: risultati */
        .polizza-right {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .polizza-tabs {
          display: flex;
          border-bottom: 1px solid var(--c-border);
          flex-shrink: 0;
          padding: 0 16px;
          background: var(--c-bg-content);
        }
        .polizza-tab {
          padding: 12px 16px;
          font-size: 12px;
          font-weight: 600;
          color: var(--c-text-muted);
          border: none;
          background: none;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: color var(--t-fast), border-color var(--t-fast);
          white-space: nowrap;
        }
        .polizza-tab.active {
          color: var(--c-accent);
          border-bottom-color: var(--c-accent);
        }
        .polizza-tab:hover:not(.active) { color: var(--c-text-primary); }
        .polizza-results {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
        }
        .polizza-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--c-text-muted);
          text-align: center;
          gap: 8px;
        }
        .polizza-empty svg { opacity: 0.3; }
        .polizza-empty h3 { font-size: 15px; font-weight: 600; }
        .polizza-empty p { font-size: 12px; }
        /* ─ Tabella risultati */
        .polizza-table {
          width: 100%;
          border-collapse: collapse;
        }
        .polizza-table th, .polizza-table td {
          padding: 8px 12px;
          text-align: left;
          font-size: 12px;
          border-bottom: 1px solid var(--c-separator);
        }
        .polizza-table th {
          font-weight: 600;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--c-text-muted);
          background: var(--c-bg-card);
          position: sticky;
          top: 0;
          z-index: 1;
        }
        .polizza-table td:first-child {
          color: var(--c-text-secondary);
          width: 42%;
          font-weight: 500;
        }
        .polizza-table td:last-child {
          color: var(--c-text-primary);
          font-weight: 400;
        }
        .polizza-table tr:hover td { background: var(--c-bg-hover); }
        .value-null { color: var(--c-text-muted) !important; font-style: italic; }
        .value-ok   { color: var(--c-success) !important; font-weight: 500 !important; }
        .editable-cell {
          width: 100%;
          background: transparent;
          border: none;
          outline: none;
          color: inherit;
          font: inherit;
          padding: 0;
        }
        .editable-cell:focus {
          background: var(--c-bg-input);
          border-radius: 3px;
          padding: 2px 4px;
        }
        /* ─ Mapping modal */
        .mapping-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
        }
        .mapping-modal {
          background: var(--c-bg-card);
          border: 1px solid var(--c-border);
          border-radius: var(--r-lg);
          width: min(820px, 92vw);
          max-height: 80vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: var(--shadow-lg);
        }
        .mapping-header {
          padding: 16px 20px;
          border-bottom: 1px solid var(--c-border);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .mapping-header h2 { font-size: 15px; font-weight: 700; }
        .mapping-header p  { font-size: 11px; color: var(--c-text-muted); margin-top: 2px; }
        .mapping-body {
          flex: 1;
          overflow-y: auto;
          padding: 16px 20px;
        }
        .mapping-table {
          width: 100%;
          border-collapse: collapse;
        }
        .mapping-table th, .mapping-table td {
          padding: 6px 8px;
          font-size: 11px;
          border-bottom: 1px solid var(--c-separator);
          text-align: left;
        }
        .mapping-table th {
          font-weight: 600;
          font-size: 10px;
          text-transform: uppercase;
          color: var(--c-text-muted);
          background: var(--c-bg-card-alt);
        }
        .mapping-table td:first-child { color: var(--c-text-secondary); width: 38%; }
        .mapping-input {
          padding: 4px 7px;
          background: var(--c-bg-input);
          border: 1px solid var(--c-border);
          border-radius: var(--r-sm);
          color: var(--c-text-primary);
          font-size: 11px;
          width: 100%;
        }
        .mapping-input:focus { border-color: var(--c-accent); outline: none; }
        .mapping-footer {
          padding: 12px 20px;
          border-top: 1px solid var(--c-border);
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
        .polizza-error {
          margin: 0 16px;
          padding: 10px 14px;
          background: rgba(239,68,68,0.08);
          border: 1px solid rgba(239,68,68,0.25);
          border-radius: var(--r-sm);
          font-size: 12px;
          color: var(--c-error);
          flex-shrink: 0;
        }
        .section-title {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--c-text-muted);
          margin-bottom: 6px;
        }
      `}</style>

      {/* Header */}
      <div className="polizza-header">
        <h1>🛡️ Polizze</h1>
        <p>Estrazione automatica dati da polizze Responsabilità Civile (RCT/O/P) · fogli Excel RCT_O e RCP</p>
      </div>

      <div className="polizza-body">
        {/* ── Pannello sinistro: caricamento ────────────────────────────────── */}
        <div className="polizza-left">
          <div className="polizza-left-inner">

            {/* Dropzone */}
            <div
              className={`polizza-dropzone${dragging ? ' dragging' : ''}`}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={openFilePicker}
              role="button"
              tabIndex={0}
              aria-label="Trascina PDF della polizza o clicca per selezionarli"
              onKeyDown={e => e.key === 'Enter' && openFilePicker()}
            >
              <div className="dz-icon"><IconUpload /></div>
              <p style={{ fontWeight: 600, fontSize: '13px', color: 'var(--c-text-primary)' }}>
                Trascina i PDF della polizza
              </p>
              <p>Carica tutti i documenti: polizza, appendici, condizioni</p>
              <button className="dz-btn" onClick={e => { e.stopPropagation(); openFilePicker() }}>
                Seleziona file PDF
              </button>
            </div>

            {/* Lista file caricati */}
            {files.length > 0 && (
              <div>
                <div className="section-title">Documenti caricati ({files.length})</div>
                <div className="polizza-file-list">
                  {files.map(f => (
                    <div key={f.path} className="polizza-file-item">
                      <div className="polizza-file-row">
                        <IconFile />
                        <span className="polizza-file-name" title={f.path}>{f.name}</span>
                        <button
                          className="polizza-file-remove"
                          onClick={() => removeFile(f.path)}
                          aria-label={`Rimuovi ${f.name}`}
                        >
                          <IconX />
                        </button>
                      </div>
                      <select
                        className="polizza-type-select"
                        value={f.type}
                        onChange={e => setFileType(f.path, e.target.value)}
                        aria-label="Tipo documento"
                      >
                        {DOC_TYPES.map(t => (
                          <option key={t.id} value={t.id}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Legenda tipi documento */}
            {files.length === 0 && (
              <div style={{ background: 'var(--c-bg-card)', borderRadius: 'var(--r-sm)', padding: '10px 12px' }}>
                <div className="section-title">Documenti da caricare</div>
                {DOC_TYPES.map(t => (
                  <div key={t.id} style={{ marginBottom: '6px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--c-text-secondary)' }}>{t.label}</div>
                    <div style={{ fontSize: '10px', color: 'var(--c-text-muted)' }}>{t.hint}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Template Excel */}
            <div className="polizza-template-block">
              <div className="polizza-template-label">Gestionale Excel (opzionale)</div>
              {templateName
                ? <>
                  <div className="polizza-template-file"><IconExcel /> {templateName}</div>
                  {templateStructure && polizzaTypes.some(t => Object.keys(templateStructure).includes(t.id)) && (
                    <div style={{ fontSize: '10px', color: 'var(--c-success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <IconCheck /> Gestionale CSA riconosciuto — mappatura automatica attiva
                    </div>
                  )}
                </>
                : <div style={{ fontSize: '11px', color: 'var(--c-text-muted)' }}>Nessun template caricato</div>
              }
              <button className="btn-secondary" style={{ fontSize: '11px', padding: '6px 10px' }} onClick={handleLoadTemplate}>
                <IconExcel />
                {templateName ? 'Cambia template…' : 'Carica gestionale Excel…'}
              </button>
              {templateName && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: '11px', padding: '6px 10px', borderColor: 'var(--c-accent)', color: 'var(--c-accent)' }}
                  onClick={() => setShowMapping(true)}
                >
                  <IconMap />
                  {useAutoMapping ? 'Verifica/modifica mappatura…' : 'Configura mappatura celle…'}
                </button>
              )}
            </div>
          </div>

          {/* Azioni fisse in fondo */}
          <div className="polizza-actions">
            {error && <div className="polizza-error">⚠ {error}</div>}

            <button
              className="btn-primary"
              onClick={handleExtract}
              disabled={!files.length || extracting}
              aria-busy={extracting}
            >
              {extracting ? <IconSpinner /> : '⚡'}
              {extracting ? 'Estrazione in corso…' : 'Estrai dati polizza'}
            </button>

            {showDiagBtn && (
              <button
                className="btn-secondary"
                style={{ fontSize: '11px', padding: '4px 10px', opacity: 0.75 }}
                onClick={handleSaveDiagnostics}
                title="Salva log diagnostica come file .txt — utile per inviarlo al supporto tecnico"
              >
                {diagSaved ? '✓ Salvato' : '📋 Salva diagnostica'}
              </button>
            )}

            {/* Indicatore vision OCR */}
            {(visionExtracting || visionMsg) && (
              <div style={{
                fontSize: '11px',
                padding: '6px 10px',
                borderRadius: 'var(--r-sm)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: visionMsg === 'done' ? 'rgba(34,197,94,0.08)' :
                  visionMsg === 'error' ? 'rgba(239,68,68,0.08)' :
                    'rgba(59,130,246,0.08)',
                border: '1px solid',
                borderColor: visionMsg === 'done' ? 'rgba(34,197,94,0.25)' :
                  visionMsg === 'error' ? 'rgba(239,68,68,0.25)' :
                    'rgba(59,130,246,0.25)',
                color: visionMsg === 'done' ? 'var(--c-success)' :
                  visionMsg === 'error' ? 'var(--c-error)' :
                    'var(--c-info)'
              }}>
                {visionExtracting && <IconSpinner />}
                {visionMsg === 'extracting' && 'OCR visivo in corso…'}
                {visionMsg === 'done' && '✓ OCR visivo completato'}
                {visionMsg === 'error' && '⚠ OCR visivo non disponibile'}
              </div>
            )}

            {extracted && (
              <>
                <button
                  className="btn-success"
                  onClick={handleExportNew}
                  disabled={exporting}
                >
                  <IconExcel />
                  Esporta nuovo Excel ({polizzaTypes.map(t => t.id).join(' + ')})
                </button>
                {templateName && (
                  <button
                    className="btn-secondary"
                    onClick={handlePreviewChanges}
                    disabled={exporting || loadingPreview}
                    style={{ borderColor: 'var(--c-info)', color: 'var(--c-info)' }}
                    aria-busy={loadingPreview}
                  >
                    {loadingPreview ? <IconSpinner /> : <IconExcel />}
                    {loadingPreview ? 'Lettura template…' : 'Rivedi e popola gestionale…'}
                  </button>
                )}
              </>
            )}

            {exportMsg && (
              <div className={`export-msg${exportMsg.startsWith('✗') ? ' error' : ''}`}>
                {exportMsg}
              </div>
            )}
          </div>
        </div>

        {/* ── Pannello destro: risultati ────────────────────────────────────── */}
        <div className="polizza-right">
          <div className="polizza-tabs" role="tablist">
            {polizzaTypes.map((type, idx) => (
              <button
                key={type.id}
                role="tab"
                aria-selected={activeTab === type.id}
                className={`polizza-tab${activeTab === type.id ? ' active' : ''}`}
                onClick={() => setActiveTab(type.id)}
              >
                {TAB_ICONS[idx % TAB_ICONS.length]} {type.label}
              </button>
            ))}
          </div>

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
                      <div style={{
                        width: `${Math.round(((rollingProgress.docIndex) / rollingProgress.docTotal) * 100)}%`,
                        height: '100%', background: 'var(--c-info)', borderRadius: 2, transition: 'width 0.4s'
                      }} />
                    </div>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-secondary)', lineHeight: 1.8 }}>
                      {rollingProgress.docName}<br />
                      File {rollingProgress.docIndex + 1} di {rollingProgress.docTotal}
                      {rollingProgress.pageTotal > 0 && ` · Pag. ${rollingProgress.pageIndex}/${rollingProgress.pageTotal}`}
                      {liveSecs(rollingProgress)}
                      {(rollingProgress.totalPagesProcessed > 0) && (
                        <><br />{rollingProgress.totalPagesProcessed} pagine elaborate</>
                      )}
                    </p>
                  </>
                ) : (
                  <p>L&apos;AI sta analizzando i documenti di polizza</p>
                )}
              </div>
            )}
            {extracted && (
              <>
                {(extracting || visionExtracting) && rollingProgress && (
                  <div style={{
                    margin: '0 0 8px 0',
                    borderRadius: 6,
                    background: 'rgba(59,130,246,0.07)',
                    border: '1px solid rgba(59,130,246,0.2)',
                    fontSize: 11,
                    color: 'var(--c-info)',
                    fontFamily: 'var(--font-mono)',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      height: 3,
                      background: 'rgba(59,130,246,0.15)'
                    }}>
                      <div style={{
                        width: `${Math.round(((rollingProgress.docIndex) / rollingProgress.docTotal) * 100)}%`,
                        height: '100%', background: 'var(--c-info)', transition: 'width 0.4s'
                      }} />
                    </div>
                    <div style={{ padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <IconSpinner />
                      <span>
                        File {rollingProgress.docIndex + 1}/{rollingProgress.docTotal} · {rollingProgress.docName}
                        {rollingProgress.pageTotal > 0 && ` · Pag. ${rollingProgress.pageIndex}/${rollingProgress.pageTotal}`}
                        {rollingProgress.totalPagesProcessed > 0 && ` · ${rollingProgress.totalPagesProcessed} pag. elaborate`}
                        {liveSecs(rollingProgress)}
                      </span>
                    </div>
                  </div>
                )}
                <div role="note" style={{
                  margin: '0 0 10px 0',
                  padding: '7px 12px',
                  borderRadius: 6,
                  background: 'rgba(234,179,8,0.1)',
                  border: '1px solid rgba(234,179,8,0.3)',
                  color: 'var(--c-text-secondary)',
                  fontSize: 12
                }}>
                  Risultati generati da AI — verificare sempre prima dell&apos;uso
                </div>
                <ExtractedTable
                  fields={sheetFields}
                  data={extracted}
                  sources={sources}
                  onUpdate={(id, val) => !extracting && !visionExtracting && setExtracted(prev => ({ ...prev, [id]: val }))}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Modal mappatura celle ──────────────────────────────────────────── */}
      {showMapping && (
        <MappingModal
          fields={fields}
          mapping={mapping}
          defaultMapping={defaultMapping}
          useAutoMapping={useAutoMapping}
          templateStructure={templateStructure}
          polizzaTypes={polizzaTypes}
          onUpdate={updateMapping}
          onToggleAuto={() => setUseAutoMapping(v => !v)}
          onClose={() => setShowMapping(false)}
        />
      )}

      {/* ── Modal preview modifiche ────────────────────────────────────────── */}
      {showPreview && previewChanges && (
        <ChangePreviewModal
          changes={previewChanges}
          exporting={exporting}
          onChange={setPreviewChanges}
          onConfirm={handleExportApproved}
          onClose={() => { setShowPreview(false); setPreviewChanges(null) }}
        />
      )}
    </div>
  )
}

// ─── Tabella risultati modificabile ───────────────────────────────────────────

function ExtractedTable({ fields, data, sources, onUpdate }) {
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
        {fields.map(f => {
          const val = data[f.id]
          const isEmpty = val === null || val === undefined || val === ''
          const src = sources?.[f.id]
          return (
            <tr key={f.id}>
              <td title={f.description}>{f.label}</td>
              <td className={isEmpty ? 'value-null' : 'value-ok'}>
                {isEmpty
                  ? <span style={{ color: 'var(--c-text-muted)', fontStyle: 'italic' }}>—</span>
                  : <input
                    className="editable-cell"
                    value={val ?? ''}
                    onChange={e => onUpdate(f.id, e.target.value)}
                    aria-label={f.label}
                  />
                }
              </td>
              <td style={{
                fontSize: 11,
                color: src ? 'var(--c-text-secondary)' : 'var(--c-text-muted)',
                fontFamily: 'var(--font-mono)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 180
              }} title={src ? `${src.file} · pag. ${src.page}` : ''}>
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

// ─── Modal mappatura celle Excel ──────────────────────────────────────────────

function MappingModal({ fields, mapping, defaultMapping, useAutoMapping, templateStructure, polizzaTypes, onUpdate, onToggleAuto, onClose }) {
  const sheets = templateStructure ? Object.keys(templateStructure) : []
  const activeTypes = (polizzaTypes || [{ id: 'RCT_O' }, { id: 'RCP' }])
  const isCSATemplate = activeTypes.some(t => sheets.includes(t.id))

  return (
    <div className="mapping-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="mapping-modal" role="dialog" aria-modal="true" aria-label="Mappatura celle Excel">
        <div className="mapping-header">
          <div>
            <h2>Mappatura campi → celle Excel</h2>
            <p>
              {isCSATemplate
                ? 'Gestionale CSA riconosciuto — puoi usare la mappatura automatica o personalizzarla'
                : 'Indica in quale foglio e cella del gestionale inserire ciascun campo estratto'
              }
            </p>
          </div>
          <button
            className="btn-secondary"
            style={{ padding: '6px 12px', fontSize: '12px' }}
            onClick={onClose}
          >
            Chiudi
          </button>
        </div>

        <div className="mapping-body">
          {isCSATemplate && (
            <div style={{
              padding: '10px 14px',
              background: useAutoMapping ? 'rgba(34,197,94,0.08)' : 'var(--c-bg-card-alt)',
              border: '1px solid',
              borderColor: useAutoMapping ? 'rgba(34,197,94,0.3)' : 'var(--c-border)',
              borderRadius: 'var(--r-sm)',
              marginBottom: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: useAutoMapping ? 'var(--c-success)' : 'var(--c-text-secondary)' }}>
                  {useAutoMapping ? '✓ Mappatura automatica Gestionale CSA attiva' : 'Mappatura manuale personalizzata'}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--c-text-muted)', marginTop: '2px' }}>
                  {useAutoMapping
                    ? `I dati verranno scritti nelle celle corrette di ${activeTypes.map(t => t.id).join(' e ')} automaticamente`
                    : 'Specifica manualmente foglio e cella per ogni campo'
                  }
                </div>
              </div>
              <button
                className="btn-secondary"
                style={{ fontSize: '11px', padding: '5px 10px', minWidth: '130px' }}
                onClick={onToggleAuto}
              >
                {useAutoMapping ? 'Usa mappatura manuale' : 'Usa auto-CSA'}
              </button>
            </div>
          )}

          {sheets.length > 0 && (
            <div style={{ marginBottom: '8px', fontSize: '10px', color: 'var(--c-text-muted)' }}>
              Fogli nel template: {sheets.join(', ')}
            </div>
          )}

          <table className="mapping-table">
            <thead>
              <tr>
                <th>Campo estratto</th>
                <th>Celle nel gestionale</th>
                <th style={{ display: useAutoMapping ? 'none' : '' }}>Foglio</th>
                <th style={{ display: useAutoMapping ? 'none' : '' }}>Cella</th>
              </tr>
            </thead>
            <tbody>
              {fields.map(f => {
                const m = mapping[f.id] || {}
                const autoTargets = defaultMapping[f.id] || []
                const autoDesc = autoTargets.length > 0
                  ? autoTargets.map(t => `${t.sheet}!${t.cell}`).join(', ')
                  : '—'

                return (
                  <tr key={f.id}>
                    <td title={f.description}>{f.label}</td>
                    <td>
                      {useAutoMapping
                        ? <span style={{
                          fontSize: '10px',
                          color: autoTargets.length > 0 ? 'var(--c-success)' : 'var(--c-text-muted)',
                          fontFamily: 'var(--font-mono)'
                        }}>
                          {autoDesc}
                        </span>
                        : null
                      }
                      {!useAutoMapping &&
                        <input
                          className="mapping-input"
                          placeholder="RCT_O"
                          value={m.sheet || ''}
                          onChange={e => onUpdate(f.id, e.target.value, m.cell || '')}
                        />
                      }
                    </td>
                    {!useAutoMapping && (
                      <td>
                        <input
                          className="mapping-input"
                          placeholder="Es. C5"
                          value={m.cell || ''}
                          onChange={e => onUpdate(f.id, m.sheet || '', e.target.value)}
                          style={{ maxWidth: '80px' }}
                        />
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

// ─── Modal preview modifiche vecchio→nuovo ────────────────────────────────────

function ChangePreviewModal({ changes, exporting, onChange, onConfirm, onClose }) {
  const approved = changes.filter(c => c.approved)
  const allChecked = approved.length === changes.length
  const noneChecked = approved.length === 0

  const toggle = (idx) =>
    onChange(prev => prev.map((c, i) => i === idx ? { ...c, approved: !c.approved } : c))

  const toggleAll = () =>
    onChange(prev => prev.map(c => ({ ...c, approved: !allChecked })))

  // raggruppa per foglio per leggibilità
  const bySheet = {}
  changes.forEach((c, idx) => {
    if (!bySheet[c.sheet]) bySheet[c.sheet] = []
    bySheet[c.sheet].push({ ...c, _idx: idx })
  })

  const hasChanges = changes.some(c => c.oldValue !== c.newValue && c.newValue !== '')
  const totalChanged = changes.filter(c => c.oldValue !== c.newValue && c.newValue !== '').length

  return (
    <div className="mapping-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div
        className="mapping-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Anteprima modifiche gestionale"
        style={{ width: 'min(900px, 95vw)', maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="mapping-header">
          <div>
            <h2>Rivedi le modifiche al gestionale</h2>
            <p>
              {approved.length} di {changes.length} campi selezionati ·{' '}
              <span style={{ color: 'var(--c-warning)' }}>{totalChanged} con valore precedente</span>
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              className="btn-secondary"
              style={{ fontSize: '11px', padding: '5px 10px' }}
              onClick={toggleAll}
            >
              {allChecked ? 'Deseleziona tutto' : 'Approva tutto'}
            </button>
            <button
              className="btn-secondary"
              style={{ padding: '6px 12px', fontSize: '12px' }}
              onClick={onClose}
            >
              Annulla
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="mapping-body" style={{ padding: '0' }}>
          {Object.entries(bySheet).map(([sheetName, rows]) => (
            <div key={sheetName}>
              {/* Intestazione sezione */}
              <div style={{
                padding: '8px 20px',
                background: 'var(--c-bg-card-alt)',
                borderBottom: '1px solid var(--c-separator)',
                borderTop: '1px solid var(--c-separator)',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--c-text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span style={{
                  padding: '2px 8px',
                  background: sheetName === 'RCT_O' ? 'rgba(59,130,246,0.15)' : 'rgba(34,197,94,0.15)',
                  color: sheetName === 'RCT_O' ? 'var(--c-info)' : 'var(--c-success)',
                  borderRadius: 'var(--r-full)',
                  fontFamily: 'var(--font-mono)'
                }}>{sheetName}</span>
                {rows.filter(r => r.approved).length} / {rows.length} selezionati
              </div>

              {/* Righe */}
              {rows.map((row) => {
                const hasOldValue = row.oldValue !== '' && row.oldValue !== '0'
                const isChanged = row.oldValue !== row.newValue
                return (
                  <div
                    key={row._idx}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '28px 1fr 80px 1fr 1fr',
                      alignItems: 'center',
                      gap: '0',
                      padding: '0',
                      borderBottom: '1px solid var(--c-separator)',
                      background: row.approved ? 'transparent' : 'rgba(0,0,0,0.06)',
                      opacity: row.approved ? 1 : 0.55,
                      transition: 'background 0.12s, opacity 0.12s',
                      cursor: 'pointer'
                    }}
                    onClick={() => toggle(row._idx)}
                    role="row"
                  >
                    {/* Checkbox */}
                    <div style={{ padding: '10px 0 10px 14px', display: 'flex', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={row.approved}
                        onChange={() => toggle(row._idx)}
                        onClick={e => e.stopPropagation()}
                        style={{ width: '14px', height: '14px', cursor: 'pointer', accentColor: 'var(--c-accent)' }}
                        aria-label={`Approva ${row.label}`}
                      />
                    </div>

                    {/* Campo */}
                    <div style={{ padding: '10px 8px', fontSize: '11px', color: 'var(--c-text-secondary)', fontWeight: 500 }}>
                      <div>{row.label}</div>
                      <div style={{ fontSize: '10px', color: 'var(--c-text-muted)', fontFamily: 'var(--font-mono)' }}>
                        cella {row.cell}
                      </div>
                    </div>

                    {/* Badge cambiato/invariato */}
                    <div style={{ padding: '10px 4px', textAlign: 'center' }}>
                      {isChanged
                        ? <span style={{ fontSize: '9px', padding: '2px 5px', background: 'rgba(245,158,11,0.15)', color: 'var(--c-warning)', borderRadius: 'var(--r-full)', fontWeight: 700 }}>
                          AGGIORNA
                        </span>
                        : <span style={{ fontSize: '9px', padding: '2px 5px', background: 'rgba(107,114,128,0.12)', color: 'var(--c-text-muted)', borderRadius: 'var(--r-full)' }}>
                          invariato
                        </span>
                      }
                    </div>

                    {/* Valore attuale */}
                    <div style={{ padding: '10px 8px', fontSize: '11px', borderLeft: '1px solid var(--c-separator)' }}>
                      <div style={{ fontSize: '9px', color: 'var(--c-text-muted)', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Attuale</div>
                      <div style={{
                        color: hasOldValue ? 'var(--c-text-primary)' : 'var(--c-text-muted)',
                        fontStyle: hasOldValue ? 'normal' : 'italic',
                        fontFamily: hasOldValue ? 'var(--font-mono)' : 'inherit',
                        fontSize: hasOldValue ? '11px' : '10px',
                        wordBreak: 'break-word'
                      }}>
                        {hasOldValue ? row.oldValue : '—'}
                      </div>
                    </div>

                    {/* Nuovo valore */}
                    <div style={{ padding: '10px 8px', fontSize: '11px', borderLeft: '1px solid var(--c-separator)' }}>
                      <div style={{ fontSize: '9px', color: 'var(--c-text-muted)', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Nuovo</div>
                      <div style={{
                        color: isChanged ? 'var(--c-success)' : 'var(--c-text-secondary)',
                        fontWeight: isChanged ? 600 : 400,
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        wordBreak: 'break-word'
                      }}>
                        {row.newValue || '—'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mapping-footer" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '11px', color: 'var(--c-text-muted)' }}>
            {noneChecked
              ? 'Seleziona almeno un campo per procedere'
              : `Verranno scritti ${approved.length} campi nel gestionale`
            }
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn-secondary" onClick={onClose} disabled={exporting}>
              Annulla
            </button>
            <button
              className="btn-success"
              onClick={() => onConfirm(approved)}
              disabled={noneChecked || exporting}
              style={{ minWidth: '160px' }}
              aria-busy={exporting}
            >
              {exporting ? <IconSpinner /> : <IconCheck />}
              {exporting
                ? 'Scrittura in corso…'
                : `Conferma ${approved.length} ${approved.length === 1 ? 'modifica' : 'modifiche'}`
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function guessDocType(filePath) {
  const lower = filePath.toLowerCase()
  if (lower.includes('rinnov') || lower.includes('app_r')) return 'appendice'
  if (lower.includes('cga') || lower.includes('condiz')) return 'cga'
  if (lower.includes('app') || lower.includes('allegat')) return 'allegato'
  return 'polizza'
}
