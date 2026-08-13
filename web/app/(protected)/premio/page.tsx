'use client'

import { useRef, useState } from 'react'
import { useI18n } from '@/lib/i18n/I18nProvider'

/* ─── Forma del riepilogo restituito da /api/premio ────────────────────────── */
interface Voce { nome: string; righe: number }
interface Garanzia extends Voce { aliquota: number; inTabella: boolean }
interface Check { nome: string; ok: boolean; dettaglio: string }
interface Sconosciuta { garanzia: string; righe: number; esempi: number[] }
interface Pareggio { riga: number; garanzia: string; premioNetto: string; valore: number; alternativa: number }
interface ColonnaExtra { colonna: string; etichetta: string | null; celle: number }

interface Report {
  sheet: string
  sheets: string[]
  headerRow: number
  righeDati: number
  colonnaLordo: string
  colonnaTotale: string
  rounding: string
  movimenti: Voce[]
  garanzie: Garanzia[]
  inclusioni: number
  calcolate: number
  polizze: number
  totaleGenerale: number
  unknownGaranzie: Sconosciuta[]
  premioNettoIllleggibile: { riga: number; valore: string }[]
  pareggi: Pareggio[]
  colonneExtra: ColonnaExtra[]
  colonneExtraRimosse: boolean
  verifica: Check[]
  verificaOk: boolean
  rilettura: Check[]
  riletturaOk: boolean
  celleRimosse: number
  formuleRimosse: number
  unioniRimosse: number
  avvisi: string[]
}

interface Esito {
  ok: boolean
  blocked: string | null
  report: Report
  fileName: string
  fileBase64: string | null
}

const num = (n: number, dec = 2) =>
  n.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec })

