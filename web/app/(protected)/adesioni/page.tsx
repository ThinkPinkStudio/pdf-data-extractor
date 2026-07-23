'use client'

import { useEffect, useRef, useState } from 'react'
import AdesioniRecordForm, { type AdesioniRecord } from '@/components/AdesioniRecordForm'
import { defaultAdesioniConfig, type AdesioniConfig } from '@/lib/adesioni/config'
// Moduli puri (browser-safe): validazione, numerazione progressiva, premio.
import { validateRecord } from '@/lib/adesioni/recordMapper.js'
import { nextIdentificativo } from '@/lib/adesioni/numbering.js'
import { premioFor } from '@/lib/adesioni/premioService.js'

const NUM_KEY = 'adesioni_next_id'

type Mode = 'manual' | 'flusso'

export default function AdesioniPage() {
  const [config, setConfig] = useState<AdesioniConfig>(defaultAdesioniConfig())
  const [mode, setMode] = useState<Mode>('manual')
  const [record, setRecord] = useState<AdesioniRecord>({ idd: {} })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [flussoRecords, setFlussoRecords] = useState<AdesioniRecord[] | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/adesioni/config').then((r) => r.json()).then((c) => { if (c && c.fields) setConfig(c) }).catch(() => {})
  }, [])

  // Precompila i campi 'fixed' quando la config è pronta; se in manuale l'identificativo
  // è vuoto, propone il prossimo numero suggerito (persistito nel browser).
  useEffect(() => {
    setRecord((prev) => {
      const next = { ...prev }
      for (const f of config.fields) if (f.type === 'fixed' && next[f.id] == null) next[f.id] = f.fixed
      if (!next.identificativo) {
        const suggested = typeof window !== 'undefined' ? localStorage.getItem(NUM_KEY) : null
        if (suggested) next.identificativo = suggested
      }
      return next
    })
  }, [config])

  // Premio calcolato dal codice configurazione (mostrato in tempo reale).
  const premio = premioFor(String(record.codice_configurazione ?? ''), config.prezzi, record) as { pacchetto: string; premio: string }

  function validateNow(r: AdesioniRecord): boolean {
    const { errors: errs, valid } = validateRecord(r, config.fields) as { errors: Record<string, string>; valid: boolean }
    setErrors(errs)
    if (!valid) setMsg({ ok: false, text: 'Correggi i campi evidenziati.' })
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
      if (!res.ok) throw new Error(data.error || 'Errore lettura flusso')
      setFlussoRecords(data.records || [])
      setSelectedIdx(null)
      setMsg({ ok: true, text: `${data.count} anagrafiche caricate dal flusso.` })
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
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Errore generazione') }
      const blob = await res.blob()
      downloadBlob(blob, 'adesione.zip')
      setMsg({ ok: true, text: 'Modulo generato (docx + PDF + tracciato).' })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  // Numerazione progressiva: avanza il suggerimento e lo persiste nel browser.
  function advanceNumbering() {
    const cur = String(record.identificativo || '')
    if (cur) {
      const nxt = nextIdentificativo(cur)
      localStorage.setItem(NUM_KEY, nxt)
      setRecord((prev) => ({ ...prev, identificativo: nxt }))
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
      if (!res.ok) throw new Error(d.error || 'Errore salvataggio')
      setMsg({ ok: true, text: 'Record salvato in archivio.' })
      advanceNumbering()
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
      if (!sres.ok) throw new Error(sd.error || 'Errore salvataggio')
      const gres = await fetch('/api/adesioni/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records: [record], pdf: true }) })
      if (!gres.ok) throw new Error((await gres.json()).error || 'Errore generazione')
      downloadBlob(await gres.blob(), 'adesione.zip')
      setMsg({ ok: true, text: 'Record salvato e documenti generati (docx + PDF + tracciato).' })
      advanceNumbering()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1 className="page-title">Adesioni</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <button className={`btn ${mode === 'manual' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('manual')}>Inserimento manuale</button>
        <button className={`btn ${mode === 'flusso' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('flusso')}>Importa flusso Excel</button>
      </div>

      {mode === 'flusso' && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy}>Carica flusso .xlsx</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm" style={{ display: 'none' }} onChange={(e) => uploadFlusso(e.target.files?.[0])} />
            {flussoRecords && (
              <select value={selectedIdx ?? ''} onChange={(e) => pickFlusso(Number(e.target.value))} style={{ minWidth: 260 }}>
                <option value="">— seleziona anagrafica ({flussoRecords.length}) —</option>
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
          <span style={{ fontSize: 13, color: 'var(--c-text-secondary)' }}>Pacchetto: <strong style={{ color: 'var(--c-text-primary)' }}>{premio.pacchetto || '—'}</strong></span>
          <span style={{ fontSize: 13, color: 'var(--c-text-secondary)' }}>Premio: <strong style={{ color: 'var(--c-accent)' }}>€ {premio.premio || '—'}</strong></span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={generateAndSave} disabled={busy}>
          {busy ? <><span className="spinner" /> Elaborazione…</> : 'Genera e salva'}
        </button>
        <button className="btn btn-secondary" onClick={generate} disabled={busy}>Solo genera (docx + PDF + tracciato)</button>
        <button className="btn btn-secondary" onClick={save} disabled={busy}>Solo salva in archivio</button>
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
