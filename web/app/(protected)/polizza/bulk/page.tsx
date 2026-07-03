'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useT } from '@/lib/i18n/I18nProvider'
import { groupPathsByDossier, displayDossierName, type GroupingMode, type GroupedDossier } from '@/lib/bulkGrouping'
import { parseExclusionList } from '@/lib/bulkExclusions'

const ERROR_BOX_STYLE: CSSProperties = {
  marginBottom: 16, padding: '10px 14px', background: 'rgba(239,68,68,.08)',
  border: '1px solid rgba(239,68,68,.25)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--c-error)',
}

type DossierStatus = 'pending' | 'uploading' | 'done' | 'error'

function fileRelPath(f: File): string {
  return (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
}

export default function PolizzaBulkPage() {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const supported = typeof window !== 'undefined' && 'webkitdirectory' in document.createElement('input')

  const [extraExclusions, setExtraExclusions] = useState<Set<string>>(new Set())
  const [files, setFiles] = useState<File[]>([]) // flat, indice allineato ai path
  const [root, setRoot] = useState('')
  const [mode, setMode] = useState<GroupingMode>('leaf')
  const [dossiers, setDossiers] = useState<GroupedDossier[]>([])
  const [scanning, setScanning] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)

  const [batchId, setBatchId] = useState<string | null>(null)
  const [phase, setPhase] = useState<'select' | 'uploading' | 'started'>('select')
  const [dossierStatus, setDossierStatus] = useState<Record<string, DossierStatus>>({})
  const [dossierError, setDossierError] = useState<Record<string, string>>({})
  const [finishing, setFinishing] = useState(false)

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((s) => {
      setExtraExclusions(parseExclusionList(s.bulkExcludedFolderNames))
    }).catch(() => {})
  }, [])

  // Ricalcola il raggruppamento (client-side, gratuito) quando cambiano i file
  // selezionati o la modalità — senza dover riselezionare la cartella.
  useEffect(() => {
    if (!files.length) { setDossiers([]); return }
    const relPaths = files.map(fileRelPath)
    const result = groupPathsByDossier(relPaths, mode, extraExclusions)
    setRoot((prev) => result.root || prev)
    setDossiers(result.dossiers)
  }, [files, mode, extraExclusions])

  function handlePick(fileList: FileList | null) {
    if (!fileList || !fileList.length) return
    setScanning(true); setPickError(null); setPhase('select'); setBatchId(null)
    setDossierStatus({}); setDossierError({})
    const all = Array.from(fileList)
    setFiles(all)
    setScanning(false)
    const relPaths = all.map(fileRelPath)
    const result = groupPathsByDossier(relPaths, mode, extraExclusions)
    if (result.dossiers.length === 0) setPickError(t('bulk.noPdfFound'))
  }

  const totalFiles = dossiers.reduce((n, d) => n + d.fileIndexes.length, 0)
  const doneCount = Object.values(dossierStatus).filter((s) => s === 'done').length
  const errorCount = Object.values(dossierStatus).filter((s) => s === 'error').length
  const attemptedAll = dossiers.length > 0 && dossiers.every((d) => dossierStatus[d.dossierName] === 'done' || dossierStatus[d.dossierName] === 'error')

  async function uploadDossier(id: string, d: GroupedDossier) {
    setDossierStatus((p) => ({ ...p, [d.dossierName]: 'uploading' }))
    try {
      const form = new FormData()
      form.append('dossierName', displayDossierName(d.dossierName, root))
      for (const idx of d.fileIndexes) {
        form.append('pdf', files[idx])
        form.append('path', fileRelPath(files[idx]))
      }
      const res = await fetch(`/api/polizza/batch/${id}/dossier`, { method: 'POST', body: form })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || t('bulk.errUpload'))
      }
      setDossierStatus((p) => ({ ...p, [d.dossierName]: 'done' }))
    } catch (err: any) {
      setDossierStatus((p) => ({ ...p, [d.dossierName]: 'error' }))
      setDossierError((p) => ({ ...p, [d.dossierName]: err.message }))
    }
  }

  async function handleStartUpload() {
    if (!dossiers.length) return
    setPhase('uploading'); setPickError(null)
    try {
      const res = await fetch('/api/polizza/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: root || 'Cartella' }),
      })
      if (!res.ok) throw new Error(t('bulk.errUpload'))
      const { batchId: id } = await res.json()
      setBatchId(id)
      for (const d of dossiers) await uploadDossier(id, d) // sequenziale: un dossier alla volta
    } catch (err: any) {
      setPickError(err.message); setPhase('select')
    }
  }

  async function handleRetry(d: GroupedDossier) {
    if (!batchId) return
    await uploadDossier(batchId, d)
  }

  async function handleFinish() {
    if (!batchId) return
    setFinishing(true)
    try {
      await fetch(`/api/polizza/batch/${batchId}/complete`, { method: 'POST' })
      setPhase('started')
    } finally {
      setFinishing(false)
    }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 className="page-title">{t('bulk.title')}</h1>
      <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginBottom: 20 }}>{t('bulk.subtitle')}</p>

      {!supported && <div style={ERROR_BOX_STYLE}>⚠ {t('bulk.notSupported')}</div>}

      {phase === 'select' && (
        <>
          <div className="card" style={{ padding: 24, textAlign: 'center', marginBottom: 16 }}>
            <button className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={scanning || !supported}>
              {dossiers.length ? t('bulk.changeFolder') : t('bulk.selectFolder')}
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

          {pickError && <div style={ERROR_BOX_STYLE}>⚠ {pickError}</div>}

          {dossiers.length > 0 && (
            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{t('bulk.rootLabel', { name: root })}</p>
              <p style={{ fontSize: 13, marginBottom: 12 }}>{t('bulk.summaryTitle', { n: dossiers.length, m: totalFiles })}</p>

              <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="radio" checked={mode === 'leaf'} onChange={() => setMode('leaf')} /> {t('bulk.modeLeaf')}
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="radio" checked={mode === 'firstLevel'} onChange={() => setMode('firstLevel')} /> {t('bulk.modeFirstLevel')}
                </label>
              </div>

              <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                <table>
                  <tbody>
                    {dossiers.map((d) => (
                      <tr key={d.dossierName}>
                        <td style={{ fontSize: 12 }}>{displayDossierName(d.dossierName, root)}</td>
                        <td style={{ fontSize: 12, color: 'var(--c-text-muted)', textAlign: 'right' }}>{t('bulk.dossierFiles', { n: d.fileIndexes.length })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} onClick={handleStartUpload}>
                {t('bulk.startBtn')}
              </button>
            </div>
          )}
        </>
      )}

      {phase === 'uploading' && (
        <div className="card" style={{ padding: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{t('bulk.rootLabel', { name: root })}</p>
          <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginBottom: 12 }}>
            {t('bulk.uploadSummary', { done: doneCount, error: errorCount, total: dossiers.length })}
          </p>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table>
              <tbody>
                {dossiers.map((d) => {
                  const st = dossierStatus[d.dossierName] || 'pending'
                  return (
                    <tr key={d.dossierName}>
                      <td style={{ fontSize: 12 }}>{displayDossierName(d.dossierName, root)}</td>
                      <td style={{ fontSize: 12, textAlign: 'right' }}>
                        {st === 'pending' && <span style={{ color: 'var(--c-text-muted)' }}>{t('bulk.dossierPending')}</span>}
                        {st === 'uploading' && <span style={{ color: 'var(--c-info)' }}><span className="spinner" /> {t('bulk.dossierUploading')}</span>}
                        {st === 'done' && <span style={{ color: 'var(--c-success)' }}>✓ {t('bulk.dossierDone')}</span>}
                        {st === 'error' && (
                          <span style={{ color: 'var(--c-error)' }}>
                            ⚠ {dossierError[d.dossierName]}{' '}
                            <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginLeft: 6 }} onClick={() => handleRetry(d)}>
                              {t('bulk.retryDossier')}
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {pickError && <div style={{ ...ERROR_BOX_STYLE, marginTop: 12 }}>⚠ {pickError}</div>}

          {attemptedAll && (
            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 16 }}
              onClick={handleFinish}
              disabled={finishing || doneCount === 0}
              aria-busy={finishing}
            >
              {finishing ? <><span className="spinner" /> {t('bulk.finishing')}</> : t('bulk.finishUpload')}
            </button>
          )}
        </div>
      )}

      {phase === 'started' && (
        <div className="card" style={{ padding: 24 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-success)', marginBottom: 6 }}>{t('bulk.startedTitle')}</p>
          <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginBottom: 16 }}>{t('bulk.startedText')}</p>
          <Link href="/polizza/jobs" className="btn btn-primary">{t('bulk.goToDashboard')}</Link>
        </div>
      )}
    </div>
  )
}
