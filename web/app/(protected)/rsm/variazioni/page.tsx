'use client'

// Registra variazioni: Excel di inclusione (lettura, controlli, mail per i
// dati errati, conferma), cessazioni comunicate via mail e inserimenti a mano.
import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { RsmGate, RsmHeader, api, eur, saveBlob, today, useRsm } from '@/components/rsm/useRsm'
import type { Rsm } from '@/components/rsm/useRsm'
import {
  buildEml, buildErrorMail, checkPerson, cleanCf, computeMember, decodeCf, decorrenza, fmtDate, isCovered, mailIssues, normDate, statusAt,
} from '@/lib/rsm/rules.js'
import type { RsmCalc, RsmIssue, RsmPreparedRow } from '@/lib/rsm/types'

const SENDERS_KEY = 'rsmSenders'

interface FileResult { name: string; sheet?: string; error?: string; rows: (RsmPreparedRow & { sel: boolean; forced: string })[] }

export default function RsmVariazioniPage() {
  const { t } = useI18n()
  const rsm = useRsm()
  return (
    <div className="rsm">
      <RsmHeader rsm={rsm} title={t('rsm.var.title')} />
      <RsmGate rsm={rsm}>
        {!rsm.editor && <div className="alert alert-error">{t('rsm.readOnlyLong')}</div>}
        <p className="rsm-muted" style={{ margin: 0, maxWidth: 820 }}>{t('rsm.var.intro')}</p>
        <ExcelSection rsm={rsm} />
        <div className="rsm-grid2">
          <CeaseSection rsm={rsm} />
          <ManualSection rsm={rsm} />
        </div>
      </RsmGate>
    </div>
  )
}

/* ─── Excel di inclusione ─────────────────────────────────────────────── */

