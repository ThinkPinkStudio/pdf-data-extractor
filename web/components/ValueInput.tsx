'use client'

// Casella di un VALORE CONFIGURABILE (web/lib/configValue.js): importo fisso,
// oppure percentuale / per mille della somma di altri campi scelti da un
// elenco. Compatta: un menu del tipo, il numero, e per le percentuali le basi
// come caselle da spuntare. Usata da RSM e Vita.
import { useState } from 'react'
import NumInput from '@/components/rsm/NumInput'
import { normValue } from '@/lib/configValue.js'

export interface ValueBase { key: string; label: string }
export type ConfigValue = { mode: 'fisso'; value: number } | { mode: 'percentuale' | 'permille'; value: number; of: string[] }

export default function ValueInput({ value, onChange, bases, legacy, disabled, label, width = 80, allowFixed = true, unit = '€' }: {
  value: unknown
  onChange: (v: ConfigValue) => void
  /** campi di cui può essere percentuale (vuoto = solo importo fisso) */
  bases: ValueBase[]
  /** come leggere un numero semplice delle configurazioni vecchie */
  legacy?: { mode: 'percentuale' | 'permille'; of: string[] }
  disabled?: boolean
  label?: string
  width?: number
  allowFixed?: boolean
  /** unità dell'importo fisso (€, giorni, anni…) */
  unit?: string
}) {
  const v = normValue(value, legacy) as ConfigValue
  const [open, setOpen] = useState(false)
  const of = v.mode === 'fisso' ? [] : v.of
  const setMode = (mode: ConfigValue['mode']) => {
    if (mode === 'fisso') onChange({ mode, value: v.value })
    else onChange({ mode, value: v.value, of: of.length ? of : bases.slice(0, 1).map((b) => b.key) })
  }
  const toggle = (k: string) => {
    if (v.mode === 'fisso') return
    const next = of.includes(k) ? of.filter((x) => x !== k) : [...of, k]
    onChange({ ...v, of: next })
  }
  const baseText = of.map((k) => bases.find((b) => b.key === k)?.label || k).join(' + ') || 'scegli'
  return (
    <span className="cv-input" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', position: 'relative' }}>
      <NumInput value={v.value} onChange={(n) => onChange({ ...v, value: n } as ConfigValue)} width={width} disabled={disabled} label={label} />
      {(bases.length > 0 || !allowFixed) ? (
        <select aria-label={label ? `${label}: tipo` : 'Tipo di valore'} disabled={disabled} value={v.mode} onChange={(e) => setMode(e.target.value as ConfigValue['mode'])}
          style={{ width: 'auto', height: 30, padding: '0 6px', fontSize: 12 }}>
          {allowFixed && <option value="fisso">{unit}</option>}
          {bases.length > 0 && <option value="percentuale">%</option>}
          {bases.length > 0 && <option value="permille">‰</option>}
        </select>
      ) : <span className="rsm-muted" style={{ fontSize: 12 }}>{unit}</span>}
      {v.mode !== 'fisso' && (
        <>
          <button type="button" className="rsm-mini" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-expanded={open}
            title="Di quali campi" style={{ fontSize: 12 }}>di {baseText} ▾</button>
          {open && (
            <span role="group" aria-label="Campi di cui è la percentuale"
              style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, background: 'var(--c-surface, #fff)', border: '1px solid var(--c-border, #ccc)', borderRadius: 8, padding: 8, display: 'grid', gap: 4, minWidth: 200, boxShadow: '0 4px 16px rgba(0,0,0,.15)' }}>
              {bases.map((b) => (
                <label key={b.key} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" checked={of.includes(b.key)} disabled={disabled} onChange={() => toggle(b.key)} /> {b.label}
                </label>
              ))}
              <button type="button" className="rsm-mini" onClick={() => setOpen(false)}>Fatto</button>
            </span>
          )}
        </>
      )}
    </span>
  )
}
