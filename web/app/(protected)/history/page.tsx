'use client'

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'

const IconFile = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="18" height="18">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
  </svg>
)
const IconTrash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="14" height="14">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" />
  </svg>
)
const IconOpen = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="14" height="14">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
  </svg>
)

interface SessionSummary { id: string; fileName: string; numPages: number; createdAt: string }

export default function HistoryPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/history')
      const data = await res.json()
      setSessions(data.sessions || [])
    } catch (err) {
      setError((err as Error).message)
    }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const openSession = (id: string) => router.push(`/extractor?restore=${encodeURIComponent(id)}`)

  const deleteSession = async (id: string) => {
    if (!window.confirm(t('history.confirmDelete'))) return
    try {
      await fetch(`/api/history/${id}`, { method: 'DELETE' })
      setSessions((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      setError((err as Error).message)
    }
  }
  const clearAll = async () => {
    if (!window.confirm(t('history.confirmClearAll'))) return
    try {
      await fetch('/api/history/clear', { method: 'POST' })
      setSessions([])
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const formatDate = (iso: string) => {
    if (!iso) return ''
    try { return new Date(iso).toLocaleString() } catch { return iso }
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">{t('history.title')}</h1>
        <p className="page-subtitle">{t('history.subtitle')}</p>
      </div>

      <div className="page-body">
        {error && <div className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}

        <div className="flex gap-2" style={{ marginBottom: 16, alignItems: 'center' }}>
          {sessions.length > 0 && (
            <button className="btn btn-ghost" onClick={clearAll}>
              <IconTrash />
              {t('history.clearAll')}
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center" style={{ justifyContent: 'center', padding: 40 }}>
            <div className="spinner" aria-label={t('common.loading')} />
          </div>
        ) : sessions.length === 0 ? (
          <div className="empty-state">
            <IconFile />
            <p>{t('history.noSessions')}</p>
          </div>
        ) : (
          <div className="history-list" role="list">
            {sessions.map((session) => (
              <div key={session.id} className="history-item card-section" role="listitem">
                <div className="history-item-icon"><IconFile /></div>
                <div className="history-item-info">
                  <div className="history-item-name">{session.fileName || session.id}</div>
                  <div className="history-item-meta text-muted text-sm">
                    {session.numPages ? `${session.numPages} ${t('extractor.pages')} · ` : ''}
                    {t('history.created')}: {formatDate(session.createdAt)}
                  </div>
                </div>
                <div className="history-item-actions flex gap-2">
                  <button className="btn btn-secondary" onClick={() => openSession(session.id)} aria-label={`${t('history.openSession')}: ${session.fileName}`} title={t('history.openSession')}>
                    <IconOpen />
                    {t('history.openSession')}
                  </button>
                  <button className="btn btn-ghost" onClick={() => deleteSession(session.id)} aria-label={`${t('history.deleteSession')}: ${session.fileName}`} title={t('history.deleteSession')}>
                    <IconTrash />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
