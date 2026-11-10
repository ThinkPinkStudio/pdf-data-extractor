'use client'

// Pezzi comuni delle pagine Polizza Vita: schede per contraente, pillole di stato
// e scheda dell'assicurato (pannello laterale).
import { useEffect, useMemo, useState } from 'react'
import { checkPerson } from '@/lib/rsm/rules.js'
import { missingDoc } from '@/lib/vita/rules.js'
import { api, eur, fmtDate, rate4, statusAt, useFlash } from './useVita'
import type { Row, Vita } from './useVita'
import type { VitaConfig } from '@/lib/vita/types'

export type CompanyTab = 'all' | string

export function CompanyTabs({ cfg, value, onChange, counts }: { cfg: VitaConfig; value: CompanyTab; onChange: (v: CompanyTab) => void; counts: Record<string, number> }) {
  const tabs: { key: CompanyTab; label: string }[] = [
    ...cfg.companies.map((c) => ({ key: c.key, label: `${c.name}${c.policy ? ` · pol. ${c.policy}` : ''}` })),
    { key: 'all', label: 'Tutte' },
  ]
  return (
    <div className="rsm-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={`rsm-tab${value === t.key ? ' on' : ''}`} onClick={() => onChange(t.key)}>
          {t.label}<span className="n">{counts[t.key] ?? 0}</span>
        </button>
      ))}
    </div>
  )
}

export type DocMissing = 'visita' | 'ok' | 'accertamenti' | null

/** Stato della documentazione sanitaria di una persona, con che cosa manca. */
export function docState(r: Row): { tone: 'off' | 'ok' | 'warn' | 'err'; label: string; need: string; missing: DocMissing } {
  if (r.c.band === 'nessuna') return { tone: 'off', label: 'Non richiesta', need: '', missing: null }
  const need = r.c.band === 'visita' ? 'Rapporto di visita medica' : 'Rapporto di visita + accertamenti o check-up'
  const missing = missingDoc({ band: r.c.band, doc: r.doc }) as DocMissing
  if (missing === null) return { tone: 'ok', label: 'Accettata', need, missing }
  if (missing === 'accertamenti') return { tone: 'warn', label: 'Mancano gli accertamenti', need, missing }
  if (missing === 'ok') return { tone: 'warn', label: 'Attende ok C.A. Vita', need, missing }
  return { tone: 'err', label: 'Mancante', need, missing }
}

/** Che cosa chiedere, per la mail all'Azienda. */
export const MISSING_TEXT: Record<Exclude<DocMissing, null>, string> = {
  visita: 'rapporto di visita medica',
  accertamenti: 'accertamenti sanitari o check-up degli ultimi 6 mesi',
  ok: 'documentazione inviata, in attesa della risposta di Credit Agricole Vita',
}

export function DocPill({ r }: { r: Row }) {
  const d = docState(r)
  return <span className={`rsm-pill ${d.tone}`}>{d.label}</span>
}

export function CoverPill({ cover }: { cover: string }) {
  const tone = cover === 'MORTE + IPT' ? 'ok' : cover === 'SOLO CASO MORTE' ? 'warn' : 'err'
  const label = cover === 'MORTE + IPT' ? 'Morte + IPT' : cover === 'SOLO CASO MORTE' ? 'Solo morte' : cover === 'FUORI COPERTURA' ? 'Fuori copertura' : '—'
  return <span className={`rsm-pill ${tone}`}>{label}</span>
}

const BAND_LABEL = (cfg: VitaConfig): Record<string, string> => ({
  nessuna: `fino a ${eur(cfg.rules.noDocUpTo)}: nessun documento`,
  visita: `da ${eur(cfg.rules.noDocUpTo)} a ${eur(cfg.rules.visitUpTo)}: rapporto di visita`,
  'visita+accertamenti': `oltre ${eur(cfg.rules.visitUpTo)}: visita + accertamenti o check-up`,
})

/* ─── Pannelli di modifica ───────────────────────────────────────────────── */

