'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/lib/i18n/I18nProvider'
import type { SummaryListItem } from '@/lib/summaryTypes'
import { useConfirmPanel } from '@/components/ConfirmPanel'
import { ActionMenu } from '@/components/jobs/ActionMenu'
import { IcChart, IcChevRight, IcDownload, IcX } from '@/components/jobs/Icons'
import { downloadBlob } from '@/components/jobs/model'
import { apiErrorText, makeFmt, tn } from '@/components/summaries/format'

// RIEPILOGHI — elenco: una card per riepilogo (nome, profilo, polizze, modo,
// ultimo aggiornamento, Apri / Excel / Elimina). Si caricano una volta sola,
// niente polling. I riepiloghi si creano da Elaborazioni, spuntando le
// polizze estratte dello stesso profilo. Lo stato vuoto solo se l'elenco è
// arrivato davvero vuoto (mai sotto un errore); l'Excel si scarica come nel
// dettaglio, con il messaggio se l'export non riesce.
export default function SummariesPage() {
  const { t, lang } = useI18n()
  const fmt = useMemo(() => makeFmt(lang), [lang])
  const { ask, panel } = useConfirmPanel()
  const [list, setList] = useState<SummaryListItem[] | null>(null)
  const [error, setError] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  const [exporting, setExporting] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/polizza/summaries', { cache: 'no-store' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setError(apiErrorText(t, d, r.status)); setLoadFailed(true); setList((p) => p || []); return }
      setError('')
      setLoadFailed(false)
      setList(Array.isArray(d.summaries) ? d.summaries : [])
    } catch {
      setError(apiErrorText(t, null, 0))
      setLoadFailed(true)
      setList((p) => p || [])
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  async function remove(s: SummaryListItem) {
    if (!(await ask(t('rp.list.deleteAsk', { name: s.name }), { danger: true, title: t('rp.list.deleteTitle'), okLabel: t('rp.list.delete') }))) return
    try {
      const r = await fetch(`/api/polizza/summaries/${encodeURIComponent(s.id)}`, { method: 'DELETE' })
      if (!r.ok && r.status !== 404) {
        const d = await r.json().catch(() => ({}))
        setError(apiErrorText(t, d, r.status))
      }
    } catch {
      setError(apiErrorText(t, null, 0))
    }
    await load()
  }

  async function exportExcel(s: SummaryListItem) {
    setExporting(s.id)
    try {
      const r = await fetch(`/api/polizza/summaries/${encodeURIComponent(s.id)}/export?lang=${lang === 'en' ? 'en' : 'it'}`)
      if (!r.ok) { setError(t('rp.head.exportError')); return }
      const m = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '')
      downloadBlob(await r.blob(), m ? m[1] : 'riepilogo.xlsx')
    } catch {
      setError(t('rp.head.exportError'))
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="rp-page">
      <div>
        <h1 className="rp-title" style={{ fontSize: 20 }}>{t('rp.list.title')}</h1>
        <p className="rp-sub" style={{ marginTop: 2 }}>{t('rp.list.subtitle')}</p>
      </div>

      {error && (
        <div className="jb-callout" role="alert">
          <span style={{ flex: '1 1 0' }}>{error}</span>
          <button type="button" className="jb-btn ghost icon" aria-label={t('jobsDash.close')} onClick={() => setError('')}><IcX /></button>
        </div>
      )}

      {list === null && <p><span className="spinner" /></p>}

      {list !== null && list.length === 0 && !loadFailed && (
        <div className="rp-card rp-listempty">
          <span className="rp-bigico" aria-hidden="true"><IcChart /></span>
          <p>{t('rp.list.empty')}</p>
          <Link href="/polizza/jobs" className="jb-btn btn-primary rp-btn">{t('rp.list.goJobs')}<IcChevRight /></Link>
        </div>
      )}

      {list !== null && list.length > 0 && (
        <div className="rp-listgrid">
          {list.map((s) => {
            const href = `/polizza/riepiloghi/${encodeURIComponent(s.id)}`
            return (
              <div key={s.id} className="jb-card">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  <Link href={href} className="title" title={s.name}>{s.name}</Link>
                  <span className="rp-sub rp-ell">
                    {s.profileName || t('rp.profileFromFieldsShort')} · {tn(t, 'rp.list.policies', s.jobCount)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={`jb-pill ${s.mode === 'snapshot' ? 'info' : 'neutral'}`}>
                    {s.mode === 'snapshot' ? t('rp.mode.snapshot', { date: fmt.date(s.snapshotAt) }) : t('rp.mode.live')}
                  </span>
                </div>
                <div className="rp-sub" style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span>{t('rp.list.updated', { date: fmt.dateTime(s.updatedAt) })}</span>
                  <span className="rp-ell" title={s.createdBy}>{t('rp.list.by', { email: s.createdBy })}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
                  <Link href={href} className="jb-btn btn-primary">{t('rp.list.open')}<IcChevRight /></Link>
                  <button type="button" className="jb-btn btn-secondary" disabled={exporting === s.id} title={t('rp.head.export')} onClick={() => void exportExcel(s)}>
                    {exporting === s.id ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <IcDownload />}{t('rp.list.excel')}
                  </button>
                  <span style={{ flex: '1 1 0' }} />
                  <ActionMenu ariaLabel={t('rp.list.more')} items={[
                    { id: 'delete', label: t('rp.list.delete'), icon: <IcX />, danger: true, onClick: () => void remove(s) },
                  ]} />
                </div>
              </div>
            )
          })}
        </div>
      )}
      {panel}
    </div>
  )
}
