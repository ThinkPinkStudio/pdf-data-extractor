'use client'

import { useEffect, useState } from 'react'
import type { InfConfig, InfOption } from '@/components/infortuni/InfortuniForm'
import { useT } from '@/lib/i18n/I18nProvider'

const OPTION_COLS: { key: keyof InfOption; label: string; width?: number }[] = [
  { key: 'name', label: 'inf.set.optName', width: 110 },
  { key: 'premio', label: 'inf.set.optPremio' },
  { key: 'imposte', label: 'inf.set.optImposte' },
  { key: 'morte', label: 'inf.set.optMorte' },
  { key: 'invalidita', label: 'inf.set.optIp' },
  { key: 'franchigia', label: 'inf.set.optFranchigia' },
  { key: 'speseMediche', label: 'inf.set.optSpese' },
  { key: 'franchigiaSpese', label: 'inf.set.optFranchigiaSpese' },
]

export default function InfortuniSettingsPage() {
  const t = useT()
  const [config, setConfig] = useState<InfConfig | null>(null)
  const [nextNumber, setNextNumber] = useState('')
  const [loadErr, setLoadErr] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/infortuni/config').then((r) => { if (!r.ok) throw new Error(); return r.json() })
      .then((d) => { setConfig(d.config); setNextNumber(d.nextNumber || '') })
      .catch(() => setLoadErr(true))
  }, [])

  if (loadErr) return <><h1 className="page-title">{t('nav.infSettings')}</h1><div className="alert alert-error">{t('inf.set.loadError')}</div></>
  if (!config) return <><h1 className="page-title">{t('nav.infSettings')}</h1><div className="card">{t('inf.loading')}</div></>

  const up = (patch: Partial<InfConfig>) => { setConfig({ ...config, ...patch }); setMsg(null) }
  const upOpt = (i: number, key: keyof InfOption, value: string) =>
    up({ options: config.options.map((o, j) => (j === i ? { ...o, [key]: value } : o)) })

  async function save() {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/infortuni/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config, nextNumber }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Errore')
      setConfig(d.config); setNextNumber(d.nextNumber)
      setMsg({ ok: true, text: t('inf.set.saved') })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const label = (text: string, hint?: string) => (
    <>
      <label className="label">{text}</label>
      {hint && <span style={{ fontSize: 11, color: 'var(--c-text-muted)', display: 'block', marginBottom: 4 }}>{hint}</span>}
    </>
  )

  return (
    <>
      <h1 className="page-title">{t('nav.infSettings')}</h1>
      <p className="view-subtitle">{t('inf.set.subtitle')}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{t('inf.set.policy')}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px 16px' }}>
            <div className="form-group">
              {label(t('inf.set.polizzaCollettiva'), t('inf.set.polizzaHint'))}
              <input value={config.polizzaCollettiva} onChange={(e) => up({ polizzaCollettiva: e.target.value })} style={{ fontFamily: 'var(--font-mono)' }} />
            </div>
            <div className="form-group">
              {label(t('inf.set.nextNumber'), t('inf.set.nextNumberHint'))}
              <input value={nextNumber} onChange={(e) => { setNextNumber(e.target.value); setMsg(null) }} style={{ fontFamily: 'var(--font-mono)' }} />
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              {label(t('inf.set.pagamento'), t('inf.set.pagamentoHint'))}
              <input value={config.pagamento} onChange={(e) => up({ pagamento: e.target.value })} placeholder="[…]" />
            </div>
          </div>
        </div>

        <div className="card" style={{ overflowX: 'auto' }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t('inf.set.options')}</h2>
          <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 0, marginBottom: 12 }}>{t('inf.set.optionsHint')}</p>
          <table>
            <thead><tr>{OPTION_COLS.map((c) => <th key={c.key} style={{ whiteSpace: 'nowrap' }}>{t(c.label)}</th>)}</tr></thead>
            <tbody>
              {config.options.map((o, i) => (
                <tr key={o.key}>
                  {OPTION_COLS.map((c) => (
                    <td key={c.key}>
                      <input value={String(o[c.key] ?? '')} onChange={(e) => upOpt(i, c.key, e.target.value)} style={{ width: c.width || 96 }} aria-label={`${o.name} ${t(c.label)}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t('inf.set.docs')}</h2>
          <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 0, marginBottom: 12 }}>{t('inf.set.docsHint')}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {([
              ['showRagioneSociale', 'inf.set.swRagione', 'inf.set.swRagioneHint', false],
              ['showFranchigiaSpese', 'inf.set.swFranchigia', 'inf.set.swFranchigiaHint', true],
              ['questionarioNumero', 'inf.set.swNumero', 'inf.set.swNumeroHint', true],
            ] as const).map(([key, lab, hint, def]) => (
              <label key={key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input type="checkbox" style={{ marginTop: 3 }} checked={config[key] ?? def} onChange={(e) => up({ [key]: e.target.checked })} />
                <span><span style={{ fontSize: 13, fontWeight: 600 }}>{t(lab)}</span><br /><span style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{t(hint)}</span></span>
              </label>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t('inf.set.mail')}</h2>
          <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 0, marginBottom: 12 }}>{t('inf.set.mailHint')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px 16px' }}>
            <div className="form-group">{label(t('inf.set.mailTo'))}<input value={config.mailTo} onChange={(e) => up({ mailTo: e.target.value })} placeholder="nome@dominio.it" /></div>
            <div className="form-group">{label(t('inf.set.mailCc'))}<input value={config.mailCc} onChange={(e) => up({ mailCc: e.target.value })} /></div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>{label(t('inf.set.mailSubject'))}<input value={config.mailSubject} onChange={(e) => up({ mailSubject: e.target.value })} /></div>
          </div>
        </div>
      </div>

      {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`} style={{ marginTop: 16 }}>{msg.text}</div>}
      <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={save} disabled={busy}>{busy ? <><span className="spinner" /> {t('inf.busy')}</> : t('inf.set.save')}</button>
    </>
  )
}
