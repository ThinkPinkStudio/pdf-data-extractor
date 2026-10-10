'use client'
// Pannello «Nuovo riepilogo» (mockup Main.dc.html): nome, profilo (fisso, dal
// server), «Anno da» (campi DATA decisi dal server dalla descrizione), e cosa
// fare quando una polizza viene ri-estratta: valori nuovi (live) o fotografia
// a oggi (snapshot). Senza velo, come nel mockup; Escape chiude.
import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import type { Refusal, SummaryMode, SummaryPreview } from '@/lib/summaryTypes'
import { useEscape } from './hooks'
import { apiErrorText, tn } from './format'

const MAX_REFUSED = 5

export function refusalText(t: (k: string, v?: Record<string, string | number>) => string, r: Refusal): string {
  const detail = r.detail || ''
  return `${r.name} — ${t(`rp.why.${r.reason}`, { profile: detail, name: detail })}`
}

export function CreateSummaryPanel({ jobIds, defaultName, onClose, onCreated, active = true }: {
  jobIds: string[]
  /** Nome proposto (il nome del batch se la selezione viene da un solo batch). */
  defaultName: string | null
  onClose: () => void
  onCreated: (id: string) => void
  active?: boolean
}) {
  const t = useT()
  useEscape(onClose, active)
  const [preview, setPreview] = useState<SummaryPreview | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const [yearFieldId, setYearFieldId] = useState('')
  const [mode, setMode] = useState<SummaryMode>('live')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [refused, setRefused] = useState<Refusal[]>([])
  // Guardia sincrona: un doppio Invio partiva prima che `busy` arrivasse al render (due riepiloghi).
  const submitting = useRef(false)

  useEffect(() => {
    let alive = true
    fetch('/api/polizza/summaries/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobIds }) })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!alive) return
        if (!r.ok) { setLoadErr(apiErrorText(t, d, r.status)); return }
        const p = d as SummaryPreview
        setPreview(p)
        setRefused(p.refused || [])
        setYearFieldId(p.defaults?.yearFieldId || '')
      })
      .catch(() => { if (alive) setLoadErr(apiErrorText(t, null, 0)) })
    return () => { alive = false }
    // t cambia solo con la lingua: l'anteprima non si rifà per questo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobIds])

  const profileLabel = preview ? (preview.profileName || t('rp.profileFromFields', { n: preview.fieldCount })) : ''
  const nEligible = preview?.eligible.length || 0

  // Nome proposto: il batch, altrimenti «profilo — N polizze» nella lingua dell'utente.
  useEffect(() => {
    if (!preview || touched) return
    setName(defaultName || tn(t, 'rp.new.defaultName', nEligible, { profile: profileLabel }))
  }, [preview, touched, defaultName, nEligible, profileLabel, t])

  async function submit() {
    if (submitting.current) return
    const v = name.trim()
    if (!v) { setErr(t('rp.new.nameRequired')); return }
    if (!preview || !nEligible) return
    submitting.current = true
    setBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/polizza/summaries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: v, jobIds: preview.eligible.map((e) => e.jobId), yearFieldId: yearFieldId || null, mode }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.status === 201 && d.id) { onCreated(String(d.id)); return }
      if (d.code === 'not-eligible' && Array.isArray(d.refused)) setRefused(d.refused)
      setErr(apiErrorText(t, d, r.status))
    } catch {
      setErr(apiErrorText(t, null, 0))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return (
    <div className="card rp-panel" role="dialog" aria-label={t('rp.new.title')}>
      <div className="rp-ptitle">{t('rp.new.title')}</div>
      {!preview && !loadErr && <p><span className="spinner" /></p>}
      {loadErr && <p className="rp-err" role="alert">{loadErr}</p>}
      {preview && (
        <>
          <label>
            <span className="rp-lbl">{t('rp.new.name')}</span>
            <input type="text" value={name} maxLength={120} autoFocus onChange={(e) => { setName(e.target.value); setTouched(true) }}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit() }} />
          </label>
          <div className="rp-prow">
            <div style={{ flex: '1 1 0', minWidth: 0 }}>
              <span className="rp-lbl">{t('rp.new.profile')}</span>
              <div className="rp-ro" title={profileLabel}>{profileLabel || '—'}</div>
            </div>
            <label style={{ flex: '1 1 0', minWidth: 0 }}>
              <span className="rp-lbl">{t('rp.new.yearFrom')}</span>
              {preview.dateFields.length ? (
                <select value={yearFieldId} onChange={(e) => setYearFieldId(e.target.value)}>
                  {preview.dateFields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              ) : <div className="rp-ro">—</div>}
              {/* il conteggio sta sotto la select: il title di un <option> quasi nessun browser lo mostra */}
              {(() => {
                const sel = preview.dateFields.find((f) => f.id === yearFieldId)
                return sel ? <span className="rp-sub" style={{ display: 'block', marginTop: 4 }}>{tn(t, 'rp.new.filled', sel.filled)}</span> : null
              })()}
            </label>
          </div>
          {!preview.dateFields.length && <p className="rp-sub">{t('rp.new.noDate')}</p>}
          <div>
            <span className="rp-lbl">{t('rp.new.modeTitle')}</span>
            <div role="radiogroup" aria-label={t('rp.new.modeTitle')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(['live', 'snapshot'] as const).map((m) => (
                <label key={m} className={`rp-opt${mode === m ? ' on' : ''}`}>
                  <input type="radio" name="rp-mode" checked={mode === m} onChange={() => setMode(m)} />
                  <span>
                    <span style={{ display: 'block' }}>{m === 'live' ? t('rp.new.live') : t('rp.new.snapshot')}</span>
                    <span className="rp-sub">{m === 'live' ? t('rp.new.liveHint') : t('rp.new.snapshotHint')}</span>
                  </span>
                </label>
              ))}
            </div>
            {mode === 'snapshot' && <p className="rp-sub" style={{ marginTop: 6 }}>{t('rp.new.snapshotData')}</p>}
          </div>
          <p className="rp-sub">{t('rp.new.later')}</p>
          {preview.inherited && <p className="rp-sub">{t('rp.new.inherited')}</p>}
          {refused.length > 0 && (
            <div className="jb-callout" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 4 }}>
              <b>{tn(t, 'rp.new.refused', refused.length)}</b>
              {refused.slice(0, MAX_REFUSED).map((r) => <span key={r.jobId}>{refusalText(t, r)}</span>)}
              {refused.length > MAX_REFUSED && <span>+{refused.length - MAX_REFUSED}</span>}
            </div>
          )}
          {!nEligible && <p className="rp-err">{t('rp.sel.none')}</p>}
        </>
      )}
      {err && <p className="rp-err" role="alert">{err}</p>}
      <div className="rp-pbtns">
        <span style={{ flex: '1 1 0' }} />
        <button type="button" className="jb-btn btn-secondary rp-btn" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="jb-btn btn-primary rp-btn" disabled={busy || !preview || !nEligible || !name.trim()} onClick={() => void submit()}>
          {busy && <span className="spinner" style={{ width: 12, height: 12 }} />}{t('rp.new.submit')}
        </button>
      </div>
    </div>
  )
}
