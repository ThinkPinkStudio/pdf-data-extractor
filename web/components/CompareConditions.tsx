'use client'

import { useCompare } from '@/lib/compare/CompareProvider'
import { workbookColumns, TRANSFORM_OPTIONS, type Condition, type CondMode } from '@/lib/compare/engine'

// Editor di una lista di condizioni (colonna A/B, foglio, modalità, trasformazione,
// connettore AND/OR). Condiviso tra Ricerca e In Entrambi. Le colonne disponibili
// sono derivate dai file caricati; se non caricati, si usa un input libero.
export default function CompareConditions({
  conditions,
  onChange,
  modes,
}: {
  conditions: Condition[]
  onChange: (c: Condition[]) => void
  modes: { value: CondMode; label: string }[]
}) {
  const { fileA, fileB } = useCompare()

  function update(i: number, patch: Partial<Condition>) {
    const next = conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c))
    onChange(next)
  }
  function remove(i: number) {
    const next = conditions.filter((_, idx) => idx !== i)
    onChange(next.length ? next : [{ columnA: '', columnB: '', sheetA: '', sheetB: '', mode: modes[0].value, transform: 'none', connector: 'AND' }])
  }
  function add() {
    onChange([...conditions, { columnA: '', columnB: '', sheetA: '', sheetB: '', mode: modes[0].value, transform: 'none', connector: 'AND' }])
  }

  const colsA = workbookColumns(fileA?.wb ?? null)
  const colsB = workbookColumns(fileB?.wb ?? null)

  const ColSelect = ({ value, cols, onSet }: { value: string; cols: string[]; onSet: (v: string) => void }) =>
    cols.length ? (
      <select value={value} onChange={(e) => onSet(e.target.value)}>
        <option value="">— seleziona colonna —</option>
        {cols.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    ) : (
      <input value={value} onChange={(e) => onSet(e.target.value)} placeholder="Nome colonna" />
    )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {conditions.map((cond, i) => (
        <div key={i}>
          {i > 0 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '4px 0' }}>
              <button type="button" className={`btn ${cond.connector !== 'OR' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: 12, padding: '3px 12px' }} onClick={() => update(i, { connector: 'AND' })}>E</button>
              <button type="button" className={`btn ${cond.connector === 'OR' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: 12, padding: '3px 12px' }} onClick={() => update(i, { connector: 'OR' })}>O</button>
            </div>
          )}
          <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr)) auto', gap: 10, alignItems: 'end' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="label">Colonna A</label>
              <ColSelect value={cond.columnA} cols={colsA} onSet={(v) => update(i, { columnA: v })} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="label">Colonna B</label>
              <ColSelect value={cond.columnB} cols={colsB} onSet={(v) => update(i, { columnB: v })} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="label">Modalità</label>
              <select value={cond.mode} onChange={(e) => update(i, { mode: e.target.value as CondMode })}>
                {modes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="label">Trasformazione</label>
              <select value={cond.transform || 'none'} onChange={(e) => update(i, { transform: e.target.value as Condition['transform'] })}>
                {TRANSFORM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <button type="button" className="btn btn-secondary" style={{ padding: '6px 10px' }} onClick={() => remove(i)} title="Rimuovi">✕</button>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={add}>+ Aggiungi condizione</button>
    </div>
  )
}
