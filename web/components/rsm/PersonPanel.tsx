'use client'

// Scheda della persona: dati e controlli del codice fiscale, situazione a una
// data, nucleo, storico di tutte le righe (entrate, uscite, promozioni, con la
// fonte di ogni movimento e chi l'ha registrato) e le azioni sulla riga aperta.
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { api, eur } from '@/components/rsm/useRsm'
import type { Rsm, Row } from '@/components/rsm/useRsm'
import { CeasePanel, EditPanel } from '@/components/rsm/MemberPanels'
import { addDays, checkPerson, decodeCf, fmtDate, isCovered, statusAt } from '@/lib/rsm/rules.js'
import type { RsmIssue } from '@/lib/rsm/types'

const PILL: Record<string, string> = { attivo: 'ok', cessazione: 'warn', uscito: 'off', promosso: 'promo', futuro: 'new' }

interface Ev { date: string; key: string; title: string; amount: string; lines: string[]; tone: string }

export default function PersonPanel({ rsm, cf, at, onClose, onOpen, onDone }: {
  rsm: Rsm; cf: string; at: string; onClose: () => void; onOpen: (cf: string) => void; onDone: (text: string) => void
}) {
  const { t } = useI18n()
  const cfg = rsm.program!.config
  const [mode, setMode] = useState<null | 'exit' | 'edit'>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setMode(null); setErr(null) }, [cf])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const rows = useMemo(() => rsm.rows.filter((r) => r.cf === cf).sort((a, b) => (a.entryDate || '').localeCompare(b.entryDate || '')), [rsm.rows, cf])
  const label = (k: string) => cfg.categories.find((c) => c.key === k)?.label || k
  if (!rows.length) return null
  const person = rows[rows.length - 1]
  const current = rows.find((r) => isCovered(statusAt(cfg, r, at)) || statusAt(cfg, r, at) === 'futuro') || person
  const st = statusAt(cfg, current, at) as string
  const d = decodeCf(cf, rsm.program!.year)
  const age = person.birthDate ? Math.floor((Date.parse(at) - Date.parse(person.birthDate)) / (365.2425 * 86400000)) : null
  const issues = (checkPerson({ cognome: person.cognome, nome: person.nome, cf, birthDate: person.birthDate }, rsm.program!.year).issues as RsmIssue[]).filter((i) => i.level !== 'info')

  // Nucleo della riga aperta: titolare e familiari nella stessa categoria.
  const titCf = current.legame === 'TI' ? current.cf : current.cfTitolare
  const nucleus = rsm.rows.filter((r) => r.category === current.category && (r.cf === titCf || r.cfTitolare === titCf) && !(r.exitKind === 'promozione' && r.id !== current.id && r.cf === cf))
    .filter((r, i, all) => all.findIndex((x) => x.cf === r.cf) === i)
    .sort((a, b) => ['TI', 'CO', 'FI'].indexOf(a.legame) - ['TI', 'CO', 'FI'].indexOf(b.legame))

  // Storico: un evento per ogni entrata e ogni uscita di ogni riga.
  const events: Ev[] = []
  for (const r of rows) {
    const meta = [
      r.source ? t('rsm.ps.source', { s: r.source }) : '',
      r.note ? t('rsm.ps.note', { s: r.note }) : '',
      t('rsm.ps.by', { u: r.createdBy, d: new Date(r.createdAt * 1000).toLocaleDateString('it-IT') }),
    ].filter(Boolean)
    if (r.entryDate) {
      const dec = [
        r.requestedDate && r.requestedDate !== r.entryDate ? t('rsm.ps.requested', { d: fmtDate(r.requestedDate) }) : '',
        r.communicatedDate ? t('rsm.ps.communicated', { d: fmtDate(r.communicatedDate) }) : '',
        r.entryForced ? t('rsm.forced') : '',
      ].filter(Boolean)
      events.push({
        date: r.entryDate, key: `${r.id}-in`, tone: r.entryKind === 'promozione' ? 'promo' : 'new',
        title: t(`rsm.ps.in.${r.entryKind}`, { c: label(r.category), l: t(`rsm.leg.${r.legame}`) }),
        amount: r.c.dovuto ? `${eur(r.c.dovuto)} · ${r.c.calc}` : r.c.calc,
        lines: [...dec, ...meta],
      })
    }
    if (r.exitDate) {
      events.push({
        date: r.exitDate, key: `${r.id}-out`, tone: r.exitKind === 'promozione' ? 'promo' : 'off',
        title: t(`rsm.ps.out.${r.exitKind}`, { c: label(r.category), e: fmtDate(addDays(cfg.periodEnd, -1)) }),
        amount: r.exitKind === 'promozione' ? t('rsm.st.refund', { v: eur(r.c.rimborso) }) : t('rsm.mv.noRefund'),
        lines: r.exitCommunicated ? [t('rsm.ps.communicated', { d: fmtDate(r.exitCommunicated) })] : [],
      })
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.key.endsWith('out') ? -1 : 1))

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setErr(null)
    try { await fn(); setMode(null); await rsm.reload(); onDone(ok) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const fam = nucleus.filter((r) => r.id !== current.id)
  return (
    <>
      <div className="rsm-drawer-veil" onClick={onClose} aria-hidden="true" />
      <aside className="rsm-drawer" role="dialog" aria-modal="true" aria-label={t('rsm.ps.title', { name: `${person.cognome} ${person.nome}` })}>
        <div className="rsm-drawer-head">
          <div>
            <div className="rsm-kicker">{t('rsm.ps.kicker')}</div>
            <h2 style={{ margin: '2px 0 4px', fontSize: 19 }}>{person.cognome} {person.nome}</h2>
            <div className="rsm-cf">{cf}</div>
          </div>
          <button className="rsm-mini" onClick={onClose} aria-label={t('rsm.close')}>×</button>
        </div>
        <div className="rsm-drawer-body">
          <div className="rsm-facts">
            <div><span>{t('rsm.col.birth')}</span><b>{fmtDate(person.birthDate) || '—'}{age != null ? ` · ${t('rsm.ps.age', { n: age })}` : ''}</b></div>
            <div><span>{t('rsm.ps.sex')}</span><b>{d.sex === 'F' ? t('rsm.ps.f') : d.sex === 'M' ? t('rsm.ps.m') : '—'}</b></div>
            <div><span>{t('rsm.category')}</span><b>{label(current.category)}{current.quiescente ? ` · ${t('rsm.quiescente')}` : ''}</b></div>
            <div><span>{t('rsm.col.legame')}</span><b>{t(`rsm.leg.${current.legame}`)}</b></div>
            <div><span>{t('rsm.ps.stateAt', { d: fmtDate(at) })}</span><b><span className={`rsm-pill ${PILL[st]}`}>{t(`rsm.state.${st}`)}</span></b></div>
            <div><span>{t('rsm.col.due')}</span><b>{eur(current.c.dovuto)}{current.c.annuo ? ` (${t('rsm.ps.annual', { v: eur(current.c.annuo) })})` : ''}</b></div>
          </div>

          {issues.length > 0 && (
            <div className="rsm-panel" style={{ borderColor: 'var(--c-warning)', background: 'transparent' }}>
              <div className="rsm-box-title">{t('rsm.ps.checks')}</div>
              {issues.map((i) => <div key={i.code} className={`rsm-issue ${i.level}`}>{i.text}</div>)}
              {rsm.editor && <div><button className="rsm-mini" onClick={() => setMode('edit')}>{t('rsm.ps.fix')}</button></div>}
            </div>
          )}

          {rsm.editor && (
            <div className="rsm-row">
              {!current.exitKind && <button className="btn btn-secondary" onClick={() => setMode('exit')}>{t('rsm.st.cease')}</button>}
              {current.exitKind === 'cessazione' && <button className="btn btn-secondary" disabled={busy} onClick={() => run(() => api(`/api/rsm/programs/${rsm.programId}/members`, 'PATCH', { action: 'clear-exit', id: current.id }), t('rsm.st.exitCleared'))}>{t('rsm.st.undoCease')}</button>}
              {current.legame === 'TI' && !current.exitKind && <Link className="btn btn-secondary" href={`/rsm/promozioni?m=${current.id}`}>{t('rsm.st.promote')}</Link>}
              <button className="btn btn-secondary" onClick={() => setMode('edit')}>{t('rsm.edit')}</button>
            </div>
          )}
          {err && <div className="alert alert-error">{err}</div>}
          {mode === 'exit' && (
            <CeasePanel row={current} nucleus={nucleus} busy={busy} onCancel={() => setMode(null)}
              onSave={(ids, exitDate, exitCommunicated, note) => run(() => api(`/api/rsm/programs/${rsm.programId}/members`, 'PATCH', { action: 'exit', ids, exitDate, exitCommunicated, note }), t('rsm.st.ceased'))} />
          )}
          {mode === 'edit' && (
            <EditPanel row={current} year={rsm.program!.year} busy={busy} onCancel={() => setMode(null)}
              onSave={(patch) => run(() => api(`/api/rsm/programs/${rsm.programId}/members`, 'PATCH', { action: 'update', id: current.id, patch }), t('rsm.saved'))} />
          )}

          {fam.length > 0 && (
            <section>
              <h3 className="rsm-drawer-h">{t('rsm.ps.nucleus', { c: label(current.category) })}</h3>
              <ul className="rsm-list">
                {nucleus.map((r) => (
                  <li key={r.id}>
                    {r.cf === cf ? <b>{r.cognome} {r.nome}</b> : <button className="rsm-link" onClick={() => onOpen(r.cf)}>{r.cognome} {r.nome}</button>}
                    <span className="rsm-sub"> · {t(`rsm.leg.${r.legame}`)} · <span className={`rsm-pill ${PILL[statusAt(cfg, r, at) as string]}`}>{t(`rsm.state.${statusAt(cfg, r, at)}`)}</span></span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3 className="rsm-drawer-h">{t('rsm.ps.history')}</h3>
            <ol className="rsm-timeline">
              {events.map((e) => (
                <li key={e.key} className={e.tone}>
                  <div className="rsm-tl-date">{fmtDate(e.date)}</div>
                  <div>
                    <div className="rsm-tl-title">{e.title}</div>
                    <div className="rsm-sub">{e.amount}</div>
                    {e.lines.map((l, i) => <div key={i} className="rsm-sub">{l}</div>)}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </aside>
    </>
  )
}
