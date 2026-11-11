'use client'

import { useEffect, useState } from 'react'
import InfortuniForm, { Warnings, downloadBlob, fileNameOf, type InfConfig, type InfRecord } from '@/components/infortuni/InfortuniForm'
import { defaultConfig, validateAdesione, normalizeAdesione } from '@/lib/infortuni/rules.js'
import { useT } from '@/lib/i18n/I18nProvider'

const EMPTY: InfRecord = { questionario: {} }

export default function InfortuniNewPage() {
  const t = useT()
  const [config, setConfig] = useState<InfConfig>(defaultConfig() as InfConfig)
  const [nextNumber, setNextNumber] = useState('')
  const [record, setRecord] = useState<InfRecord>(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [saved, setSaved] = useState<{ id: string; numero: string } | null>(null)

  const loadConfig = () => fetch('/api/infortuni/config').then((r) => r.json()).then((d) => {
    if (d.config) setConfig(d.config)
    setNextNumber(d.nextNumber || '')
  }).catch(() => {})
  useEffect(() => { loadConfig() }, [])

  // Avvisi in tempo reale (non bloccano): nome/codice fiscale, risposte NO.
  const { warnings } = validateAdesione(normalizeAdesione(record, config), config) as { warnings: string[] }

  async function downloadDocs(id: string) {
    const res = await fetch('/api/infortuni/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'PDF')
    downloadBlob(await res.blob(), fileNameOf(res, 'adesione.zip'))
  }

  async function save(withDocs: boolean) {
    const clean = normalizeAdesione(record, config)
    const v = validateAdesione(clean, config) as { errors: Record<string, string>; valid: boolean }
    setErrors(v.errors)
    if (!v.valid) { setMsg({ ok: false, text: t('inf.fix') }); return }
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/infortuni/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ record: clean }) })
      const d = await res.json()
      if (!res.ok) { if (d.errors) setErrors(d.errors); throw new Error(d.error || t('inf.fix')) }
      const numero = d.record.numero as string
      setSaved({ id: d.record.id, numero })
      if (withDocs) {
        try {
          await downloadDocs(d.record.id)
          setMsg({ ok: true, text: t('inf.new.savedDocs', { n: numero }) })
        } catch (e) {
          setMsg({ ok: false, text: `${t('inf.new.saved', { n: numero })} PDF: ${(e as Error).message}` })
        }
      } else {
        setMsg({ ok: true, text: t('inf.new.saved', { n: numero }) })
      }
      await loadConfig()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  function startNew() {
    setRecord(EMPTY); setErrors({}); setSaved(null); setMsg(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <>
      <h1 className="page-title">{t('nav.infNew')}</h1>
      <p className="view-subtitle">{t('inf.new.subtitle')}</p>

      <div className="card" style={{ marginBottom: 18, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13 }}>
          <span style={{ color: 'var(--c-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 11, fontWeight: 700 }}>{t('inf.new.nextNumber')}</span>
          <div style={{ marginTop: 2 }}><strong style={{ color: 'var(--c-accent)', fontFamily: 'var(--font-mono)', fontSize: 15 }}>{nextNumber || '…'}</strong></div>
        </div>
        <span style={{ fontSize: 12, color: 'var(--c-text-muted)', marginLeft: 'auto' }}>{t('inf.new.numberHint')}</span>
      </div>

      {msg && (
        <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ flex: 1 }}>{msg.text}</span>
          {saved && msg.ok && (
            <>
              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} disabled={busy}
                onClick={() => { setBusy(true); downloadDocs(saved.id).catch((e) => setMsg({ ok: false, text: (e as Error).message })).finally(() => setBusy(false)) }}>
                {t('inf.new.downloadAgain')}
              </button>
              <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={startNew}>{t('inf.new.another')}</button>
            </>
          )}
        </div>
      )}

      <fieldset disabled={!!saved} style={{ border: 0, padding: 0, margin: 0, opacity: saved ? 0.7 : 1 }}>
        <InfortuniForm config={config} record={record} errors={errors} onChange={setRecord} />
      </fieldset>

      <Warnings items={warnings} title={t('inf.warnTitle')} />

      <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        {saved ? (
          <button className="btn btn-primary" onClick={startNew}>{t('inf.new.another')}</button>
        ) : (
          <>
            <button className="btn btn-primary" onClick={() => save(true)} disabled={busy}>
              {busy ? <><span className="spinner" /> {t('inf.busy')}</> : t('inf.new.saveAndDocs')}
            </button>
            <button className="btn btn-secondary" onClick={() => save(false)} disabled={busy}>{t('inf.new.saveOnly')}</button>
            <button className="btn btn-secondary" onClick={startNew} disabled={busy} style={{ marginLeft: 'auto' }}>{t('inf.new.reset')}</button>
          </>
        )}
      </div>
    </>
  )
}
