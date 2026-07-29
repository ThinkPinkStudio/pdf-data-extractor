'use client'

// Chat sull'archivio documenti (RAG su Qdrant): interroga TUTTI i documenti
// indicizzati, un fascicolo (job — scope ermetico), una polizza (numero,
// attraverso caricamenti diversi) o un singolo documento. Le risposte sono
// ancorate ai soli estratti recuperati, con le fonti (file · pagina).

import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

interface ChatJob { id: string; label: string; files: string[] }
interface Source { n: number; dossier?: string; file?: string; page?: number; score?: number }
interface Msg { role: 'user' | 'assistant'; text: string; sources?: Source[] }

type Scope = 'all' | 'job' | 'polizza' | 'file'

export default function ArchiveChatPage() {
  const t = useT()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [jobs, setJobs] = useState<ChatJob[]>([])
  const [scope, setScope] = useState<Scope>('all')
  const [jobId, setJobId] = useState('')
  const [file, setFile] = useState('')
  const [polizzaNumero, setPolizzaNumero] = useState('')
  const [question, setQuestion] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/archive/chat').then((r) => r.json())
      .then((d) => { setEnabled(!!d.enabled); setJobs(d.jobs || []) })
      .catch(() => setEnabled(false))
  }, [])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  const selectedJob = jobs.find((j) => j.id === jobId)

  async function ask() {
    const q = question.trim()
    if (!q || busy) return
    setMsgs((p) => [...p, { role: 'user', text: q }])
    setQuestion('')
    setBusy(true)
    try {
      const res = await fetch('/api/archive/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          jobId: (scope === 'job' || scope === 'file') && jobId ? jobId : null,
          file: scope === 'file' && file ? file : null,
          polizzaNumero: scope === 'polizza' && polizzaNumero.trim() ? polizzaNumero.trim() : null,
        }),
      })
      const d = await res.json()
      if (!d.success) setMsgs((p) => [...p, { role: 'assistant', text: `⚠ ${d.error || 'Errore'}` }])
      else if (!d.answer) setMsgs((p) => [...p, { role: 'assistant', text: t('chat.empty') }])
      else setMsgs((p) => [...p, { role: 'assistant', text: d.answer, sources: d.sources || [] }])
    } catch (e) {
      setMsgs((p) => [...p, { role: 'assistant', text: `⚠ ${(e as Error).message}` }])
    } finally { setBusy(false) }
  }

  return (
    <div style={{ maxWidth: 1200, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      <h1 className="page-title">{t('chat.title')}</h1>
      <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginBottom: 12 }}>{t('chat.subtitle')}</p>

      {enabled === false && (
        <div className="card" style={{ padding: 14, marginBottom: 12, fontSize: 13, color: 'var(--c-warning, #e6a23c)' }}>
          ⚠ {t('chat.notConfigured')}
        </div>
      )}

      {/* Scope: tutti / fascicolo / polizza / documento */}
      <div className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={scope} onChange={(e) => setScope(e.target.value as Scope)} style={{ fontSize: 12, flex: '0 0 auto' }}>
          <option value="all">{t('chat.scopeAll')}</option>
          <option value="job">{t('chat.scopeJob')}</option>
          <option value="polizza">{t('chat.scopePolizza')}</option>
          <option value="file">{t('chat.scopeFile')}</option>
        </select>
        {(scope === 'job' || scope === 'file') && (
          <select value={jobId} onChange={(e) => { setJobId(e.target.value); setFile('') }} style={{ fontSize: 12, flex: '1 1 260px' }}>
            <option value="">{t('chat.pickJob')}</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
          </select>
        )}
        {scope === 'file' && (
          <select value={file} onChange={(e) => setFile(e.target.value)} style={{ fontSize: 12, flex: '1 1 240px' }} disabled={!selectedJob}>
            <option value="">{t('chat.pickFile')}</option>
            {(selectedJob?.files || []).map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        {scope === 'polizza' && (
          <input value={polizzaNumero} onChange={(e) => setPolizzaNumero(e.target.value)}
            placeholder={t('chat.polizzaPlaceholder')} style={{ fontSize: 12, flex: '1 1 200px', fontFamily: 'var(--font-mono)' }} />
        )}
      </div>

      {/* Conversazione */}
      <div className="card" style={{ flex: 1, minHeight: 240, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {msgs.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--c-text-muted)', margin: 'auto' }}>{t('chat.placeholder')}</p>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%',
            background: m.role === 'user' ? 'var(--c-accent)' : 'var(--c-bg-card-alt)',
            color: m.role === 'user' ? '#fff' : 'var(--c-text-primary)',
            borderRadius: 10, padding: '10px 14px', fontSize: 13, whiteSpace: 'pre-wrap',
          }}>
            {m.text}
            {m.sources && m.sources.length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--c-separator)', fontSize: 11, color: 'var(--c-text-muted)' }}>
                <strong>{t('chat.sources')}:</strong>{' '}
                {m.sources.map((s) => `[${s.n}] ${s.file || '?'}${s.page ? ` · pag. ${s.page}` : ''}`).join(' · ')}
              </div>
            )}
          </div>
        ))}
        {busy && <p style={{ fontSize: 12, color: 'var(--c-text-muted)' }}><span className="spinner" /> {t('chat.thinking')}</p>}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input value={question} onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          placeholder={t('chat.placeholder')} style={{ flex: 1, fontSize: 13 }}
          disabled={enabled === false} />
        <button className="btn btn-primary" onClick={ask} disabled={busy || !question.trim() || enabled === false}>
          {t('chat.send')}
        </button>
      </div>
    </div>
  )
}
