'use client'

// Modulo di un'adesione CSA Adesioni Infortuni: i campi sono le colonne del
// BDX (lib/infortuni/rules.js FIELDS), più le 4 risposte del questionario.
// Usato da «Nuova adesione» e dalla modifica in archivio.
import { FIELDS, QUESTIONS, VEHICLE_TYPES, defaultScadenza, optionOf } from '@/lib/infortuni/rules.js'
import { useT } from '@/lib/i18n/I18nProvider'

export type InfRecord = Record<string, unknown> & { questionario?: Record<string, string> }
export interface InfOption { key: string; name: string; premio: string; imposte: string; morte: string; invalidita: string; franchigia: string; speseMediche: string; franchigiaSpese: string }
export interface InfConfig { polizzaCollettiva: string; options: InfOption[]; pagamento: string; mailTo: string; mailCc: string; mailSubject: string; showRagioneSociale?: boolean; showFranchigiaSpese?: boolean; questionarioNumero?: boolean }

type Field = { id: string; type: string; required?: boolean }
const byId = (id: string) => (FIELDS as Field[]).find((f) => f.id === id) as Field

const GROUPS: { key: string; ids: string[] }[] = [
  { key: 'cliente', ids: ['nome', 'cognome', 'data_nascita', 'codice_fiscale', 'email'] },
  { key: 'veicolo', ids: ['targa', 'tipo_veicolo', 'marca', 'modello'] },
  { key: 'copertura', ids: ['data_adesione', 'data_scadenza', 'opzione', 'note'] },
]

export default function InfortuniForm({ config, record, errors, onChange }: {
  config: InfConfig
  record: InfRecord
  errors: Record<string, string>
  onChange: (r: InfRecord) => void
}) {
  const t = useT()
  const set = (id: string, value: string) => {
    const next: InfRecord = { ...record, [id]: value }
    // Scadenza proposta un anno dopo l'adesione, finché l'operatore non la cambia.
    if (id === 'data_adesione') {
      const prevAuto = defaultScadenza(String(record.data_adesione || ''))
      if (!record.data_scadenza || record.data_scadenza === prevAuto) next.data_scadenza = defaultScadenza(value)
    }
    onChange(next)
  }
  const setAnswer = (q: string, v: string) => onChange({ ...record, questionario: { ...(record.questionario || {}), [q]: v } })
  const opt = optionOf(config, record.opzione) as InfOption | null
  const errStyle = (id: string) => (errors[id] ? { borderColor: 'var(--c-error)' } : undefined)

  const input = (id: string) => {
    const f = byId(id)
    const val = String(record[id] ?? '')
    const err = errors[id]
    let control: React.ReactNode
    if (f.type === 'option') {
      control = (
        <select id={`inf-${id}`} value={val} onChange={(e) => set(id, e.target.value)} style={errStyle(id)}>
          <option value="">{t('inf.select')}</option>
          {config.options.map((o) => <option key={o.key} value={o.key}>{t('inf.optLine', { name: o.name, premio: o.premio })}</option>)}
        </select>
      )
    } else if (id === 'note') {
      control = <textarea id={`inf-${id}`} value={val} rows={2} onChange={(e) => set(id, e.target.value)} />
    } else {
      control = (
        <input
          id={`inf-${id}`}
          value={val}
          type={f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text'}
          list={id === 'tipo_veicolo' ? 'inf-vehicle-types' : undefined}
          autoCapitalize={id === 'codice_fiscale' || id === 'targa' ? 'characters' : undefined}
          onChange={(e) => set(id, e.target.value)}
          style={{ ...(errStyle(id) || {}), ...(id === 'codice_fiscale' || id === 'targa' ? { textTransform: 'uppercase' as const, fontFamily: 'var(--font-mono)' } : {}) }}
        />
      )
    }
    return (
      <div className="form-group" key={id} style={{ marginBottom: 12, ...(id === 'note' ? { gridColumn: '1 / -1' } : {}) }}>
        <label className="label" htmlFor={`inf-${id}`}>{t(`inf.f.${id}`)}{f.required ? ' *' : ''}</label>
        {control}
        {err && <span style={{ fontSize: 11, color: 'var(--c-error)' }}>{err}</span>}
        {id === 'data_scadenza' && !err && <span style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{t('inf.scadenzaAuto')}</span>}
        {id === 'opzione' && opt && (
          <span style={{ fontSize: 11, color: 'var(--c-text-secondary)' }}>
            {t('inf.optDetail', { morte: opt.morte, ip: opt.invalidita, fr: opt.franchigia, sm: opt.speseMediche })}
          </span>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <datalist id="inf-vehicle-types">{(VEHICLE_TYPES as string[]).map((v) => <option key={v} value={v} />)}</datalist>
      {GROUPS.map((g) => (
        <div key={g.key} className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{t(`inf.g.${g.key}`)}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
            {g.ids.map(input)}
            {g.key === 'cliente' && config.showRagioneSociale && (
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label className="label" htmlFor="inf-ragione_sociale">{t('inf.f.ragione_sociale')}</label>
                <input id="inf-ragione_sociale" value={String(record.ragione_sociale ?? '')} onChange={(e) => set('ragione_sociale', e.target.value)} />
              </div>
            )}
          </div>
        </div>
      ))}

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t('inf.g.questionario')}</h2>
        <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 0, marginBottom: 14 }}>{t('inf.g.questionarioHint')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {(QUESTIONS as { id: string; text: string }[]).map((q, i) => {
            const err = errors[`questionario.${q.id}`]
            const cur = (record.questionario || {})[q.id] || ''
            return (
              <fieldset key={q.id} style={{ border: 0, padding: 0, margin: 0 }}>
                <legend style={{ fontSize: 13, marginBottom: 6, color: err ? 'var(--c-error)' : 'var(--c-text-primary)' }}>{i + 1}. {q.text} *</legend>
                <div style={{ display: 'flex', gap: 18 }}>
                  {(['SI', 'NO'] as const).map((v) => (
                    <label key={v} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                      <input type="radio" name={`inf-${q.id}`} value={v} checked={cur === v} onChange={() => setAnswer(q.id, v)} />
                      {v === 'SI' ? t('inf.yes') : t('inf.no')}
                    </label>
                  ))}
                </div>
                {err && <span style={{ fontSize: 11, color: 'var(--c-error)' }}>{err}</span>}
              </fieldset>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function Warnings({ items, title }: { items: string[]; title: string }) {
  if (!items.length) return null
  return (
    <div className="alert" style={{ marginTop: 16, borderColor: 'var(--c-warning)', color: 'var(--c-text-primary)' }}>
      <strong style={{ color: 'var(--c-warning)' }}>{title}</strong>
      <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>{items.map((w) => <li key={w} style={{ fontSize: 13 }}>{w}</li>)}</ul>
    </div>
  )
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Nome del file dalla risposta (Content-Disposition), altrimenti quello dato. */
export function fileNameOf(res: Response, fallback: string): string {
  const m = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')
  return m ? m[1] : fallback
}
