'use client'

import { useCompare } from '@/lib/compare/CompareProvider'
import { workbookColumns, TRANSFORM_OPTIONS, type Condition, type CondMode, type Workbook } from '@/lib/compare/engine'

// Editor di una lista di condizioni (colonna A/B, foglio A/B, modalità,
// trasformazione, connettore AND/OR). Condiviso tra Ricerca e In Entrambi. Le
// colonne disponibili derivano dal foglio scelto dei file caricati; se non
// caricati, si usa un input libero. Il selettore Foglio è SEMPRE presente (come
// nel desktop): con file assente o mono-foglio mostra solo "(1° foglio)".
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
    onChange(conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  }
  function remove(i: number) {
    const next = conditions.filter((_, idx) => idx !== i)
    onChange(next.length ? next : [{ columnA: '', columnB: '', sheetA: '', sheetB: '', mode: modes[0].value, transform: 'none', connector: 'AND' }])
  }
  function add() {
    onChange([...conditions, { columnA: '', columnB: '', sheetA: '', sheetB: '', mode: modes[0].value, transform: 'none', connector: 'AND' }])
  }

  const SheetSelect = ({ wb, side, value, onSet }: { wb: Workbook | null; side: 'A' | 'B'; value: string; onSet: (v: string) => void }) => (
    <div className="form-group" style={{ margin: 0 }}>
      <label className="label">Foglio {side} (opz.)</label>
      <select value={value} onChange={(e) => onSet(e.target.value)} disabled={!wb}>
        <option value="">(1° foglio)</option>
        {wb?.sheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  )

  const ColSelect = ({ wb, sheet, value, onSet }: { wb: Workbook | null; sheet?: string; value: string; onSet: (v: string) => void }) => {
    const cols = workbookColumns(wb, sheet)
    return cols.length ? (
      <select value={value} onChange={(e) => onSet(e.target.value)}>
        <option value="">— seleziona colonna —</option>
        {cols.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    ) : (
      <input value={value} onChange={(e) => onSet(e.target.value)} placeholder="Nome colonna" />
    )
  }

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
          <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr)) auto', gap: 10, alignItems: 'end', overflowX: 'auto' }}>
            <SheetSelect wb={fileA?.wb ?? null} side="A" value={cond.sheetA || ''} onSet={(v) => update(i, { sheetA: v })} />
            <div className="form-group" style={{ margin: 0 }}>
              <label className="label">Colonna File A</label>
              <ColSelect wb={fileA?.wb ?? null} sheet={cond.sheetA} value={cond.columnA} onSet={(v) => update(i, { columnA: v })} />
            </div>
            <SheetSelect wb={fileB?.wb ?? null} side="B" value={cond.sheetB || ''} onSet={(v) => update(i, { sheetB: v })} />
            <div className="form-group" style={{ margin: 0 }}>
              <label className="label">Colonna File B</label>
              <ColSelect wb={fileB?.wb ?? null} sheet={cond.sheetB} value={cond.columnB} onSet={(v) => update(i, { columnB: v })} />
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