export default function PremioLordoPage() {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [esito, setEsito] = useState<Esito | null>(null)
  const [rounding, setRounding] = useState<'commerciale' | 'legacy'>('commerciale')
  const [scaricato, setScaricato] = useState(false)

  function scegli(f: File | undefined) {
    if (!f) return
    setFile(f)
    setEsito(null)
    setErr(null)
    setScaricato(false)
  }

  async function elabora(assumeDefault = false) {
    if (!file) return
    setBusy(true)
    setErr(null)
    if (!assumeDefault) setEsito(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('rounding', rounding)
      if (assumeDefault) fd.append('assumeDefault', 'true')

      const res = await fetch('/api/premio', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setErr(data.error || t('premio.errGeneric'))
        return
      }
      setEsito(data as Esito)
      setScaricato(false)
    } catch {
      setErr(t('premio.errNetwork'))
    } finally {
      setBusy(false)
    }
  }

  function scarica() {
    if (!esito?.fileBase64) return
    const bin = atob(esito.fileBase64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = esito.fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setScaricato(true)
  }

  const r = esito?.report

  return (
    <div style={{ maxWidth: 940, margin: '0 auto' }}>
      <h1 className="page-title">{t('premio.title')}</h1>
      <p className="view-subtitle">{t('premio.subtitle')}</p>

      {/* ── 1. Il file ──────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div
          className={`file-card ${file ? 'loaded' : ''} ${dragOver ? 'drag-over' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); scegli(e.dataTransfer.files[0]) }}
        >
          <div className="file-card-label">{t('premio.fileLabel')}</div>
          <div className="file-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
          </div>
          {file ? (
            <>
              <div className="file-name">{file.name}</div>
              <div className="file-meta">{(file.size / 1024).toLocaleString('it-IT', { maximumFractionDigits: 0 })} KB</div>
            </>
          ) : (
            <div className="file-meta">{t('premio.noFile')}</div>
          )}
          <button type="button" className="btn-browse" onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}>
            {t('premio.browse')}
          </button>
          <div className="drop-hint">{t('premio.dropHint')}</div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            style={{ display: 'none' }}
            onChange={(e) => scegli(e.target.files?.[0])}
          />
        </div>

        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 18 }}>
          <div className="form-group" style={{ margin: 0, minWidth: 260 }}>
            <label className="label" htmlFor="rounding">{t('premio.roundingLabel')}</label>
            <select
              id="rounding"
              value={rounding}
              onChange={(e) => { setRounding(e.target.value as 'commerciale' | 'legacy'); setEsito(null) }}
            >
              <option value="commerciale">{t('premio.roundingCommercial')}</option>
              <option value="legacy">{t('premio.roundingLegacy')}</option>
            </select>
          </div>
          <button className="btn btn-primary" disabled={!file || busy} onClick={() => elabora(false)}>
            {busy ? <span className="spinner" /> : null}
            {busy ? t('premio.working') : t('premio.run')}
          </button>
        </div>
        <p style={{ color: 'var(--c-text-muted)', fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          {t('premio.roundingHelp')}
        </p>
      </div>

      {err && <div className="alert alert-error" style={{ marginBottom: 20 }}>{err}</div>}

      {/* ── 2. Garanzie fuori tabella: si chiede, non si inventa ─────────── */}
      {esito?.blocked === 'unknownGaranzie' && r && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--c-warning, #d68a00)' }}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>{t('premio.unknownTitle')}</h2>
          <p style={{ color: 'var(--c-text-secondary)', fontSize: 14 }}>{t('premio.unknownBody')}</p>
          <ul style={{ fontSize: 14, lineHeight: 1.7 }}>
            {r.unknownGaranzie.map((u) => (
              <li key={u.garanzia}>
                <strong>{u.garanzia}</strong> — {u.righe} {t('premio.rows')} ({t('premio.egRow')} {u.esempi.join(', ')})
              </li>
            ))}
          </ul>
          <button className="btn btn-primary" disabled={busy} onClick={() => elabora(true)}>
            {t('premio.applyDefault')}
          </button>
        </div>
      )}

      {/* ── 3. Riepilogo + scarica ───────────────────────────────────────── */}
      {r && esito?.ok && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>{t('premio.readyTitle')}</h2>
                <p style={{ margin: 0, color: 'var(--c-text-secondary)', fontSize: 14 }}>
                  {t('premio.readyBody')
                    .replace('{rows}', r.righeDati.toLocaleString('it-IT'))
                    .replace('{lordo}', r.colonnaLordo)
                    .replace('{tot}', r.colonnaTotale)}
                </p>
              </div>
              <button className="btn btn-success" onClick={scarica}>
                {scaricato ? t('premio.downloadAgain') : t('premio.download')}
              </button>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h2 style={{ marginTop: 0, fontSize: 17 }}>{t('premio.summary')}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 18 }}>
              <Stat label={t('premio.stRows')} value={r.righeDati.toLocaleString('it-IT')} />
              <Stat label={t('premio.stInclusions')} value={r.calcolate.toLocaleString('it-IT')} />
              <Stat label={t('premio.stPolicies')} value={r.polizze.toLocaleString('it-IT')} />
              <Stat label={t('premio.stTotal')} value={num(r.totaleGenerale)} />
            </div>
            <p style={{ color: 'var(--c-text-muted)', fontSize: 12, margin: 0 }}>
              {t('premio.sheetInfo').replace('{sheet}', r.sheet).replace('{row}', String(r.headerRow))}
            </p>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h2 style={{ marginTop: 0, fontSize: 17 }}>{t('premio.ratesTitle')}</h2>
            <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--c-text-secondary)' }}>
                  <th style={{ padding: '6px 8px' }}>{t('premio.thGaranzia')}</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('premio.thRows')}</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('premio.thRate')}</th>
                </tr>
              </thead>
              <tbody>
                {r.garanzie.map((g) => (
                  <tr key={g.nome} style={{ borderTop: '1px solid var(--c-border)' }}>
                    <td style={{ padding: '6px 8px' }}>
                      {g.nome}
                      {!g.inTabella && <span title={t('premio.notInTable')} style={{ color: 'var(--c-warning, #d68a00)' }}> ⚠</span>}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{g.righe.toLocaleString('it-IT')}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{num(g.aliquota * 100, 1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ color: 'var(--c-text-muted)', fontSize: 12, marginTop: 12, marginBottom: 0 }}>
              {t('premio.movements')}: {r.movimenti.map((m) => `${m.nome} ${m.righe.toLocaleString('it-IT')}`).join(' · ')}
            </p>
          </div>

          {r.pareggi.length > 0 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <h2 style={{ marginTop: 0, fontSize: 17 }}>{t('premio.tiesTitle')}</h2>
              <p style={{ color: 'var(--c-text-secondary)', fontSize: 14 }}>
                {t('premio.tiesBody').replace('{n}', String(r.pareggi.length))}
              </p>
              <ul style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
                {r.pareggi.slice(0, 12).map((p) => (
                  <li key={p.riga}>
                    {t('premio.row')} {p.riga} · {p.garanzia} · {t('premio.net')} {p.premioNetto} →{' '}
                    <strong>{num(p.valore)}</strong> ({t('premio.insteadOf')} {num(p.alternativa)})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(r.colonneExtra.length > 0 || r.premioNettoIllleggibile.length > 0 || r.avvisi.length > 0) && (
            <div className="card" style={{ marginBottom: 20 }}>
              <h2 style={{ marginTop: 0, fontSize: 17 }}>{t('premio.noticesTitle')}</h2>
              <ul style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 0 }}>
                {r.colonneExtra.length > 0 && (
                  <li>
                    {t('premio.extraCols')}:{' '}
                    {r.colonneExtra.map((c) => `${c.colonna}${c.etichetta ? ` "${c.etichetta}"` : ''}`).join(', ')} —{' '}
                    {r.colonneExtraRimosse ? t('premio.extraColsRemoved') : t('premio.extraColsKept')}
                  </li>
                )}
                {r.premioNettoIllleggibile.length > 0 && (
                  <li>
                    {t('premio.badNet').replace('{n}', String(r.premioNettoIllleggibile.length))}:{' '}
                    {r.premioNettoIllleggibile.slice(0, 6).map((m) => m.riga).join(', ')}
                  </li>
                )}
                {r.avvisi.map((a) => <li key={a}>{a}</li>)}
              </ul>
            </div>
          )}

          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: 17 }}>{t('premio.checksTitle')}</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 14, lineHeight: 1.9 }}>
              {[...r.verifica, ...r.rilettura].map((c, i) => (
                <li key={`${c.nome}-${i}`}>
                  <span style={{ color: c.ok ? 'var(--c-success, #2ea043)' : 'var(--c-danger, #d13438)' }}>
                    {c.ok ? '✓' : '✗'}
                  </span>{' '}
                  {c.nome} <span style={{ color: 'var(--c-text-muted)' }}>— {c.dettaglio}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: 'var(--c-text-muted)', fontSize: 12, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
    </div>
  )
}
