import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

/* ─── Icons ─────────────────────────────────────────────────── */
const IconUpload = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
)
const IconFile = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
  </svg>
)
const IconFiles = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/>
    <polyline points="15 2 15 8 21 8"/>
    <path d="M9 13h6M9 17h3"/>
  </svg>
)
const IconSend = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
  </svg>
)
const IconChevLeft = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="14" height="14">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
)
const IconChevRight = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="14" height="14">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
)
const IconCopy = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="14" height="14">
    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
)
const IconTrash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="14" height="14">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
  </svg>
)
const IconDownload = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="14" height="14">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
)
const IconSave = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="14" height="14">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
    <polyline points="17 21 17 13 7 13 7 21"/>
    <polyline points="7 3 7 8 15 8"/>
  </svg>
)
const IconPackage = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="14" height="14">
    <line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
    <line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
)
const IconPlus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="14" height="14">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)
const IconX = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="11" height="11">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

/* ─── Save menu (PDF copy + export all) ─────────────────────── */
function SaveMenu({ fileName, chatHistory, extracted }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const run = async (fn) => {
    setOpen(false)
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn btn-secondary"
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        aria-label={t('extractor.saveMenu')}
        title={t('extractor.saveMenu')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {busy
          ? <div className="spinner spinner-sm" aria-hidden="true" />
          : <IconSave />}
      </button>
      {open && (
        <div className="save-menu-popup" role="menu">
          <button
            className="save-menu-item"
            role="menuitem"
            onClick={() => run(() => window.electronAPI.savePDFCopy())}
          >
            <IconFile />
            {t('extractor.savePDFCopy')}
          </button>
          <div className="save-menu-sep" />
          <button
            className="save-menu-item"
            role="menuitem"
            onClick={() => run(() => window.electronAPI.exportAll(chatHistory, extracted, fileName))}
          >
            <IconPackage />
            {t('extractor.exportAll')}
          </button>
        </div>
      )}
    </div>
  )
}

/* ─── PDF Preview with highlight overlay ────────────────────── */
function PDFPreview({ buffer, fileName, numPages, extracted }) {
  const { t } = useTranslation()
  const canvasRef = useRef(null)
  const overlayRef = useRef(null)
  const wrapRef = useRef(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pdfDoc, setPdfDoc] = useState(null)
  const renderRef = useRef(null)

  useEffect(() => {
    if (!buffer) return
    let cancelled = false
    ;(async () => {
      const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
      GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.js', window.location.href).href
      const uint8 = new Uint8Array(buffer)
      const doc = await getDocument({ data: uint8 }).promise
      if (!cancelled) {
        setPdfDoc(doc)
        setCurrentPage(1)
      }
    })()
    return () => { cancelled = true }
  }, [buffer])

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return
    let cancelled = false
    if (renderRef.current) {
      try { renderRef.current.cancel() } catch (_) {}
      renderRef.current = null
    }
    ;(async () => {
      const page = await pdfDoc.getPage(currentPage)
      if (cancelled || !canvasRef.current) return
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')
      const wrap = wrapRef.current
      const availW = wrap ? Math.max(wrap.clientWidth - 24, 200) : 500
      const naturalVp = page.getViewport({ scale: 1 })
      const scale = Math.min(availW / naturalVp.width, 2.0)
      const viewport = page.getViewport({ scale })
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${canvas.width}px`
      canvas.style.height = `${canvas.height}px`

      // Resize overlay to match
      if (overlayRef.current) {
        overlayRef.current.width = canvas.width
        overlayRef.current.height = canvas.height
        overlayRef.current.style.width = `${canvas.width}px`
        overlayRef.current.style.height = `${canvas.height}px`
      }

      if (cancelled) return
      const task = page.render({ canvasContext: ctx, viewport })
      renderRef.current = task
      try {
        await task.promise
      } catch (e) {
        if (e?.name !== 'RenderingCancelledException') console.error(e)
        return
      }

      // Draw highlights after render
      if (overlayRef.current && !cancelled) {
        if (extracted) {
          try { await drawHighlights(page, viewport, overlayRef.current, extracted) } catch (_) {}
        } else {
          const oc = overlayRef.current.getContext('2d')
          oc.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height)
        }
      }
    })()
    return () => { cancelled = true }
  }, [pdfDoc, currentPage, extracted])

  async function drawHighlights(page, viewport, overlayCanvas, extractedData) {
    const oc = overlayCanvas.getContext('2d')
    oc.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)
    if (!extractedData) return

    const values = Object.values(extractedData)
      .filter(v => v != null && String(v).trim().length > 2)
      .map(v => String(v).trim().toLowerCase())

    if (values.length === 0) return

    const textContent = await page.getTextContent()
    const colors = [
      'rgba(233,30,140,0.28)', 'rgba(30,120,233,0.28)',
      'rgba(30,200,80,0.28)', 'rgba(200,150,30,0.28)'
    ]
    let colorIdx = 0

    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue
      const itemText = item.str.toLowerCase()
      for (const val of values) {
        if (itemText.includes(val) || (val.length > 3 && val.includes(itemText) && itemText.length > 3)) {
          const tx = item.transform
          const [x, y] = viewport.convertToViewportPoint(tx[4], tx[5])
          const w = (item.width || 60) * viewport.scale
          const h = (item.height || 12) * viewport.scale
          oc.fillStyle = colors[colorIdx % colors.length]
          oc.fillRect(x, y - h, w, h + 2)
          colorIdx++
          break
        }
      }
    }
  }

  if (!buffer) return null

  return (
    <div className="pdf-preview-container">
      <div className="pdf-preview-toolbar">
        <span className="pdf-filename" title={fileName}>{fileName}</span>
        <div className="pdf-pagination" role="group" aria-label="Navigazione pagine">
          <button
            className="btn-icon"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            aria-label={t('extractor.prevPage')}
          ><IconChevLeft /></button>
          <span aria-live="polite" aria-atomic="true">
            {currentPage} {t('extractor.pageOf')} {numPages}
          </span>
          <button
            className="btn-icon"
            onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
            disabled={currentPage >= numPages}
            aria-label={t('extractor.nextPage')}
          ><IconChevRight /></button>
        </div>
      </div>
      <div
        ref={wrapRef}
        className="pdf-canvas-wrap"
        role="img"
        aria-label={`${t('extractor.loadedFile')}: ${fileName}, ${t('extractor.page')} ${currentPage} ${t('extractor.pageOf')} ${numPages}`}
        style={{ position: 'relative' }}
      >
        <canvas ref={canvasRef} />
        {extracted && (
          <canvas
            ref={overlayRef}
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 2 }}
          />
        )}
      </div>
    </div>
  )
}

/* ─── Document tabs ─────────────────────────────────────────── */
function DocTabs({ docs, activeId, onSelect, onRemove, onAdd, loading }) {
  const { t } = useTranslation()
  return (
    <div className="doc-tabs-bar" role="tablist" aria-label={t('extractor.docTabs')}>
      {docs.map(doc => (
        <div
          key={doc.id}
          className={`doc-tab${activeId === doc.id ? ' active' : ''}`}
          role="tab"
          aria-selected={activeId === doc.id}
          onClick={() => onSelect(doc.id)}
          tabIndex={0}
          onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onSelect(doc.id)}
        >
          <IconFile />
          <span className="doc-tab-name" title={doc.fileName}>{doc.fileName}</span>
          <button
            className="doc-tab-remove"
            onClick={e => { e.stopPropagation(); onRemove(doc.id) }}
            aria-label={`${t('extractor.removeDoc')}: ${doc.fileName}`}
            title={t('extractor.removeDoc')}
          >
            <IconX />
          </button>
        </div>
      ))}
      <button
        className="doc-tab-add btn-icon"
        onClick={onAdd}
        disabled={loading}
        aria-label={t('extractor.addDoc')}
        title={t('extractor.addDoc')}
      >
        {loading ? <div className="spinner spinner-sm" aria-hidden="true" /> : <IconPlus />}
      </button>
    </div>
  )
}

/* ─── Chat ──────────────────────────────────────────────────── */
function ChatPanel({ hasDoc, isMultiDoc, docs, messages, setMessages, historyRef, streaming, setStreaming, onExportChat, activeDocId }) {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const endRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    window.electronAPI.onLLMChunk(({ chunk, done, error }) => {
      if (error) {
        setMessages(prev => {
          const msgs = [...prev]
          const last = msgs[msgs.length - 1]
          if (last?.role === 'assistant' && last.streaming) {
            msgs[msgs.length - 1] = { ...last, content: t('common.error') + ': ' + error, streaming: false }
          }
          return msgs
        })
        setStreaming(false)
        return
      }
      if (done) {
        setMessages(prev => {
          const msgs = [...prev]
          const last = msgs[msgs.length - 1]
          if (last?.role === 'assistant' && last.streaming) {
            historyRef.current.push({ role: 'assistant', content: last.content })
            msgs[msgs.length - 1] = { ...last, streaming: false }
          }
          return msgs
        })
        setStreaming(false)
        return
      }
      setMessages(prev => {
        const msgs = [...prev]
        const last = msgs[msgs.length - 1]
        if (last?.role === 'assistant' && last.streaming) {
          msgs[msgs.length - 1] = { ...last, content: last.content + chunk }
        }
        return msgs
      })
    })
    return () => window.electronAPI.removeAllLLMListeners()
  }, [])

  const send = async () => {
    if (!input.trim() || streaming || !hasDoc) return
    const msg = input.trim()
    setInput('')
    setStreaming(true)
    historyRef.current.push({ role: 'user', content: msg })
    setMessages(prev => [
      ...prev,
      { role: 'user', content: msg },
      { role: 'assistant', content: '', streaming: true }
    ])
    const history = historyRef.current.slice(0, -1)
    // In multi-doc mode, don't pass a specific docId so the backend uses all documents
    const docId = isMultiDoc ? null : activeDocId
    await window.electronAPI.chatWithPDF(msg, history, docId)
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const placeholder = !hasDoc
    ? t('extractor.chatNoDoc')
    : isMultiDoc
      ? t('extractor.chatPlaceholderMulti')
      : t('extractor.chatPlaceholder')

  return (
    <div className="chat-panel" role="region" aria-label={t('extractor.chatTitle')}>
      {/* Multi-doc mode indicator */}
      {isMultiDoc && hasDoc && (
        <div className="chat-multidoc-banner">
          <IconFiles />
          <span>{t('extractor.chatMultiDocMode', { count: docs.length })}</span>
        </div>
      )}

      {messages.length > 0 && (
        <div className="chat-export-bar">
          <span className="export-label">{t('extractor.exportChat')}:</span>
          <button className="btn btn-ghost export-fmt-btn" onClick={() => onExportChat('txt')} title="TXT">
            <IconDownload />TXT
          </button>
          <button className="btn btn-ghost export-fmt-btn" onClick={() => onExportChat('json')} title="JSON">
            <IconDownload />JSON
          </button>
        </div>
      )}
      <div
        className="chat-messages"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={t('extractor.chatTitle')}
      >
        {messages.length === 0 && (
          <div className="empty-state">
            <p className="text-muted text-sm">
              {placeholder}
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`msg msg-${m.role}`}
            role={m.role === 'assistant' ? 'article' : undefined}
          >
            <div className={`msg-bubble${m.streaming ? ' streaming' : ''}`}>
              {m.content}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="chat-input-row">
        <textarea
          ref={inputRef}
          className="chat-input"
          rows={1}
          placeholder={placeholder}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={!hasDoc || streaming}
          aria-label={placeholder}
          aria-disabled={!hasDoc || streaming}
        />
        <button
          className="chat-send-btn"
          onClick={send}
          disabled={!hasDoc || streaming || !input.trim()}
          aria-label={t('extractor.chatSend')}
        >
          {streaming ? <div className="spinner spinner-sm" aria-hidden="true" /> : <IconSend />}
        </button>
      </div>
    </div>
  )
}

/* ─── Validation ─────────────────────────────────────────────── */
const TYPE_VALIDATORS = {
  email:  v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()),
  phone:  v => /^[\d\s+\-().]{6,20}$/.test(String(v).trim()),
  number: v => !isNaN(parseFloat(String(v).trim())) && isFinite(String(v).trim()),
  date:   v => !isNaN(Date.parse(String(v).trim())),
  url:    v => { try { new URL(String(v).trim()); return true } catch { return false } },
  iva:    v => /^[A-Z]{0,2}\d{8,12}$/.test(String(v).replace(/[\s.]/g, '').toUpperCase()),
  cf:     v => /^[A-Z0-9]{16}$/i.test(String(v).replace(/\s/g, '')),
}

function validateField(value, type) {
  if (!value || value === '—' || value == null) return null
  const fn = TYPE_VALIDATORS[type]
  if (!fn) return null
  return fn(value)
}

/* ─── Main Extractor Page ───────────────────────────────────── */
export default function Extractor({ restoredSession, onSessionRestored }) {
  const { t } = useTranslation()

  // Multi-doc state: array of { id, fileName, numPages, buffer }
  const [docs, setDocs] = useState([])
  const [activeDocId, setActiveDocId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  // Extraction state (per-doc)
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState(null)
  const [extractError, setExtractError] = useState('')
  const [copied, setCopied] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Profile selector
  const [appSettings, setAppSettings] = useState(null)
  const [selectedProfileId, setSelectedProfileId] = useState('')

  useEffect(() => {
    window.electronAPI.getSettings().then(s => setAppSettings(s))
  }, [])

  // Chat state — lifted here so export-all can access it
  const [chatMessages, setChatMessages] = useState([])
  const [chatStreaming, setChatStreaming] = useState(false)
  const chatHistoryRef = useRef([])

  const [drag, setDrag] = useState(false)
  const [activeTab, setActiveTab] = useState('extract')

  const isMultiDoc = docs.length > 1
  const activeDoc = docs.find(d => d.id === activeDocId) || null

  // Handle restored session from History
  useEffect(() => {
    if (!restoredSession) return
    const restore = async () => {
      // Clear current state
      await window.electronAPI.clearPDF()
      setDocs([])
      setActiveDocId(null)
      setExtracted(null)
      setExtractError('')
      setLoadError('')
      setChatMessages([])
      chatHistoryRef.current = []

      if (restoredSession.extracted) {
        setExtracted(restoredSession.extracted)
      }
      if (restoredSession.chatHistory && restoredSession.chatHistory.length) {
        setChatMessages(restoredSession.chatHistory.map(m => ({ role: m.role, content: m.content })))
        chatHistoryRef.current = [...restoredSession.chatHistory]
        setActiveTab('chat')
      }
    }
    restore()
    onSessionRestored?.()
  }, [restoredSession])

  const loadFile = async (filePath) => {
    setLoading(true)
    setLoadError('')
    const res = await window.electronAPI.loadPDF(filePath)
    setLoading(false)
    if (res.success) {
      const doc = { id: res.id, fileName: res.fileName, numPages: res.numPages, buffer: res.buffer }
      setDocs(prev => [...prev, doc])
      setActiveDocId(res.id)
      // Clear extraction when switching/adding docs
      setExtracted(null)
      setExtractError('')
    } else {
      setLoadError(res.error)
    }
  }

  const openDialog = async () => {
    const filePath = await window.electronAPI.openPDFDialog()
    if (filePath) loadFile(filePath)
  }

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDrag(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type === 'application/pdf') loadFile(file.path)
  }, [])

  const handleDragOver = (e) => { e.preventDefault(); setDrag(true) }
  const handleDragLeave = () => setDrag(false)

  const handleRemoveDoc = async (id) => {
    await window.electronAPI.removePDF(id)
    setDocs(prev => {
      const next = prev.filter(d => d.id !== id)
      if (activeDocId === id) {
        setActiveDocId(next.length ? next[next.length - 1].id : null)
      }
      return next
    })
    setExtracted(null)
    setExtractError('')
    // Clear chat when docs change
    setChatMessages([])
    chatHistoryRef.current = []
  }

  const clearAllDocs = async () => {
    await window.electronAPI.clearPDF()
    setDocs([])
    setActiveDocId(null)
    setExtracted(null)
    setExtractError('')
    setLoadError('')
    setChatMessages([])
    chatHistoryRef.current = []
  }

  const sessionIdRef = useRef(null)

  const autoSaveSession = async (data) => {
    if (!activeDoc) return
    try {
      const session = {
        id: sessionIdRef.current || undefined,
        fileName: activeDoc.fileName,
        numPages: activeDoc.numPages,
        extracted: data,
        messages: chatHistoryRef.current,
        createdAt: new Date().toISOString()
      }
      const res = await window.electronAPI.saveHistory(session)
      if (res.success) sessionIdRef.current = res.id
    } catch (_) {}
  }

  const handleExtract = async () => {
    if (!activeDoc) return
    setExtracting(true)
    setExtractError('')
    const profile = appSettings?.profiles?.find(p => p.id === selectedProfileId)
    const overrideFields = profile ? profile.fields : undefined
    const res = await window.electronAPI.extractData(activeDocId, overrideFields)
    setExtracting(false)
    if (res.success) {
      setExtracted(res.data)
      setActiveTab('extract')
      autoSaveSession(res.data)
    } else {
      setExtractError(res.error)
    }
  }

  const copyResults = () => {
    if (!extracted) return
    navigator.clipboard.writeText(
      Object.entries(extracted).map(([k, v]) => `${k}: ${v ?? '—'}`).join('\n')
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleExport = async (format) => {
    if (!extracted || exporting) return
    setExporting(true)
    const res = await window.electronAPI.exportData(format, extracted, activeDoc?.fileName || '')
    setExporting(false)
    if (!res.success && !res.canceled && res.error) setExtractError(res.error)
  }

  const handleExportChat = async (format) => {
    if (!chatHistoryRef.current.length) return
    await window.electronAPI.exportChat(format, chatHistoryRef.current, activeDoc?.fileName || 'chat')
  }

  const hasDoc = docs.length > 0

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">{t('extractor.title')}</h1>
        <p className="page-subtitle">{t('extractor.subtitle')}</p>
      </div>
      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '16px 28px 20px' }}>
        {loadError && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>
            {loadError}
          </div>
        )}

        {/* Document tabs bar — only shown when at least one doc is loaded */}
        {hasDoc && (
          <DocTabs
            docs={docs}
            activeId={activeDocId}
            onSelect={id => { setActiveDocId(id); setExtracted(null); setExtractError('') }}
            onRemove={handleRemoveDoc}
            onAdd={openDialog}
            loading={loading}
          />
        )}

        <div className="extractor-layout" style={{ flex: 1, minHeight: 0, height: hasDoc ? 'calc(100vh - 170px)' : 'calc(100vh - 130px)' }}>

          {/* Left: PDF panel */}
          <div className="pdf-panel">
            {!hasDoc ? (
              <div
                className={`dropzone${drag ? ' drag-over' : ''}`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={openDialog}
                role="button"
                tabIndex={0}
                aria-label={t('extractor.dropzone')}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && openDialog()}
              >
                <div className="dropzone-icon">
                  {loading ? <div className="spinner" aria-label={t('common.loading')} /> : <IconUpload />}
                </div>
                <div className="dropzone-text">
                  {loading ? t('common.loading') : t('extractor.dropzone')}
                </div>
                <div className="dropzone-sub">{t('extractor.dropzoneOr')}</div>
                <button
                  className="btn btn-primary"
                  onClick={e => { e.stopPropagation(); openDialog() }}
                  disabled={loading}
                  aria-label={t('extractor.loadButton')}
                >
                  <IconFile />
                  {t('extractor.loadButton')}
                </button>
              </div>
            ) : (
              <PDFPreview
                buffer={activeDoc?.buffer}
                fileName={activeDoc?.fileName}
                numPages={activeDoc?.numPages}
                extracted={extracted}
              />
            )}

            {hasDoc && (
              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {appSettings?.profiles?.length > 0 && (
                  <select
                    className="form-select"
                    value={selectedProfileId}
                    onChange={e => setSelectedProfileId(e.target.value)}
                    aria-label={t('extractor.profileSelect')}
                    style={{ fontSize: 12 }}
                  >
                    <option value="">{t('extractor.profileNone')}</option>
                    {appSettings.profiles.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                )}
                <div className="flex gap-2">
                  <button
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    onClick={handleExtract}
                    disabled={extracting || !activeDoc}
                    aria-busy={extracting}
                  >
                    {extracting
                      ? <><div className="spinner spinner-sm" aria-hidden="true" />{t('extractor.extracting')}</>
                      : t('extractor.extractButton')}
                  </button>
                  <SaveMenu
                    fileName={activeDoc?.fileName || ''}
                    chatHistory={chatHistoryRef.current}
                    extracted={extracted}
                  />
                  <button className="btn btn-secondary" onClick={clearAllDocs} aria-label={t('extractor.clearDoc')}>
                    <IconTrash />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right: Tabs panel */}
          <div className="right-panel">
            <div className="tabs" role="tablist" aria-label="Sezioni">
              <button
                className={`tab-btn${activeTab === 'extract' ? ' active' : ''}`}
                onClick={() => setActiveTab('extract')}
                role="tab"
                aria-selected={activeTab === 'extract'}
                aria-controls="panel-extract"
                id="tab-extract"
              >{t('extractor.tabExtract')}</button>
              <button
                className={`tab-btn${activeTab === 'chat' ? ' active' : ''}`}
                onClick={() => setActiveTab('chat')}
                role="tab"
                aria-selected={activeTab === 'chat'}
                aria-controls="panel-chat"
                id="tab-chat"
              >{t('extractor.tabChat')}</button>
            </div>

            {/* Extract panel */}
            <div
              id="panel-extract"
              role="tabpanel"
              aria-labelledby="tab-extract"
              className={`tab-panel${activeTab === 'extract' ? ' visible' : ''}`}
            >
              <div className="results-panel">
                <div className="results-header">
                  <h3>{t('extractor.extractedTitle')}</h3>
                  {extracted && (
                    <div className="results-actions">
                      <button
                        className="btn btn-ghost"
                        onClick={copyResults}
                        aria-label={t('extractor.copyResults')}
                        style={{ padding: '5px 10px', fontSize: 12 }}
                      >
                        <IconCopy />
                        {copied ? t('extractor.copied') : t('extractor.copyResults')}
                      </button>
                      <div className="export-group" aria-label={t('extractor.exportLabel')}>
                        <span className="export-label">{t('extractor.exportLabel')}:</span>
                        {['json', 'csv', 'xlsx'].map(fmt => (
                          <button
                            key={fmt}
                            className="btn btn-ghost export-fmt-btn"
                            onClick={() => handleExport(fmt)}
                            disabled={exporting}
                            title={`${t('extractor.exportLabel')} ${fmt.toUpperCase()}`}
                          >
                            <IconDownload />
                            {fmt.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="results-body">
                  {extractError && (
                    <div className="alert alert-error" role="alert" style={{ marginBottom: 8 }}>
                      {extractError}
                    </div>
                  )}
                  {extracted && (
                    <div className="alert alert-warning" role="note" style={{ marginBottom: 8, fontSize: 12 }}>
                      {t('compliance.aiDisclaimer')}
                    </div>
                  )}
                  {extracted ? (
                    <dl>
                      {Object.entries(extracted).map(([key, val]) => {
                        const profile = appSettings?.profiles?.find(p => p.id === selectedProfileId)
                        const fieldDefs = profile ? profile.fields : appSettings?.extractions
                        const fieldDef = fieldDefs?.find(f => f.label === key)
                        const valid = fieldDef ? validateField(val, fieldDef.type) : null
                        return (
                          <div key={key} className="result-row">
                            <dt className="result-label">{key}</dt>
                            <dd className={`result-value${val == null ? ' result-null' : ''}`}>
                              {val ?? '—'}
                              {valid === true && (
                                <span className="valid-badge valid-ok" title={t('extractor.validValid')}>✓</span>
                              )}
                              {valid === false && (
                                <span className="valid-badge valid-bad" title={t('extractor.validInvalid')}>✗</span>
                              )}
                            </dd>
                          </div>
                        )
                      })}
                    </dl>
                  ) : (
                    <div className="empty-state" aria-label={t('extractor.noExtracted')}>
                      <IconFile />
                      <p>{t('extractor.noExtracted')}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Chat panel */}
            <div
              id="panel-chat"
              role="tabpanel"
              aria-labelledby="tab-chat"
              className={`tab-panel${activeTab === 'chat' ? ' visible' : ''}`}
            >
              <ChatPanel
                hasDoc={hasDoc}
                isMultiDoc={isMultiDoc}
                docs={docs}
                messages={chatMessages}
                setMessages={setChatMessages}
                historyRef={chatHistoryRef}
                streaming={chatStreaming}
                setStreaming={setChatStreaming}
                onExportChat={handleExportChat}
                activeDocId={activeDocId}
              />
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
