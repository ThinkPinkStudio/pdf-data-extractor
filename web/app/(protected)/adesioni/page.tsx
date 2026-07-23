'use client'

import { useEffect, useRef, useState } from 'react'
import AdesioniRecordForm, { type AdesioniRecord } from '@/components/AdesioniRecordForm'
import { defaultAdesioniConfig, type AdesioniConfig } from '@/lib/adesioni/config'
// Moduli puri (browser-safe): validazione e numerazione progressiva.
import { validateRecord } from '@/lib/adesioni/recordMapper.js'
import { nextIdentificativo } from '@/lib/adesioni/numbering.js'

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

  // Precompila i campi 'fixed' quando la config è pronta.
  useEffect(() => {
    setRecord((prev) => {
      const next = { ...prev }
      for (const f of config.fields) if (f.type === 'fixed' && next[f.id] == null) next[f.id] = f.fixed
      return next
    })
  }, [config])

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
      // Suggerimento numerazione progressiva sul prossimo identificativo.
      const cur = String(record.identificativo || '')
      if (cur) setRecord((prev) => ({ ...prev, identificativo: nextIdentificativo(cur) }))
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

      <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={generate} disabled={busy}>
          {busy ? <><span className="spinner" /> Generazione…</> : 'Genera modulo (docx + PDF + tracciato)'}
        </button>
        <button className="btn btn-secondary" onClick={save} disabled={busy}>Salva in archivio</button>
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
