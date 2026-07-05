'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */
// Chat sull'archivio polizze: interroga il corpus documentale persistito
// (testo + metadati di ogni PDF caricato) con retrieval ibrido e citazioni.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

interface Conversation { id: string; title: string | null; updated_at: number }
interface Citation {
  n: number; documentId: string; fileName: string
  gruppo?: string | null; societa?: string | null; ramo?: string | null
  pageFrom?: number | null; pageTo?: number | null
}
interface Message { role: 'user' | 'assistant'; content: string; citations?: Citation[] }
interface Facets { gruppi: string[]; societa: string[]; rami: string[]; docTypes: string[]; anni: number[]; totalDocuments: number }
interface Filters { gruppo?: string; societa?: string; ramo?: string; docType?: string; anno?: number }

export default function CorpusChatPage() {
  const t = useT()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [facets, setFacets] = useState<Facets | null>(null)
  const [filters, setFilters] = useState<Filters>({})
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [sourceDoc, setSourceDoc] = useState<any | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const loadConversations = useCallback(async () => {
    try {
      const d = await (await fetch('/api/chat/conversations')).json()
      setConversations(d.conversations || [])
    } catch { setConversations([]) }
  }, [])

  useEffect(() => {
    loadConversations()
    fetch('/api/chat/facets').then((r) => r.json()).then(setFacets).catch(() => setFacets(null))
  }, [loadConversations])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function openConversation(id: string) {
    setActiveId(id)
    setSourceDoc(null)
    try {
      const d = await (await fetch(`/api/chat/conversations/${id}`)).json()
      setMessages((d.messages || []).map((m: any) => ({ role: m.role, content: m.content, citations: m.citations })))
      setFilters(d.conversation?.filters || {})
    } catch { setMessages([]) }
  }

  async function removeConversation(id: string) {
    if (!confirm(t('chat.deleteConfirm'))) return
    await fetch(`/api/chat/conversations/${id}`, { method: 'DELETE' })
    if (activeId === id) { setActiveId(null); setMessages([]) }
    loadConversations()
  }

  async function send() {
    const message = input.trim()
    if (!message || streaming) return
    setInput('')
    setStreaming(true)
    setMessages((prev) => [...prev, { role: 'user', content: message }, { role: 'assistant', content: '' }])
    try {
      let id = activeId
      if (!id) {
        const d = await (await fetch('/api/chat/conversations', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filters }),
        })).json()
        id = d.id
        setActiveId(id)
      }
      const res = await fetch(`/api/chat/conversations/${id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, filters }),
      })
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({})))?.error || 'errore')

      // Prima riga dello stream: JSON con le fonti disponibili, poi il testo.
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let citations: Citation[] = []
      let headerDone = false
      let text = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        if (!headerDone) {
          const sep = buf.indexOf('\n\n')
          if (sep === -1) continue
          try { citations = (JSON.parse(buf.slice(0, sep)).citations || []) } catch { citations = [] }
          buf = buf.slice(sep + 2)
          headerDone = true
        }
        text = buf
        setMessages((prev) => {
          const next = [...prev]
          next[next.length - 1] = { role: 'assistant', content: text, citations: [] }
          return next
        })
      }
      // A fine stream mostra solo le fonti effettivamente citate.
      const used = citations.filter((c) => text.includes(`[${c.n}]`))
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: text, citations: used.length ? used : citations.slice(0, 3) }
        return next
      })
      loadConversations()
    } catch (err: any) {
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: `[errore: ${err?.message || err}]` }
        return next
      })
    } finally {
      setStreaming(false)
    }
  }

  async function openSource(c: Citation) {
    try {
      const d = await (await fetch(`/api/documents/${c.documentId}`)).json()
      setSourceDoc(d)
    } catch { /* niente drawer */ }
  }

  const filterSelect = (label: string, key: keyof Filters, options: (string | number)[]) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10, color: 'var(--c-text-muted)' }}>
      {label}
      <select
        value={String(filters[key] ?? '')}
        onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value ? (key === 'anno' ? Number(e.target.value) : e.target.value) : undefined }))}
        style={{ fontSize: 11, maxWidth: 150 }}
      >
        <option value="">{t('chat.filterAll')}</option>
        {options.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
      </select>
    </label>
  )

  return (
    <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 90px)' }}>
      {/* Conversazioni */}
      <div className="card" style={{ width: 220, flexShrink: 0, padding: 10, overflowY: 'auto' }}>
        <button className="btn btn-secondary" style={{ width: '100%', fontSize: 12, marginBottom: 10 }}
          onClick={() => { setActiveId(null); setMessages([]); setSourceDoc(null) }}>
          ＋ {t('chat.newConversation')}
        </button>
        {conversations.map((c) => (
          <div key={c.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
              background: activeId === c.id ? 'var(--c-bg-card-alt)' : 'transparent', marginBottom: 2,
            }}
            onClick={() => openConversation(c.id)}>
            <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.title || '—'}
            </span>
            <button aria-label="delete" onClick={(e) => { e.stopPropagation(); removeConversation(c.id) }}
              style={{ background: 'none', border: 'none', color: 'var(--c-text-muted)', cursor: 'pointer', fontSize: 12 }}>✕</button>
          </div>
        ))}
      </div>

      {/* Chat */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h1 className="page-title">{t('chat.title')}</h1>
          {facets && <span style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{t('chat.subtitle', { n: facets.totalDocuments })}</span>}
        </div>

        {facets && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            {filterSelect(t('chat.filterGruppo'), 'gruppo', facets.gruppi)}
            {filterSelect(t('chat.filterSocieta'), 'societa', facets.societa)}
            {filterSelect(t('chat.filterRamo'), 'ramo', facets.rami)}
            {filterSelect(t('chat.filterDocType'), 'docType', facets.docTypes)}
            {filterSelect(t('chat.filterAnno'), 'anno', facets.anni)}
          </div>
        )}

        <div className="card" style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {facets !== null && facets.totalDocuments === 0 && (
            <p style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>{t('chat.noDocs')}</p>
          )}
          {messages.length === 0 && (facets?.totalDocuments ?? 1) > 0 && (
            <p style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>{t('chat.empty')}</p>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              background: m.role === 'user' ? 'var(--c-accent)' : 'var(--c-bg-card-alt)',
              color: m.role === 'user' ? '#fff' : 'var(--c-text)',
              borderRadius: 10, padding: '8px 12px', fontSize: 13, whiteSpace: 'pre-wrap',
            }}>
              {m.content || (streaming && i === messages.length - 1 ? <span className="spinner" /> : '')}
              {m.role === 'assistant' && (m.citations?.length ?? 0) > 0 && (
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: 'var(--c-text-muted)' }}>{t('chat.sources')}:</span>
                  {m.citations!.map((c) => (
                    <button key={`${c.n}-${c.documentId}`} onClick={() => openSource(c)}
                      title={[c.gruppo, c.societa, c.ramo].filter(Boolean).join(' / ')}
                      style={{
                        fontSize: 10, padding: '1px 7px', borderRadius: 8, cursor: 'pointer',
                        border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-text-secondary)',
                      }}>
                      [{c.n}] {c.fileName}{c.pageFrom ? ` · ${t('chat.sourcePages')} ${c.pageFrom}${c.pageTo && c.pageTo !== c.pageFrom ? `-${c.pageTo}` : ''}` : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={(e) => { e.preventDefault(); send() }} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('chat.placeholder')}
            style={{ flex: 1 }} disabled={streaming} />
          <button type="submit" className="btn btn-primary" disabled={streaming || !input.trim()}>
            {streaming ? <span className="spinner" /> : t('chat.send')}
          </button>
        </form>
      </div>

      {/* Drawer fonte */}
      {sourceDoc && (
        <div className="card" style={{ width: 320, flexShrink: 0, padding: 12, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>{sourceDoc.fileName}</strong>
            <button onClick={() => setSourceDoc(null)}
              style={{ background: 'none', border: 'none', color: 'var(--c-text-muted)', cursor: 'pointer' }}>✕</button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 8 }}>
            {[sourceDoc.gruppo, sourceDoc.societa, sourceDoc.ramo, sourceDoc.docType, sourceDoc.anno].filter(Boolean).join(' · ')}
          </p>
          {(sourceDoc.pages || []).map((p: any) => (
            <details key={p.page} style={{ marginBottom: 6 }}>
              <summary style={{ fontSize: 11, cursor: 'pointer', color: 'var(--c-text-secondary)' }}>Pag. {p.page}</summary>
              <pre style={{ fontSize: 10, whiteSpace: 'pre-wrap', color: 'var(--c-text-muted)' }}>{p.text}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}