function ExcelSection({ rsm }: { rsm: Rsm }) {
  const { t } = useI18n()
  const cfg = rsm.program!.config
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [received, setReceived] = useState(today())
  const [sender, setSender] = useState('')
  const [results, setResults] = useState<FileResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const senders = useMemo(() => { try { return JSON.parse(localStorage.getItem(SENDERS_KEY) || '[]') as string[] } catch { return [] } }, [])

  async function read() {
    setBusy(true); setMsg(null); setResults(null)
    try {
      const fd = new FormData()
      files.forEach((f) => fd.append('files', f))
      fd.append('communicated', received)
      const r = await fetch(`/api/rsm/programs/${rsm.programId}/parse`, { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Errore')
      setResults((j.files as FileResult[]).map((f) => ({ ...f, rows: f.rows.map((x) => ({ ...x, sel: !x.hasError && !x.issues.some((i) => i.code === 'doppione'), forced: '' })) })))
      if (sender && /@/.test(sender)) { try { localStorage.setItem(SENDERS_KEY, JSON.stringify([sender, ...senders.filter((s) => s !== sender)].slice(0, 12))) } catch { /* ignora */ } }
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  function patchRow(fi: number, ri: number, p: Partial<FileResult['rows'][number]>) {
    setResults((rs) => rs && rs.map((f, i) => (i !== fi ? f : { ...f, rows: f.rows.map((x, j) => (j !== ri ? x : { ...x, ...p })) })))
  }

  /** Decorrenza forzata dall'operatore: ricalcola il premio sulla nuova data. */
  function effective(r: FileResult['rows'][number]) {
    if (r.action !== 'entrata' || !r.forced) return { member: r.member, calc: r.calc }
    const member = { ...r.member, entryDate: r.forced, entryForced: true }
    return { member, calc: member.category ? (computeMember(cfg, member) as RsmCalc) : null }
  }

  const all = (results || []).flatMap((f) => f.rows)
  const selected = all.filter((r) => r.sel)

  async function confirm() {
    setBusy(true); setMsg(null)
    try {
      const members = selected.map((r) => {
        const e = effective(r)
        return { ...e.member, entryForced: !!r.forced, source: `${(results || []).find((f) => f.rows.includes(r))?.name || 'Excel'} riga ${r.rowNumber}${sender ? ` · da ${sender}` : ''}` }
      })
      const j = await api(`/api/rsm/programs/${rsm.programId}/members`, 'POST', { members, source: 'Excel' })
      setMsg({ ok: true, text: t('rsm.var.registered', { e: j.entries, u: j.exits }) })
      setResults((rs) => rs && rs.map((f) => ({ ...f, rows: f.rows.filter((r) => !r.sel) })))
      await rsm.reload()
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  return (
    <div className="rsm-box">
      <div className="rsm-box-head"><div className="rsm-box-title">{t('rsm.var.excelTitle')}</div><span className="rsm-note">{t('rsm.var.excelHint')}</span></div>
      <div className="rsm-box-body">
        <div className="rsm-row">
          <label className="rsm-field" style={{ minWidth: 260 }}>{t('rsm.var.files')}
            <input ref={inputRef} type="file" multiple accept=".xlsx,.xls" onChange={(e) => setFiles(Array.from(e.target.files || []))} style={{ height: 'auto', padding: 6 }} />
          </label>
          <label className="rsm-field w-date">{t('rsm.var.received')}<input type="date" value={received} onChange={(e) => setReceived(e.target.value)} /></label>
          <label className="rsm-field" style={{ minWidth: 240 }}>{t('rsm.var.sender')}
            <input type="email" list="rsm-senders" value={sender} onChange={(e) => setSender(e.target.value)} placeholder="nome@azienda.it" />
            <datalist id="rsm-senders">{senders.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <button className="btn btn-primary" disabled={!files.length || !received || busy || !rsm.editor} onClick={read}>{busy ? <span className="spinner" /> : t('rsm.var.read')}</button>
        </div>
        {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`}>{msg.text}</div>}
        {results && results.map((f, fi) => (
          <div key={f.name + fi} className="rsm-box">
            <div className="rsm-box-head">
              <div><b>{f.name}</b>{f.sheet ? <span className="rsm-note"> · {f.sheet}</span> : null}</div>
              {!f.error && <span className="rsm-muted">{t('rsm.var.fileSum', { n: f.rows.length, e: f.rows.filter((r) => r.hasError).length })}</span>}
            </div>
            {f.error ? <div className="rsm-box-body"><div className="rsm-issue error">{f.error}</div></div> : f.rows.length === 0 ? <div className="rsm-empty">{t('rsm.var.allDone')}</div> : (
              <div className="rsm-scroll">
                <table className="rsm-table">
                  <thead><tr>
                    <th /><th>{t('rsm.var.row')}</th><th>{t('rsm.var.action')}</th><th>{t('rsm.col.insured')}</th><th>{t('rsm.col.legame')}</th>
                    <th>{t('rsm.category')}</th><th>{t('rsm.var.decorrenza')}</th><th className="num">{t('rsm.var.premium')}</th><th>{t('rsm.var.checks')}</th>
                  </tr></thead>
                  <tbody>
                    {f.rows.map((r, ri) => {
                      const e = effective(r)
                      const label = cfg.categories.find((c) => c.key === r.member.category)?.label || '—'
                      return (
                        <tr key={ri}>
                          <td><input type="checkbox" aria-label={t('rsm.var.select')} checked={r.sel} disabled={r.hasError || !rsm.editor} onChange={(ev) => patchRow(fi, ri, { sel: ev.target.checked })} /></td>
                          <td className="nowrap">{r.rowNumber}</td>
                          <td><span className={`rsm-pill ${r.action === 'entrata' ? 'new' : 'off'}`}>{t(`rsm.var.${r.action}`)}</span></td>
                          <td><div className="rsm-who">{r.cognome} {r.nome}</div><div className="rsm-cf">{r.member.cf || '—'}</div></td>
                          <td className="nowrap">{r.member.legame ? t(`rsm.leg.${r.member.legame}`) : '—'}</td>
                          <td className="nowrap">{label}</td>
                          <td className="nowrap">
                            {r.action === 'entrata'
                              ? <input type="date" aria-label={t('rsm.var.decorrenza')} value={r.forced || r.member.entryDate || ''} disabled={!rsm.editor} onChange={(ev) => patchRow(fi, ri, { forced: ev.target.value === r.member.entryDate ? '' : ev.target.value })} style={{ height: 30, width: 140, fontSize: 12.5 }} />
                              : fmtDate(r.member.exitDate || null)}
                            {r.forced && <div className="rsm-sub">{t('rsm.forced')}</div>}
                          </td>
                          <td className="num">{e.calc ? <>{eur(e.calc.dovuto)}<div className="rsm-sub">{e.calc.calc}</div></> : '—'}</td>
                          <td style={{ minWidth: 260 }}>
                            {r.issues.length === 0 ? <span className="rsm-pill ok">{t('rsm.var.ok')}</span>
                              : (r.issues as RsmIssue[]).map((i, k) => <IssueLine key={k} issue={i} />)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!f.error && f.rows.some((r) => mailIssues(r).length > 0) && <ErrorMail fileName={f.name} received={received} rows={f.rows} sender={sender} cc={cfg.mail?.cc || ''} signature={cfg.mail?.signature || ''} />}
          </div>
        ))}
        {results && all.length > 0 && (
          <div className="rsm-row">
            <button className="btn btn-primary" disabled={!selected.length || busy || !rsm.editor} onClick={confirm}>{t('rsm.var.confirm', { n: selected.length })}</button>
            <span className="rsm-note">{t('rsm.var.confirmHint')}</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** Un controllo; se la persona è già in un'altra categoria, il passaggio a Promozioni già compilato. */
function IssueLine({ issue }: { issue: RsmIssue }) {
  const { t } = useI18n()
  const p = issue.promote
  return (
    <div className={`rsm-issue ${issue.level}`}>
      {issue.text}
      {p && (
        <div style={{ marginTop: 4 }}>
          <Link className="rsm-mini btn" href={`/rsm/promozioni?m=${p.memberId}&to=${p.to}${p.date ? `&d=${p.date}` : ''}`}>{t('rsm.var.asPromotion')}</Link>
        </div>
      )}
      {issue.mail === false && issue.level === 'error' && <div className="rsm-sub">{t('rsm.var.notInMail')}</div>}
    </div>
  )
}

function ErrorMail({ fileName, received, rows, sender, cc, signature }: { fileName: string; received: string; rows: RsmPreparedRow[]; sender: string; cc: string; signature: string }) {
  const { t } = useI18n()
  const initial = useMemo(() => buildErrorMail({ fileName, receivedOn: received, rows, to: sender, cc, signature }), [fileName, received, rows, sender, cc, signature])
  const [open, setOpen] = useState(false)
  const [m, setM] = useState(initial)
  const [copied, setCopied] = useState(false)
  if (!open) {
    return (
      <div className="rsm-box-body" style={{ borderTop: '1px solid var(--c-border)' }}>
        <div className="rsm-row"><button className="btn btn-secondary" onClick={() => { setM(initial); setOpen(true) }}>{t('rsm.mail.open', { n: initial.count })}</button></div>
      </div>
    )
  }
  const mailto = `mailto:${encodeURIComponent(m.to)}?${new URLSearchParams({ ...(m.cc ? { cc: m.cc } : {}), subject: m.subject, body: m.body }).toString().replace(/\+/g, '%20')}`
  return (
    <div className="rsm-box-body rsm-mail" style={{ borderTop: '1px solid var(--c-border)' }}>
      <div className="rsm-box-title">{t('rsm.mail.title')}</div>
      <div className="rsm-row">
        <label className="rsm-field" style={{ flex: 1, minWidth: 220 }}>{t('rsm.mail.to')}<input value={m.to} onChange={(e) => setM({ ...m, to: e.target.value })} /></label>
        <label className="rsm-field" style={{ flex: 1, minWidth: 220 }}>{t('rsm.mail.cc')}<input value={m.cc} onChange={(e) => setM({ ...m, cc: e.target.value })} /></label>
      </div>
      <label className="rsm-field">{t('rsm.mail.subject')}<input value={m.subject} onChange={(e) => setM({ ...m, subject: e.target.value })} /></label>
      <label className="rsm-field">{t('rsm.mail.body')}<textarea value={m.body} onChange={(e) => setM({ ...m, body: e.target.value })} /></label>
      <div className="rsm-row">
        <a className="btn btn-primary" href={mailto}>{t('rsm.mail.openClient')}</a>
        <button className="btn btn-secondary" onClick={() => saveBlob(new Blob([buildEml(m)], { type: 'message/rfc822' }), `${m.subject.replace(/[^\w\- ]+/g, '').trim() || 'mail'}.eml`)}>{t('rsm.mail.eml')}</button>
        <button className="btn btn-secondary" onClick={async () => { try { await navigator.clipboard.writeText(m.body); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignora */ } }}>{copied ? t('rsm.mail.copied') : t('rsm.mail.copy')}</button>
        <button className="btn btn-secondary" onClick={() => setOpen(false)}>{t('rsm.close')}</button>
      </div>
      <div className="rsm-note">{t('rsm.mail.hint')}</div>
    </div>
  )
}

/* ─── Cessazione comunicata via mail ──────────────────────────────────── */

function CeaseSection({ rsm }: { rsm: Rsm }) {
  const { t } = useI18n()
  const cfg = rsm.program!.config
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  const [date, setDate] = useState('')
  const [comm, setComm] = useState(today())
  const [note, setNote] = useState('')
  const [withFam, setWithFam] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const open = rsm.rows.filter((r) => !r.exitKind && (isCovered(statusAt(cfg, r, today())) || statusAt(cfg, r, today()) === 'futuro'))

  // Testo della mail incollato: si cercano codice fiscale e data di cessazione.
  function onPaste(text: string) {
    setQ(text)
    const cf = /\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/i.exec(text)?.[0]
    const d = /\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/.exec(text)?.[1]
    if (cf) {
      const hit = open.find((r) => r.cf === cleanCf(cf))
      if (hit) { setPick(hit.id); setQ(cleanCf(cf)) }
    }
    if (d) { const iso = normDate(d, rsm.program!.year); if (iso) setDate(iso) }
  }

  const needle = q.trim().toUpperCase()
  const hits = needle.length >= 2 ? open.filter((r) => `${r.cognome} ${r.nome} ${r.cf}`.includes(needle)).slice(0, 8) : []
  const sel = rsm.rows.find((r) => r.id === pick) || null
  const fam = sel && sel.legame === 'TI' ? open.filter((r) => r.category === sel.category && r.cfTitolare === sel.cf && r.id !== sel.id) : []

  async function save() {
    if (!sel) return
    setBusy(true); setMsg(null)
    try {
      const ids = [sel.id, ...(withFam ? fam.map((r) => r.id) : [])]
      await api(`/api/rsm/programs/${rsm.programId}/members`, 'PATCH', { action: 'exit', ids, exitDate: date, exitCommunicated: comm, note })
      setMsg({ ok: true, text: t('rsm.var.ceased', { name: `${sel.cognome} ${sel.nome}`, n: ids.length }) })
      setPick(null); setQ(''); setDate(''); setNote('')
      await rsm.reload()
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  return (
    <div className="rsm-box">
      <div className="rsm-box-head"><div className="rsm-box-title">{t('rsm.var.ceaseTitle')}</div></div>
      <div className="rsm-box-body">
        <label className="rsm-field">{t('rsm.var.ceaseSearch')}
          <textarea rows={2} value={q} onChange={(e) => { onPaste(e.target.value); setPick(null) }} placeholder={t('rsm.var.ceaseSearchPh')} />
        </label>
        {!sel && hits.map((r) => (
          <button key={r.id} className="btn btn-secondary" style={{ justifyContent: 'flex-start' }} onClick={() => setPick(r.id)}>
            {r.cognome} {r.nome} · {r.cf} · {cfg.categories.find((c) => c.key === r.category)?.label} · {t(`rsm.leg.${r.legame}`)}
          </button>
        ))}
        {sel && (
          <div className="rsm-panel">
            <div><b>{sel.cognome} {sel.nome}</b> <span className="rsm-cf">{sel.cf}</span> · {cfg.categories.find((c) => c.key === sel.category)?.label}</div>
            <div className="rsm-row">
              <label className="rsm-field w-date">{t('rsm.ceaseDate')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label className="rsm-field w-date">{t('rsm.mailDate')}<input type="date" value={comm} onChange={(e) => setComm(e.target.value)} /></label>
            </div>
            <label className="rsm-field">{t('rsm.note')}<input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('rsm.notePh')} /></label>
            {fam.length > 0 && <label className="rsm-muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={withFam} onChange={(e) => setWithFam(e.target.checked)} />{t('rsm.st.withFam', { n: fam.length })}</label>}
            <div className="rsm-note">{t('rsm.st.ceaseHint')}</div>
            <div className="rsm-row">
              <button className="btn btn-primary" disabled={!date || busy || !rsm.editor} onClick={save}>{t('rsm.var.ceaseSave')}</button>
              <button className="btn btn-secondary" onClick={() => setPick(null)}>{t('common.cancel')}</button>
            </div>
          </div>
        )}
        {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`}>{msg.text}</div>}
      </div>
    </div>
  )
}

/* ─── Inclusione a mano (eccezioni, comunicazioni senza file) ─────────── */

function ManualSection({ rsm }: { rsm: Rsm }) {
  const { t } = useI18n()
  const cfg = rsm.program!.config
  const empty = { cognome: '', nome: '', cf: '', birthDate: '', legame: 'TI', category: cfg.categories[0]?.key || '', quiescente: false, cfTitolare: '', requested: '', comm: today(), forced: '', note: '' }
  const [f, setF] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }))
  const tit = f.legame !== 'TI' ? rsm.rows.find((r) => r.cf === cleanCf(f.cfTitolare) && r.legame === 'TI' && !r.exitKind) : null
  const category = tit ? tit.category : f.category
  const check = checkPerson({ cognome: f.cognome, nome: f.nome, cf: f.cf, birthDate: f.birthDate || null }, rsm.program!.year)
  const dec = decorrenza(cfg, f.requested || null, f.comm || null, f.forced || null)
  const member = {
    category, quiescente: f.legame === 'TI' && f.quiescente, cf: cleanCf(f.cf), cognome: f.cognome, nome: f.nome, birthDate: check.birthDate,
    legame: f.legame, cfTitolare: f.legame === 'TI' ? cleanCf(f.cf) : cleanCf(f.cfTitolare), requestedDate: f.requested || null,
    communicatedDate: f.comm || null, entryDate: dec.date, entryKind: 'inclusione', entryForced: !!f.forced, note: f.note,
  }
  const calc = dec.date ? (computeMember(cfg, member) as RsmCalc) : null
  const issues = (check.issues as RsmIssue[]).filter((i) => i.level !== 'info')
  const titMissing = f.legame !== 'TI' && !tit
  const otherCat = cleanCf(f.cf) ? rsm.rows.find((r) => r.cf === cleanCf(f.cf) && !r.exitKind && r.category !== category) : null
  const otherTit = otherCat ? (otherCat.legame === 'TI' ? otherCat : rsm.rows.find((r) => r.category === otherCat.category && r.cf === otherCat.cfTitolare && r.legame === 'TI' && !r.exitKind) || otherCat) : null
  const ok = !!dec.date && !issues.some((i) => i.level === 'error') && !titMissing && !otherCat && decodeCf(f.cf).valid

  async function save() {
    setBusy(true); setMsg(null)
    try {
      await api(`/api/rsm/programs/${rsm.programId}/members`, 'POST', { members: [{ ...member, source: 'Inserimento a mano' }] })
      setMsg({ ok: true, text: t('rsm.var.added', { name: `${f.cognome} ${f.nome}`.toUpperCase() }) })
      setF(empty)
      await rsm.reload()
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  return (
    <div className="rsm-box">
      <div className="rsm-box-head"><div className="rsm-box-title">{t('rsm.var.manualTitle')}</div></div>
      <div className="rsm-box-body">
        <div className="rsm-row">
          <label className="rsm-field">{t('rsm.col.surname')}<input value={f.cognome} onChange={(e) => set('cognome', e.target.value)} /></label>
          <label className="rsm-field">{t('rsm.col.name')}<input value={f.nome} onChange={(e) => set('nome', e.target.value)} /></label>
          <label className="rsm-field">{t('rsm.col.cf')}<input value={f.cf} onChange={(e) => set('cf', e.target.value.toUpperCase())} style={{ width: 190 }} /></label>
          <label className="rsm-field w-date">{t('rsm.col.birth')}<input type="date" value={f.birthDate || check.birthDate || ''} onChange={(e) => set('birthDate', e.target.value)} /></label>
        </div>
        <div className="rsm-row">
          <label className="rsm-field">{t('rsm.col.legame')}
            <select value={f.legame} onChange={(e) => set('legame', e.target.value)} style={{ width: 170 }}>
              {['TI', 'CO', 'FI'].map((l) => <option key={l} value={l}>{t(`rsm.leg.${l}`)}</option>)}
            </select>
          </label>
          {f.legame === 'TI' ? (
            <>
              <label className="rsm-field">{t('rsm.category')}
                <select value={f.category} onChange={(e) => set('category', e.target.value)} style={{ width: 160 }}>
                  {cfg.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
              <label className="rsm-muted" style={{ display: 'flex', gap: 6, alignItems: 'center', height: 36 }}><input type="checkbox" checked={f.quiescente} onChange={(e) => set('quiescente', e.target.checked)} />{t('rsm.quiescente')}</label>
            </>
          ) : (
            <label className="rsm-field">{t('rsm.col.cfTit')}<input value={f.cfTitolare} onChange={(e) => set('cfTitolare', e.target.value.toUpperCase())} style={{ width: 190 }} /></label>
          )}
        </div>
        {f.legame !== 'TI' && f.cfTitolare && <div className={`rsm-issue ${tit ? 'info' : 'error'}`}>{tit ? t('rsm.var.titFound', { name: `${tit.cognome} ${tit.nome}`, cat: cfg.categories.find((c) => c.key === tit.category)?.label || '' }) : t('rsm.var.titMissing')}</div>}
        <div className="rsm-row">
          <label className="rsm-field w-date">{t('rsm.var.requested')}<input type="date" value={f.requested} onChange={(e) => set('requested', e.target.value)} /></label>
          <label className="rsm-field w-date">{t('rsm.var.received')}<input type="date" value={f.comm} onChange={(e) => set('comm', e.target.value)} /></label>
          <label className="rsm-field w-date">{t('rsm.var.forcedDate')}<input type="date" value={f.forced} onChange={(e) => set('forced', e.target.value)} /></label>
        </div>
        <label className="rsm-field">{t('rsm.note')}<input value={f.note} onChange={(e) => set('note', e.target.value)} /></label>
        {dec.date && <div className="rsm-muted">{t(`rsm.var.dec.${dec.reason}`, { d: fmtDate(dec.date), days: cfg.rules.notifyDays })}{calc ? ` · ${t('rsm.var.premiumIs', { v: eur(calc.dovuto), c: calc.calc })}` : ''}</div>}
        {issues.map((i) => <div key={i.code} className={`rsm-issue ${i.level}`}>{i.text}</div>)}
        {otherCat && otherTit && <IssueLine issue={{ code: 'altra-categoria', level: 'error', mail: false, text: t('rsm.var.otherCat', { cat: cfg.categories.find((c) => c.key === otherCat.category)?.label || otherCat.category }), promote: { memberId: otherTit.id, to: category, date: dec.date } }} />}
        <div className="rsm-row"><button className="btn btn-primary" disabled={!ok || busy || !rsm.editor} onClick={save}>{t('rsm.var.add')}</button></div>
        {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`}>{msg.text}</div>}
      </div>
    </div>
  )
}
