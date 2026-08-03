'use client'

import type { AdesioniConfig, AdesioniField } from '@/lib/adesioni/config'
import { firstOfMonthIT } from '@/lib/adesioni/coverageDates.js'
import { iddErrorKey } from '@/lib/adesioni/recordMapper.js'
import { useT } from '@/lib/i18n/I18nProvider'

export type AdesioniRecord = Record<string, unknown> & { idd?: Record<string, string> }

const GROUP_LABEL_KEYS: Record<string, string> = {
  polizza: 'ad.form.groupPolizza',
  contraente: 'ad.form.groupContraente',
  veicolo: 'ad.form.groupVeicolo',
  copertura: 'ad.form.groupCopertura',
  contatti: 'ad.form.groupContatti',
}
const GROUP_ORDER = ['polizza', 'contraente', 'veicolo', 'copertura', 'contatti']

export default function AdesioniRecordForm({
  config,
  record,
  errors,
  onChange,
}: {
  config: AdesioniConfig
  record: AdesioniRecord
  errors: Record<string, string>
  onChange: (r: AdesioniRecord) => void
}) {
  const t = useT()
  const set = (id: string, value: unknown) => {
    const next: AdesioniRecord = { ...record, [id]: value }
    // La data di rendicontazione è sempre il primo giorno del mese della data effetto.
    if (id === 'data_inizio') next.data_rendicontazione = firstOfMonthIT(String(value ?? ''))
    onChange(next)
  }
  const setIdd = (domanda: string, value: string) => onChange({ ...record, idd: { ...(record.idd || {}), [domanda]: value } })

  const isA = String(record.tipo_movimento || '').toUpperCase() === 'A'
  const groups = GROUP_ORDER.filter((g) => config.fields.some((f) => f.group === g && f.enabled !== false))

  const field = (f: AdesioniField) => {
    const val = f.type === 'fixed' ? (f.fixed ?? '') : (record[f.id] ?? '')
    const err = errors[f.id]
    const common = { value: String(val ?? ''), disabled: f.type === 'fixed' }
    return (
      <div className="form-group" key={f.id} style={{ marginBottom: 12 }}>
        <label className="label">
          {f.label}{f.required ? ' *' : ''}
        </label>
        {f.type === 'select' ? (
          <select {...common} onChange={(e) => set(f.id, e.target.value)} style={err ? { borderColor: 'var(--c-error)' } : undefined}>
            <option value="">{t('set.selectPlaceholder')}</option>
            {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <input
            {...common}
            type={f.type === 'email' ? 'email' : f.type === 'number' ? 'text' : 'text'}
            placeholder={f.type === 'date' ? t('ad.form.datePlaceholder') : ''}
            maxLength={f.maxLength}
            onChange={(e) => set(f.id, e.target.value)}
            style={err ? { borderColor: 'var(--c-error)' } : undefined}
          />
        )}
        {err && <span style={{ fontSize: 11, color: 'var(--c-error)' }}>{errLabel(err, f, t)}</span>}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {groups.map((g) => (
        <div key={g} className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{GROUP_LABEL_KEYS[g] ? t(GROUP_LABEL_KEYS[g]) : g}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
            {config.fields.filter((f) => f.group === g && f.enabled !== false).map(field)}
          </div>
        </div>
      ))}

      {config.idd.length > 0 && (
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t('ad.form.iddTitle')}</h2>
          <p style={{ fontSize: 12, color: isA ? 'var(--c-text-muted)' : 'var(--c-warning)', marginTop: 0, marginBottom: 14 }}>
            {isA ? t('ad.form.iddNoteA') : t('ad.form.iddNoteNotA')}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {config.idd.map((q) => {
              const err = errors[iddErrorKey(q.domanda)]
              return (
                <div className="form-group" key={q.domanda} style={{ margin: 0 }}>
                  <label className="label">{q.label}{isA ? ' *' : ''}</label>
                  <select
                    value={(record.idd || {})[q.domanda] || ''}
                    onChange={(e) => setIdd(q.domanda, e.target.value)}
                    style={err ? { borderColor: 'var(--c-error)' } : undefined}
                  >
                    <option value="">{t('set.selectPlaceholder')}</option>
                    {q.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {err && <span style={{ fontSize: 11, color: 'var(--c-error)' }}>{err === 'select' ? t('ad.form.errSelect') : t('ad.form.errRequired')}</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function errLabel(code: string, f: AdesioniField, t: (key: string, vars?: Record<string, string | number>) => string): string {
  switch (code) {
    case 'required': return t('ad.form.errRequired')
    case 'maxlen': return t('ad.form.errMaxlen', { n: f.maxLength ?? 0 })
    case 'date': return t('ad.form.errDate')
    case 'number': return t('ad.form.errNumber')
    case 'email': return t('ad.form.errEmail')
    case 'select': return t('ad.form.errSelect')
    default: return t('ad.form.errDefault')
  }
}
