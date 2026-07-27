'use client'

import { useEffect, useState } from 'react'
import type { SmtpConfig, FtpConfig, ExportNotify, Attachment } from '@/lib/adesioni/settingsWeb'
import { type AdesioniField, type PrezzoRow, type IddQuestion } from '@/lib/adesioni/config'
import { isValidExpr } from '@/lib/adesioni/expr.js'
import AdesioniFieldsEditor from '@/components/AdesioniFieldsEditor'
import { useT } from '@/lib/i18n/I18nProvider'

interface FullSettings {
  fields: AdesioniField[]
  idd: IddQuestion[]
  prezzi: Record<string, PrezzoRow>
  dateOffsetDays: number
  exportNotify: ExportNotify
  smtp: SmtpConfig
  ftp: { staging: FtpConfig; prod: FtpConfig }
  templateId: string
  templateHtml: string
  attachments: Attachment[]
}
type Preset = Partial<FullSettings>

export default function AdesioniSettingsPage() {
  const t = useT()
  const [s, setS] = useState<FullSettings | null>(null)
  const [loadErr, setLoadErr] = useState(false)
  const [saved, setSaved] = useState(false)
  const [ftpTest, setFtpTest] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [presets, setPresets] = useState<Record<string, Preset>>({})
  const [presetName, setPresetName] = useState('')
  const [placeholders, setPlaceholders] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/adesioni/settings').then((r) => { if (!r.ok) throw new Error(); return r.json() }).then(setS).catch(() => setLoadErr(true))
    fetch('/api/settings').then((r) => r.json()).then((d) => { if (d.adesioniProfiles) setPresets(d.adesioniProfiles) }).catch(() => {})
    fetch('/api/adesioni/template').then((r) => r.json()).then((d) => setPlaceholders([...(d.docxPlaceholders || []), ...(d.htmlPlaceholders || [])])).catch(() => {})
  }, [])

  if (loadErr) return <><h1 className="page-title">{t('nav.adSettings')}</h1><div className="alert alert-error">{t('ad.settings.loadError')}</div></>
  if (!s) return <><h1 className="page-title">{t('nav.adSettings')}</h1><div className="card">{t('ad.common.loading')}</div></>

  const upFtp = (kind: 'staging' | 'prod', patch: Partial<FtpConfig>) => setS({ ...s, ftp: { ...s.ftp, [kind]: { ...s.ftp[kind], ...patch } } })
  const upPrezzo = (code: string, patch: Partial<PrezzoRow>) => setS({ ...s, prezzi: { ...s.prezzi, [code]: { ...s.prezzi[code], ...patch } } })

  async function save() {
    const res = await fetch('/api/adesioni/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) })
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }
  async function testFtp(kind: 'staging' | 'prod') {
    setFtpTest((prev) => ({ ...prev, [kind]: { ok: false, text: t('ad.settings.verifying') } }))
    try {
      const res = await fetch('/api/adesioni/ftp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: kind, test: true, profile: s!.ftp[kind] }) })
      const d = await res.json()
      setFtpTest((prev) => ({ ...prev, [kind]: res.ok && d.ok ? { ok: true, text: t('ad.settings.connected', { dir: d.dir || '' }) } : { ok: false, text: d.error || t('set.connFail') } }))
    } catch (e) {
      setFtpTest((prev) => ({ ...prev, [kind]: { ok: false, text: (e as Error).message } }))
    }
  }

  // ─── Preset (adesioniProfiles) ───────────────────────────────────────────
  async function savePresets(next: Record<string, Preset>) {
    setPresets(next)
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adesioniProfiles: next }) })
  }
  async function saveAsPreset() {
    const name = presetName.trim(); if (!name) return
    // Snapshot completo (esclusi i segreti SMTP/FTP).
    await savePresets({ ...presets, [name]: { fields: s!.fields, idd: s!.idd, prezzi: s!.prezzi, dateOffsetDays: s!.dateOffsetDays, templateId: s!.templateId, templateHtml: s!.templateHtml, attachments: s!.attachments } })
    setPresetName('')
  }
  function loadPreset(name: string) {
    const p = presets[name]; if (!p) return
    setS({
      ...s!,
      fields: p.fields ?? s!.fields,
      idd: p.idd ?? s!.idd,
      prezzi: p.prezzi ?? s!.prezzi,
      dateOffsetDays: p.dateOffsetDays ?? s!.dateOffsetDays,
      templateId: p.templateId ?? s!.templateId,
      templateHtml: p.templateHtml ?? s!.templateHtml,
      attachments: p.attachments ?? s!.attachments,
    })
  }
  async function deletePreset(name: string) { const n = { ...presets }; delete n[name]; await savePresets(n) }
  function exportPresets() {
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'preset_adesioni.json'; a.click(); URL.revokeObjectURL(url)
  }
  async function importPresets(file: File | undefined) {
    if (!file) return
    try { await savePresets({ ...presets, ...JSON.parse(await file.text()) }) } catch { /* ignora */ }
  }

  return (
    <>
      <h1 className="page-title">{t('nav.adSettings')}</h1>
      <p className="view-subtitle">{t('ad.settings.subtitle')}</p>
      <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Prezzi */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{t('ad.settings.pricesTitle')}</h2>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>{t('ad.settings.colCode')}</th><th>{t('ad.settings.colPackage')}</th><th>{t('ad.settings.colPremium')}</th><th>{t('ad.settings.colFormula')}</th></tr></thead>
              <tbody>
                {Object.keys(s.prezzi).map((code) => (
                  <tr key={code}>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{code}</td>
                    <td><input value={s.prezzi[code].pacchetto || ''} onChange={(e) => upPrezzo(code, { pacchetto: e.target.value })} style={{ width: 80 }} aria-label={t('ad.settings.ariaPackage', { code })} /></td>
                    <td><input value={s.prezzi[code].premio || ''} onChange={(e) => upPrezzo(code, { premio: e.target.value })} style={{ width: 90 }} aria-label={t('ad.settings.ariaPremium', { code })} /></td>
                    <td>
                      <input value={s.prezzi[code].formula || ''} onChange={(e) => upPrezzo(code, { formula: e.target.value })} placeholder={t('ad.settings.formulaPlaceholder')} aria-label={t('ad.settings.ariaFormula', { code })} style={s.prezzi[code].formula && !isValidExpr(s.prezzi[code].formula, { premio: 0 }) ? { borderColor: 'var(--c-error)' } : undefined} />
                      {s.prezzi[code].formula && !isValidExpr(s.prezzi[code].formula, { premio: 0 }) && <span style={{ fontSize: 11, color: 'var(--c-error)' }}>{t('ad.settings.formulaInvalid')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Date */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{t('ad.settings.datesTitle')}</h2>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="label">{t('ad.settings.dateOffsetLabel')}</label>
            <input type="number" value={s.dateOffsetDays} onChange={(e) => setS({ ...s, dateOffsetDays: parseInt(e.target.value, 10) || 0 })} style={{ width: 100 }} />
            <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>{t('ad.settings.dateOffsetHint')}</p>
          </div>
        </div>

        {/* Campi maschera — editor completo */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{t('ad.settings.fieldsTitle')}</h2>
          <AdesioniFieldsEditor fields={s.fields} onChange={(f) => setS({ ...s, fields: f })} placeholders={placeholders} />
        </div>

        {/* Template HTML del modulo */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t('ad.settings.templateTitle')}</h2>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
              <input type="radio" name="tpl" checked={s.templateId !== 'custom'} onChange={() => setS({ ...s, templateId: 'default' })} /> {t('ad.settings.templateDefault')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
              <input type="radio" name="tpl" checked={s.templateId === 'custom'} onChange={() => setS({ ...s, templateId: 'custom' })} /> {t('ad.settings.templateCustom')}
            </label>
          </div>
          {s.templateId === 'custom' && (
            <>
              <label className="btn btn-secondary" style={{ cursor: 'pointer', marginBottom: 8 }}>
                {t('ad.settings.loadHtml')}
                <input type="file" accept=".html,.xhtml,.htm" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) setS({ ...s, templateHtml: await f.text() }) }} />
              </label>
              <textarea value={s.templateHtml} onChange={(e) => setS({ ...s, templateHtml: e.target.value })} rows={6} style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 11 }} placeholder={t('ad.settings.htmlPlaceholder')} />
              <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>{t('ad.settings.templateRelHint')} <code>{'{{campo}}'}</code>.</p>
            </>
          )}
          <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 8 }}>{t('ad.settings.placeholdersDetected')} {placeholders.length ? placeholders.join(', ') : '—'}</p>
        </div>

        {/* Allegati PDF */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700 }}>{t('ad.settings.attachmentsTitle')}</h2>
            <label className="btn btn-secondary" style={{ cursor: 'pointer', fontSize: 12, padding: '4px 10px' }}>
              {t('ad.settings.addPdf')}
              <input type="file" accept=".pdf" style={{ display: 'none' }} onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return
                const b64 = btoa(String.fromCharCode(...new Uint8Array(await f.arrayBuffer())))
                setS({ ...s, attachments: [...s.attachments, { name: f.name, dataBase64: b64 }] })
              }} />
            </label>
          </div>
          {s.attachments.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--c-text-muted)', margin: 0 }}>{t('ad.settings.noAttachments')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {s.attachments.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 14 }}>{i + 1}. {a.name}</span>
                  <button className="btn btn-secondary" style={{ padding: '4px 8px' }} disabled={i === 0} onClick={() => { const n = [...s.attachments];[n[i - 1], n[i]] = [n[i], n[i - 1]]; setS({ ...s, attachments: n }) }} title={t('ad.settings.moveUp')}>↑</button>
                  <button className="btn btn-secondary" style={{ padding: '4px 8px' }} disabled={i === s.attachments.length - 1} onClick={() => { const n = [...s.attachments];[n[i + 1], n[i]] = [n[i], n[i + 1]]; setS({ ...s, attachments: n }) }} title={t('ad.settings.moveDown')}>↓</button>
                  <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => setS({ ...s, attachments: s.attachments.filter((_, j) => j !== i) })} title={t('ad.settings.remove')}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* SMTP */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{t('ad.settings.smtpTitle')}</h2>
          <Field label={t('ad.settings.host')}><input value={s.smtp.host} onChange={(e) => setS({ ...s, smtp: { ...s.smtp, host: e.target.value } })} /></Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label={t('ad.settings.port')}><input type="number" value={s.smtp.port} onChange={(e) => setS({ ...s, smtp: { ...s.smtp, port: parseInt(e.target.value, 10) || 587 } })} style={{ width: 100 }} /></Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, marginTop: 22 }}><input type="checkbox" checked={s.smtp.secure} onChange={(e) => setS({ ...s, smtp: { ...s.smtp, secure: e.target.checked } })} /> TLS</label>
          </div>
          <Field label={t('ad.settings.user')}><input value={s.smtp.user} onChange={(e) => setS({ ...s, smtp: { ...s.smtp, user: e.target.value } })} /></Field>
          <Field label={t('ad.settings.password')}><input type="password" value={s.smtp.pass} onChange={(e) => setS({ ...s, smtp: { ...s.smtp, pass: e.target.value } })} placeholder="•••" /></Field>
          <Field label={t('ad.settings.from')}><input value={s.smtp.from} onChange={(e) => setS({ ...s, smtp: { ...s.smtp, from: e.target.value } })} placeholder={t('ad.settings.fromPlaceholder')} /></Field>
        </div>

        {/* FTP */}
        {(['staging', 'prod'] as const).map((kind) => (
          <div className="card" key={kind}>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{t('ad.settings.ftpTitle')} {kind === 'staging' ? t('ad.settings.staging') : t('ad.settings.prod')}</h2>
            <Field label={t('ad.settings.protocol')}>
              <select value={s.ftp[kind].protocol} onChange={(e) => upFtp(kind, { protocol: e.target.value as FtpConfig['protocol'] })}>
                <option value="ftp">FTP</option><option value="ftps">FTPS</option><option value="sftp">SFTP</option>
              </select>
            </Field>
            <div style={{ display: 'flex', gap: 12 }}>
              <Field label={t('ad.settings.host')}><input value={s.ftp[kind].host} onChange={(e) => upFtp(kind, { host: e.target.value })} /></Field>
              <Field label={t('ad.settings.port')}><input type="number" value={s.ftp[kind].port} onChange={(e) => upFtp(kind, { port: parseInt(e.target.value, 10) || 21 })} style={{ width: 90 }} /></Field>
            </div>
            <Field label={t('ad.settings.user')}><input value={s.ftp[kind].user} onChange={(e) => upFtp(kind, { user: e.target.value })} /></Field>
            <Field label={t('ad.settings.password')}><input type="password" value={s.ftp[kind].pass} onChange={(e) => upFtp(kind, { pass: e.target.value })} placeholder="•••" /></Field>
            <Field label={t('ad.settings.remoteFolder')}><input value={s.ftp[kind].dir} onChange={(e) => upFtp(kind, { dir: e.target.value })} placeholder="/upload" /></Field>
            {s.ftp[kind].protocol === 'sftp' && (
              <>
                <Field label={t('ad.settings.privateKey')}><textarea value={s.ftp[kind].privateKey} onChange={(e) => upFtp(kind, { privateKey: e.target.value })} rows={3} style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 11 }} placeholder="•••" /></Field>
                <Field label={t('ad.settings.passphrase')}><input type="password" value={s.ftp[kind].passphrase} onChange={(e) => upFtp(kind, { passphrase: e.target.value })} placeholder="•••" /></Field>
              </>
            )}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
              <button className="btn btn-secondary" onClick={() => testFtp(kind)}>{t('set.testConn')}</button>
              {ftpTest[kind] && <span style={{ fontSize: 12, color: ftpTest[kind].ok ? 'var(--c-success)' : 'var(--c-error)' }}>{ftpTest[kind].text}</span>}
            </div>
            <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 8 }}>{t('ad.settings.ftpTestHint')}</p>
          </div>
        ))}

        {/* Notifiche */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{t('ad.settings.notifyTitle')}</h2>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 12 }}>
            <input type="checkbox" checked={s.exportNotify.enabled} onChange={(e) => setS({ ...s, exportNotify: { ...s.exportNotify, enabled: e.target.checked } })} /> {t('ad.settings.notifyEnabled')}
          </label>
          <Field label={t('ad.settings.recipient')}>
            <select value={s.exportNotify.mode} onChange={(e) => setS({ ...s, exportNotify: { ...s.exportNotify, mode: e.target.value as ExportNotify['mode'] } })}>
              <option value="user">{t('ad.settings.notifyUser')}</option><option value="shared">{t('ad.settings.notifyShared')}</option><option value="both">{t('ad.settings.notifyBoth')}</option>
            </select>
          </Field>
          <Field label={t('ad.settings.notifyShared')}><input value={s.exportNotify.sharedEmail} onChange={(e) => setS({ ...s, exportNotify: { ...s.exportNotify, sharedEmail: e.target.value } })} placeholder={t('ad.settings.sharedPlaceholder')} /></Field>
        </div>

        {/* Preset */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{t('ad.settings.presetsTitle')}</h2>
          <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: -6, marginBottom: 12 }}>{t('ad.settings.presetsHint')}</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder={t('ad.settings.presetName')} style={{ flex: 1, minWidth: 180 }} aria-label={t('ad.settings.presetName')} />
            <button className="btn btn-secondary" onClick={saveAsPreset}>{t('ad.settings.savePreset')}</button>
            <button className="btn btn-secondary" onClick={exportPresets}>{t('set.exportJson')}</button>
            <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>{t('set.importJson')}<input type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => importPresets(e.target.files?.[0])} /></label>
          </div>
          {Object.keys(presets).length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--c-text-muted)', margin: 0 }}>{t('ad.settings.noPresets')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.keys(presets).map((name) => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 14 }}>{name}</span>
                  <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => loadPreset(name)}>{t('ad.settings.loadPreset')}</button>
                  <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => deletePreset(name)}>{t('ad.btn.delete')}</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {saved && <div className="alert alert-success">{t('ad.settings.saved')}</div>}
        <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={save}>{t('ad.settings.save')}</button>
      </div>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="form-group">
      <label className="label">{label}</label>
      {children}
    </div>
  )
}
