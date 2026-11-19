'use client'

// File mensile del cliente (Agos: «Polizze Vita ITC», entro l'8 di ogni mese):
// assunti, cessati, proroghe, passaggi di livello e promozioni. Un solo
// caricamento aggiorna tutte le polizze del cliente nell'anno (LTC per tutti,
// Vita solo per quadri e dirigenti): prima si vede che cosa cambia, poi si
// registra. Il file è cumulativo (da gennaio al mese scorso): ricaricarlo non
// registra nulla due volte, entra solo quello che è nuovo.
import Link from 'next/link'
import { useRef, useState } from 'react'
import { VitaGate, VitaHeader, eur, fmtDate, useFlash, useVita } from '@/components/vita/useVita'
import { clientOf } from '@/lib/vita/types'

interface Change { kind: string; date: string; who: string; cf: string; sheet: string; id: string; text: string; amount?: number | null }
interface Diff { key: string; id: string; field: string; current: string | null; expected: string; who: string; text: string }
interface ProgramPlan {
  id: string; name: string; editor: boolean; hrMonthly: boolean; byCategory: boolean; insured: number
  changes: Change[]; diffs: Diff[]; skipped: Record<string, number>; warnings: string[]
}
interface Preview { months: string[]; events: number; warnings: string[]; programs: ProgramPlan[] }

const KIND: Record<string, { label: string; tone: string }> = {
  entrata: { label: 'Entra', tone: 'new' },
  uscita: { label: 'Esce', tone: 'off' },
  passaggio: { label: 'Passaggio', tone: 'promo' },
  correzione: { label: 'Data corretta', tone: 'warn' },
}

