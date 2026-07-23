'use client'

import { useEffect, useState } from 'react'
import type { SmtpConfig, FtpConfig, ExportNotify } from '@/lib/adesioni/settingsWeb'
import type { AdesioniField, PrezzoRow } from '@/lib/adesioni/config'

interface FullSettings {
  fields: AdesioniField[]
  prezzi: Record<string, PrezzoRow>
  dateOffsetDays: number
  exportNotify: ExportNotify
  smtp: SmtpConfig
  ftp: { staging: FtpConfig; prod: FtpConfig }
}

export default function AdesioniSettingsPage() {
  const [s, setS] = useState<FullSettings | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => { fetch('/api/adesioni/settings').then((r) => r.json()).then(setS).catch(() => {}) }, [])

  if (!s) return <><h1 className="page-title">Configurazioni</h1><div className="card">Caricamento…</div></>

  const upFtp = (kind: 'staging' | 'prod', patch: Partial<FtpConfig>) => setS({ ...s, ftp: { ...s.ftp, [kind]: { ...s.ftp[kind], ...patch } } })
  const upPrezzo = (code: string, patch: Partial<PrezzoRow>) => setS({ ...s, prezzi: { ...s.prezzi, [code]: { ...s.prezzi[code], ...patch } } })

  async function save() {
    const res = await fetch('/api/adesioni/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) })
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <>
      <h1 className="page-title">Configurazioni</h1>
      <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Prezzi */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Tabella premi</h2>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Codice</th><th>Pacchetto</th><th>Premio (€)</th><th>Formula (opz.)</th></tr></thead>
              <tbody>
                {Object.keys(s.prezzi).map((code) => (
                  <tr key={code}>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{code}</td>
                    <td><input value={s.prezzi[code].pacchetto || ''} onChange={(e) => upPrezzo(code, { pacchetto: e.target.value })} style={{ width: 80 }} /></td>
                    <td><input value={s.prezzi[code].premio || ''} onChange={(e) => upPrezzo(code, { premio: e.target.value })} style={{ width: 90 }} /></td>
                    <td><input value={s.prezzi[code].formula || ''} onChange={(e) => upPrezzo(code, { formula: e.target.value })} placeholder="es. premio * 2" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Date */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Date del modulo</h2>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="label">Offset giorni (decorrenza reale)</label>
            <input type="number" value={s.dateOffsetDays} onChange={(e) => setS({ ...s, dateOffsetDays: parseInt(e.target.value, 10) || 0 })} style={{ width: 100 }} />
            <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>0 = data del flusso così com&apos;è. 1 = stampa la decorrenza reale (semantica &quot;ore 24:00&quot;).</p>
          </div>
        </div>

        {/* Campi maschera */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Campi della maschera</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {s.fields.map((f, i) => (
              <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 90px', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={f.enabled !== false} onChange={(e) => setS({ ...s, fields: s.fields.map((x, j) => j === i ? { ...x, enabled: e.target.checked } : x) })} />
                <input value={f.label} onChange={(e) => setS({ ...s, fields: s.fields.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
                <input type="number" value={f.maxLength ?? ''} placeholder="max" onChange={(e) => setS({ ...s, fields: s.fields.map((x, j) => j === i ? { ...x, maxLength: e.target.value ? parseInt(e.target.value, 10) : undefined } : x) })} style={{ width: 80 }} />
              </div>
            ))}
          </div>
        </div>

        {/* SMTP */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Email (SMTP)</h2>
          <Field label="Host"><input value={s.smtp.host} onChange={(e) => setS({ ...s, smtp: { ...s.smtp, host: e.target.value } })} /></Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Porta"><input type="number" value={s.smtp.port} onChange={(e) => setS({ ...s, smtp: { ...s.smtp, port: parseInt(e.target.value, 10) || 587 } })} style={{ width: 100 }} /></Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, marginTop: 22 }}><input type="checkbox" checked={s.smtp.secure} onChange={(e) => setS({ ...s, smtp: { ...s.smtp, secure: e.target.checked } })} /> TLS</label>
          </div>
          <Field label="Utente"><input value={s.smtp.user} onChange={(e) => setS({ ...s, smtp: { ...s.smtp, user: e.target.value } })} /></Field>
          <Field label="Password"><input type="password" value={s.smtp.pass} onChange={(e) => setS({ ...s, smtp: { ...s.smtp, pass: e.target.value } })} placeholder="•••" /></Field>
          <Field label="Mittente (From)"><input value={s.smtp.from} onChange={(e) => setS({ ...s, smtp: { ...s.smtp, from: e.target.value } })} placeholder="CSA <noreply@dominio.it>" /></Field>
        </div>

        {/* FTP */}
        {(['staging', 'prod'] as const).map((kind) => (
          <div className="card" key={kind}>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Pubblicazione FTP — {kind === 'staging' ? 'Staging' : 'Produzione'}</h2>
            <Field label="Protocollo">
              <select value={s.ftp[kind].protocol} onChange={(e) => upFtp(kind, { protocol: e.target.value as FtpConfig['protocol'] })}>
                <option value="ftp">FTP</option><option value="ftps">FTPS</option><option value="sftp">SFTP</option>
              </select>
            </Field>
            <div style={{ display: 'flex', gap: 12 }}>
              <Field label="Host"><input value={s.ftp[kind].host} onChange={(e) => upFtp(kind, { host: e.target.value })} /></Field>
              <Field label="Porta"><input type="number" value={s.ftp[kind].port} onChange={(e) => upFtp(kind, { port: parseInt(e.target.value, 10) || 21 })} style={{ width: 90 }} /></Field>
            </div>
            <Field label="Utente"><input value={s.ftp[kind].user} onChange={(e) => upFtp(kind, { user: e.target.value })} /></Field>
            <Field label="Password"><input type="password" value={s.ftp[kind].pass} onChange={(e) => upFtp(kind, { pass: e.target.value })} placeholder="•••" /></Field>
            <Field label="Cartella remota"><input value={s.ftp[kind].dir} onChange={(e) => upFtp(kind, { dir: e.target.value })} placeholder="/upload" /></Field>
            {s.ftp[kind].protocol === 'sftp' && (
              <>
                <Field label="Chiave privata (SFTP)"><textarea value={s.ftp[kind].privateKey} onChange={(e) => upFtp(kind, { privateKey: e.target.value })} rows={3} style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 11 }} /></Field>
                <Field label="Passphrase"><input type="password" value={s.ftp[kind].passphrase} onChange={(e) => upFtp(kind, { passphrase: e.target.value })} placeholder="•••" /></Field>
              </>
            )}
          </div>
        ))}

        {/* Notifiche */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Notifiche di riepilogo</h2>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 12 }}>
            <input type="checkbox" checked={s.exportNotify.enabled} onChange={(e) => setS({ ...s, exportNotify: { ...s.exportNotify, enabled: e.target.checked } })} /> Invia email di riepilogo su esportazione/upload
          </label>
          <Field label="Destinatario">
            <select value={s.exportNotify.mode} onChange={(e) => setS({ ...s, exportNotify: { ...s.exportNotify, mode: e.target.value as ExportNotify['mode'] } })}>
              <option value="user">Utente collegato</option><option value="shared">Mailbox condivisa</option><option value="both">Entrambi</option>
            </select>
          </Field>
          <Field label="Mailbox condivisa"><input value={s.exportNotify.sharedEmail} onChange={(e) => setS({ ...s, exportNotify: { ...s.exportNotify, sharedEmail: e.target.value } })} placeholder="ufficio@dominio.it" /></Field>
        </div>

        {saved && <div className="alert alert-success">Configurazioni salvate.</div>}
        <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={save}>Salva configurazioni</button>
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
