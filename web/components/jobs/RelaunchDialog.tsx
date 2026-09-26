'use client'
import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import type { JobSnapshot, ReprofileMode } from './types'
import { shortName } from './model'
import { IcFlask, IcPlay, IcRefresh, IcSwap } from './Icons'

export interface RelaunchValues { profileId: string; model: string; strategy: string; prompt: string; extractAfter: boolean; reconcile: boolean }

// Ultima scelta di «Estrai subito dopo l'abbinamento» (preferenza per utente/browser).
const EXTRACT_AFTER_KEY = 'jobsRematchExtract'
function readExtractAfter(): boolean { try { return localStorage.getItem(EXTRACT_AFTER_KEY) === '1' } catch { return false } }
function writeExtractAfter(v: boolean) { try { localStorage.setItem(EXTRACT_AFTER_KEY, v ? '1' : '0') } catch { /* solo comodità */ } }

// Dialog universale di rilancio: run di TEST (copia, profilo opzionale),
// RIELABORA CON PROFILO (stesso job in coda coi campi del profilo scelto),
// RIABBINA (solo OCR dalla cache + pertinenza, profilo attuale / scelto / Automatico).
export function RelaunchDialog({ mode, jobs, profiles, models, busy, error, initialProfileId, canReconcile, onCancel, onSubmit }: {
  mode: ReprofileMode
  jobs: JobSnapshot[]
  profiles: { id: string; name: string }[]
  models: string[]
  busy: boolean
  error: string
  initialProfileId?: string | null
  // Riabbina di più dossier di UN batch: si può riconciliare prima (non per le singole).
  canReconcile?: boolean
  onCancel: () => void
  onSubmit: (v: RelaunchValues) => void
}) {
  const t = useT()
  const isBatch = jobs.length > 1
  const isRematch = mode === 'rematch' || mode === 'rematchBatch'
  const isReprofile = mode === 'reprofile' || mode === 'reprofileBatch'
  const n = jobs.length
  const [profileId, setProfileId] = useState('')
  const [model, setModel] = useState('')
  const [strategy, setStrategy] = useState('')
  const [prompt, setPrompt] = useState(isBatch ? '' : (jobs[0]?.promptExtra || ''))
  // RIABBINA + ESTRAI in un colpo solo: abbinamento e, se riuscito, estrazione
  // (come un'elaborazione normale); spento = si ferma in «Abbinato».
  const [extractAfter, setExtractAfter] = useState(false)
  useEffect(() => { if (isRematch) setExtractAfter(readExtractAfter()) }, [isRematch])
  // RICONCILIA prima dell'abbinamento: unisce i dossier con lo stesso numero di
  // polizza (batch caricati prima della riconciliazione). Mai ricordata: è rara.
  const [reconcile, setReconcile] = useState(false)
  const showReconcile = isRematch && isBatch && !!canReconcile

  // Preselezione (rielabora con profilo, singolo): l'ultimo profilo di QUESTO
  // job, se esiste ancora; i profili arrivano in asincrono.
  useEffect(() => {
    if (isReprofile && !isBatch && initialProfileId && profiles.some((p) => p.id === initialProfileId)) setProfileId((cur) => cur || initialProfileId)
  }, [profiles, initialProfileId, isReprofile, isBatch])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const title = isRematch
    ? (isBatch ? t('jobsDash.rematchBatchDialogTitle', { n }) : t('jobsDash.rematchDialogTitle'))
    : mode === 'test' ? t('jobsDash.testDialogTitle')
      : isBatch ? t('jobsDash.reprofileBatchDialogTitle', { n }) : t('jobsDash.reprofileDialogTitle')
  const hint = isRematch ? (extractAfter ? t('jobsDash.rematchExtractDialogHint') : t('jobsDash.rematchDialogHint'))
    : mode === 'test' ? t('jobsDash.testDialogHint')
      : isBatch ? t('jobsDash.reprofileBatchDialogHint') : t('jobsDash.reprofileDialogHint')
  const startLabel = isRematch
    ? (extractAfter
      ? (isBatch ? t('jobsDash.rematchExtractStartBatch', { n }) : t('jobsDash.rematchExtractStart'))
      : (isBatch ? t('jobsDash.rematchStartBatch', { n }) : t('jobsDash.rematchStart')))
    : isBatch ? t('jobsDash.reprofileStartBatch', { n }) : (mode === 'test' ? t('jobsDash.testStart') : t('jobsDash.reprofileStart'))
  const Icon = isRematch ? IcRefresh : mode === 'test' ? IcFlask : IcSwap

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '92vw', padding: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}><Icon /> {title}</h3>
        <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 14 }}>
          {isBatch ? `${n} job — ` : `${shortName(jobs[0])} — `}{hint}
        </p>
        <div className="form-group">
          <label className="label">{t('jobsDash.testProfile')}{isReprofile ? ' *' : ''}</label>
          <select value={profileId} onChange={(e) => setProfileId(e.target.value)} style={{ width: '100%' }}>
            <option value="">{isRematch ? t('jobsDash.rematchProfileCurrent') : mode === 'test' ? t('jobsDash.testProfileFrozen') : t('jobsDash.testProfileFrozenHint')}</option>
            {isRematch && <option value="auto">{t('jobsDash.rematchProfileAuto')}</option>}
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {isRematch && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, marginBottom: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={extractAfter} style={{ marginTop: 2 }}
              onChange={(e) => { setExtractAfter(e.target.checked); writeExtractAfter(e.target.checked) }} />
            <span>{t('jobsDash.rematchExtractAfter')}<br /><span style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{t('jobsDash.rematchExtractAfterHelp')}</span></span>
          </label>
        )}
        {showReconcile && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, margin: '8px 0 4px', cursor: 'pointer' }}>
            <input type="checkbox" checked={reconcile} style={{ marginTop: 2 }} onChange={(e) => setReconcile(e.target.checked)} />
            <span>{t('jobsDash.rematchReconcile')}<br /><span style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{t('jobsDash.rematchReconcileHelp')}</span></span>
          </label>
        )}
        {!isRematch && (<>
          <div className="form-group">
            <label className="label">{t('jobsDash.testModel')}</label>
            <input list="jb-test-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('jobsDash.testModelPlaceholder')} style={{ width: '100%' }} />
            <datalist id="jb-test-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
          </div>
          <div className="form-group">
            <label className="label">{t('jobsDash.testStrategy')}</label>
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)} style={{ width: '100%' }}>
              <option value="">{t('jobsDash.testStrategyCurrent')}</option>
              <option value="perfield">{t('jobsDash.testStrategyPerField')}</option>
              <option value="groups">{t('jobsDash.testStrategyGroups')}</option>
              <option value="cascade">{t('jobsDash.testStrategyCascade')}</option>
            </select>
          </div>
          <div className="form-group">
            <label className="label">{t('jobsDash.testPrompt')}</label>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} style={{ width: '100%', fontSize: 12 }} />
          </div>
        </>)}
        {error && <p style={{ fontSize: 11, color: 'var(--c-error)', margin: '0 0 10px' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={onCancel}>{t('jobsDash.testCancel')}</button>
          <button type="button" className="btn btn-primary" style={{ fontSize: 12 }} disabled={busy} onClick={() => onSubmit({ profileId, model, strategy, prompt, extractAfter: isRematch && extractAfter, reconcile: showReconcile && reconcile })}>
            <IcPlay /> {startLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
