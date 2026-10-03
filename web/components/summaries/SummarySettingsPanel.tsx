'use client'
// Pannello «Personalizza» del riepilogo: campi in evidenza (fino a 4) con il
// calcolo, «raggruppa per», distribuzione del cruscotto, scadenza e giorni di
// preavviso, chiavi di abbinamento del confronto. Le opzioni vengono dai campi
// restituiti dal server (tipo letto dalla DESCRIZIONE): il client non deduce
// niente. Si salvano solo le voci cambiate, così le altre seguono i default.
import { useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import type { AmountOp, SummaryDetail, SummaryField, SummaryPatchBody, SummaryPrefs } from '@/lib/summaryTypes'
import type { PatchOutcome } from './useSummary'
import { useEscape } from './hooks'
import { apiErrorText } from './format'
import { DOSSIER_KEY } from './views/types'

const DUE_DAYS = [30, 60, 90, 180, 365]
const opsFor = (f: SummaryField | undefined): AmountOp[] => (f?.kind === 'rate' ? ['avg', 'minmax'] : ['sum', 'avg', 'minmax'])
const defaultOpFor = (f: SummaryField | undefined): AmountOp => (f?.kind === 'rate' || f?.structural ? 'avg' : 'sum')

export function SummarySettingsPanel({ d, onClose, patch, active }: {
  d: SummaryDetail
  onClose: () => void
  patch: (body: SummaryPatchBody) => Promise<PatchOutcome>
  active: boolean
}) {
  const t = useT()
  useEscape(onClose, active)
  const byId = new Map(d.fields.map((f) => [f.id, f]))
  const numeric = d.fields.filter((f) => (f.kind === 'amount' || f.kind === 'rate') && !f.textLike)
  const groupable = d.fields.filter((f) => f.kind === 'text' || f.kind === 'check')
  const dates = d.fields.filter((f) => f.kind === 'date')
  const matchable = d.fields.filter((f) => f.kind === 'identifier' || f.kind === 'text')

  const pad = (list: { fieldId: string; op: AmountOp }[]) => [...list, ...Array(4).fill(null).map(() => ({ fieldId: '', op: 'sum' as AmountOp }))].slice(0, 4)
  const [hl, setHl] = useState(() => pad(d.prefs.highlights))
  const [groupId, setGroupId] = useState(d.prefs.groupFieldId || '')
  const [distId, setDistId] = useState(d.prefs.distributionFieldId || '')
  const [dueId, setDueId] = useState(d.summary.dueFieldId || '')
  const [dueDays, setDueDays] = useState(d.prefs.dueDays)
  const [m1, setM1] = useState(d.prefs.matchFieldIds[0] || DOSSIER_KEY)
  const [m2, setM2] = useState(d.prefs.matchFieldIds[1] || '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const setHlField = (i: number, fieldId: string) => setHl((cur) => cur.map((h, k) => {
    if (k !== i) return h
    const f = byId.get(fieldId)
    return { fieldId, op: opsFor(f).includes(h.op) ? h.op : defaultOpFor(f) }
  }))
  const setHlOp = (i: number, op: AmountOp) => setHl((cur) => cur.map((h, k) => (k === i ? { ...h, op } : h)))

  async function run(body: SummaryPatchBody) {
    setBusy(true)
    setErr('')
    const out = await patch(body)
    setBusy(false)
    if (out.ok) onClose()
    else setErr(t('rp.cfg.error', { msg: apiErrorText(t, out.body, out.status) }))
  }

  async function save() {
    const prefs: SummaryPrefs = {}
    const seen = new Set<string>()
    const nextHl = hl.filter((h) => h.fieldId && byId.has(h.fieldId)).filter((h) => {
      const sig = `${h.fieldId}|${h.op}`
      if (seen.has(sig)) return false
      seen.add(sig)
      return true
    })
    if (JSON.stringify(nextHl) !== JSON.stringify(d.prefs.highlights)) prefs.highlights = nextHl
    if ((groupId || null) !== d.prefs.groupFieldId) prefs.groupFieldId = groupId || null
    if ((distId || null) !== d.prefs.distributionFieldId) prefs.distributionFieldId = distId || null
    if (dueDays !== d.prefs.dueDays) prefs.dueDays = dueDays
    const match = [...new Set([m1, m2].filter(Boolean))]
    if (match.length && JSON.stringify(match) !== JSON.stringify(d.prefs.matchFieldIds)) prefs.matchFieldIds = match
    const body: SummaryPatchBody = {}
    if (Object.keys(prefs).length) body.prefs = prefs
    if ((dueId || null) !== (d.summary.dueFieldId || null)) body.dueFieldId = dueId || null
    if (!Object.keys(body).length) { onClose(); return }
    await run(body)
  }

  const fieldOpt = (f: SummaryField, extra = '') => <option key={f.id} value={f.id}>{f.label}{extra}</option>

  return (
    <div className="rp-panel" role="dialog" aria-label={t('rp.cfg.title')}>
      <div className="rp-ptitle">{t('rp.cfg.title')}</div>

      <div>
        <span className="rp-lbl">{t('rp.cfg.highlights')}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {hl.map((h, i) => {
            const f = byId.get(h.fieldId)
            return (
              <div key={i} style={{ display: 'flex', gap: 8 }}>
                <select value={h.fieldId} onChange={(e) => setHlField(i, e.target.value)} aria-label={`${t('rp.cfg.highlights')} ${i + 1}`} style={{ flex: '1 1 0', minWidth: 0 }}>
                  <option value="">{t('rp.cfg.none')}</option>
                  {numeric.map((x) => fieldOpt(x))}
                  {f && !numeric.includes(f) && fieldOpt(f)}
                </select>
                <select value={h.op} onChange={(e) => setHlOp(i, e.target.value as AmountOp)} disabled={!h.fieldId} aria-label={t('rp.tbl.calc')} style={{ width: 128, flex: 'none' }}>
                  {opsFor(f).map((op) => <option key={op} value={op}>{t(`rp.op.${op}`)}</option>)}
                </select>
              </div>
            )
          })}
        </div>
      </div>

      <div className="rp-prow">
        <label style={{ flex: '1 1 0', minWidth: 0 }}>
          <span className="rp-lbl">{t('rp.cfg.groupBy')}</span>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">{t('rp.cfg.none')}</option>
            {groupable.map((f) => fieldOpt(f, f.unique ? ` — ${t('rp.fld.uniqueHint')}` : ''))}
          </select>
        </label>
        <label style={{ flex: '1 1 0', minWidth: 0 }}>
          <span className="rp-lbl">{t('rp.cfg.distribution')}</span>
          <select value={distId} onChange={(e) => setDistId(e.target.value)}>
            <option value="">{t('rp.cfg.none')}</option>
            {numeric.map((f) => fieldOpt(f))}
          </select>
        </label>
      </div>

      <div className="rp-prow">
        <label style={{ flex: '1 1 0', minWidth: 0 }}>
          <span className="rp-lbl">{t('rp.cfg.dueField')}</span>
          <select value={dueId} onChange={(e) => setDueId(e.target.value)}>
            <option value="">{t('rp.cfg.none')}</option>
            {dates.map((f) => fieldOpt(f))}
          </select>
        </label>
        <label style={{ width: 128, flex: 'none' }}>
          <span className="rp-lbl">{t('rp.cfg.dueDays')}</span>
          <select value={dueDays} onChange={(e) => setDueDays(Number(e.target.value))}>
            {[...new Set([...DUE_DAYS, dueDays])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      <div className="rp-prow">
        <label style={{ flex: '1 1 0', minWidth: 0 }}>
          <span className="rp-lbl">{t('rp.cfg.matchFirst')}</span>
          <select value={m1} onChange={(e) => setM1(e.target.value)}>
            <option value={DOSSIER_KEY}>{t('rp.cmp.dossier')}</option>
            {matchable.map((f) => fieldOpt(f))}
          </select>
        </label>
        <label style={{ flex: '1 1 0', minWidth: 0 }}>
          <span className="rp-lbl">{t('rp.cfg.matchSecond')}</span>
          <select value={m2} onChange={(e) => setM2(e.target.value)}>
            <option value="">{t('rp.cfg.none')}</option>
            <option value={DOSSIER_KEY}>{t('rp.cmp.dossier')}</option>
            {matchable.map((f) => fieldOpt(f))}
          </select>
        </label>
      </div>

      <p className="rp-sub">{t('rp.cfg.hint')}</p>
      {err && <p className="rp-err" role="alert">{err}</p>}

      <div className="rp-pbtns">
        <button type="button" className="jb-btn ghost rp-btn" disabled={busy} onClick={() => void run({ prefs: null })}>{t('rp.cfg.reset')}</button>
        <span style={{ flex: '1 1 0' }} />
        <button type="button" className="jb-btn btn-secondary rp-btn" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="jb-btn btn-primary rp-btn" disabled={busy} onClick={() => void save()}>{t('rp.cfg.save')}</button>
      </div>
    </div>
  )
}
