'use client'

import { useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useT } from '@/lib/i18n/I18nProvider'

const ROOT_BUCKET = '(radice)'

const ERROR_BOX_STYLE: CSSProperties = {
  marginBottom: 16, padding: '10px 14px', background: 'rgba(239,68,68,.08)',
  border: '1px solid rgba(239,68,68,.25)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--c-error)',
}

interface DossierGroup { dossierName: string; files: File[] }

function groupByDossier(fileList: FileList): { root: string; groups: DossierGroup[]; total: number } {
  const files = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith('.pdf'))
  let root = ''
  const order: string[] = []
  const map = new Map<string, File[]>()
  for (const f of files) {
    const relPath = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    const segments = relPath.split('/').filter(Boolean)
    if (!root && segments.length) root = segments[0]
    const dossierName = segments.length >= 3 ? segments[1] : ROOT_BUCKET
    if (!map.has(dossierName)) { map.set(dossierName, []); order.push(dossierName) }
    map.get(dossierName)!.push(f)
  }
  const groups = order.map((name) => ({ dossierName: name, files: map.get(name)! }))
  return { root, groups, total: files.length }
}

export default function PolizzaBulkPage() {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const [root, setRoot] = useState('')
  const [groups, setGroups] = useState<DossierGroup[]>([])
  const [scanning, setScanning] = useState(false)
  const [status, setStatus] = useState<'idle' | 'ready' | 'starting' | 'started' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const supported = typeof window !== 'undefined' && 'webkitdirectory' in document.createElement('input')

  const totalFiles = groups.reduce((n, g) => n + g.files.length, 0)

  function handlePick(fileList: FileList | null) {
    if (!fileList || !fileList.length) return
    setScanning(true); setError(null); setStatus('idle')
    const { root: r, groups: g, total } = groupByDossier(fileList)
    setRoot(r); setGroups(g); setScanning(false)
    setStatus(total > 0 ? 'ready' : 'error')
    if (total === 0) setError(t('bulk.noPdfFound'))
  }

  async function handleStart() {
    if (!groups.length) return
    setStatus('starting'); setError(null)
    try {
      const form = new FormData()
      form.append('label', root || 'Cartella')
      for (const g of groups) {
        for (const f of g.files) {
          form.append('pdf', f)
          form.append('path', (f as File & { webkitRelativePath?: string }).webkitRelativePath || `${root}/${g.dossierName}/${f.name}`)
        }
      }
      const res = await fetch('/api/polizza/batch', { method: 'POST', body: form })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || t('bulk.errUpload'))
      }
      setStatus('started')
    } catch (err: any) {
      setError(err.message); setStatus('ready')
    }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 className="page-title">{t('bulk.title')}</h1>
      <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginBottom: 20 }}>{t('bulk.subtitle')}</p>

      {!supported && <div style={ERROR_BOX_STYLE}>⚠ {t('bulk.notSupported')}</div>}

      {status !== 'started' && (
        <>
          <div className="card" style={{ padding: 24, textAlign: 'center', marginBottom: 16 }}>
            <button className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={scanning || !supported}>
              {groups.length ? t('bulk.changeFolder') : t('bulk.selectFolder')}
            </button>
            <input
              ref={inputRef}
              type="file"
              webkitdirectory=""
              multiple
              style={{ display: 'none' }}
              onChange={(e) => { handlePick(e.target.files); e.target.value = '' }}
            />
            {scanning && <p style={{ fontSize: 12, marginTop: 10 }}><span className="spinner" /> {t('bulk.scanning')}</p>}
          </div>

          {error && <div style={ERROR_BOX_STYLE}>⚠ {error}</div>}

          {groups.length > 0 && (
            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{t('bulk.rootLabel', { name: root })}</p>
              <p style={{ fontSize: 13, marginBottom: 12 }}>{t('bulk.summaryTitle', { n: groups.length, m: totalFiles })}</p>
              <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                <table>
                  <tbody>
                    {groups.map((g) => (
                      <tr key={g.dossierName}>
                        <td style={{ fontSize: 12 }}>{g.dossierName === ROOT_BUCKET ? root : g.dossierName}</td>
                        <td style={{ fontSize: 12, color: 'var(--c-text-muted)', textAlign: 'right' }}>{t('bulk.dossierFiles', { n: g.files.length })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                className="btn btn-primary"
                style={{ width: '100%', marginTop: 16 }}
                onClick={handleStart}
                disabled={status === 'starting'}
                aria-busy={status === 'starting'}
              >
                {status === 'starting' ? <><span className="spinner" /> {t('bulk.starting')}</> : t('bulk.startBtn')}
              </button>
            </div>
          )}
        </>
      )}

      {status === 'started' && (
        <div className="card" style={{ padding: 24 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-success)', marginBottom: 6 }}>{t('bulk.startedTitle')}</p>
          <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginBottom: 16 }}>{t('bulk.startedText')}</p>
          <Link href="/polizza/jobs" className="btn btn-primary">{t('bulk.goToDashboard')}</Link>
        </div>
      )}
    </div>
  )
}
