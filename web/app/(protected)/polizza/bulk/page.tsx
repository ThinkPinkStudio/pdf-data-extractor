'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useT } from '@/lib/i18n/I18nProvider'
import { groupPathsByDossier, displayDossierName, type GroupedDossier, type SkippedPath } from '@/lib/bulkGrouping'
import { parseExclusionList, parseKeywords, makeFilters, type SkipReason } from '@/lib/bulkExclusions'

const ERROR_BOX_STYLE: CSSProperties = {
  marginBottom: 16, padding: '10px 14px', background: 'rgba(239,68,68,.08)',
  border: '1px solid rgba(239,68,68,.25)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--c-error)',
}

type DossierStatus = 'pending' | 'uploading' | 'done' | 'error'

// Dossier finale da elaborare: uno o più dossier-foglia uniti dall'utente.
interface FinalDossier { gid: string; label: string; fileIndexes: number[]; memberCount: number }

function fileRelPath(f: File): string {
  return (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
}

// Etichetta di un gruppo unito: prefisso-cartella comune dei membri (es. "Cli/PolX"
// per "Cli/PolX/Scansioni" + "Cli/PolX/Condizioni"), altrimenti il primo membro. I
// percorsi includono già la radice, quindi non va riaggiunta.
function mergedLabel(members: GroupedDossier[]): string {
  const realPaths = members.map((m) => m.dossierName).filter((n) => !n.startsWith('__loose__'))
  if (realPaths.length >= 2) {
    const split = realPaths.map((p) => p.split('/'))
    const common: string[] = []
    for (let i = 0; ; i++) {
      const seg = split[0][i]
      if (seg === undefined || !split.every((s) => s[i] === seg)) break
      common.push(seg)
    }
    if (common.length) return common.join('/')
  }
  return displayDossierName(members[0].dossierName)
}

export default function PolizzaBulkPage() {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const supported = typeof window !== 'undefined' && 'webkitdirectory' in document.createElement('input')

  const [extraExclusions, setExtraExclusions] = useState<Set<string>>(new Set())
  const [includeText, setIncludeText] = useState('')
  const [excludeText, setExcludeText] = useState('')
  const [files, setFiles] = useState<File[]>([]) // flat, indice allineato ai path
  const [root, setRoot] = useState('')
  const [baseDossiers, setBaseDossiers] = useState<GroupedDossier[]>([])
  const [skipped, setSkipped] = useState<SkippedPath[]>([])
  const [showSkipped, setShowSkipped] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)

  // Revisione manuale dell'elenco: esclusione per riga, selezione multipla e unione.
  const [included, setIncluded] = useState<Record<string, boolean>>({}) // default: incluso
  const [groupOf, setGroupOf] = useState<Record<string, string>>({})    // dossier-foglia → id gruppo unito
  const [selected, setSelected] = useState<Set<string>>(new Set())      // righe spuntate per l'unione
  const mergeCounter = useRef(0)

  const [batchId, setBatchId] = useState<string | null>(null)
  const [phase, setPhase] = useState<'select' | 'uploading' | 'started'>('select')
  const [dossierStatus, setDossierStatus] = useState<Record<string, DossierStatus>>({})
  const [dossierError, setDossierError] = useState<Record<string, string>>({})
  const [finishing, setFinishing] = useState(false)
  // Snapshot dei dossier finali al momento dell'avvio: l'upload non deve risentire di
  // eventuali cambi di stato successivi.
  const [uploadList, setUploadList] = useState<FinalDossier[]>([])

  // I valori salvati nelle Impostazioni sono il punto di partenza: qui si possono
  // ritoccare per la singola cartella senza tornare in Impostazioni.
  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((s) => {
      setExtraExclusions(parseExclusionList(s.bulkExcludedFolderNames))
      setIncludeText(s.bulkIncludeKeywords || '')
      setExcludeText(s.bulkExcludeKeywords || '')
    }).catch(() => {})
  }, [])

  const filters = useMemo(() => makeFilters({
    excludedNames: extraExclusions,
    includeWords: parseKeywords(includeText),
    excludeWords: parseKeywords(excludeText),
  }), [extraExclusions, includeText, excludeText])

  // Ricalcola il raggruppamento (client-side, gratuito) quando cambiano i file
  // selezionati o i filtri. Cambiando l'insieme dei dossier, la revisione manuale
  // (esclusioni/unioni/selezioni) viene azzerata: si riparte dall'elenco proposto.
  useEffect(() => {
    if (!files.length) { setBaseDossiers([]); setSkipped([]); return }
    const relPaths = files.map(fileRelPath)
    const result = groupPathsByDossier(relPaths, filters)
    setRoot((prev) => result.root || prev)
    setBaseDossiers(result.dossiers)
    setSkipped(result.skipped)
    setIncluded({})
    setGroupOf({})
    setSelected(new Set())
  }, [files, filters])

  function handlePick(fileList: FileList | null) {
    if (!fileList || !fileList.length) return
    setScanning(true); setPickError(null); setPhase('select'); setBatchId(null)
    setDossierStatus({}); setDossierError({})
    const all = Array.from(fileList)
    setFiles(all)
    setScanning(false)
    const relPaths = all.map(fileRelPath)
    const result = groupPathsByDossier(relPaths, filters)
    if (result.dossiers.length === 0) setPickError(t('bulk.noPdfFound'))
  }

  // I file non-PDF di una cartella mista sono rumore (immagini, Word, …): si contano
  // e basta, mentre i PDF davvero scartati dai filtri vanno mostrati uno per uno.
  const filteredOut = useMemo(() => skipped.filter((s) => s.reason !== 'notPdf'), [skipped])
  const nonPdfCount = skipped.length - filteredOut.length
  const skipLabel: Record<SkipReason, string> = {
    notPdf: t('bulk.skipNotPdf'),
    excludedName: t('bulk.skipExcludedName'),
    excludeWord: t('bulk.skipExcludeWord'),
    includeWord: t('bulk.skipIncludeWord'),
  }

  const isIncluded = (name: string) => included[name] !== false
  const gidOf = (name: string) => groupOf[name] || name

  // Dossier finali = dossier-foglia inclusi, raggruppati per id gruppo (unione).
  const finalDossiers = useMemo<FinalDossier[]>(() => {
    const map = new Map<string, { members: GroupedDossier[]; fileIndexes: number[] }>()
    for (const d of baseDossiers) {
      if (included[d.dossierName] === false) continue
      const gid = groupOf[d.dossierName] || d.dossierName
      const g = map.get(gid) || { members: [], fileIndexes: [] }
      g.members.push(d); g.fileIndexes.push(...d.fileIndexes)
      map.set(gid, g)
    }
    return [...map.entries()].map(([gid, g]) => ({
      gid,
      label: g.members.length === 1 ? displayDossierName(g.members[0].dossierName) : mergedLabel(g.members),
      fileIndexes: g.fileIndexes,
      memberCount: g.members.length,
    }))
  }, [baseDossiers, included, groupOf, root])

  const detectedFiles = baseDossiers.reduce((n, d) => n + d.fileIndexes.length, 0)
  const selectedFiles = finalDossiers.reduce((n, d) => n + d.fileIndexes.length, 0)
  const doneCount = Object.values(dossierStatus).filter((s) => s === 'done').length
  const errorCount = Object.values(dossierStatus).filter((s) => s === 'error').length
  const attemptedAll = uploadList.length > 0 && uploadList.every((d) => dossierStatus[d.gid] === 'done' || dossierStatus[d.gid] === 'error')

  function toggleInclude(name: string) { setIncluded((p) => ({ ...p, [name]: p[name] === false })) }
  function toggleSelect(name: string) {
    setSelected((p) => { const n = new Set(p); if (n.has(name)) n.delete(name); else n.add(name); return n })
  }
  function setAllIncluded(v: boolean) {
    const next: Record<string, boolean> = {}
    for (const d of baseDossiers) next[d.dossierName] = v
    setIncluded(next)
  }
  // Unisce le righe spuntate in un unico dossier. Trascina dentro anche gli eventuali
  // altri membri dei gruppi a cui le righe selezionate già appartengono.
  function mergeSelected() {
    if (selected.size < 2) return
    const targetGids = new Set([...selected].map(gidOf))
    const gid = `__merge__${++mergeCounter.current}`
    setGroupOf((p) => {
      const next = { ...p }
      for (const d of baseDossiers) {
        if (selected.has(d.dossierName) || targetGids.has(gidOf(d.dossierName))) next[d.dossierName] = gid
      }
      return next
    })
    setSelected(new Set())
  }
  function unmerge(gid: string) {
    setGroupOf((p) => {
      const next = { ...p }
      for (const d of baseDossiers) if ((next[d.dossierName] || d.dossierName) === gid) delete next[d.dossierName]
      return next
    })
  }

  async function uploadDossier(id: string, d: FinalDossier) {
    setDossierStatus((p) => ({ ...p, [d.gid]: 'uploading' }))
    try {
      const form = new FormData()
      form.append('dossierName', d.label)
      // Il server riapplica gli stessi filtri (difesa in profondità): gli si passano
      // le parole effettivamente in uso in questa esecuzione, non solo quelle salvate.
      form.append('includeWords', includeText)
      form.append('excludeWords', excludeText)
      for (const idx of d.fileIndexes) {
        form.append('pdf', files[idx])
        form.append('path', fileRelPath(files[idx]))
      }
      const res = await fetch(`/api/polizza/batch/${id}/dossier`, { method: 'POST', body: form })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || t('bulk.errUpload'))
      }
      setDossierStatus((p) => ({ ...p, [d.gid]: 'done' }))
    } catch (err: any) {
      setDossierStatus((p) => ({ ...p, [d.gid]: 'error' }))
      setDossierError((p) => ({ ...p, [d.gid]: err.message }))
    }
  }

  async function handleStartUpload() {
    if (!finalDossiers.length) return
    const list = finalDossiers
    setUploadList(list)
    setPhase('uploading'); setPickError(null)
    try {
      const res = await fetch('/api/polizza/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: root || 'Cartella' }),
      })
      if (!res.ok) throw new Error(t('bulk.errUpload'))
      const { batchId: id } = await res.json()
      setBatchId(id)
      for (const d of list) await uploadDossier(id, d) // sequenziale: un dossier alla volta
    } catch (err: any) {
      setPickError(err.message); setPhase('select')
    }
  }

  async function handleRetry(d: FinalDossier) {
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

  // Auto-chiusura del batch se l'utente lascia la pagina senza premere "Termina": i
  // dossier già caricati vengono comunque elaborati, ma senza questa chiamata
  // l'orchestratore resterebbe in attesa di altri dossier (polling) fino al prossimo
  // restart. sendBeacon parte anche mentre la tab si chiude.
  const closeRef = useRef<{ batchId: string | null; phase: string }>({ batchId: null, phase: 'select' })
  closeRef.current = { batchId, phase }
  useEffect(() => {
    const onLeave = () => {
      const { batchId: id, phase: ph } = closeRef.current
      if (id && ph !== 'started' && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(`/api/polizza/batch/${id}/complete`)
      }
    }
    window.addEventListener('pagehide', onLeave)
    return () => window.removeEventListener('pagehide', onLeave)
  }, [])

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 className="page-title">{t('bulk.title')}</h1>
      <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginBottom: 20 }}>{t('bulk.subtitle')}</p>

      {!supported && <div style={ERROR_BOX_STYLE}>⚠ {t('bulk.notSupported')}</div>}

      {phase === 'select' && (
        <>
          <div className="card" style={{ padding: 24, textAlign: 'center', marginBottom: 16 }}>
            <button className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={scanning || !supported}>
              {baseDossiers.length ? t('bulk.changeFolder') : t('bulk.selectFolder')}
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

          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{t('bulk.filtersTitle')}</p>
            <div className="form-group">
              <label className="label" htmlFor="bulk-include">{t('bulk.includeLabel')}</label>
              <input id="bulk-include" value={includeText} onChange={(e) => setIncludeText(e.target.value)} placeholder={t('bulk.includePlaceholder')} />
              <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>{t('bulk.includeHelp')}</p>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="label" htmlFor="bulk-exclude">{t('bulk.excludeLabel')}</label>
              <input id="bulk-exclude" value={excludeText} onChange={(e) => setExcludeText(e.target.value)} placeholder={t('bulk.excludePlaceholder')} />
              <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>{t('bulk.excludeHelp')}</p>
            </div>
          </div>

          {pickError && <div style={ERROR_BOX_STYLE}>⚠ {pickError}</div>}

          {filteredOut.length > 0 && (
            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: 12 }}
                onClick={() => setShowSkipped((v) => !v)}
              >
                {showSkipped ? t('bulk.hideSkipped') : t('bulk.showSkipped', { n: filteredOut.length })}
              </button>
              {nonPdfCount > 0 && (
                <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 8 }}>{t('bulk.nonPdfIgnored', { n: nonPdfCount })}</p>
              )}
              {showSkipped && (
                <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 10 }}>
                  <table>
                    <tbody>
                      {filteredOut.map((s) => (
                        <tr key={s.relPath}>
                          <td style={{ fontSize: 11 }}>{s.relPath}</td>
                          <td style={{ fontSize: 11, color: 'var(--c-text-muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {skipLabel[s.reason]}{s.matched ? `: “${s.matched}”` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {baseDossiers.length > 0 && (
            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{t('bulk.rootLabel', { name: root })}</p>
              <p style={{ fontSize: 13, marginBottom: 6 }}>{t('bulk.summaryTitle', { n: baseDossiers.length, m: detectedFiles })}</p>
              <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 12 }}>{t('bulk.reviewHint')}</p>

              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setAllIncluded(true)}>{t('bulk.selectAll')}</button>
                <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setAllIncluded(false)}>{t('bulk.deselectAll')}</button>
                <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={mergeSelected} disabled={selected.size < 2}>
                  {t('bulk.mergeSelected', { n: selected.size })}
                </button>
              </div>

              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table style={{ width: '100%' }}>
                  <tbody>
                    {baseDossiers.map((d) => {
                      const gid = gidOf(d.dossierName)
                      const groupSize = baseDossiers.filter((x) => gidOf(x.dossierName) === gid).length
                      const merged = groupSize > 1
                      const inc = isIncluded(d.dossierName)
                      return (
                        <tr key={d.dossierName} style={{ opacity: inc ? 1 : 0.45 }}>
                          <td style={{ width: 24 }}>
                            <input type="checkbox" checked={inc} onChange={() => toggleInclude(d.dossierName)} title={t('bulk.deselectAll')} />
                          </td>
                          <td style={{ width: 24 }}>
                            <input type="checkbox" checked={selected.has(d.dossierName)} onChange={() => toggleSelect(d.dossierName)} disabled={!inc} />
                          </td>
                          <td style={{ fontSize: 12 }}>
                            {displayDossierName(d.dossierName)}
                            {merged && (
                              <span style={{ marginLeft: 8, fontSize: 10, padding: '1px 6px', borderRadius: 999, background: 'var(--c-bg-card-alt)', color: 'var(--c-text-secondary)' }}>
                                {t('bulk.mergedBadge', { n: groupSize })}{' '}
                                <button type="button" onClick={() => unmerge(gid)} style={{ background: 'none', border: 'none', color: 'var(--c-accent)', cursor: 'pointer', fontSize: 10, padding: 0 }}>
                                  {t('bulk.unmerge')}
                                </button>
                              </span>
                            )}
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--c-text-muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>{t('bulk.dossierFiles', { n: d.fileIndexes.length })}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <p style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>{t('bulk.selectedSummary', { n: finalDossiers.length, m: selectedFiles })}</p>
              <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={handleStartUpload} disabled={finalDossiers.length === 0}>
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
            {t('bulk.uploadSummary', { done: doneCount, error: errorCount, total: uploadList.length })}
          </p>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table>
              <tbody>
                {uploadList.map((d) => {
                  const st = dossierStatus[d.gid] || 'pending'
                  return (
                    <tr key={d.gid}>
                      <td style={{ fontSize: 12 }}>{d.label}{d.memberCount > 1 ? ` (${d.memberCount})` : ''}</td>
                      <td style={{ fontSize: 12, textAlign: 'right' }}>
                        {st === 'pending' && <span style={{ color: 'var(--c-text-muted)' }}>{t('bulk.dossierPending')}</span>}
                        {st === 'uploading' && <span style={{ color: 'var(--c-info)' }}><span className="spinner" /> {t('bulk.dossierUploading')}</span>}
                        {st === 'done' && <span style={{ color: 'var(--c-success)' }}>✓ {t('bulk.dossierDone')}</span>}
                        {st === 'error' && (
                          <span style={{ color: 'var(--c-error)' }}>
                            ⚠ {dossierError[d.gid]}{' '}
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
