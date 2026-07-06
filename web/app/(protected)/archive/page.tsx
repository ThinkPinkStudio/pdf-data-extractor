'use client'

import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

interface Hit {
  score: number
  dossier?: string
  file?: string
  page?: number
  doc_type?: string
  doc_year?: number | null
  text?: string
}

export default function ArchivePage() {
  const t = useT()
  const [query, setQuery] = useState('')
  const [dossier, setDossier] = useState('')
  const [year, setYear] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<Hit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<{ enabled: boolean; available?: boolean; reason?: string } | null>(null)

  useEffect(() => {
    fetch('/api/vector/search')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [])

  async function search() {
    const q = query.trim()
    if (!q || searching) return
    setSearching(true)
    setError(null)
    try {
      const res = await fetch('/api/vector/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, dossier: dossier.trim() || null, year: year.trim() || null, limit: 15 }),
      })
      const data = await res.json()
      if (data.success) setResults(data.results || [])
      else { setResults(null); setError(data.error || 'Errore di ricerca') }
    } catch (e) {
      setResults(null)
      setError((e as Error).message)
    } finally {
      setSearching(false)
    }
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <h1 className="page-title">{t('arch.title')}</h1>
      <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginBottom: 20 }}>{t('arch.subtitle')}</p>

      {status && !status.enabled && (
        <div className="card" style={{ padding: 14, marginBottom: 16, fontSize: 13, color: 'var(--c-warning, #e6a23c)' }}>
          ⚠ {t('arch.notConfigured')}
        </div>
      )}
      {status && status.enabled && status.available === false && (
        <div className="card" style={{ padding: 14, marginBottom: 16, fontSize: 13, color: 'var(--c-warning, #e6a23c)' }}>
          ⚠ {t('arch.unreachable', { reason: status.reason || 'n/d' })}
        </div>
      )}

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder={t('arch.placeholder')}
            style={{ flex: '1 1 320px' }}
            aria-label={t('arch.search')}
          />
          <button className="btn btn-primary" onClick={search} disabled={searching || !query.trim()}>
            {searching ? <><span className="spinner" /> {t('arch.searching')}</> : t('arch.search')}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <input value={dossier} onChange={(e) => setDossier(e.target.value)} placeholder={t('arch.filterDossier')} style={{ flex: '1 1 200px', fontSize: 12 }} />
          <input value={year} onChange={(e) => setYear(e.target.value)} placeholder={t('arch.filterYear')} style={{ flex: '0 1 140px', fontSize: 12 }} />
        </div>
      </div>

      {error && <div className="card" style={{ padding: 12, marginBottom: 12, fontSize: 13, color: 'var(--c-error, #e05252)' }}>⚠ {error}</div>}

      {results !== null && (
        results.length === 0
          ? <p style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>{t('arch.noResults')}</p>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {results.map((r, i) => (
                <div key={i} className="card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      {t('arch.resultMeta', {
                        file: r.file || 'n/d',
                        page: String(r.page ?? '?'),
                        type: r.doc_type || 'altro',
                        year: r.doc_year ? ` · ${r.doc_year}` : '',
                      })}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>
                      {r.dossier} · score {typeof r.score === 'number' ? r.score.toFixed(3) : 'n/d'}
                    </span>
                  </div>
                  <p style={{ fontSize: 12.5, whiteSpace: 'pre-wrap', color: 'var(--c-text-primary)' }}>{(r.text || '').slice(0, 600)}</p>
                </div>
              ))}
            </div>
          )
      )}
    </div>
  )
}
