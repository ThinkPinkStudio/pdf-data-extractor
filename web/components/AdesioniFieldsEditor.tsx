'use client'

import { defaultAdesioniConfig, type AdesioniField, type AdesioniOption } from '@/lib/adesioni/config'
import { classifyFieldDocx, unmappedPlaceholders } from '@/lib/adesioni/templateScan.js'
import { useT } from '@/lib/i18n/I18nProvider'

const FIELD_TYPES = ['text', 'number', 'date', 'email', 'phone', 'select', 'fixed']
const GROUPS = ['polizza', 'contraente', 'veicolo', 'copertura', 'contatti']

// Editor completo dei campi della maschera (parità col desktop): type/group/
// flussoCol/trackCol/segnaposto docx/options/fixed/required/maxLength + aggiungi/
// elimina/ripristina. `placeholders` popola il datalist dei segnaposto docx.
export default function AdesioniFieldsEditor({
  fields,
  onChange,
  placeholders,
}: {
  fields: AdesioniField[]
  onChange: (f: AdesioniField[]) => void
  placeholders: string[]
}) {
  const t = useT()
  const upd = (i: number, patch: Partial<AdesioniField>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  const del = (i: number) => onChange(fields.filter((_, j) => j !== i))
  const add = () => onChange([...fields, { id: `campo_${Date.now()}`, label: t('ad.fieldsEditor.newField'), group: 'contraente', type: 'text', enabled: true, flussoCol: '', trackCol: '', docx: '' }])

  const parseOptions = (text: string): AdesioniOption[] =>
    text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [value, ...rest] = l.split('=')
      return { value: value.trim(), label: (rest.join('=') || value).trim() }
    })
  const optionsToText = (opts?: AdesioniOption[]) => (opts || []).map((o) => `${o.value}=${o.label}`).join('\n')

  // Badge di stato del "Segnaposto modulo" rispetto al template attivo.
  const badgeFor = (docx: AdesioniField['docx']) => {
    const status = classifyFieldDocx(docx, placeholders) as 'ok' | 'mismatch' | 'unset'
    if (status === 'ok') return { color: 'var(--c-success)', text: t('ad.fieldsEditor.badgeOk') }
    if (status === 'mismatch') return { color: 'var(--c-error)', text: t('ad.fieldsEditor.badgeMismatch') }
    return { color: 'var(--c-text-muted)', text: t('ad.fieldsEditor.badgeUnset') }
  }
  const unmapped = unmappedPlaceholders(placeholders, fields) as string[]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <datalist id="docx-placeholders">
        {placeholders.map((p) => <option key={p} value={p} />)}
      </datalist>

      {fields.map((f, i) => (
        <div key={i} className="card" style={{ background: 'var(--c-bg-card-alt)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 130px 130px auto', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={f.enabled !== false} onChange={(e) => upd(i, { enabled: e.target.checked })} aria-label={t('ad.fieldsEditor.enabled')} title={t('ad.fieldsEditor.enabled')} />
            <input value={f.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder={t('ad.fieldsEditor.label')} aria-label={t('ad.fieldsEditor.label')} />
            <select value={f.type} onChange={(e) => upd(i, { type: e.target.value })} aria-label={t('ad.fieldsEditor.type')}>
              {FIELD_TYPES.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
            </select>
            <select value={f.group || ''} onChange={(e) => upd(i, { group: e.target.value })} aria-label={t('ad.fieldsEditor.group')}>
              {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => del(i)} title={t('ad.fieldsEditor.deleteField')}>✕</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            <label style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{t('ad.fieldsEditor.flussoCol')}
              <input value={f.flussoCol ?? ''} onChange={(e) => upd(i, { flussoCol: e.target.value || null })} placeholder={t('ad.fieldsEditor.none')} />
            </label>
            <label style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{t('ad.fieldsEditor.trackCol')}
              <input value={f.trackCol ?? ''} onChange={(e) => upd(i, { trackCol: e.target.value || null })} placeholder={t('ad.fieldsEditor.none')} />
            </label>
            <label style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{t('ad.fieldsEditor.docx')}
              <input list="docx-placeholders" value={f.docx ?? ''} onChange={(e) => upd(i, { docx: e.target.value || null })} placeholder={t('ad.fieldsEditor.noneM')} />
              <span style={{ display: 'inline-block', marginTop: 3, fontSize: 10, fontWeight: 600, color: badgeFor(f.docx).color }}>● {badgeFor(f.docx).text}</span>
            </label>
          </div>

          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={!!f.required} onChange={(e) => upd(i, { required: e.target.checked })} /> {t('ad.fieldsEditor.required')}
            </label>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>{t('ad.fieldsEditor.max')}
              <input type="number" value={f.maxLength ?? ''} onChange={(e) => upd(i, { maxLength: e.target.value ? parseInt(e.target.value, 10) : undefined })} style={{ width: 80 }} />
            </label>
            {f.type === 'fixed' && (
              <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>{t('ad.fieldsEditor.fixedValue')}
                <input value={f.fixed ?? ''} onChange={(e) => upd(i, { fixed: e.target.value })} style={{ width: 120 }} />
              </label>
            )}
          </div>

          {f.type === 'select' && (
            <label style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{t('ad.fieldsEditor.optionsLabel')} <code>valore=etichetta</code>)
              <textarea rows={3} value={optionsToText(f.options)} onChange={(e) => upd(i, { options: parseOptions(e.target.value) })} style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12 }} />
            </label>
          )}
        </div>
      ))}

      {placeholders.length > 0 && (
        <p style={{ fontSize: 11, color: unmapped.length ? 'var(--c-error)' : 'var(--c-text-muted)', margin: 0 }}>
          {unmapped.length ? <>{t('ad.fieldsEditor.unmappedTitle')} {unmapped.join(', ')}</> : t('ad.fieldsEditor.unmappedNone')}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-secondary" onClick={add}>{t('ad.fieldsEditor.addField')}</button>
        <button className="btn btn-secondary" onClick={() => onChange(defaultAdesioniConfig().fields)}>{t('ad.fieldsEditor.resetDefaults')}</button>
      </div>
    </div>
  )
}
