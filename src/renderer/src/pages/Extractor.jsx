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

/* ─── PDF Preview ───────────────────────────────────────────── */
function PDFPreview({ buffer, fileName, numPages }) {
  const { t } = useTranslation()
  const canvasRef = useRef(null)
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

      // Scale PDF to fit available container width
      const wrap = wrapRef.current
      const availW = wrap ? Math.max(wrap.clientWidth - 24, 200) : 500
      const naturalVp = page.getViewport({ scale: 1 })
      const scale = Math.min(availW / naturalVp.width, 2.0)
      const viewport = page.getViewport({ scale })

      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${canvas.width}px`
      canvas.style.height = `${canvas.height}px`

      if (cancelled) return

      const task = page.render({ canvasContext: ctx, viewport })
      renderRef.current = task
      try {
        await task.promise
      } catch (e) {
        if (e?.name !== 'RenderingCancelledException') console.error(e)
      }
    })()

    return () => { cancelled = true }
  }, [pdfDoc, currentPage])

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
      >
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}

/* ─── Chat ──────────────────────────────────────────────────── */
function ChatPanel({ hasDoc }) {
  const { t } = useTranslation()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [settings, setSettings] = useState(null)
  const endRef = useRef(null)
  const inputRef = useRef(null)
  const historyRef = useRef([])

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings)
  }, [])

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
    await window.electronAPI.chatWithPDF(msg, history)
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="chat-panel" role="region" aria-label={t('extractor.chatTitle')}>
      <div
        className="chat-messages"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={t('extractor.chatTitle')}
      >
        {messages.length === 0 && (
          <div className="empty-state">
            <p className="text-muted text-sm">
              {hasDoc ? t('extractor.chatPlaceholder') : t('extractor.chatNoDoc')}
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`msg msg-${m.role}`}
            role={m.role === 'assistant' ? 'article' : undefined}
            aria-label={m.role === 'assistant' ? 'Risposta assistente' : 'Tua domanda'}
          >
            <div className={`msg-bubble${m.streaming ? ' streaming' : ''}`}>
              {m.content || (m.streaming ? '' : '')}
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
          placeholder={hasDoc ? t('extractor.chatPlaceholder') : t('extractor.chatNoDoc')}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={!hasDoc || streaming}
          aria-label={t('extractor.chatPlaceholder')}
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

/* ─── Main Extractor Page ───────────────────────────────────── */
export default function Extractor() {
  const { t } = useTranslation()
  const [pdfBuffer, setPdfBuffer] = useState(null)
  const [fileName, setFileName] = useState('')
  const [numPages, setNumPages] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState(null)
  const [extractError, setExtractError] = useState('')
  const [copied, setCopied] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [drag, setDrag] = useState(false)
  const [activeTab, setActiveTab] = useState('extract')
  const dropRef = useRef(null)

  const loadFile = async (filePath) => {
    setLoading(true)
    setLoadError('')
    setExtracted(null)
    const res = await window.electronAPI.loadPDF(filePath)
    setLoading(false)
    if (res.success) {
      setPdfBuffer(res.buffer)
      setFileName(res.fileName)
      setNumPages(res.numPages)
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
    if (file && file.type === 'application/pdf') {
      loadFile(file.path)
    }
  }, [])

  const handleDragOver = (e) => { e.preventDefault(); setDrag(true) }
  const handleDragLeave = () => setDrag(false)

  const handleExtract = async () => {
    if (!pdfBuffer) return
    setExtracting(true)
    setExtractError('')
    const res = await window.electronAPI.extractData()
    setExtracting(false)
    if (res.success) {
      setExtracted(res.data)
      setActiveTab('extract')
    } else {
      setExtractError(res.error)
    }
  }

  const clearDoc = async () => {
    await window.electronAPI.clearPDF()
    setPdfBuffer(null)
    setFileName('')
    setNumPages(0)
    setExtracted(null)
    setExtractError('')
    setLoadError('')
  }

  const copyResults = () => {
    if (!extracted) return
    const text = Object.entries(extracted)
      .map(([k, v]) => `${k}: ${v ?? '—'}`)
      .join('\n')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleExport = async (format) => {
    if (!extracted || exporting) return
    setExporting(true)
    const res = await window.electronAPI.exportData(format, extracted, fileName)
    setExporting(false)
    if (!res.success && !res.canceled && res.error) {
      setExtractError(res.error)
    }
  }

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
        <div className="extractor-layout" style={{ flex: 1, minHeight: 0, height: 'calc(100vh - 130px)' }}>
          {/* Left: PDF panel */}
          <div className="pdf-panel">
            {!pdfBuffer ? (
              <div
                ref={dropRef}
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
              <PDFPreview buffer={pdfBuffer} fileName={fileName} numPages={numPages} />
            )}

            {pdfBuffer && (
              <div className="flex gap-2" style={{ flexShrink: 0 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleExtract} disabled={extracting} aria-busy={extracting}>
                  {extracting ? (
                    <><div className="spinner spinner-sm" aria-hidden="true" />{t('extractor.extracting')}</>
                  ) : t('extractor.extractButton')}
                </button>
                <button className="btn btn-secondary" onClick={clearDoc} aria-label={t('extractor.clearDoc')}>
                  <IconTrash />
                </button>
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
                            aria-label={`${t('extractor.exportLabel')} ${fmt.toUpperCase()}`}
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
                  {extracted ? (
                    <dl>
                      {Object.entries(extracted).map(([key, val]) => (
                        <div key={key} className="result-row">
                          <dt className="result-label">{key}</dt>
                          <dd className={`result-value${val == null ? ' result-null' : ''}`}>
                            {val ?? '—'}
                          </dd>
                        </div>
                      ))}
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
              <ChatPanel hasDoc={!!pdfBuffer} />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