function Panel({ title, children, onCancel, onSave, busy, saveLabel = 'Salva' }: { title: string; children: React.ReactNode; onCancel: () => void; onSave: () => void; busy?: boolean; saveLabel?: string }) {
  return (
    <div className="rsm-panel">
      <div className="rsm-box-title">{title}</div>
      {children}
      <div className="rsm-row">
        <button className="btn btn-primary" disabled={busy} onClick={onSave}>{saveLabel}</button>
        <button className="btn btn-secondary" disabled={busy} onClick={onCancel}>Annulla</button>
      </div>
    </div>
  )
}

/* ─── Scheda dell'assicurato ─────────────────────────────────────────────── */

type Mode = null | 'exit' | 'edit' | 'transfer' | 'doc'

export function PersonPanel({ vita, row, at, onClose, onDone }: { vita: Vita; row: Row; at: string; onClose: () => void; onDone: (text: string, opId?: string) => void }) {
  const cfg = vita.cfg!
  const [mode, setMode] = useState<Mode>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const issues = useMemo(() => (checkPerson({ cognome: row.cognome, nome: row.nome, cf: row.cf, birthDate: row.birthDate }, vita.program!.year).issues as { code: string; level: string; text: string }[]).filter((i) => i.level === 'error'), [row, vita.program])
  const d = docState(row)
  const mv = useMemo(() => vita.movements().filter((m) => m.row.id === row.id), [vita, row.id])
  const sameCf = vita.rows.filter((r) => r.cf === row.cf && r.id !== row.id)
  const other = cfg.companies.find((c) => c.key !== row.company)
  const st = statusAt(row, at)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  // Campi dei pannelli
  const [exitDate, setExitDate] = useState('')
  const [exitComm, setExitComm] = useState('')
  const [trDate, setTrDate] = useState('')
  const [trTo, setTrTo] = useState(other?.key || '')
  const [form, setForm] = useState({ cognome: row.cognome, nome: row.nome, level: row.level, ral: String(row.ral), keyFigure: row.keyFigure, sovrPct: String(row.sovrPct), note: row.note || '' })
  const [doc, setDoc] = useState(row.doc)

  async function run(fn: () => Promise<{ label?: string; opId?: string }>, fallback: string) {
    setBusy(true); setErr(null)
    try {
      const j = await fn()
      setMode(null)
      await vita.reload()
      onDone(j.label || fallback, j.opId)
      onClose()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const url = `/api/vita/programs/${vita.programId}/insured`

  const events: { date: string; tone: string; title: string; lines: string[] }[] = []
  events.push({
    date: row.entryDate || cfg.periodStart,
    tone: row.entryKind === 'passaggio' ? 'promo' : row.entryKind === 'inclusione' ? 'new' : 'off',
    title: row.entryKind === 'passaggio' ? `Entra in ${cfg.companies.find((c) => c.key === row.company)?.name}`
      : row.entryKind === 'inclusione' ? 'Inclusione' : `Stato di rischio al ${fmtDate(cfg.periodStart)}`,
    lines: [`Capitale ${eur(row.c.capital)} · premio lordo annuo ${eur(row.c.gross)}`, row.source || ''].filter(Boolean),
  })
  if (row.remindedOn) events.push({ date: row.remindedOn, tone: 'promo', title: 'Promemoria documentazione', lines: [d.need ? `Richiesto: ${d.need.toLowerCase()}` : ''].filter(Boolean) })
  for (const m of mv) {
    if (m.kind === 'ESCLUSIONE') events.push({ date: m.date, tone: 'off', title: m.title, lines: [m.source, `Rimborso ${eur(Math.abs(m.gross || 0))} per ${m.days} giorni non goduti`].filter(Boolean) })
    else if (events[0]) events[0].lines.push(`Rateo ${m.days}/365 dell'anno: ${eur(m.gross)} (diritti compresi)`)
  }
  events.sort((a, b) => a.date.localeCompare(b.date))

  return (
    <>
      <div className="rsm-drawer-veil" onClick={onClose} aria-hidden="true" />
      <aside className="rsm-drawer" role="dialog" aria-modal="true" aria-label={`Scheda di ${row.cognome} ${row.nome}`}>
        <div className="rsm-drawer-head">
          <div>
            <div className="rsm-kicker">{cfg.companies.find((c) => c.key === row.company)?.name}{cfg.companies.find((c) => c.key === row.company)?.policy ? ` · pol. ${cfg.companies.find((c) => c.key === row.company)!.policy}` : ''}</div>
            <h2 style={{ margin: '2px 0 4px', fontSize: 19 }}>{row.cognome} {row.nome}{row.keyFigure && <> <span className="rsm-pill promo">figura chiave</span></>}</h2>
            <div className="rsm-cf">{row.cf}</div>
          </div>
          <button className="rsm-mini" onClick={onClose} aria-label="Chiudi">×</button>
        </div>
        <div className="rsm-drawer-body">
          <div className="rsm-facts">
            <div><span>Data di nascita</span><b>{fmtDate(row.birthDate) || '—'}</b></div>
            <div><span>Livello</span><b>{row.level || '—'}</b></div>
            <div><span>Età computabile al {fmtDate(row.entryDate || cfg.periodStart)}</span><b>{row.c.age ?? '—'} anni</b></div>
            <div><span>Garanzie</span><b><CoverPill cover={row.c.cover} /></b></div>
            <div><span>Stato al {fmtDate(at)}</span><b><span className={`rsm-pill ${st === 'attivo' ? 'ok' : st === 'uscito' ? 'off' : 'new'}`}>{st === 'attivo' ? 'In copertura' : st === 'uscito' ? 'Uscito' : 'Non ancora entrato'}</span></b></div>
            {row.nextRal != null && <div><span>RAL comunicata per l&apos;anno dopo</span><b>{eur(row.nextRal)}</b></div>}
          </div>

          {issues.length === 0 ? (
            <div className="rsm-issue info">✓ Nome, cognome e data di nascita sono coerenti con il codice fiscale.</div>
          ) : (
            <div className="rsm-panel" style={{ borderColor: 'var(--c-warning)', background: 'transparent' }}>
              <div className="rsm-box-title">Da controllare</div>
              {issues.map((i, k) => <div key={`${i.code}-${k}`} className={`rsm-issue ${i.level}`}>{i.text}</div>)}
            </div>
          )}

          <section>
            <h3 className="rsm-drawer-h">Come si arriva al premio</h3>
            <table className="rsm-table" aria-label="Calcolo del premio">
              <tbody>
                <tr><td>RAL</td><td className="num">{eur(row.ral)}</td></tr>
                <tr><td>{row.keyFigure ? 'Capitale previsto (figura chiave)' : `Capitale previsto (${String(cfg.rules.multiplier).replace('.', ',')} × RAL)`}</td><td className="num">{eur(row.c.target)}</td></tr>
                <tr><td>Fascia sanitaria</td><td className="num">{BAND_LABEL(cfg)[row.c.band]}</td></tr>
                <tr><td>Documentazione</td><td className="num"><span className={`rsm-pill ${d.tone}`}>{d.label}</span></td></tr>
                <tr><td><b>Capitale assicurato</b></td><td className="num"><b>{eur(row.c.capital)}</b></td></tr>
                {row.c.scopertura > 0 && <tr><td>Capitale non coperto</td><td className="num" style={{ color: 'var(--c-error)' }}>{eur(row.c.scopertura)}</td></tr>}
                <tr><td>{row.c.age == null ? 'Tasso' : `Tasso a ${row.c.age} anni`}</td><td className="num">{rate4(row.c.rate)} ‰</td></tr>
                <tr><td>Sovrappremio</td><td className="num">{row.sovrPct} %</td></tr>
                <tr><td>Premio netto</td><td className="num">{eur(row.c.net)}</td></tr>
                <tr><td>Diritti</td><td className="num">{eur(cfg.rules.rights)}</td></tr>
                <tr className="total"><td>Premio lordo annuo</td><td className="num">{eur(row.c.gross)}</td></tr>
              </tbody>
            </table>
          </section>

          {row.c.band !== 'nessuna' && (
            <section>
              <h3 className="rsm-drawer-h">Documentazione sanitaria</h3>
              <ul className="rsm-list">
                <li><span>Richiesto</span> · <b>{d.need}</b></li>
                <li><span>Rapporto di visita</span> · <b>{row.doc.visit ? 'fornito' : 'non fornito'}</b></li>
                {row.c.band === 'visita+accertamenti' && <li><span>Accertamenti o check-up</span> · <b>{row.doc.extra ? `forniti${row.doc.checkupDate ? ` (check-up del ${fmtDate(row.doc.checkupDate)})` : ''}` : 'non forniti'}</b></li>}
                <li><span>Ok C.A. Vita</span> · <b>{row.doc.ok ? 'sì' : 'no'}</b></li>
                {row.remindedOn && <li><span>Ultimo promemoria</span> · <b>{fmtDate(row.remindedOn)}</b></li>}
              </ul>
              {vita.editor && <div className="rsm-row" style={{ marginTop: 8 }}><button className="rsm-mini" onClick={() => { setDoc(row.doc); setMode('doc') }}>Aggiorna la documentazione</button></div>}
            </section>
          )}

          {row.note && (
            <section>
              <h3 className="rsm-drawer-h">Nota (resta interna)</h3>
              <div className="rsm-issue info">{row.note}</div>
            </section>
          )}

          {sameCf.length > 0 && (
            <section>
              <h3 className="rsm-drawer-h">Stessa persona sull&apos;altra polizza</h3>
              <ul className="rsm-list">
                {sameCf.map((o) => (
                  <li key={o.id}>{cfg.companies.find((c) => c.key === o.company)?.name} · {o.exitDate ? `uscita il ${fmtDate(o.exitDate)}` : `dal ${fmtDate(o.entryDate)}`}</li>
                ))}
              </ul>
            </section>
          )}

          {err && <div className="alert alert-error">{err}</div>}

          {vita.editor && mode === null && (
            <div className="rsm-row">
              <button className="btn btn-secondary" onClick={() => { setForm({ cognome: row.cognome, nome: row.nome, level: row.level, ral: String(row.ral), keyFigure: row.keyFigure, sovrPct: String(row.sovrPct), note: row.note || '' }); setMode('edit') }}>Modifica</button>
              {!row.exitKind && <button className="btn btn-secondary" onClick={() => { setExitDate(''); setExitComm(''); setMode('exit') }}>Registra uscita</button>}
              {row.exitKind === 'cessazione' && <button className="btn btn-secondary" disabled={busy} onClick={() => run(() => api(url, 'PATCH', { action: 'clear-exit', id: row.id }), 'Uscita annullata')}>Annulla l&apos;uscita</button>}
              {!row.exitKind && other && <button className="btn btn-secondary" onClick={() => { setTrDate(''); setTrTo(other.key); setMode('transfer') }}>Passa ad {other.name}</button>}
            </div>
          )}

          {mode === 'exit' && (
            <Panel title="Registra l'uscita" busy={busy} onCancel={() => setMode(null)} saveLabel="Registra"
              onSave={() => run(() => api(url, 'PATCH', { action: 'exit', ids: [row.id], exitDate, exitCommunicated: exitComm || null }), 'Uscita registrata')}>
              <div className="rsm-row">
                <label className="rsm-field w-date">Comunicata il<input type="date" value={exitComm} onChange={(e) => { setExitComm(e.target.value); if (e.target.value && !exitDate) { const d = new Date(e.target.value); d.setDate(d.getDate() + 1); setExitDate(d.toISOString().slice(0, 10)) } }} /></label>
                <label className="rsm-field w-date">Esce dal<input type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} /></label>
              </div>
              <p className="rsm-note">La data dell&apos;uscita è il giorno dopo la comunicazione: scrivendo la comunicazione la proponiamo noi. Il rimborso usa il tasso e il capitale pagati a inizio anno.</p>
            </Panel>
          )}

          {mode === 'transfer' && other && (
            <Panel title="Passaggio fra le due polizze" busy={busy} onCancel={() => setMode(null)} saveLabel="Registra il passaggio"
              onSave={() => run(() => api(url, 'PATCH', { action: 'transfer', id: row.id, toCompany: trTo, date: trDate }), 'Passaggio registrato')}>
              <div className="rsm-row">
                <label className="rsm-field">Va a<select value={trTo} onChange={(e) => setTrTo(e.target.value)}>{cfg.companies.filter((c) => c.key !== row.company).map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select></label>
                <label className="rsm-field w-date">Dal<input type="date" value={trDate} onChange={(e) => setTrDate(e.target.value)} /></label>
              </div>
              <p className="rsm-note">Esce da questa polizza e entra nell&apos;altra dalla stessa data. Sulla polizza nuova i diritti si pagano di nuovo.</p>
            </Panel>
          )}

          {mode === 'doc' && (
            <Panel title="Documentazione sanitaria" busy={busy} onCancel={() => setMode(null)}
              onSave={() => run(() => api(url, 'PATCH', { action: 'update', id: row.id, patch: { doc } }), 'Documentazione aggiornata')}>
              <label className="rsm-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontSize: 12.5 }}><input type="checkbox" checked={doc.visit} onChange={(e) => setDoc({ ...doc, visit: e.target.checked })} style={{ height: 16, width: 16 }} />Rapporto di visita medica fornito</label>
              <label className="rsm-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontSize: 12.5 }}><input type="checkbox" checked={doc.extra} onChange={(e) => setDoc({ ...doc, extra: e.target.checked })} style={{ height: 16, width: 16 }} />Accertamenti o check-up forniti</label>
              {doc.extra && <label className="rsm-field w-date">Data del check-up<input type="date" value={doc.checkupDate || ''} onChange={(e) => setDoc({ ...doc, checkupDate: e.target.value || null })} /></label>}
              <label className="rsm-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontSize: 12.5 }}><input type="checkbox" checked={doc.ok} onChange={(e) => setDoc({ ...doc, ok: e.target.checked })} style={{ height: 16, width: 16 }} />Ok di Credit Agricole Vita</label>
              <p className="rsm-note">Il capitale si adegua da solo: senza documenti resta a {eur(cfg.rules.noDocUpTo)}, col rapporto di visita accettato arriva a {eur(cfg.rules.visitUpTo)}, con gli accertamenti al capitale previsto.</p>
            </Panel>
          )}

          {mode === 'edit' && (
            <Panel title="Modifica i dati" busy={busy} onCancel={() => setMode(null)}
              onSave={() => run(() => api(url, 'PATCH', { action: 'update', id: row.id, patch: { ...form, ral: Number(String(form.ral).replace(/\./g, '').replace(',', '.')) || 0, sovrPct: Number(String(form.sovrPct).replace(',', '.')) || 0 } }), 'Dati aggiornati')}>
              <div className="rsm-row">
                <label className="rsm-field">Cognome<input value={form.cognome} onChange={(e) => setForm({ ...form, cognome: e.target.value })} /></label>
                <label className="rsm-field">Nome<input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></label>
              </div>
              <div className="rsm-row">
                <label className="rsm-field">Livello<input value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} /></label>
                <label className="rsm-field">RAL<input value={form.ral} onChange={(e) => setForm({ ...form, ral: e.target.value })} style={{ width: 130 }} /></label>
                <label className="rsm-field">Sovrappremio %<input value={form.sovrPct} onChange={(e) => setForm({ ...form, sovrPct: e.target.value })} style={{ width: 90 }} /></label>
              </div>
              <label className="rsm-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontSize: 12.5 }}><input type="checkbox" checked={form.keyFigure} onChange={(e) => setForm({ ...form, keyFigure: e.target.checked })} style={{ height: 16, width: 16 }} />Figura chiave (capitale {eur(cfg.rules.keyFigureCapital)}, documentazione sempre richiesta)</label>
              <label className="rsm-field">Nota (resta interna)<textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
            </Panel>
          )}

          <section>
            <h3 className="rsm-drawer-h">Storico</h3>
            <ol className="rsm-timeline">
              {events.map((e, i) => (
                <li key={i} className={e.tone}>
                  <div className="rsm-tl-date">{fmtDate(e.date)}</div>
                  <div>
                    <div className="rsm-tl-title">{e.title}</div>
                    {e.lines.map((l, j) => <div key={j} className="rsm-sub">{l}</div>)}
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

export { useFlash }
