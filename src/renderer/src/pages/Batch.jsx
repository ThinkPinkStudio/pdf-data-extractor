import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const IconFolder = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="16" height="16">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>
)

const IconFile = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="16" height="16">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
  </svg>
)

const IconPlay = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="16" height="16">
    <polygon points="5 3 19 12 5 21 5 3"/>
  </svg>
)

const IconStop = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="16" height="16">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
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

function StatusBadge({ status, t }) {
  const map = {
    pending: { cls: 'badge-neutral', label: t('batch.statusPending') },
    processing: { cls: 'badge-info', label: t('batch.statusProcessing') },
    done: { cls: 'badge-success', label: t('batch.statusDone') },
    error: { cls: 'badge-error', label: t('batch.statusError') },
    cancelled: { cls: 'badge-neutral', label: t('batch.statusCancelled') }
  }
  const { cls, label } = map[status] || map.pending
  return <span className={`badge ${cls}`}>{label}</span>
}

export default function Batch() {
  const { t } = useTranslation()
  const [files, setFiles] = useState([]) // array of { path, name }
  const [running, setRunning] = useState(false)
  const [fileStatuses, setFileStatuses] = useState({}) // path -> { status, result, error }
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [done, setDone] = useState(false)
  const listenerRef = useRef(false)

  useEffect(() => {
    if (listenerRef.current) return
    listenerRef.current = true

    window.electronAPI.onBatchProgress(({ index, total, fileName, status, result, error }) => {
      setCurrentIndex(index)
      setFileStatuses(prev => ({
        ...prev,
        [fileName]: { status, result, error }
      }))
      if (index === total - 1 && (status === 'done' || status === 'error' || status === 'cancelled')) {
        setRunning(false)
        setDone(true)
      }
    })

    return () => {
      window.electronAPI.removeAllBatchListeners()
      listenerRef.current = false
    }
  }, [])

  const addFiles = async () => {
    const paths = await window.electronAPI.openMultiplePDFsDialog()
    if (!paths || paths.length === 0) return
    const newFiles = paths.map(p => ({ path: p, name: p.split('/').pop() }))
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.path))
      return [...prev, ...newFiles.filter(f => !existing.has(f.path))]
    })
  }

  const addFolder = async () => {
    const folderPath = await window.electronAPI.openFolderDialog()
    if (!folderPath) return
    // We can't directly enumerate folder contents from renderer; just show a note
    // The main handler will have to enumerate. For now pass folder as special entry.
    // Instead use dialog:openMultiplePDFs which supports multiSelections.
    // Since we can't enumerate folder from renderer, we inform user to use "Select PDFs" instead.
    alert(t('batch.selectFiles'))
  }

  const removeFile = (path) => {
    setFiles(prev => prev.filter(f => f.path !== path))
    setFileStatuses(prev => {
      const next = { ...prev }
      const name = path.split('/').pop()
      delete next[name]
      return next
    })
  }

  const clearFiles = () => {
    setFiles([])
    setFileStatuses({})
    setDone(false)
    setCurrentIndex(-1)
  }

  const start = async () => {
    if (files.length === 0 || running) return
    setRunning(true)
    setDone(false)
    setFileStatuses({})
    setCurrentIndex(-1)

    // Initialize all as pending
    const init = {}
    files.forEach(f => { init[f.name] = { status: 'pending' } })
    setFileStatuses(init)

    try {
      await window.electronAPI.startBatch(files.map(f => f.path))
    } catch (err) {
      setRunning(false)
    }
    setRunning(false)
    setDone(true)
  }

  const cancel = async () => {
    await window.electronAPI.cancelBatch()
    setRunning(false)
  }

  const exportCSV = () => {
    const rows = files
      .map(f => {
        const st = fileStatuses[f.name]
        if (!st || !st.result) return null
        return { fileName: f.name, ...st.result }
      })
      .filter(Boolean)

    if (rows.length === 0) return

    const allKeys = ['fileName', ...new Set(rows.flatMap(r => Object.keys(r).filter(k => k !== 'fileName')))]
    const esc = v => {
      const s = String(v ?? '')
      return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [allKeys.join(','), ...rows.map(r => allKeys.map(k => esc(r[k])).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'batch_results.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const completedCount = Object.values(fileStatuses).filter(s => s.status === 'done').length
  const totalCount = files.length
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">{t('batch.title')}</h1>
        <p className="page-subtitle">{t('batch.subtitle')}</p>
      </div>

      <div className="page-body">
        {/* File selection */}
        <section className="card-section" aria-labelledby="section-batch-files">
          <h2 className="section-title" id="section-batch-files">{t('batch.selectFiles')}</h2>

          <div className="flex gap-2" style={{ marginBottom: 12 }}>
            <button className="btn btn-secondary" onClick={addFiles} disabled={running}>
              <IconFile />
              {t('batch.addFiles')}
            </button>
            {files.length > 0 && (
              <button className="btn btn-ghost" onClick={clearFiles} disabled={running}>
                <IconTrash />
                {t('batch.clearFiles')}
              </button>
            )}
          </div>

          {files.length === 0 ? (
            <p className="text-muted text-sm">{t('batch.noFiles')}</p>
          ) : (
            <div className="batch-file-list" role="list">
              {files.map((f, i) => {
                const st = fileStatuses[f.name] || { status: 'pending' }
                return (
                  <div key={f.path} className="batch-file-item" role="listitem">
                    <span className="batch-file-index">{i + 1}</span>
                    <IconFile />
                    <span className="batch-file-name" title={f.path}>{f.name}</span>
                    <StatusBadge status={st.status} t={t} />
                    {st.error && (
                      <span className="batch-file-error text-sm" title={st.error}>
                        {st.error.slice(0, 60)}{st.error.length > 60 ? '…' : ''}
                      </span>
                    )}
                    {!running && (
                      <button
                        className="btn-icon btn-danger-icon"
                        onClick={() => removeFile(f.path)}
                        aria-label={`${t('common.delete')}: ${f.name}`}
                      >
                        <IconTrash />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <div className="sep" />

        {/* Controls */}
        <section className="card-section" aria-labelledby="section-batch-ctrl">
          <h2 className="section-title" id="section-batch-ctrl">{t('batch.progress')}</h2>

          {totalCount > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="progress-bar-wrap">
                <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <p className="text-muted text-sm" style={{ marginTop: 4 }}>
                {completedCount} / {totalCount}
              </p>
            </div>
          )}

          <div className="flex gap-2">
            {!running ? (
              <button
                className="btn btn-primary"
                onClick={start}
                disabled={files.length === 0}
              >
                <IconPlay />
                {t('batch.start')}
              </button>
            ) : (
              <button className="btn btn-secondary" onClick={cancel}>
                <IconStop />
                {t('batch.cancel')}
              </button>
            )}

            {done && completedCount > 0 && (
              <button className="btn btn-ghost" onClick={exportCSV}>
                <IconDownload />
                {t('batch.exportCSV')}
              </button>
            )}
          </div>
        </section>

        {/* Results table */}
        {done && files.some(f => fileStatuses[f.name]?.result) && (
          <>
            <div className="sep" />
            <section className="card-section" aria-labelledby="section-batch-results">
              <h2 className="section-title" id="section-batch-results">{t('batch.results')}</h2>
              <div className="batch-results-table-wrap">
                <table className="batch-results-table">
                  <thead>
                    <tr>
                      <th>{t('batch.status')}</th>
                      <th>File</th>
                      {files
                        .filter(f => fileStatuses[f.name]?.result)
                        .flatMap(f => Object.keys(fileStatuses[f.name].result))
                        .filter((k, i, a) => a.indexOf(k) === i)
                        .map(k => <th key={k}>{k}</th>)
                      }
                    </tr>
                  </thead>
                  <tbody>
                    {files.map(f => {
                      const st = fileStatuses[f.name]
                      if (!st) return null
                      const allKeys = files
                        .filter(ff => fileStatuses[ff.name]?.result)
                        .flatMap(ff => Object.keys(fileStatuses[ff.name].result))
                        .filter((k, i, a) => a.indexOf(k) === i)
                      return (
                        <tr key={f.path}>
                          <td><StatusBadge status={st.status} t={t} /></td>
                          <td className="batch-file-name-cell" title={f.path}>{f.name}</td>
                          {allKeys.map(k => (
                            <td key={k}>{st.result ? (st.result[k] ?? '—') : (st.error || '—')}</td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </>
  )
}
