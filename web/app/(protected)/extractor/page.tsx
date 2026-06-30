'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useEffect, useCallback } from 'react'
import { loadPdfFromFile } from '@/lib/pdfRender'
import { useT } from '@/lib/i18n/I18nProvider'

interface Field { name: string; value: string }
interface Msg { role: 'user' | 'assistant'; content: string }
interface Doc { id: string; file: File; fields: Field[] | null; chat: Msg[] }

function validate(name: string, value: string): 'ok' | 'bad' | null {
  if (!value) return null
  const n = name.toLowerCase()
  if (n.includes('email') || n.includes('mail')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? 'ok' : 'bad'
  if (n.includes('iva') || n.includes('vat')) return /^\d{11}$/.test(value.replace(/\D/g, '')) ? 'ok' : 'bad'
  if (n.includes('fiscale') || n === 'cf') return /^[A-Z0-9]{16}$/i.test(value.replace(/\s/g, '')) ? 'ok' : 'bad'
  if (n.includes('tel') || n.includes('phone') || n.includes('cell')) return value.replace(/\D/g, '').length >= 6 ? 'ok' : 'bad'
  if (n.includes('url') || n.includes('sito') || n.includes('web')) return /^https?:\/\/|www\./i.test(value) ? 'ok' : 'bad'
  return null
}
function download(content: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function ExtractorPage() {
  const t = useT()
  const [docs, setDocs] = useState<Doc[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [fields, setFields] = useState('')
  const [tab, setTab] = useState<'extract' | 'chat'>('extract')
  const [status, setStatus] = useState<'idle' | 'loading'>('idle')
  const [error, setError] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [chatStreaming, setChatStreaming] = useState(false)
  const [saved, setSaved] = useState(false)

  const [pageNum, setPageNum] = useState(1)
  const [numPages, setNumPages] = useState(0)
  const [pageImg, setPageImg] = useState<string | null>(null)
  const docCache = useRef<Map<string, any>>(new Map())
  const inputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const active = docs.find((d) => d.id === activeId) || null

  const addFiles = useCallback((incoming: File[]) => {
    const pdfs = incoming.filter((f) => f.name.toLowerCase().endsWith('.pdf'))
    if (!pdfs.length) return
    setDocs((prev) => {
      const next = [...prev, ...pdfs.map((f) => ({ id: `${f.name}-${f.size}-${Math.round(f.lastModified)}`, file: f, fields: null as Field[] | null, chat: [] as Msg[] }))]
      return next.filter((d, i, a) => a.findIndex((x) => x.id === d.id) === i)
    })
    setActiveId((cur) => cur || `${pdfs[0].name}-${pdfs[0].size}-${Math.round(pdfs[0].lastModified)}`)
  }, [])

  // Ripristino sessione dalla Cronologia (sessionStorage)
  useEffect(() => {
    const raw = sessionStorage.getItem('restoreSession')
    if (!raw) return
    sessionStorage.removeItem('restoreSession')
    try {
      const s = JSON.parse(raw)
      const bytes = Uint8Array.from(atob(s.pdfBase64), (c) => c.charCodeAt(0))
      const file = new File([bytes], s.fileName, { type: 'application/pdf' })
      const id = `${file.name}-${file.size}-restored`
      setDocs((prev) => [...prev, { id, file, fields: s.meta?.fields ?? null, chat: s.meta?.chat ?? [] }])
      setActiveId(id)
    } catch { /* ignora ripristino non valido */ }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function render() {
      if (!active) { setPageImg(null); setNumPages(0); return }
      let doc = docCache.current.get(active.id)
      if (!doc) { doc = await loadPdfFromFile(active.file); docCache.current.set(active.id, doc) }
      if (cancelled) return
      setNumPages(doc.numPages)
      const p = Math.min(pageNum, doc.numPages)
      const img = await doc.renderPage(p)
      if (!cancelled) setPageImg(img)
    }
    render().catch(() => {})
    return () => { cancelled = true }
  }, [active, pageNum])
  useEffect(() => { setPageNum(1) }, [activeId])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [active?.chat])

  function updateDoc(id: string, patch: Partial<Doc>) {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }
  function removeDoc(id: string) {
    docCache.current.get(id)?.destroy?.()
    docCache.current.delete(id)
    setDocs((prev) => {
      const next = prev.filter((d) => d.id !== id)
      if (activeId === id) setActiveId(next[0]?.id || null)
      return next
    })
  }

  async function handleExtract() {
    if (!active || !fields.trim()) return
    setStatus('loading'); setError('')
    try {
      const form = new FormData()
      form.append('pdf', active.file); form.append('fields', fields)
      const res = await fetch('/api/extract', { method: 'POST', body: form })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || t('ext.errExtract'))
      const data = await res.json()
      updateDoc(active.id, { fields: data.fields })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setStatus('idle')
    }
  }

  async function handleChat() {
    if (!active || !chatInput.trim() || chatStreaming) return
    const userMsg: Msg = { role: 'user', content: chatInput }
    const history = active.chat
    const aId = active.id
    updateDoc(aId, { chat: [...history, userMsg, { role: 'assistant', content: '' }] })
    setChatInput(''); setChatStreaming(true)
    try {
      const form = new FormData()
      form.append('message', userMsg.content)
      form.append('history', JSON.stringify(history))
      form.append('pdf', active.file)
      const res = await fetch('/api/extract/chat', { method: 'POST', body: form })
      if (!res.ok || !res.body) throw new Error('Errore chat')
      const reader = res.body.getReader(); const dec = new TextDecoder()
      let acc = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        acc += dec.decode(value, { stream: true })
        const accLocal = acc
        setDocs((prev) => prev.map((d) => d.id === aId ? { ...d, chat: [...history, userMsg, { role: 'assistant', content: accLocal }] } : d))
      }
    } catch {
      setDocs((prev) => prev.map((d) => d.id === aId ? { ...d, chat: [...history, userMsg, { role: 'assistant', content: t('ext.chatError') }] } : d))
    } finally {
      setChatStreaming(false)
    }
  }

  function exportData(format: 'json' | 'csv' | 'xlsx') {
    if (!active?.fields) return
    const base = active.file.name.replace(/\.pdf$/i, '')
    if (format === 'json') return download(JSON.stringify(active.fields, null, 2), base + '.json', 'application/json')
    if (format === 'csv') {
      const csv = ['Campo,Valore', ...active.fields.map((f) => `"${f.name}","${(f.value || '').replace(/"/g, '""')}"`)].join('\n')
      return download(csv, base + '.csv', 'text/csv')
    }
    fetch('/api/extract/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: active.fields, fileName: base }) })
      .then((r) => r.blob()).then((b) => download(b, base + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
  }

  async function saveToHistory() {
    if (!active) return
    const meta = { fileName: active.file.name, numPages, fields: active.fields, chat: active.chat }
    const form = new FormData()
    form.append('pdf', active.file)
    form.append('meta', JSON.stringify(meta))
    const r = await fetch('/api/history', { method: 'POST', body: form })
    if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <div className="ext-page">
      <style>{EXT_CSS}</style>
      <div className="ext-header">
        <h1>{t('ext.title')}</h1>
        <p>{t('ext.subtitle')}</p>
      </div>

      {docs.length > 0 && (
        <div className="doc-tabs">
          {docs.map((d) => (
            <div key={d.id} className={`doc-tab${d.id === activeId ? ' active' : ''}`} onClick={() => setActiveId(d.id)}>
              <span className="doc-tab-name" title={d.file.name}>{d.file.name}</span>
              <button className="doc-tab-x" onClick={(e) => { e.stopPropagation(); removeDoc(d.id) }}>✕</button>
            </div>
          ))}
          <button className="doc-tab-add" onClick={() => inputRef.current?.click()}>＋</button>
        </div>
      )}

      <div className="ext-body">
        <div className="ext-left">
          {!active ? (
            <div className="ext-dropzone" onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files)) }}>
              <p style={{ fontWeight: 600 }}>{t('ext.dropPrimary')}</p>
              <p style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{t('ext.dropSecondary')}</p>
            </div>
          ) : (
            <div className="ext-preview">
              <div className="ext-preview-toolbar">
                <span className="truncate" style={{ fontSize: 12, fontWeight: 600 }}>{active.file.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <button className="btn btn-secondary" style={{ padding: '4px 10px' }} disabled={pageNum <= 1} onClick={() => setPageNum((p) => p - 1)}>‹</button>
                  {pageNum}/{numPages || '…'}
                  <button className="btn btn-secondary" style={{ padding: '4px 10px' }} disabled={pageNum >= numPages} onClick={() => setPageNum((p) => p + 1)}>›</button>
                </div>
              </div>
              <div className="ext-canvas">{pageImg ? <img src={pageImg} alt={t('ext.pageAlt', { n: pageNum })} style={{ maxWidth: '100%', boxShadow: 'var(--shadow-md)' }} /> : <span className="spinner" />}</div>
            </div>
          )}
          <input ref={inputRef} type="file" accept=".pdf" multiple style={{ display: 'none' }}
            onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
        </div>

        <div className="ext-right">
          <div className="tabs">
            <button className={`tab-btn${tab === 'extract' ? ' active' : ''}`} onClick={() => setTab('extract')}>{t('ext.tabExtract')}</button>
            <button className={`tab-btn${tab === 'chat' ? ' active' : ''}`} onClick={() => setTab('chat')}>{t('ext.tabChat')}</button>
          </div>

          {tab === 'extract' && (
            <div className="ext-panel">
              <div className="form-group">
                <label className="label">{t('ext.fieldsLabel')}</label>
                <textarea rows={3} value={fields} onChange={(e) => setFields(e.target.value)} placeholder={t('ext.fieldsPlaceholder')} style={{ resize: 'vertical' }} />
                <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 4 }}>{t('ext.fieldsHelp')}</p>
              </div>
              {error && <div className="alert alert-error">{error}</div>}
              <button className="btn btn-primary" onClick={handleExtract} disabled={!active || !fields.trim() || status === 'loading'}>
                {status === 'loading' ? <><span className="spinner" /> {t('ext.extracting')}</> : t('ext.extractBtn')}
              </button>

              {active?.fields && (
                <>
                  <div style={{ display: 'flex', gap: 6, margin: '14px 0 8px', flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => exportData('json')}>JSON</button>
                    <button className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => exportData('csv')}>CSV</button>
                    <button className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => exportData('xlsx')}>Excel</button>
                    <button className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 10px' }} onClick={saveToHistory}>{saved ? t('ext.saved') : t('ext.saveHistory')}</button>
                  </div>
                  <table className="ext-table">
                    <thead><tr><th>{t('ext.colField')}</th><th>{t('ext.colValue')}</th></tr></thead>
                    <tbody>
                      {active.fields.map((f, i) => {
                        const v = validate(f.name, f.value)
                        return (
                          <tr key={i}>
                            <td style={{ fontWeight: 500, color: 'var(--c-accent)' }}>{f.name}</td>
                            <td style={{ color: f.value ? 'var(--c-text-primary)' : 'var(--c-text-muted)' }}>
                              {f.value || '—'}
                              {v && <span className={`badge-v ${v}`}>{v === 'ok' ? '✓' : '!'}</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}

          {tab === 'chat' && (
            <div className="ext-chat">
              <div className="ext-chat-msgs">
                {!active?.chat.length && <div style={{ color: 'var(--c-text-muted)', textAlign: 'center', marginTop: 40, fontSize: 13 }}>{t('ext.chatEmpty')}</div>}
                {active?.chat.map((m, i) => (
                  <div key={i} className={`msg ${m.role}`}><div className="msg-bubble">{m.content || (chatStreaming && i === active.chat.length - 1 ? '▌' : '')}</div></div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="ext-chat-input">
                <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder={t('ext.chatPlaceholder')}
                  onKeyDown={(e) => e.key === 'Enter' && handleChat()} disabled={!active || chatStreaming} />
                <button className="btn btn-primary" onClick={handleChat} disabled={!active || !chatInput.trim() || chatStreaming}>{t('ext.send')}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const EXT_CSS = `
.ext-page { margin: -24px -28px; height: 100vh; display: flex; flex-direction: column; overflow: hidden; background: var(--c-bg-content); }
.ext-header { padding: 18px 24px 10px; flex-shrink: 0; }
.ext-header h1 { font-size: 18px; font-weight: 700; }
.ext-header p { font-size: 12px; color: var(--c-text-muted); }
.doc-tabs { display: flex; gap: 6px; padding: 0 24px 10px; overflow-x: auto; flex-shrink: 0; }
.doc-tab { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid var(--c-border); border-radius: var(--r-md); background: var(--c-bg-card); cursor: pointer; font-size: 12px; max-width: 200px; }
.doc-tab.active { background: var(--c-bg-active); border-color: var(--c-accent-dim); color: var(--c-accent); }
.doc-tab-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px; }
.doc-tab-x { background: none; border: none; color: var(--c-text-muted); cursor: pointer; padding: 0; width: auto; }
.doc-tab-x:hover { color: var(--c-error); }
.doc-tab-add { width: 32px; padding: 0; color: var(--c-accent); border: 1px dashed var(--c-accent-dim); background: var(--c-accent-faint); border-radius: var(--r-md); }
.ext-body { display: flex; flex: 1; gap: 16px; padding: 0 24px 24px; overflow: hidden; }
.ext-left, .ext-right { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.ext-dropzone { flex: 1; border: 2px dashed var(--c-border); border-radius: var(--r-lg); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; cursor: pointer; background: var(--c-bg-card); text-align: center; }
.ext-dropzone:hover { border-color: var(--c-accent); background: var(--c-accent-faint); }
.ext-preview { flex: 1; display: flex; flex-direction: column; background: var(--c-bg-card); border: 1px solid var(--c-border); border-radius: var(--r-lg); overflow: hidden; min-height: 0; }
.ext-preview-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--c-border); background: var(--c-bg-card-alt); }
.ext-canvas { flex: 1; overflow: auto; display: flex; align-items: flex-start; justify-content: center; padding: 12px; background: #111118; }
.ext-right { background: var(--c-bg-card); border: 1px solid var(--c-border); border-radius: var(--r-lg); overflow: hidden; }
.tabs { display: flex; gap: 2px; padding: 6px; background: var(--c-bg-app); }
.tab-btn { flex: 1; padding: 7px; border: none; background: transparent; color: var(--c-text-secondary); font-weight: 600; font-size: 13px; cursor: pointer; border-radius: var(--r-md); }
.tab-btn.active { background: var(--c-bg-card); color: var(--c-text-primary); box-shadow: var(--shadow-sm); }
.ext-panel { flex: 1; overflow-y: auto; padding: 16px; }
.ext-table { width: 100%; border-collapse: collapse; }
.ext-table th, .ext-table td { padding: 8px 10px; text-align: left; font-size: 13px; border-bottom: 1px solid var(--c-separator); }
.ext-table th { font-size: 10px; text-transform: uppercase; color: var(--c-text-muted); }
.badge-v { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; font-size: 10px; font-weight: 700; margin-left: 6px; }
.badge-v.ok { background: rgba(34,197,94,.15); color: #4ade80; }
.badge-v.bad { background: rgba(239,68,68,.15); color: #f87171; }
.ext-chat { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.ext-chat-msgs { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.msg { max-width: 85%; }
.msg.user { align-self: flex-end; }
.msg.assistant { align-self: flex-start; }
.msg-bubble { padding: 9px 13px; border-radius: var(--r-lg); font-size: 14px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.msg.user .msg-bubble { background: var(--gradient-accent); color: #fff; border-bottom-right-radius: var(--r-sm); }
.msg.assistant .msg-bubble { background: var(--c-bg-card-alt); color: var(--c-text-primary); border: 1px solid var(--c-border); border-bottom-left-radius: var(--r-sm); }
.ext-chat-input { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--c-border); }
.ext-chat-input input { flex: 1; }
@media (max-width: 900px) { .ext-body { flex-direction: column; overflow: auto; } .ext-left, .ext-right { min-height: 380px; } }
`
