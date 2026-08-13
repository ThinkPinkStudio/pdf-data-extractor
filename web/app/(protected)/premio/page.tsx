'use client'

import { useRef, useState } from 'react'
import { useI18n } from '@/lib/i18n/I18nProvider'
import './premio.css'

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
const int = (n: number) => n.toLocaleString('it-IT')

const IconSheet = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M8 13h8M8 17h5" />
  </svg>
)

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
    <div className="premio-scope" style={{ maxWidth: 900, margin: '0 auto' }}>
      <h1 className="page-title">{t('premio.title')}</h1>
      <p className="view-subtitle">{t('premio.subtitle')}</p>

      {/* ── 1. Il file ──────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div
          className={`premio-drop${file ? ' is-loaded' : ''}${dragOver ? ' is-drag' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); scegli(e.dataTransfer.files[0]) }}
        >
          <div className="premio-drop-label">{t('premio.fileLabel')}</div>
          <div className="premio-drop-icon"><IconSheet /></div>
          {file ? (
            <>
              <div className="premio-file-name">{file.name}</div>
              <div className="premio-file-meta">
                {(file.size / 1024).toLocaleString('it-IT', { maximumFractionDigits: 0 })} KB
              </div>
            </>
          ) : (
            <div className="premio-file-meta">{t('premio.noFile')}</div>
          )}
          <button type="button" className="premio-browse" onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}>
            {t('premio.browse')}
          </button>
          <div className="premio-drop-hint">{t('premio.dropHint')}</div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            style={{ display: 'none' }}
            onChange={(e) => scegli(e.target.files?.[0])}
          />
        </div>

        <div className="premio-controls">
          <div className="form-group">
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
            {busy && <span className="spinner" />}
            {busy ? t('premio.working') : t('premio.run')}
          </button>
        </div>
        <p className="premio-note">{t('premio.roundingHelp')}</p>
      </div>

      {err && <div className="alert alert-error" style={{ marginBottom: 20 }}>{err}</div>}

      {/* ── 2. Garanzie fuori tabella: si chiede, non si inventa ─────────── */}
      {esito?.blocked === 'unknownGaranzie' && r && (
        <div className="card premio-attention" style={{ marginBottom: 20 }}>
          <h2 className="premio-card-title">{t('premio.unknownTitle')}</h2>
          <p style={{ color: 'var(--c-text-secondary)', fontSize: 14, marginTop: 0 }}>{t('premio.unknownBody')}</p>
          <ul className="premio-list" style={{ marginBottom: 16 }}>
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
            <div className="premio-ready">
              <div>
                <h2>{t('premio.readyTitle')}</h2>
                <p>
                  {t('premio.readyBody')
                    .replace('{rows}', int(r.righeDati))
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
            <h2 className="premio-card-title">{t('premio.summary')}</h2>
            <div className="premio-stats">
              <Stat label={t('premio.stRows')} value={int(r.righeDati)} />
              <Stat label={t('premio.stInclusions')} value={int(r.calcolate)} />
              <Stat label={t('premio.stPolicies')} value={int(r.polizze)} />
              <Stat label={t('premio.stTotal')} value={num(r.totaleGenerale)} />
            </div>
            <p className="premio-note">
              {t('premio.sheetInfo').replace('{sheet}', r.sheet).replace('{row}', String(r.headerRow))}
            </p>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h2 className="premio-card-title">{t('premio.ratesTitle')}</h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="premio-table">
                <thead>
                  <tr>
                    <th>{t('premio.thGaranzia')}</th>
                    <th className="num">{t('premio.thRows')}</th>
                    <th className="num">{t('premio.thRate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.garanzie.map((g) => (
                    <tr key={g.nome}>
                      <td>
                        {g.nome}
                        {!g.inTabella && <span className="premio-tag" title={t('premio.notInTable')}>?</span>}
                      </td>
                      <td className="num">{int(g.righe)}</td>
                      <td className="num premio-rate">{num(g.aliquota * 100, 1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="premio-note">
              {t('premio.movements')}: {r.movimenti.map((m) => `${m.nome} ${int(m.righe)}`).join(' · ')}
            </p>
          </div>

          {r.pareggi.length > 0 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <h2 className="premio-card-title">{t('premio.tiesTitle')}</h2>
              <p style={{ color: 'var(--c-text-secondary)', fontSize: 14, marginTop: 0 }}>
                {t('premio.tiesBody').replace('{n}', String(r.pareggi.length))}
              </p>
              <ul className="premio-list">
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
              <h2 className="premio-card-title">{t('premio.noticesTitle')}</h2>
              <ul className="premio-list">
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
            <h2 className="premio-card-title">{t('premio.checksTitle')}</h2>
            <ul className="premio-checks">
              {[...r.verifica, ...r.rilettura].map((c, i) => (
                <li key={`${c.nome}-${i}`}>
                  <span className={c.ok ? 'premio-check-ok' : 'premio-check-ko'}>{c.ok ? '✓' : '✗'}</span>
                  <span>
                    {c.nome} <span className="premio-check-detail">— {c.dettaglio}</span>
                  </span>
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
      <div className="premio-stat-label">{label}</div>
      <div className="premio-stat-value">{value}</div>
    </div>
  )
}
