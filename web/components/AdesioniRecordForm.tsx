'use client'

import type { AdesioniConfig, AdesioniField } from '@/lib/adesioni/config'

export type AdesioniRecord = Record<string, unknown> & { idd?: Record<string, string> }

const GROUP_LABELS: Record<string, string> = {
  polizza: 'Dati polizza',
  contraente: 'Aderente',
  veicolo: 'Veicolo',
  copertura: 'Copertura',
  contatti: 'Contatti',
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
  const set = (id: string, value: unknown) => onChange({ ...record, [id]: value })
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
            <option value="">— seleziona —</option>
            {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <input
            {...common}
            type={f.type === 'email' ? 'email' : f.type === 'number' ? 'text' : 'text'}
            placeholder={f.type === 'date' ? 'GG/MM/AAAA' : ''}
            maxLength={f.maxLength}
            onChange={(e) => set(f.id, e.target.value)}
            style={err ? { borderColor: 'var(--c-error)' } : undefined}
          />
        )}
        {err && <span style={{ fontSize: 11, color: 'var(--c-error)' }}>{errLabel(err, f)}</span>}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {groups.map((g) => (
        <div key={g} className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{GROUP_LABELS[g] || g}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
            {config.fields.filter((f) => f.group === g && f.enabled !== false).map(field)}
          </div>
        </div>
      ))}

      {config.idd.length > 0 && (
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Questionario IDD</h2>
          <p style={{ fontSize: 12, color: isA ? 'var(--c-text-muted)' : 'var(--c-warning)', marginTop: 0, marginBottom: 14 }}>
            {isA ? 'Le risposte finiscono nel tracciato (Tipo movimento = A).' : 'Compilabile, ma le risposte finiscono nel tracciato solo con Tipo movimento = A.'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {config.idd.map((q) => (
              <div className="form-group" key={q.domanda} style={{ margin: 0 }}>
                <label className="label">{q.label}</label>
                <select value={(record.idd || {})[q.domanda] || ''} onChange={(e) => setIdd(q.domanda, e.target.value)}>
                  <option value="">— seleziona —</option>
                  {q.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function errLabel(code: string, f: AdesioniField): string {
  switch (code) {
    case 'required': return 'Campo obbligatorio'
    case 'maxlen': return `Massimo ${f.maxLength} caratteri`
    case 'date': return 'Formato data: GG/MM/AAAA'
    case 'number': return 'Numero non valido'
    case 'email': return 'Email non valida'
    case 'select': return 'Valore non ammesso'
    default: return 'Valore non valido'
  }
}
