'use client'

import { useEffect, useState } from 'react'
import type { SmtpConfig, FtpConfig, ExportNotify, Attachment } from '@/lib/adesioni/settingsWeb'
import { type AdesioniField, type PrezzoRow, type IddQuestion } from '@/lib/adesioni/config'
import { isValidExpr } from '@/lib/adesioni/expr.js'
import AdesioniFieldsEditor from '@/components/AdesioniFieldsEditor'

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

  if (loadErr) return <><h1 className="page-title">Configurazioni</h1><div className="alert alert-error">Impossibile caricare le impostazioni. Ricarica la pagina o verifica la connessione al server.</div></>
  if (!s) return <><h1 className="page-title">Configurazioni</h1><div className="card">Caricamento…</div></>

  const upFtp = (kind: 'staging' | 'prod', patch: Partial<FtpConfig>) => setS({ ...s, ftp: { ...s.ftp, [kind]: { ...s.ftp[kind], ...patch } } })
  const upPrezzo = (code: string, patch: Partial<PrezzoRow>) => setS({ ...s, prezzi: { ...s.prezzi, [code]: { ...s.prezzi[code], ...patch } } })

  async function save() {
    const res = await fetch('/api/adesioni/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) })
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }
  async function testFtp(kind: 'staging' | 'prod') {
    setFtpTest((t) => ({ ...t, [kind]: { ok: false, text: 'Verifica…' } }))
    try {
      const res = await fetch('/api/adesioni/ftp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: kind, test: true, profile: s!.ftp[kind] }) })
      const d = await res.json()
      setFtpTest((t) => ({ ...t, [kind]: res.ok && d.ok ? { ok: true, text: `Connesso · ${d.dir || ''}` } : { ok: false, text: d.error || 'Connessione fallita' } }))
    } catch (e) {
      setFtpTest((t) => ({ ...t, [kind]: { ok: false, text: (e as Error).message } }))
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
                    <td><input value={s.prezzi[code].pacchetto || ''} onChange={(e) => upPrezzo(code, { pacchetto: e.target.value })} style={{ width: 80 }} aria-label={`Pacchetto ${code}`} /></td>
                    <td><input value={s.prezzi[code].premio || ''} onChange={(e) => upPrezzo(code, { premio: e.target.value })} style={{ width: 90 }} aria-label={`Premio ${code}`} /></td>
                    <td>
                      <input value={s.prezzi[code].formula || ''} onChange={(e) => upPrezzo(code, { formula: e.target.value })} placeholder="es. premio * 2" aria-label={`Formula ${code}`} style={s.prezzi[code].formula && !isValidExpr(s.prezzi[code].formula, { premio: 0 }) ? { borderColor: 'var(--c-error)' } : undefined} />
                      {s.prezzi[code].formula && !isValidExpr(s.prezzi[code].formula, { premio: 0 }) && <span style={{ fontSize: 11, color: 'var(--c-error)' }}>Formula non valida</span>}
                    </td>
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

        {/* Campi maschera — editor completo */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Campi della maschera</h2>
          <AdesioniFieldsEditor fields={s.fields} onChange={(f) => setS({ ...s, fields: f })} placeholders={placeholders} />
        </div>

        {/* Template HTML del modulo */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Template del modulo (PDF)</h2>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
              <input type="radio" name="tpl" checked={s.templateId !== 'custom'} onChange={() => setS({ ...s, templateId: 'default' })} /> Predefinito (AXA)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
              <input type="radio" name="tpl" checked={s.templateId === 'custom'} onChange={() => setS({ ...s, templateId: 'custom' })} /> Personalizzato
            </label>
          </div>
          {s.templateId === 'custom' && (
            <>
              <label className="btn btn-secondary" style={{ cursor: 'pointer', marginBottom: 8 }}>
                Carica HTML del modulo
                <input type="file" accept=".html,.xhtml,.htm" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) setS({ ...s, templateHtml: await f.text() }) }} />
              </label>
              <textarea value={s.templateHtml} onChange={(e) => setS({ ...s, templateHtml: e.target.value })} rows={6} style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 11 }} placeholder="HTML del modulo con segnaposto {{campo}}…" />
              <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>I riferimenti relativi (font/immagini) risolvono agli asset del template predefinito. Usa i segnaposto <code>{'{{campo}}'}</code>.</p>
            </>
          )}
          <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 8 }}>Segnaposto rilevati nel template attivo: {placeholders.length ? placeholders.join(', ') : '—'}</p>
        </div>

        {/* Allegati PDF */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700 }}>Allegati PDF</h2>
            <label className="btn btn-secondary" style={{ cursor: 'pointer', fontSize: 12, padding: '4px 10px' }}>
              + Aggiungi PDF
              <input type="file" accept=".pdf" style={{ display: 'none' }} onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return
                const b64 = btoa(String.fromCharCode(...new Uint8Array(await f.arrayBuffer())))
                setS({ ...s, attachments: [...s.attachments, { name: f.name, dataBase64: b64 }] })
              }} />
            </label>
          </div>
          {s.attachments.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--c-text-muted)', margin: 0 }}>Nessun allegato personalizzato: verrà accodato il DIP incluso.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {s.attachments.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 14 }}>{i + 1}. {a.name}</span>
                  <button className="btn btn-secondary" style={{ padding: '4px 8px' }} disabled={i === 0} onClick={() => { const n = [...s.attachments];[n[i - 1], n[i]] = [n[i], n[i - 1]]; setS({ ...s, attachments: n }) }} title="Su">↑</button>
                  <button className="btn btn-secondary" style={{ padding: '4px 8px' }} disabled={i === s.attachments.length - 1} onClick={() => { const n = [...s.attachments];[n[i + 1], n[i]] = [n[i], n[i + 1]]; setS({ ...s, attachments: n }) }} title="Giù">↓</button>
                  <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => setS({ ...s, attachments: s.attachments.filter((_, j) => j !== i) })} title="Rimuovi">✕</button>
                </div>
              ))}
            </div>
          )}
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
                <Field label="Chiave privata (SFTP)"><textarea value={s.ftp[kind].privateKey} onChange={(e) => upFtp(kind, { privateKey: e.target.value })} rows={3} style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 11 }} placeholder="•••" /></Field>
                <Field label="Passphrase"><input type="password" value={s.ftp[kind].passphrase} onChange={(e) => upFtp(kind, { passphrase: e.target.value })} placeholder="•••" /></Field>
              </>
            )}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
              <button className="btn btn-secondary" onClick={() => testFtp(kind)}>Testa connessione</button>
              {ftpTest[kind] && <span style={{ fontSize: 12, color: ftpTest[kind].ok ? 'var(--c-success)' : 'var(--c-error)' }}>{ftpTest[kind].text}</span>}
            </div>
            <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 8 }}>Il test usa i valori qui sopra; le password lasciate a «•••» usano quelle già salvate.</p>
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

        {/* Preset */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Preset di configurazione</h2>
          <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: -6, marginBottom: 12 }}>Salva/richiama campi, premi e offset date (i segreti SMTP/FTP non sono inclusi nei preset).</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Nome preset" style={{ flex: 1, minWidth: 180 }} aria-label="Nome preset" />
            <button className="btn btn-secondary" onClick={saveAsPreset}>Salva come preset</button>
            <button className="btn btn-secondary" onClick={exportPresets}>Esporta JSON</button>
            <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>Importa JSON<input type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => importPresets(e.target.files?.[0])} /></label>
          </div>
          {Object.keys(presets).length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--c-text-muted)', margin: 0 }}>Nessun preset salvato.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.keys(presets).map((name) => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 14 }}>{name}</span>
                  <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => loadPreset(name)}>Carica</button>
                  <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => deletePreset(name)}>Elimina</button>
                </div>
              ))}
            </div>
          )}
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
