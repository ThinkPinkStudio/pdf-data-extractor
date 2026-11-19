'use client'

// Import guidato, passo 2: le colonne del file e i codici di categoria e
// legame, indicati una volta per società e ricordati (config.fileLayout).
import { useI18n } from '@/lib/i18n/I18nProvider'
import { LAYOUT_FIELDS } from '@/lib/rsm/rules.js'
import type { RsmCategory } from '@/lib/rsm/types'

export interface MapCol { col: number; head: string; norm: string; field: string | null; auto: string | null; saved: boolean; samples: string[]; values: string[] }

/** Colonne indispensabili: senza, nessuna riga si può leggere. */
export function missingFields(cols: MapCol[], categorySheets: boolean): string[] {
  const has = (f: string) => cols.some((c) => c.field === f)
  const need = ['cognome', 'nome', 'cfAss', 'legame', ...(categorySheets ? [] : ['categoria'])]
  return need.filter((f) => !has(f))
}

export function ColumnMap({ cols, setCols, cats, catCodes, setCatCodes, legCodes, setLegCodes, guessed, categorySheets, open, setOpen }: {
  cols: MapCol[]; setCols: (c: MapCol[]) => void
  cats: RsmCategory[]
  catCodes: Record<string, string>; setCatCodes: (c: Record<string, string>) => void
  legCodes: Record<string, string>; setLegCodes: (c: Record<string, string>) => void
  guessed: boolean; categorySheets: boolean; open: boolean; setOpen: (o: boolean) => void
}) {
  const { t } = useI18n()
  const missing = missingFields(cols, categorySheets)
  const catCol = cols.find((c) => c.field === 'categoria')
  const legCol = cols.find((c) => c.field === 'legame')
  const catVals = catCol ? catCol.values : []
  const legVals = legCol ? legCol.values : []
  const todoCodes = (categorySheets ? 0 : catVals.filter((v) => !catCodes[v]).length) + legVals.filter((v) => !legCodes[v]).length
  const todoCols = cols.filter((c) => !c.field).length
  const set = (col: number, field: string) => setCols(cols.map((c) => (c.col === col ? { ...c, field: field || null } : c)))
  const pill = (c: MapCol) => !c.field ? <span className="rsm-pill warn">{t('rsm.col.todo')}</span>
    : c.field === 'extra' ? <span className="rsm-pill new">{t('rsm.col.export')}</span>
    : c.field === 'skip' ? <span className="rsm-pill off">{t('rsm.f.skip')}</span>
    : c.saved && c.field === c.auto ? <span className="rsm-pill ok">{t('rsm.col.saved')}</span>
    : c.field === c.auto ? <span className="rsm-pill ok">{t('rsm.col.ok')}</span> : <span className="rsm-pill promo">{t(`rsm.f.${c.field}`)}</span>
  return (
    <div className="rsm-box">
      <div className="rsm-box-head">
        <div>
          <div className="rsm-box-title">{t('rsm.col.title')}</div>
          <span className="rsm-note">{t('rsm.col.hint')}</span>
        </div>
        <button className="btn btn-secondary" onClick={() => setOpen(!open)}>{open ? '▴' : '▾'} {cols.length - todoCols}/{cols.length}</button>
      </div>
      <div className="rsm-box-body">
        {guessed && <div className="rsm-issue warning">{t('rsm.col.guessed')}</div>}
        {missing.length > 0 && <div className="rsm-issue error">{t('rsm.col.missing', { f: missing.map((f) => t(`rsm.f.${f}`)).join(', ') })}</div>}
        {todoCodes > 0 && <div className="rsm-issue warning">{t('rsm.col.codesTodo', { n: todoCodes })}</div>}
        {open && (
          <div className="rsm-scroll">
            <table className="rsm-table rsm-colmap">
              <thead><tr><th>{t('rsm.col.head')}</th><th>{t('rsm.col.sample')}</th><th>{t('rsm.col.is')}</th><th /></tr></thead>
              <tbody>
                {cols.map((c) => (
                  <tr key={c.col} className={!c.field ? 'todo' : undefined}>
                    <td><b>{c.head}</b></td>
                    <td className="rsm-sub">{c.samples.join(' · ')}</td>
                    <td>
                      <select value={c.field || ''} onChange={(e) => set(c.col, e.target.value)} aria-label={`${c.head}: ${t('rsm.col.is')}`}>
                        <option value="">{t('rsm.f.none')}</option>
                        {LAYOUT_FIELDS.map((f: string) => <option key={f} value={f}>{t(`rsm.f.${f}`)}</option>)}
                        <option value="extra">{t('rsm.f.extra')}</option>
                        <option value="skip">{t('rsm.f.skip')}</option>
                      </select>
                    </td>
                    <td>{pill(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(open || todoCodes > 0) && catCol && !categorySheets && catVals.length > 0 && (
          <CodeTable title={t('rsm.col.cats', { c: catCol.head })} values={catVals} codes={catCodes} setCodes={setCatCodes}
            options={cats.flatMap((c) => [{ v: c.key, l: c.label }, { v: `${c.key}|Q`, l: t('rsm.col.quiesc', { c: c.label }) }])} />
        )}
        {(open || todoCodes > 0) && legCol && legVals.length > 0 && (
          <CodeTable title={t('rsm.col.legs', { c: legCol.head })} values={legVals} codes={legCodes} setCodes={setLegCodes}
            options={(['TI', 'CO', 'FI', 'FA'] as const).map((k) => ({ v: k, l: t(`rsm.leg.${k}`) }))} />
        )}
      </div>
    </div>
  )
}

function CodeTable({ title, values, codes, setCodes, options }: {
  title: string; values: string[]; codes: Record<string, string>; setCodes: (c: Record<string, string>) => void; options: { v: string; l: string }[]
}) {
  const { t } = useI18n()
  return (
    <div>
      <div className="rsm-box-title" style={{ fontSize: 13, marginBottom: 6 }}>{title}</div>
      <table className="rsm-table rsm-colmap" style={{ maxWidth: 640 }}>
        <thead><tr><th>{t('rsm.col.code')}</th><th>{t('rsm.col.means')}</th></tr></thead>
        <tbody>
          {values.map((v) => (
            <tr key={v} className={!codes[v] ? 'todo' : undefined}>
              <td><b>{v}</b></td>
              <td>
                <select value={codes[v] || ''} onChange={(e) => setCodes({ ...codes, [v]: e.target.value })} aria-label={`${v}: ${t('rsm.col.means')}`}>
                  <option value="">{t('rsm.f.none')}</option>
                  {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
