'use client'

import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

interface Field { id: string; label: string; description?: string; type?: string; enabled?: boolean }
interface Profile { id: string; name: string; fields: Field[] }

function uid() { return 'campo_' + Math.random().toString(36).slice(2, 9) }

// Editor dei Campi/Profili di estrazione GENERICI (pagina Estrattore), come nel desktop.
// Salva `extractions` e `profiles` nelle impostazioni; l'Estrattore può poi caricare
// un profilo per precompilare i campi da estrarre.
export default function GenericFieldsEditor() {
  const t = useT()
  const [fields, setFields] = useState<Field[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [profileName, setProfileName] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const dragIndex = useRef<number | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((s) => {
      setFields(s.extractions || [])
      setProfiles(s.profiles || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  function patch(i: number, p: Partial<Field>) { setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...p } : f))); setSaved(false) }
  function addField() { setFields((prev) => [...prev, { id: uid(), label: '', description: '', type: 'text', enabled: true }]); setSaved(false) }
  function delField(i: number) { setFields((prev) => prev.filter((_, idx) => idx !== i)); setSaved(false) }
  function onDrop(i: number) {
    const from = dragIndex.current; dragIndex.current = null
    if (from === null || from === i) return
    setFields((prev) => { const n = [...prev]; const [m] = n.splice(from, 1); n.splice(i, 0, m); return n }); setSaved(false)
  }

  async function persist(extra: Record<string, unknown>) {
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(extra) })
  }
  async function save() { await persist({ extractions: fields }); setSaved(true); setTimeout(() => setSaved(false), 2500) }
  async function saveProfile() {
    if (!profileName.trim()) return
    const next = [...profiles, { id: String(Date.now()), name: profileName.trim(), fields }]
    setProfiles(next); setProfileName(''); await persist({ profiles: next })
  }
  async function applyProfile(p: Profile) {
    const applied = (p.fields || []).map((f) => ({ ...f }))
    setFields(applied); setSaved(true); setTimeout(() => setSaved(false), 2500)
    await persist({ extractions: applied })
  }
  async function delProfile(id: string) { const next = profiles.filter((p) => p.id !== id); setProfiles(next); await persist({ profiles: next }) }
  function exportProfiles() {
    const blob = new Blob([JSON.stringify(profiles, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'profili-estrazione.json'; a.click()
  }
  async function importProfiles(file: File) {
    try {
      const parsed = JSON.parse(await file.text())
      const arr: Profile[] = Array.isArray(parsed) ? parsed : [parsed]
      const stamped = arr.map((p, i) => ({ ...p, id: String(Date.now() + i) }))
      const next = [...profiles, ...stamped]
      setProfiles(next)
      const last = stamped[stamped.length - 1]
      const applied = last?.fields?.length ? last.fields.map((f) => ({ ...f })) : fields
      if (last?.fields?.length) setFields(applied)
      setSaved(true); setTimeout(() => setSaved(false), 2500)
      await persist({ profiles: next, extractions: applied })
    } catch { /* file non valido */ }
  }

  if (loading) return null

  return (
    <div className="card">
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t('set.genericTitle')}</h2>
      <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginBottom: 16 }}>{t('set.genericSubtitle')}</p>

      <div style={{ display: 'grid', gridTemplateColumns: '20px 34px 160px 1fr 30px', gap: 6, alignItems: 'center', padding: '6px 0', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--c-text-muted)', borderBottom: '1px solid var(--c-border)' }}>
        <span /><span /><span>{t('set.colLabel')}</span><span>{t('set.colDescription')}</span><span />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {fields.map((f, i) => (
          <div key={f.id} draggable onDragStart={() => { dragIndex.current = i }} onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(i)}
            style={{ display: 'grid', gridTemplateColumns: '20px 34px 160px 1fr 30px', gap: 6, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--c-separator)' }}>
            <span style={{ cursor: 'grab', color: 'var(--c-text-muted)', textAlign: 'center' }} title="Trascina per riordinare">⋮⋮</span>
            <label style={{ display: 'inline-flex', cursor: 'pointer' }}>
              <span style={{ width: 30, height: 18, borderRadius: 999, position: 'relative', background: f.enabled !== false ? 'var(--c-accent)' : 'var(--c-bg-card-alt)', border: '1px solid var(--c-border)' }}>
                <span style={{ position: 'absolute', top: 2, left: f.enabled !== false ? 14 : 2, width: 12, height: 12, borderRadius: '50%', background: f.enabled !== false ? '#fff' : 'var(--c-text-muted)', transition: 'left .2s' }} />
              </span>
              <input type="checkbox" checked={f.enabled !== false} onChange={(e) => patch(i, { enabled: e.target.checked })} style={{ display: 'none' }} />
            </label>
            <input value={f.label} onChange={(e) => patch(i, { label: e.target.value })} placeholder={t('set.colLabel')} style={{ fontSize: 12, padding: '5px 7px' }} />
            <input value={f.description || ''} onChange={(e) => patch(i, { description: e.target.value })} placeholder={t('set.colDescription')} style={{ fontSize: 12, padding: '5px 7px' }} />
            <button type="button" onClick={() => delField(i)} title="Elimina" style={{ padding: 4, background: 'transparent', color: 'var(--c-error)', width: 'auto' }}>🗑</button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" onClick={addField}>{t('set.addField')}</button>
        <button type="button" className="btn btn-primary" onClick={save}>{saved ? t('set.savedShort') : t('set.saveFields')}</button>
      </div>

      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--c-separator)' }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{t('set.profilesTitle')}</h3>
        {profiles.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {profiles.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--c-bg-card-alt)', borderRadius: 'var(--r-sm)', border: '1px solid var(--c-border)' }}>
                <span style={{ flex: 1, fontSize: 13 }}>{p.name} <span style={{ color: 'var(--c-text-muted)', fontSize: 11 }}>({p.fields?.length || 0} campi)</span></span>
                <button type="button" className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => applyProfile(p)}>{t('set.applyProfile')}</button>
                <button type="button" className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => delProfile(p.id)}>{t('common.cancel')}</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder={t('set.profileName')} style={{ flex: '1 1 160px', fontSize: 13 }} />
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
