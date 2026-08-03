'use client'

import { useEffect, useRef, useState } from 'react'
import AdesioniRecordForm, { type AdesioniRecord } from '@/components/AdesioniRecordForm'
import { defaultAdesioniConfig, type AdesioniConfig } from '@/lib/adesioni/config'
// Moduli puri (browser-safe): validazione, numerazione progressiva, premio.
import { validateRecord } from '@/lib/adesioni/recordMapper.js'
import { premioFor, opzioneLabelFor } from '@/lib/adesioni/premioService.js'
import { useT } from '@/lib/i18n/I18nProvider'

type Mode = 'manual' | 'flusso'

export default function AdesioniPage() {
  const t = useT()
  const [config, setConfig] = useState<AdesioniConfig>(defaultAdesioniConfig())
  const [mode, setMode] = useState<Mode>('manual')
  const [record, setRecord] = useState<AdesioniRecord>({ idd: {} })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [flussoRecords, setFlussoRecords] = useState<AdesioniRecord[] | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [numberingNext, setNumberingNext] = useState('')
  const [seed, setSeed] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/adesioni/config').then((r) => r.json()).then((c) => { if (c && c.fields) setConfig(c) }).catch(() => {})
    // Numerazione progressiva CONDIVISA (server-side), non più localStorage.
    fetch('/api/adesioni/numbering').then((r) => r.json()).then((d) => setNumberingNext(d.next || '')).catch(() => {})
  }, [])

  // Precompila i campi 'fixed' quando la config è pronta; se in manuale
  // l'identificativo è vuoto, propone il prossimo numero suggerito (serie condivisa).
  useEffect(() => {
    setRecord((prev) => {
      const next = { ...prev }
      for (const f of config.fields) if (f.type === 'fixed' && next[f.id] == null) next[f.id] = f.fixed
      if (!next.identificativo && numberingNext) next.identificativo = numberingNext
      return next
    })
  }, [config, numberingNext])

  // Premio calcolato dal codice configurazione (mostrato in tempo reale).
  const premio = premioFor(String(record.codice_configurazione ?? ''), config.prezzi, record) as { pacchetto: string; premio: string }
  const opzioneLabel = opzioneLabelFor(String(record.codice_configurazione ?? ''))

  function validateNow(r: AdesioniRecord): boolean {
    const { errors: errs, valid } = validateRecord(r, config.fields, config.idd) as { errors: Record<string, string>; valid: boolean }
    setErrors(errs)
    if (!valid) setMsg({ ok: false, text: t('ad.msg.fixFields') })
    return valid
  }

  async function uploadFlusso(file: File | undefined) {
    if (!file) return
    setBusy(true); setMsg(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/adesioni/flusso', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || t('ad.adesioni.errFlussoRead'))
      setFlussoRecords(data.records || [])
      setSelectedIdx(null)
      setMsg({ ok: true, text: t('ad.adesioni.anagraficheLoaded', { n: data.count }) })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  function pickFlusso(i: number) {
    if (!flussoRecords) return
    setSelectedIdx(i)
    setRecord({ ...flussoRecords[i], idd: (flussoRecords[i].idd as Record<string, string>) || {} })
    setErrors({})
  }

  async function generate() {
    if (!validateNow(record)) return
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/adesioni/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [record], pdf: true }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || t('ad.err.generate')) }
      const blob = await res.blob()
      downloadBlob(blob, 'adesione.zip')
      setMsg({ ok: true, text: t('ad.adesioni.moduleGenerated') })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  // Dopo un salvataggio la serie è già avanzata lato server (se l'identificativo
  // salvato era quello suggerito): rileggiamo il prossimo valore e lo proponiamo.
  async function refreshNumbering() {
    try {
      const d = await (await fetch('/api/adesioni/numbering')).json()
      setNumberingNext(d.next || '')
      if (d.next) setRecord((prev) => ({ ...prev, identificativo: d.next }))
    } catch { /* silenzioso */ }
  }

  // Imposta il numero iniziale/suggerito della serie condivisa (seme manuale).
  async function setStartingNumber() {
    const val = seed.trim()
    if (!val) return
    setBusy(true); setMsg(null)
    try {
      const d = await (await fetch('/api/adesioni/numbering', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ next: val }),
      })).json()
      setNumberingNext(d.next || '')
      setSeed('')
      setRecord((prev) => ({ ...prev, identificativo: d.next || prev.identificativo }))
      setMsg({ ok: true, text: t('ad.adesioni.numberingSaved') })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!validateNow(record)) return
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/adesioni/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || t('ad.err.save'))
      setMsg({ ok: true, text: t('ad.adesioni.recordSaved') })
      await refreshNumbering()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  // Azione unica (come il desktop): salva in archivio E genera i documenti.
  async function generateAndSave() {
    if (!validateNow(record)) return
    setBusy(true); setMsg(null)
    try {
      const sres = await fetch('/api/adesioni/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ record }) })
      const sd = await sres.json()
      if (!sres.ok) throw new Error(sd.error || t('ad.err.save'))
      const gres = await fetch('/api/adesioni/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records: [record], pdf: true }) })
      if (!gres.ok) throw new Error((await gres.json()).error || t('ad.err.generate'))
      downloadBlob(await gres.blob(), 'adesione.zip')
      setMsg({ ok: true, text: t('ad.adesioni.savedAndGenerated') })
      await refreshNumbering()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1 className="page-title">{t('nav.adAdesioni')}</h1>
      <p className="view-subtitle">{t('ad.adesioni.subtitle')}</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <button className={`btn ${mode === 'manual' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('manual')}>{t('ad.adesioni.tabManual')}</button>
        <button className={`btn ${mode === 'flusso' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('flusso')}>{t('ad.adesioni.tabFlusso')}</button>
      </div>

      <div className="card" style={{ marginBottom: 18, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13 }}>
          <span style={{ color: 'var(--c-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 11, fontWeight: 700 }}>{t('ad.adesioni.numberingTitle')}</span>
          <div style={{ marginTop: 2 }}>
            <span style={{ color: 'var(--c-text-secondary)' }}>{t('ad.adesioni.numberingNext')}: </span>
            <strong style={{ color: 'var(--c-accent)', fontFamily: 'var(--font-mono)' }}>{numberingNext || t('ad.adesioni.numberingNone')}</strong>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
          <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder={t('ad.adesioni.numberingSeedPlaceholder')} style={{ width: 170 }} />
          <button className="btn btn-secondary" onClick={setStartingNumber} disabled={busy || !seed.trim()}>{t('ad.adesioni.numberingSet')}</button>
        </div>
      </div>

      {mode === 'flusso' && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy}>{t('ad.adesioni.loadFlusso')}</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm" style={{ display: 'none' }} onChange={(e) => uploadFlusso(e.target.files?.[0])} />
            {flussoRecords && (
              <select value={selectedIdx ?? ''} onChange={(e) => pickFlusso(Number(e.target.value))} style={{ minWidth: 260 }}>
                <option value="">{t('ad.adesioni.selectAnagrafica', { n: flussoRecords.length })}</option>
                {flussoRecords.map((r, i) => (
                  <option key={i} value={i}>{`${i + 1}. ${r.cognome || ''} ${r.nome || ''} — ${r.targa || ''}`.trim()}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      <AdesioniRecordForm config={config} record={record} errors={errors} onChange={setRecord} />

      {(premio.premio || premio.pacchetto) && (
        <div className="card" style={{ marginTop: 16, display: 'flex', gap: 24, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--c-text-secondary)' }}>{t('ad.adesioni.pacchetto')}: <strong style={{ color: 'var(--c-text-primary)' }}>{premio.pacchetto || '—'}</strong></span>
          <span style={{ fontSize: 13, color: 'var(--c-text-secondary)' }}>{t('ad.adesioni.premio')}: <strong style={{ color: 'var(--c-accent)' }}>€ {premio.premio || '—'}</strong></span>
          {opzioneLabel && <span style={{ fontSize: 13, color: 'var(--c-text-secondary)' }}>{opzioneLabel}</span>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={generateAndSave} disabled={busy}>
          {busy ? <><span className="spinner" /> {t('ad.adesioni.processing')}</> : t('ad.adesioni.generateAndSave')}
        </button>
        <button className="btn btn-secondary" onClick={generate} disabled={busy}>{t('ad.adesioni.onlyGenerate')}</button>
        <button className="btn btn-secondary" onClick={save} disabled={busy}>{t('ad.adesioni.onlySave')}</button>
      </div>
    </>
  )
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
