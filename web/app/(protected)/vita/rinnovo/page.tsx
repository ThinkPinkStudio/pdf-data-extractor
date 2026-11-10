'use client'

// Rinnovo di fine anno: si scarica l'elenco da mandare all'Azienda, si carica il
// file di ritorno con le RAL nuove e si vede cosa cambia prima di creare il
// programma dell'anno dopo (capitali, premi, soglie sanitarie, limiti di età).
import { useMemo, useRef, useState } from 'react'
import { computeInsured } from '@/lib/vita/rules.js'
import { CoverPill } from '@/components/vita/VitaUi'
import { VitaEmpty, VitaGate, VitaHeader, api, downloadExport, eur, fmtDate, rate4, statusAt, today, useFlash, useVita } from '@/components/vita/useVita'

export default function VitaRinnovoPage() {
  const vita = useVita()
  const cfg = vita.cfg
  const year = vita.program?.year || new Date().getFullYear()
  const next = year + 1
  const nextStart = `${next}-01-01`
  const [busy, setBusy] = useState(false)
  const [dry, setDry] = useState<{ year: number; found: number; missing: number; extra: number; warnings: string[] } | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { setFlash, node: flashNode } = useFlash(vita)

  const rows = useMemo(() => vita.rows.filter((r) => statusAt(r, today()) === 'attivo').map((r) => {
    const n = r.nextRal == null ? null : r.nextRal
    const nx = n == null || !cfg ? null : computeInsured({ birthDate: r.birthDate, ral: n, keyFigure: r.keyFigure, doc: r.doc, sovrPct: r.sovrPct }, cfg.rates, nextStart, cfg.rules) as typeof r.c
    const flags: { tone: string; text: string }[] = []
    if (n == null) flags.push({ tone: 'err', text: `RAL ${next} non comunicata` })
    if (nx) {
      // Una fascia sanitaria più alta vuole documenti nuovi, anche partendo da «visita».
      const level = (b: string) => (b === 'nessuna' ? 0 : b === 'visita' ? 1 : 2)
      if (level(nx.band) > level(r.c.band)) flags.push({ tone: 'warn', text: nx.band === 'visita' ? `Supera ${eur(cfg!.rules.noDocUpTo)}: serve il rapporto di visita` : `Supera ${eur(cfg!.rules.visitUpTo)}: servono accertamenti o check-up` })
      if (nx.cover !== r.c.cover) flags.push({ tone: nx.cover === 'FUORI COPERTURA' ? 'err' : 'warn', text: nx.cover === 'SOLO CASO MORTE' ? `Compie ${cfg!.rules.ipMaxAge + 1} anni: solo caso morte` : nx.cover === 'FUORI COPERTURA' ? `Oltre gli ${cfg!.rules.deathMaxAge} anni: da segnalare al cliente` : 'Cambia la garanzia' })
    }
    return { r, n, nx, flags }
  }), [vita.rows, cfg, nextStart, next])

  const changed = rows.filter((x) => x.flags.length > 0)
  const missing = rows.filter((x) => x.n == null).length
  // Il confronto vale solo per chi ha la RAL nuova: con quelle mancanti sembrerebbe un calo.
  const withRal = rows.filter((x) => x.nx)
  const premNow = withRal.reduce((s, x) => s + (x.r.c.gross || 0), 0)
  const premNext = withRal.reduce((s, x) => s + (x.nx?.gross || 0), 0)

  async function send(confirm: boolean) {
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('ralYear', String(next))
      if (confirm) fd.append('confirm', '1')
      const r = await fetch(`/api/vita/programs/${vita.programId}/renewal`, { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Errore')
      if (confirm) {
        await vita.reload()
        setDry(null); setFile(null)
        if (fileRef.current) fileRef.current.value = ''
        setFlash({ ok: true, text: j.label || `RAL ${next} caricate`, opId: j.opId })
      } else setDry(j)
    } catch (e) { setFlash({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  async function createNext() {
    setBusy(true)
    try {
      const j = await api('/api/vita/programs', 'POST', { name: (vita.program?.name || 'Polizza Vita').replace(/\b(19|20)\d{2}\b/, String(next)) || `Polizza Vita ${next}`, year: next, copyFrom: vita.programId })
      setFlash({ ok: true, text: `Creato il programma «${j.program.name}». Caricaci lo stato di rischio con l'import.` })
      await vita.reload()
    } catch (e) { setFlash({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  return (
    <div className="rsm">
      <VitaHeader vita={vita} title="Rinnovo di fine anno" kicker={`dal ${year} al ${next}`}>
        <button className="btn btn-secondary" disabled={!vita.rows.length} onClick={() => downloadExport(vita.programId!, { kind: 'stato' }).catch((e) => setFlash({ ok: false, text: (e as Error).message }))}>Scarica l&apos;elenco per l&apos;Azienda</button>
        {vita.editor && <button className="btn btn-primary" disabled={busy || missing > 0 || !vita.rows.length} onClick={createNext}>Crea il programma {next}</button>}
      </VitaHeader>

      <VitaGate vita={vita}>
        {flashNode}
        {vita.rows.length === 0 ? <VitaEmpty what="non c'è niente da rinnovare." /> : <>
          <ol className="rsm-steps">
            <li className={vita.rows.length ? 'done' : 'on'}><span className="n">{vita.rows.length ? '✓' : '1'}</span>Scarica l&apos;elenco da mandare all&apos;Azienda</li>
            <li className={missing < rows.length ? 'done' : 'on'}><span className="n">{missing < rows.length ? '✓' : '2'}</span>Carica il file di ritorno con le RAL {next}</li>
            <li className={missing === 0 ? 'on' : ''}><span className="n">3</span>Controlla cosa cambia e crea il programma {next}</li>
          </ol>

          {vita.editor && (
            <div className="rsm-box">
              <div className="rsm-box-head"><span className="rsm-box-title">File con le RAL {next}</span><span className="rsm-note">lo stesso tracciato che vi manda l&apos;Azienda: bastano codice fiscale e RAL</span></div>
              <div className="rsm-box-body">
                <div className="rsm-row">
                  <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={(e) => { setFile(e.target.files?.[0] || null); setDry(null) }} />
                  <button className="btn btn-secondary" disabled={!file || busy} onClick={() => send(false)}>Prova la lettura</button>
                  {dry && <button className="btn btn-primary" disabled={busy} onClick={() => send(true)}>Carica {dry.found} RAL</button>}
                </div>
                {dry && (
                  <div className="rsm-panel">
                    <div className="rsm-box-title">Letto dal file</div>
                    <p>{dry.found} RAL {dry.year} combaciano con gli assicurati in copertura{dry.missing ? `, ${dry.missing} mancano` : ''}{dry.extra ? `, ${dry.extra} persone del file non sono nel programma` : ''}.</p>
                    {dry.warnings.map((w, i) => <div key={i} className="rsm-issue warning">{w}</div>)}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="rsm-kpis">
            <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Premio lordo annuo {next}</span></div><div className="rsm-kpi-num">{eur(premNext)}</div><div className="rsm-kpi-line">{year}: {eur(premNow)} · {premNext >= premNow ? '+' : '−'}{eur(Math.abs(premNext - premNow))}{missing > 0 ? ` · ${withRal.length} di ${rows.length} assicurati` : ''}</div></div>
            <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Da guardare</span></div><div className="rsm-kpi-num" style={{ color: changed.length ? 'var(--c-warning)' : undefined }}>{changed.length}</div><div className="rsm-kpi-line">cambiano fascia, garanzia o mancano dati</div></div>
            <div className="rsm-kpi"><div className="rsm-kpi-top"><span>RAL mancanti</span></div><div className="rsm-kpi-num" style={{ color: missing ? 'var(--c-error)' : undefined }}>{missing}</div><div className="rsm-kpi-line">da chiedere prima di rinnovare</div></div>
          </div>

          <div className="rsm-box">
            <div className="rsm-box-head"><span className="rsm-box-title">Cosa cambia per ogni assicurato</span><span className="rsm-muted">età e tasso al {fmtDate(nextStart)}</span></div>
            <div className="rsm-scroll tall">
              <table className="rsm-table">
                <thead><tr><th>Assicurato</th><th>Polizza</th><th className="num">RAL {year} → {next}</th><th className="num">Età</th><th className="num">Tasso ‰</th><th className="num">Capitale {next}</th><th className="num">Premio {year} → {next}</th><th>Garanzie</th><th>Da controllare</th></tr></thead>
                <tbody>
                  {[...rows].sort((a, b) => b.flags.length - a.flags.length || a.r.cognome.localeCompare(b.r.cognome)).map(({ r, n, nx, flags }) => (
                    <tr key={r.id}>
                      <td><span className="rsm-who">{r.cognome} {r.nome}</span></td>
                      <td className="nowrap">{cfg?.companies.find((c) => c.key === r.company)?.name}</td>
                      <td className="num">{eur(r.ral)} → {n == null ? <span style={{ color: 'var(--c-error)' }}>mancante</span> : eur(n)}</td>
                      <td className="num">{r.c.age ?? '—'} → {nx?.age ?? '—'}</td>
                      <td className="num">{rate4(nx?.rate ?? null)}</td>
                      <td className="num">{nx ? eur(nx.capital) : '—'}{nx && nx.scopertura > 0 && <div className="rsm-sub" style={{ color: 'var(--c-error)' }}>non coperti {eur(nx.scopertura)}</div>}</td>
                      <td className="num">{eur(r.c.gross)} → {eur(nx?.gross ?? null)}</td>
                      <td>{nx ? <CoverPill cover={nx.cover} /> : '—'}</td>
                      <td>{flags.length === 0 ? <span className="rsm-sub">nessuna variazione</span> : flags.map((f) => <div key={f.text}><span className={`rsm-pill ${f.tone}`}>{f.text}</span></div>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="rsm-note">«Crea il programma {next}» copia contraenti, tassi e regole nell&apos;anno nuovo; gli assicurati si caricano poi con l&apos;import dello stato di rischio.</p>
        </>}
      </VitaGate>
    </div>
  )
}
