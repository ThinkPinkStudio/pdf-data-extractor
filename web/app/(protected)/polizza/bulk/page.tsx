'use client'

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useT } from '@/lib/i18n/I18nProvider'
import { groupPathsByDossier, displayDossierName, type GroupedDossier, type SkippedPath } from '@/lib/bulkGrouping'
import { parseExclusionList, parseKeywords, makeFilters, type SkipReason } from '@/lib/bulkExclusions'
import type { PolizzaProfile } from '@/lib/settingsStore'

// Parole di abbinamento di un profilo per il pre-filtro e l'auto-riconoscimento del
// tipo: quelle esplicite (matchKeywords) o, se vuote, il nome del profilo.
function profileKeywords(p: PolizzaProfile): string[] {
  const kw = parseKeywords(p.matchKeywords || '')
  return kw.length ? kw : parseKeywords(p.name)
}

const ERROR_BOX_STYLE: CSSProperties = {
  marginBottom: 16, padding: '10px 14px', background: 'rgba(239,68,68,.08)',
  border: '1px solid rgba(239,68,68,.25)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--c-error)',
}

type DossierStatus = 'pending' | 'uploading' | 'done' | 'error'

// Dossier finale da elaborare: uno o più dossier-foglia uniti dall'utente.
// profileId: override esplicito (usato dai dossier-figli dello «spezzetta», che
// ereditano il profilo scelto sulla riga della cartella madre).
interface FinalDossier { gid: string; label: string; fileIndexes: number[]; memberCount: number; profileId?: string }

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
  const [expanded, setExpanded] = useState<Set<string>>(new Set())      // dossier con lista file aperta
  const [splitOf, setSplitOf] = useState<Set<string>>(new Set())        // gid «spezzetta»: ogni PDF = polizza a parte
  const mergeCounter = useRef(0)

  // Profili/tipi: elenco, tipo predefinito e scelta per-dossier (chiave = gid finale).
  const [profiles, setProfiles] = useState<PolizzaProfile[]>([])
  const [defaultType, setDefaultType] = useState('')                    // id profilo predefinito
  const [profileOf, setProfileOf] = useState<Record<string, string>>({}) // gid → id profilo
  const [manualProfile, setManualProfile] = useState<Set<string>>(new Set()) // gid con scelta manuale
  const [contentAssign, setContentAssign] = useState<Record<string, string>>({}) // gid → profilo dal pre-filtro contenuto

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
      setProfiles(Array.isArray(s.polizzaProfiles) ? s.polizzaProfiles : [])
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
    setExpanded(new Set())
    setProfileOf({})
    setManualProfile(new Set())
    setContentAssign({})
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

  // Auto-riconoscimento del profilo di un dossier dal percorso: primo profilo la cui
  // parola di abbinamento compare (sottostringa, case-insensitive) nel label/percorso.
  function detectProfile(label: string): string {
    const path = label.toLowerCase()
    for (const p of profiles) {
      if (profileKeywords(p).some((k) => path.includes(k))) return p.id
    }
    return ''
  }
  // Assegna a ogni dossier (gid) il profilo: auto-riconosciuto dal nome, altrimenti il
  // tipo predefinito. Le scelte manuali (manualProfile) vengono preservate.
  useEffect(() => {
    setProfileOf((prev) => {
      const next: Record<string, string> = {}
      for (const d of finalDossiers) {
        next[d.gid] = (manualProfile.has(d.gid) && prev[d.gid] !== undefined)
          ? prev[d.gid]
          : (contentAssign[d.gid] !== undefined ? (contentAssign[d.gid] || defaultType) : (detectProfile(d.label) || defaultType))
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalDossiers, profiles, defaultType, manualProfile, contentAssign])

  // Pre-filtro sul CONTENUTO: testo nativo delle prime pagine (nessun LLM).
  // Se l'OCR/testo è disponibile, vince sul solo percorso — è il caso
  // "in vigore/" senza "med" nel path ma con CEDAM/sanitari nel PDF.
  useEffect(() => {
    if (!finalDossiers.length || !profiles.length || !files.length) return
    let cancelled = false
    ;(async () => {
      const { extractPdfTextPreview } = await import('@/lib/pdfRender')
      const dossiers: { gid: string; label: string; text: string }[] = []
      for (const d of finalDossiers.slice(0, 40)) {
        const parts: string[] = []
        for (const idx of d.fileIndexes.slice(0, 2)) {
          const f = files[idx]
          if (!f) continue
          try { parts.push(await extractPdfTextPreview(f, 2)) } catch { /* PDF senza testo nativo */ }
        }
        dossiers.push({ gid: d.gid, label: d.label, text: parts.join('\n') })
        if (cancelled) return
      }
      if (cancelled || !dossiers.some((x) => x.text.trim())) return
      try {
        const res = await fetch('/api/polizza/bulk/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dossiers }),
        })
        if (!res.ok || cancelled) return
        const json = await res.json()
        const next: Record<string, string> = {}
        for (const [gid, a] of Object.entries(json.assignments || {})) {
          const pid = (a as { profileId?: string })?.profileId
          if (typeof pid === 'string') next[gid] = pid
        }
        if (!cancelled) setContentAssign(next)
      } catch { /* pre-filtro contenuto opzionale */ }
    })()
    return () => { cancelled = true }
  }, [finalDossiers, profiles, files])

  const detectedFiles = baseDossiers.reduce((n, d) => n + d.fileIndexes.length, 0)
  const selectedFiles = finalDossiers.reduce((n, d) => n + d.fileIndexes.length, 0)
  const doneCount = Object.values(dossierStatus).filter((s) => s === 'done').length
  const errorCount = Object.values(dossierStatus).filter((s) => s === 'error').length
  const attemptedAll = uploadList.length > 0 && uploadList.every((d) => dossierStatus[d.gid] === 'done' || dossierStatus[d.gid] === 'error')

  function toggleInclude(name: string) { setIncluded((p) => ({ ...p, [name]: p[name] === false })) }
  // «Spezzetta»: la riga (cartella o gruppo unito) è una raccolta di POLIZZE
  // SINGOLE → all'avvio ogni suo PDF diventa un dossier a parte.
  function toggleSplit(gid: string) {
    setSplitOf((p) => { const n = new Set(p); if (n.has(gid)) n.delete(gid); else n.add(gid); return n })
  }
  function toggleSelect(name: string) {
    setSelected((p) => { const n = new Set(p); if (n.has(name)) n.delete(name); else n.add(name); return n })
  }
  function toggleExpand(name: string) {
    setExpanded((p) => { const n = new Set(p); if (n.has(name)) n.delete(name); else n.add(name); return n })
  }
  // Scelta manuale del profilo per un dossier: vince sull'auto-riconoscimento.
  function chooseProfile(gid: string, id: string) {
    setProfileOf((p) => ({ ...p, [gid]: id }))
    setManualProfile((p) => new Set(p).add(gid))
  }
  // Profilo per TUTTE le righe in un colpo solo (id === '' → campi globali).
  // OBBLIGATORIO marcare ogni gid come scelta MANUALE: l'effect qui sopra
  // ricalcola profileOf per i gid non-manuali e annullerebbe l'assegnazione al
  // render successivo. Le righe «Spezzetta» ereditano già il profilo della madre.
  function applyProfileToAll(id: string) {
    setProfileOf(Object.fromEntries(finalDossiers.map((d) => [d.gid, id])))
    setManualProfile(new Set(finalDossiers.map((d) => d.gid)))
  }
  // Torna all'auto-riconoscimento: senza scelte manuali l'effect rifà da solo
  // detectProfile + tipo predefinito su ogni riga.
  function resetProfilesToAuto() {
    setManualProfile(new Set())
  }
  // Tipo predefinito: imposta il profilo di default e, se ha parole di abbinamento,
  // riempie il filtro "parole da accettare" → l'elenco mostra solo le cartelle di quel tipo.
  function applyDefaultType(id: string) {
    setDefaultType(id)
    const p = profiles.find((x) => x.id === id)
    if (p) setIncludeText(profileKeywords(p).join(', '))
  }
  // Nomi file (basename) di un dossier-foglia, per la lista espandibile.
  const fileNamesOf = (d: GroupedDossier) => d.fileIndexes.map((idx) => fileRelPath(files[idx]).split('/').pop() || fileRelPath(files[idx]))
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
      const pid = d.profileId !== undefined ? d.profileId : profileOf[d.gid]
      if (pid) form.append('profileId', pid) // profilo/tipo scelto per questo dossier
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

  // Espansione «spezzetta»: le righe marcate diventano UN dossier PER FILE
  // (nome = cartella/nomefile senza .pdf, profilo ereditato dalla riga madre).
  function expandSplits(list: FinalDossier[]): FinalDossier[] {
    const out: FinalDossier[] = []
    for (const d of list) {
      if (!splitOf.has(d.gid) || d.fileIndexes.length <= 1) { out.push(d); continue }
      const pid = profileOf[d.gid] || ''
      for (let i = 0; i < d.fileIndexes.length; i++) {
        const idx = d.fileIndexes[i]
        const base = (fileRelPath(files[idx]).split('/').pop() || `file-${i + 1}`).replace(/\.pdf$/i, '')
        out.push({ gid: `${d.gid}::${i}`, label: `${d.label}/${base}`, fileIndexes: [idx], memberCount: 1, profileId: pid })
      }
    }
    return out
  }

  async function handleStartUpload() {
    if (!finalDossiers.length) return
    const list = expandSplits(finalDossiers)
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
            {profiles.length > 0 && (
              <div className="form-group">
                <label className="label" htmlFor="bulk-type">{t('bulk.defaultType')}</label>
                <select id="bulk-type" value={defaultType} onChange={(e) => applyDefaultType(e.target.value)}>
                  <option value="">{t('bulk.noType')}</option>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>{t('bulk.defaultTypeHelp')}</p>
              </div>
            )}
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

              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setAllIncluded(true)}>{t('bulk.selectAll')}</button>
                <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setAllIncluded(false)}>{t('bulk.deselectAll')}</button>
                <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={mergeSelected} disabled={selected.size < 2}>
                  {t('bulk.mergeSelected', { n: selected.size })}
                </button>
                {profiles.length > 0 && finalDossiers.length > 0 && (
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }} title={t('bulk.applyProfileAllHelp')}>
                    <label style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{t('bulk.applyProfileAll')}</label>
                    {/* value="" fisso: è un'AZIONE (applica a N righe), non uno stato — dopo
                        l'apply le righe restano modificabili una a una col loro dropdown */}
                    <select value="" style={{ fontSize: 12, maxWidth: 220 }}
                      onChange={(e) => { if (e.target.value) applyProfileToAll(e.target.value === '__global' ? '' : e.target.value) }}>
                      <option value="">…</option>
                      <option value="__global">{t('bulk.globalFields')}</option>
                      {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button type="button" className="btn btn-secondary" style={{ fontSize: 11 }}
                      onClick={resetProfilesToAuto} disabled={manualProfile.size === 0} title={t('bulk.resetProfileAutoHelp')}>
                      {t('bulk.resetProfileAuto')}
                    </button>
                  </span>
                )}
              </div>

              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table style={{ width: '100%' }}>
                  <thead>
                    <tr style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--c-text-muted)' }}>
                      <th style={{ width: 56, textAlign: 'center', fontWeight: 600 }} title={t('bulk.colProcessHelp')}>{t('bulk.colProcess')}</th>
                      <th style={{ width: 48, textAlign: 'center', fontWeight: 600 }} title={t('bulk.colMergeHelp')}>{t('bulk.colMerge')}</th>
                      <th style={{ width: 64, textAlign: 'center', fontWeight: 600 }} title={t('bulk.colSplitHelp')}>{t('bulk.colSplit')}</th>
                      <th style={{ textAlign: 'left', fontWeight: 600 }}>{t('bulk.colDossier')}</th>
                      {profiles.length > 0 && <th style={{ textAlign: 'left', fontWeight: 600 }}>{t('bulk.colProfile')}</th>}
                      <th style={{ textAlign: 'right', fontWeight: 600 }}>{t('bulk.colFiles')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {baseDossiers.map((d) => {
                      const gid = gidOf(d.dossierName)
                      const groupSize = baseDossiers.filter((x) => gidOf(x.dossierName) === gid).length
                      const merged = groupSize > 1
                      const inc = isIncluded(d.dossierName)
                      const isOpen = expanded.has(d.dossierName)
                      return (
                        <Fragment key={d.dossierName}>
                        <tr style={{ opacity: inc ? 1 : 0.45 }}>
                          <td style={{ textAlign: 'center' }}>
                            <input type="checkbox" checked={inc} onChange={() => toggleInclude(d.dossierName)} title={t('bulk.colProcessHelp')} />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <input type="checkbox" checked={selected.has(d.dossierName)} onChange={() => toggleSelect(d.dossierName)} disabled={!inc} title={t('bulk.colMergeHelp')} />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <input type="checkbox" checked={splitOf.has(gid)} onChange={() => toggleSplit(gid)} disabled={!inc} title={t('bulk.colSplitHelp')} />
                          </td>
                          <td style={{ fontSize: 12 }}>
                            <button type="button" onClick={() => toggleExpand(d.dossierName)} title={t('bulk.expandFiles')}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-secondary)', fontSize: 11, padding: 0, marginRight: 6, width: 12 }}>
                              {isOpen ? '▾' : '▸'}
                            </button>
                            {displayDossierName(d.dossierName)}
                            {splitOf.has(gid) && (
                              <span style={{ marginLeft: 8, fontSize: 10, padding: '1px 6px', borderRadius: 999, background: 'var(--c-accent-bg, var(--c-bg-card-alt))', color: 'var(--c-accent)' }}>
                                {t('bulk.splitBadge', { n: d.fileIndexes.length })}
                              </span>
                            )}
                            {merged && (
                              <span style={{ marginLeft: 8, fontSize: 10, padding: '1px 6px', borderRadius: 999, background: 'var(--c-bg-card-alt)', color: 'var(--c-text-secondary)' }}>
                                {t('bulk.mergedBadge', { n: groupSize })}{' '}
                                <button type="button" onClick={() => unmerge(gid)} style={{ background: 'none', border: 'none', color: 'var(--c-accent)', cursor: 'pointer', fontSize: 10, padding: 0 }}>
                                  {t('bulk.unmerge')}
                                </button>
                              </span>
                            )}
                          </td>
                          {profiles.length > 0 && (
                            <td style={{ fontSize: 12 }}>
                              <select value={profileOf[gid] || ''} disabled={!inc} onChange={(e) => chooseProfile(gid, e.target.value)} style={{ fontSize: 11, padding: '2px 4px', maxWidth: 160 }}>
                                <option value="">{t('bulk.globalFields')}</option>
                                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                            </td>
                          )}
                          <td style={{ fontSize: 12, color: 'var(--c-text-muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>{t('bulk.dossierFiles', { n: d.fileIndexes.length })}</td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td />
                            <td />
                            <td />
                            <td colSpan={profiles.length > 0 ? 3 : 2} style={{ paddingBottom: 8 }}>
                              <ul style={{ margin: 0, paddingLeft: 16, listStyle: 'disc' }}>
                                {fileNamesOf(d).map((name, k) => (
                                  <li key={k} style={{ fontSize: 11, color: 'var(--c-text-secondary)' }}>{name}</li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <p style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>{t('bulk.selectedSummary', {
                // Con lo «spezzetta» ogni PDF della riga marcata è un dossier a parte.
                n: finalDossiers.reduce((n, d) => n + (splitOf.has(d.gid) && d.fileIndexes.length > 1 ? d.fileIndexes.length : 1), 0),
                m: selectedFiles,
              })}</p>
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