export default function VitaMensilePage() {
  const vita = useVita()
  const [file, setFile] = useState<File | null>(null)
  const [prev, setPrev] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [fix, setFix] = useState<Set<string>>(new Set())
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)
  const { setFlash, node: flashNode } = useFlash(vita)
  // Contraente del file: '' = dalla colonna «Soc» (codici in Impostazioni); un nome =
  // file di quel solo contraente (es. Agos Renting manda il suo a parte).
  const [company, setCompany] = useState('')
  const contractors = [...new Set((vita.programs || [])
    .filter((p) => vita.program && clientOf(p) === clientOf(vita.program) && p.year === vita.program.year && (p.config.hrMonthly || p.id === vita.programId))
    .flatMap((p) => p.config.companies.map((c) => c.name.trim()).filter(Boolean)))]

  async function preview(f: File, keepFix?: Set<string>, who = company) {
    if (!vita.programId) return
    setBusy(true); setErr(null)
    try {
      const fd = new FormData()
      fd.append('file', f)
      fd.append('programId', vita.programId)
      if (who) fd.append('company', who)
      const r = await fetch('/api/vita/hr', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Errore')
      setPrev(j)
      setFix(keepFix || new Set())
      setSkip(new Set())
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  async function pick(f: File | null) {
    if (!f) return
    setFile(f)
    await preview(f)
  }

  const targets = (prev?.programs || []).filter((p) => p.editor && !skip.has(p.id) && (p.changes.length || p.diffs.some((d) => fix.has(d.key))))

  async function register() {
    if (!file || !vita.programId || !targets.length) return
    setBusy(true); setErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('programId', vita.programId)
      fd.append('confirm', '1')
      if (company) fd.append('company', company)
      fd.append('targets', JSON.stringify(targets.map((p) => p.id)))
      fd.append('fix', JSON.stringify([...fix]))
      const r = await fetch('/api/vita/hr', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Errore')
      await vita.reload()
      const done = (j.results as { id: string; label?: string; opId: string | null }[]).filter((x) => x.opId)
      const mine = done.find((x) => x.id === vita.programId)
      setFlash({ ok: true, text: done.map((x) => x.label).join(' · ') || 'Niente da registrare.', opId: done.length === 1 ? mine?.opId || undefined : undefined })
      await preview(file)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const toggle = (set: Set<string>, k: string, on: boolean) => { const n = new Set(set); if (on) n.add(k); else n.delete(k); return n }

  return (
    <div className="rsm">
      <VitaHeader vita={vita} title="File mensile del cliente">
        <Link className="btn btn-secondary" href="/vita/movimenti">Vai ai movimenti</Link>
      </VitaHeader>
      <VitaGate vita={vita}>
        {flashNode}
        {err && <div className="alert alert-error">{err}</div>}

        <div className="rsm-box">
          <div className="rsm-box-body">
            <p className="rsm-muted">
              Il file che il cliente manda ogni mese con assunti, cessati, proroghe, passaggi di livello e promozioni (un foglio per mese).
              Un solo caricamento aggiorna tutte le polizze di {vita.client} {vita.program?.year} collegate al file mensile: ognuna prende solo chi la riguarda, secondo le sue categorie.
              Prima vedi che cosa cambia, poi registri. Il file può contenere tutti i mesi dall&apos;inizio dell&apos;anno: quello che è già registrato non entra una seconda volta.
            </p>
            {contractors.length > 1 && (
              <div className="rsm-row" style={{ marginBottom: 8 }}>
                <label className="rsm-field">Di chi è il file
                  <select value={company} onChange={(e) => { setCompany(e.target.value); if (file) preview(file, undefined, e.target.value) }}>
                    <option value="">Di tutti i contraenti: lo dice la colonna «Soc» del file</option>
                    {contractors.map((c) => <option key={c} value={c}>Solo di {c} (file a parte)</option>)}
                  </select>
                </label>
              </div>
            )}
            <div className={`rsm-drop${drag ? ' on' : ''}`} role="button" tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click() }}
              onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0] || null) }}>
              <p><b>{file ? `«${file.name}»: trascina qui un altro file o fai clic per cambiarlo` : 'Trascina qui il file Excel del mese, oppure fai clic per sceglierlo'}</b></p>
              <p className="rsm-note">Es. «70_Polizze Vita ITC_ANNO 2026_da GEN a OTT.xlsx»</p>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => { pick(e.target.files?.[0] || null); e.target.value = '' }} />
            {busy && <p className="rsm-note"><span className="spinner" /> Leggo il file…</p>}
          </div>
        </div>

        {prev && (
          <>
            <p className="rsm-muted">{prev.events} {prev.events === 1 ? 'riga' : 'righe'} nel file{prev.months.length ? `, ${prev.months.length === 1 ? 'foglio' : 'fogli'} ${prev.months.join(', ')}` : ''}.</p>
            {prev.warnings.map((w, i) => <div key={i} className="alert alert-error">{w}</div>)}

            {prev.programs.map((p) => {
              const n = (k: string) => p.changes.filter((c) => c.kind === k)
              const sum = (l: Change[]) => l.reduce((s, c) => s + (c.amount || 0), 0)
              const sk = p.skipped
              const willFix = p.diffs.filter((d) => fix.has(d.key)).length
              return (
                <div className="rsm-box" key={p.id}>
                  <div className="rsm-box-head">
                    <span className="rsm-box-title">{p.name}</span>
                    <span className="rsm-row">
                      {!p.hrMonthly && <span className="rsm-pill off">non collegata al file mensile</span>}
                      {p.editor && (p.changes.length > 0 || willFix > 0) && (
                        <label className="rsm-rule" style={{ fontSize: 12.5 }}><input type="checkbox" checked={!skip.has(p.id)} onChange={(e) => setSkip(toggle(skip, p.id, !e.target.checked))} />Registra in questa polizza</label>
                      )}
                    </span>
                  </div>
                  <div className="rsm-box-body">
                    <div className="rsm-kpis">
                      <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Entrano</span></div><div className="rsm-kpi-num">{n('entrata').length}</div><div className="rsm-kpi-line">ratei {eur(sum(n('entrata')))}</div></div>
                      <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Escono</span></div><div className="rsm-kpi-num">{n('uscita').length}</div><div className="rsm-kpi-line">rimborsi {eur(sum(n('uscita')))}</div></div>
                      <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Passaggi di categoria</span></div><div className="rsm-kpi-num">{n('passaggio').length}</div><div className="rsm-kpi-line">esce da una categoria ed entra nell&apos;altra</div></div>
                      <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Date diverse dal file</span></div><div className="rsm-kpi-num" style={{ color: p.diffs.length ? 'var(--c-warning)' : undefined }}>{p.diffs.length}</div><div className="rsm-kpi-line">{willFix ? `${willFix} da correggere` : 'già registrati con un\'altra data'}</div></div>
                    </div>

                    {p.changes.length === 0 && p.diffs.length === 0 && <div className="rsm-issue info">✓ Niente di nuovo per questa polizza: il file è già tutto registrato.</div>}

                    {p.changes.length > 0 && (
                      <section>
                        <h3 className="rsm-drawer-h">Che cosa si registra</h3>
                        <div>
                          {p.changes.map((c, i) => (
                            <div className="rsm-change" key={`${c.id}-${c.kind}-${i}`}>
                              <span className="d">{fmtDate(c.date)}</span>
                              <span><span className={`rsm-pill ${KIND[c.kind]?.tone || 'off'}`}>{KIND[c.kind]?.label || c.kind}</span> <b>{c.who}</b> · {c.text}<span className="rsm-cf" style={{ display: 'block' }}>{c.cf} · foglio «{c.sheet}»</span></span>
                              <span className="amt">{c.amount == null ? '' : eur(c.amount)}</span>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {p.diffs.length > 0 && (
                      <section>
                        <h3 className="rsm-drawer-h">Già registrati, ma con una data diversa dal file</h3>
                        <p className="rsm-note">Non si correggono da soli: spunta quelli da allineare al file del cliente. Gli altri restano come sono (magari la data giusta è quella registrata: in quel caso va segnalato al cliente).</p>
                        {p.editor && <div className="rsm-row"><button className="rsm-mini" onClick={() => setFix(new Set([...fix, ...p.diffs.map((d) => d.key)]))}>Correggi tutte</button><button className="rsm-mini" onClick={() => setFix(new Set([...fix].filter((k) => !p.diffs.some((d) => d.key === k))))}>Nessuna</button></div>}
                        <div>
                          {p.diffs.map((d) => (
                            <label className="rsm-rule" key={d.key} style={{ padding: '6px 0' }}>
                              <input type="checkbox" disabled={!p.editor} checked={fix.has(d.key)} onChange={(e) => setFix(toggle(fix, d.key, e.target.checked))} />
                              <span>{d.text}<span className="rsm-help">{d.field === 'exitDate' ? 'Uscita' : 'Decorrenza'}: {fmtDate(d.current)} → {fmtDate(d.expected)}</span></span>
                            </label>
                          ))}
                        </div>
                      </section>
                    )}

                    {p.warnings.map((w, i) => <div key={i} className="rsm-issue warning">{w}</div>)}

                    <p className="rsm-note">
                      Non toccano questa polizza: {[
                        sk.giaRegistrati && `${sk.giaRegistrati} già registrati`,
                        sk.fuoriPolizza && `${sk.fuoriPolizza} con un livello che questa polizza non copre`,
                        sk.nonAssicurati && `${sk.nonAssicurati} cessati che non erano assicurati qui`,
                        sk.proroghe && `${sk.proroghe} proroghe (non cambiano niente)`,
                        sk.altraSocieta && `${sk.altraSocieta} di una società che non è fra i contraenti`,
                      ].filter(Boolean).join(' · ') || 'nessuno'}.
                    </p>
                  </div>
                </div>
              )
            })}

            {vita.editor && (
              <div className="rsm-row">
                <button className="btn btn-primary" disabled={busy || !targets.length} onClick={register}>
                  {targets.length ? `Registra in ${targets.length === 1 ? targets[0].name : `${targets.length} polizze`}` : 'Niente da registrare'}
                </button>
                <span className="rsm-note">Ogni polizza registra la sua operazione: si annulla dal Registro operazioni in Movimenti, finché è l&apos;ultima.</span>
              </div>
            )}
          </>
        )}
      </VitaGate>
    </div>
  )
}
