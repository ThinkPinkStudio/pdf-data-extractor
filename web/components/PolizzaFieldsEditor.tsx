'use client'

import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

interface Cell { sheet: string; cell: string }
interface Field {
  id: string
  label: string
  description: string
  type?: string
  sheet?: string
  enabled?: boolean
  cells?: Cell[]
}
interface Profile {
  id: string
  name: string
  fields: Field[]
  promptExtra?: string
  matchKeywords?: string
}

function parseCells(str: string): Cell[] {
  return str
    .split(/[\s,]+/)
    .map((tok) => tok.trim())
    .filter(Boolean)
    .map((tok) => {
      const [sheet, cell] = tok.split(':')
      return cell ? { sheet, cell: cell.toUpperCase() } : null
    })
    .filter((c): c is Cell => !!c)
}
function formatCells(cells?: Cell[]): string {
  return (cells || []).map((c) => `${c.sheet}:${c.cell}`).join(' ')
}
function uid() {
  return 'campo_' + Math.random().toString(36).slice(2, 9)
}

export default function PolizzaFieldsEditor() {
  const t = useT()
  const [fields, setFields] = useState<Field[]>([])
  const [defaults, setDefaults] = useState<Field[]>([])
  const [promptExtra, setPromptExtra] = useState('')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [profileName, setProfileName] = useState('')
  const [profileKeywords, setProfileKeywords] = useState('')
  const [cellText, setCellText] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  // Verifica/qualità (usati dal servizio condiviso): modello fascicolo intero,
  // campi da verificare, passate di consenso, modello arbitro.
  const [wholeDossierModel, setWholeDossierModel] = useState('')
  const [verificaCampi, setVerificaCampi] = useState('')
  const [verificaModel, setVerificaModel] = useState('')
  const [consensusPasses, setConsensusPasses] = useState(3)
  const dragIndex = useRef<number | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/polizza/fields').then((r) => r.json()).catch(() => ({})),
      fetch('/api/settings').then((r) => r.json()).catch(() => ({})),
    ]).then(([f, s]) => {
      setDefaults(f.defaultFields || [])
      setFields((f.fields && f.fields.length ? f.fields : f.defaultFields) || [])
      setPromptExtra(s.polizzaPromptExtra || '')
      setProfiles(s.polizzaProfiles || [])
      setWholeDossierModel(s.polizzaWholeDossierModel || '')
      setVerificaCampi(s.polizzaVerificaCampi || '')
      setVerificaModel(s.polizzaVerificaModel || '')
      setConsensusPasses(s.polizzaConsensusPasses || 3)
      setLoading(false)
    })
  }, [])

  function patch(i: number, p: Partial<Field>) {
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...p } : f)))
    setSaved(false)
  }
  function commitCells(i: number, id: string) {
    if (cellText[id] === undefined) return
    patch(i, { cells: parseCells(cellText[id]) })
    setCellText((prev) => { const n = { ...prev }; delete n[id]; return n })
  }
  function addField() {
    setFields((prev) => [...prev, { id: uid(), label: '', description: '', type: 'text', enabled: true, cells: [] }])
    setSaved(false)
  }
  function copyField(i: number) {
    setFields((prev) => { const f = prev[i]; const copy = { ...f, id: uid(), cells: [...(f.cells || [])] }; const n = [...prev]; n.splice(i + 1, 0, copy); return n })
    setSaved(false)
  }
  function delField(i: number) {
    setFields((prev) => prev.filter((_, idx) => idx !== i)); setSaved(false)
  }
  function resetDefaults() {
    setFields(defaults.map((f) => ({ ...f, cells: [...(f.cells || [])] }))); setSaved(false)
  }
  function onDrop(i: number) {
    const from = dragIndex.current
    dragIndex.current = null
    if (from === null || from === i) return
    setFields((prev) => { const n = [...prev]; const [m] = n.splice(from, 1); n.splice(i, 0, m); return n })
    setSaved(false)
  }

  async function save() {
    await fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        polizzaFields: fields, polizzaPromptExtra: promptExtra,
        polizzaWholeDossierModel: wholeDossierModel, polizzaVerificaCampi: verificaCampi,
        polizzaVerificaModel: verificaModel, polizzaConsensusPasses: consensusPasses,
      }),
    })
    setSaved(true); setTimeout(() => setSaved(false), 2500)
  }

  async function saveProfile() {
    if (!profileName.trim()) return
    const next = [...profiles, { id: String(Date.now()), name: profileName.trim(), fields, promptExtra, matchKeywords: profileKeywords.trim() }]
    setProfiles(next); setProfileName(''); setProfileKeywords('')
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ polizzaProfiles: next }) })
  }
  // Modifica in linea delle parole di abbinamento di un profilo esistente (usate nel
  // bulk per pre-filtro e auto-riconoscimento). Persiste su blur.
  function setProfileKw(id: string, value: string) {
    setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, matchKeywords: value } : p)))
  }
  async function persistProfiles(list: Profile[]) {
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ polizzaProfiles: list }) })
  }
  // Persiste subito i campi/prompt correnti (come fa il desktop): così l'applicazione
  // o l'import di un profilo non va persa uscendo dalla pagina senza premere "Salva".
  async function persistFields(appliedFields: Field[], appliedPrompt: string, extra?: Record<string, unknown>) {
    await fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ polizzaFields: appliedFields, polizzaPromptExtra: appliedPrompt, ...(extra || {}) }),
    })
  }

  async function applyProfile(p: Profile) {
    const applied = (p.fields || []).map((f) => ({ ...f, cells: [...(f.cells || [])] }))
    const prompt = p.promptExtra || ''
    setFields(applied); setPromptExtra(prompt)
    setSaved(true); setTimeout(() => setSaved(false), 2500)
    await persistFields(applied, prompt)
  }
  async function delProfile(id: string) {
    const next = profiles.filter((p) => p.id !== id)
    setProfiles(next)
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ polizzaProfiles: next }) })
  }
  function exportProfiles() {
    const blob = new Blob([JSON.stringify(profiles, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'profili-polizza.json'; a.click()
  }
  async function importProfiles(file: File) {
    try {
      const parsed = JSON.parse(await file.text())
      const arr: Profile[] = Array.isArray(parsed) ? parsed : [parsed]
      const stamped = arr.map((p, i) => ({ ...p, id: String(Date.now() + i) }))
      const next = [...profiles, ...stamped]
      setProfiles(next)
      // Applica l'ultimo profilo e PERSISTE campi+prompt insieme ai profili (come desktop),
      // così l'import non viene perso uscendo dalla pagina.
      const last = stamped[stamped.length - 1]
      const appliedFields = last?.fields?.length ? last.fields.map((f) => ({ ...f, cells: [...(f.cells || [])] })) : fields
      const appliedPrompt = last?.promptExtra ?? promptExtra
      if (last?.fields?.length) { setFields(appliedFields); setPromptExtra(appliedPrompt || '') }
      setSaved(true); setTimeout(() => setSaved(false), 2500)
      await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ polizzaProfiles: next, polizzaFields: appliedFields, polizzaPromptExtra: appliedPrompt || '' }),
      })
    } catch { /* file non valido */ }
  }

  if (loading) return <span className="spinner" />

  return (
    <div className="card">
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t('set.polFieldsTitle')}</h2>
      <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginBottom: 16 }}>{t('set.polFieldsSubtitle')}</p>

      {/* Prompt extra */}
      <div className="form-group">
        <label className="label">{t('set.promptExtra')}</label>
        <textarea value={promptExtra} onChange={(e) => { setPromptExtra(e.target.value); setSaved(false) }} rows={4}
          placeholder={t('set.promptExtraPlaceholder')} style={{ resize: 'vertical', fontSize: 13 }} />
      </div>

      {/* Verifica / qualità estrazione */}
      <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--c-separator)' }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{t('set.qualityTitle')}</h3>
        <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 10 }}>{t('set.qualitySubtitle')}</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="label">{t('set.wholeDossierModel')}</label>
            <input value={wholeDossierModel} onChange={(e) => { setWholeDossierModel(e.target.value); setSaved(false) }}
              placeholder="claude-haiku-4-5-20251001" style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="label">{t('set.consensusPasses')}</label>
            <input type="number" min={2} max={5} value={consensusPasses}
              onChange={(e) => { setConsensusPasses(Math.max(2, Math.min(5, parseInt(e.target.value, 10) || 3))); setSaved(false) }}
              style={{ fontSize: 12 }} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="label">{t('set.verificaCampi')}</label>
            <input value={verificaCampi} onChange={(e) => { setVerificaCampi(e.target.value); setSaved(false) }}
              placeholder={t('set.verificaCampiPlaceholder')} style={{ fontSize: 12 }} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="label">{t('set.verificaModel')}</label>
            <input value={verificaModel} onChange={(e) => { setVerificaModel(e.target.value); setSaved(false) }}
              placeholder="claude-sonnet-4-6" style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }} />
          </div>
        </div>
      </div>

      {/* Header colonne */}
      <div style={{ display: 'grid', gridTemplateColumns: '20px 34px 150px 1fr 150px 30px 30px', gap: 6, alignItems: 'center', padding: '6px 0', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--c-text-muted)', borderBottom: '1px solid var(--c-border)' }}>
        <span /><span /><span>{t('set.colLabel')}</span><span>{t('set.colDescription')}</span><span>{t('set.colCells')}</span><span /><span />
      </div>

      {/* Righe campi */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {fields.map((f, i) => (
          <div key={f.id}
            draggable
            onDragStart={() => { dragIndex.current = i }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(i)}
            style={{ display: 'grid', gridTemplateColumns: '20px 34px 150px 1fr 150px 30px 30px', gap: 6, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--c-separator)' }}>
            <span style={{ cursor: 'grab', color: 'var(--c-text-muted)', textAlign: 'center' }} title="Trascina per riordinare">⋮⋮</span>
            <label style={{ display: 'inline-flex', cursor: 'pointer' }} title={f.enabled !== false ? 'Abilitato' : 'Disabilitato'}>
              <span style={{ width: 30, height: 18, borderRadius: 999, position: 'relative', background: f.enabled !== false ? 'var(--c-accent)' : 'var(--c-bg-card-alt)', border: '1px solid var(--c-border)', transition: 'background .2s' }}>
                <span style={{ position: 'absolute', top: 2, left: f.enabled !== false ? 14 : 2, width: 12, height: 12, borderRadius: '50%', background: f.enabled !== false ? '#fff' : 'var(--c-text-muted)', transition: 'left .2s' }} />
              </span>
              <input type="checkbox" checked={f.enabled !== false} onChange={(e) => patch(i, { enabled: e.target.checked })} style={{ display: 'none' }} />
            </label>
            <input value={f.label} onChange={(e) => patch(i, { label: e.target.value })} placeholder="Etichetta" style={{ fontSize: 12, padding: '5px 7px' }} />
            <input value={f.description} onChange={(e) => patch(i, { description: e.target.value })} placeholder={t('set.colDescription')} style={{ fontSize: 12, padding: '5px 7px' }} />
            <input
              value={cellText[f.id] ?? formatCells(f.cells)}
              onChange={(e) => setCellText((p) => ({ ...p, [f.id]: e.target.value }))}
              onBlur={() => commitCells(i, f.id)}
              placeholder="RCT_O:C3"
              style={{ fontSize: 11, padding: '5px 7px', fontFamily: 'var(--font-mono)' }} />
            <button type="button" onClick={() => copyField(i)} title="Duplica" style={{ padding: 4, background: 'transparent', color: 'var(--c-text-muted)', width: 'auto' }}>⧉</button>
            <button type="button" onClick={() => delField(i)} title="Elimina" style={{ padding: 4, background: 'transparent', color: 'var(--c-error)', width: 'auto' }}>🗑</button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" onClick={addField}>{t('set.addField')}</button>
        <button type="button" className="btn btn-secondary" onClick={resetDefaults}>{t('set.resetDefaults')}</button>
        <button type="button" className="btn btn-primary" onClick={save}>{saved ? t('set.savedShort') : t('set.saveFields')}</button>
      </div>

      {/* Profili */}
      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--c-separator)' }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{t('set.profilesTitle')}</h3>
        {profiles.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {profiles.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--c-bg-card-alt)', borderRadius: 'var(--r-sm)', border: '1px solid var(--c-border)' }}>
                <span style={{ flex: '1 1 140px', fontSize: 13 }}>{p.name} <span style={{ color: 'var(--c-text-muted)', fontSize: 11 }}>({p.fields?.length || 0} campi)</span></span>
                <input value={p.matchKeywords || ''} onChange={(e) => setProfileKw(p.id, e.target.value)} onBlur={() => persistProfiles(profiles)}
                  placeholder={t('set.profileKeywords')} title={t('set.profileKeywordsHelp')} style={{ flex: '1 1 140px', fontSize: 12 }} />
                <button type="button" className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => applyProfile(p)}>{t('set.applyProfile')}</button>
                <button type="button" className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => delProfile(p.id)}>{t('common.cancel')}</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder={t('set.profileName')} style={{ flex: '1 1 140px', fontSize: 13 }} />
          <input value={profileKeywords} onChange={(e) => setProfileKeywords(e.target.value)} placeholder={t('set.profileKeywords')} title={t('set.profileKeywordsHelp')} style={{ flex: '1 1 140px', fontSize: 13 }} />
          <button type="button" className="btn btn-secondary" onClick={saveProfile} disabled={!profileName.trim()}>{t('set.saveProfile')}</button>
          <button type="button" className="btn btn-secondary" onClick={exportProfiles} disabled={!profiles.length}>{t('set.exportJson')}</button>
          <button type="button" className="btn btn-secondary" onClick={() => importRef.current?.click()}>{t('set.importJson')}</button>
          <input ref={importRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importProfiles(f); e.target.value = '' }} />
        </div>
      </div>
    </div>
  )
}
