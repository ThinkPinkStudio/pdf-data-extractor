'use client'

// Documentazione sanitaria: fasce di capitale, chi deve ancora consegnare e il
// promemoria per la referente in Azienda (solo nomi e documento mancante: le
// note sanitarie restano interne, come chiede il cliente).
import { useMemo, useState } from 'react'
import { CompanyTabs, DocPill, PersonPanel, docState } from '@/components/vita/VitaUi'
import type { CompanyTab, DocMissing } from '@/components/vita/VitaUi'
import { VitaEmpty, VitaGate, VitaHeader, api, downloadExport, eur, fmtDate, statusAt, today, useFlash, useVita } from '@/components/vita/useVita'

export default function VitaSanitariaPage() {
  const vita = useVita()
  const cfg = vita.cfg
  const [tab, setTab] = useState<CompanyTab>('all')
  const [mail, setMail] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const at = today()
  const { setFlash, node: flashNode } = useFlash(vita)
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')

  const active = useMemo(() => vita.rows.filter((r) => statusAt(r, at) === 'attivo'), [vita.rows, at])
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: active.length }
    for (const comp of cfg?.companies || []) c[comp.key] = active.filter((r) => r.company === comp.key).length
    return c
  }, [active, cfg])
  const scope = active.filter((r) => tab === 'all' || r.company === tab)
  const bands = {
    nessuna: scope.filter((r) => r.c.band === 'nessuna').length,
    visita: scope.filter((r) => r.c.band === 'visita').length,
    plus: scope.filter((r) => r.c.band === 'visita+accertamenti').length,
  }
  const need = scope.filter((r) => r.c.band !== 'nessuna').sort((a, b) => (docState(a).tone === 'ok' ? 1 : 0) - (docState(b).tone === 'ok' ? 1 : 0) || b.c.target - a.c.target)
  // Tre situazioni diverse, che nella mail non vanno confuse.
  const byMissing = (k: DocMissing) => need.filter((r) => docState(r).missing === k)
  const noVisit = byMissing('visita')
  const noExtra = byMissing('accertamenti')
  const waiting = byMissing('ok')
  const toAsk = [...noVisit, ...noExtra]
  const current = open ? vita.rows.find((r) => r.id === open) || null : null

  const policy = tab === 'all' ? (cfg?.companies.map((c) => c.policy).filter(Boolean).join(' e ') || '') : (cfg?.companies.find((c) => c.key === tab)?.policy || '')
  const list = (rows: typeof need) => rows.map((r) => `- ${r.cognome} ${r.nome} (capitale assicurato oggi ${eur(r.c.capital)} euro, previsto ${eur(r.c.target)} euro)`).join('\n')
  const firma = cfg?.mail.signature ? `\n${cfg.mail.signature}` : ''
  const body = toAsk.length === 0 && waiting.length === 0 ? `Buongiorno,

per la polizza vita${policy ? ` (n. ${policy})` : ''} la documentazione sanitaria è completa per tutti gli assicurati: i capitali sono quelli previsti.

Restiamo a disposizione.
Un saluto${firma}` : `Buongiorno,

ti ricordiamo che per le persone qui sotto manca ancora la documentazione sanitaria della polizza vita${policy ? ` (n. ${policy})` : ''}: finché non arriva, il capitale assicurato resta quello indicato.
${noVisit.length ? `
Manca il rapporto di visita medica compilato dal medico curante:

${list(noVisit)}
` : ''}${noExtra.length ? `
Il rapporto di visita è stato accettato; per arrivare al capitale previsto mancano gli accertamenti sanitari o un check-up degli ultimi ${cfg?.rules.checkupMonths} mesi:

${list(noExtra)}
` : ''}${waiting.length ? `
Per queste persone abbiamo inviato la documentazione e attendiamo la risposta di Credit Agricole Vita:

${waiting.map((r) => `- ${r.cognome} ${r.nome}`).join('\n')}
` : ''}
Fateci sapere se preferite che contattiamo noi gli assicurati.

Restiamo a disposizione.
Un saluto${firma}`

  function openMail() {
    setTo(cfg?.mail.to || '')
    setCc(cfg?.mail.cc || '')
    setMail((v) => !v)
  }
  async function copy() {
    try { await navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignora */ }
  }
  /** Segna la data del promemoria su chi è nella mail, così si sa a che punto si è. */
  async function markReminded() {
    setBusy(true)
    try {
      const d = today()
      for (const r of toAsk) await api(`/api/vita/programs/${vita.programId}/insured`, 'PATCH', { action: 'update', id: r.id, patch: { remindedOn: d } })
      await vita.reload()
      setFlash({ ok: true, text: `Promemoria segnato per ${toAsk.length} ${toAsk.length === 1 ? 'assicurato' : 'assicurati'}.` })
    } catch (e) { setFlash({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  return (
    <div className="rsm">
      <VitaHeader vita={vita} title="Documentazione sanitaria" kicker={`situazione al ${fmtDate(at)}`}>
        <button className="btn btn-primary" disabled={!vita.rows.length} onClick={openMail}>Prepara la mail per l&apos;Azienda</button>
        <button className="btn btn-secondary" disabled={!vita.rows.length} onClick={() => downloadExport(vita.programId!, { kind: 'situazione', at }).catch((e) => setFlash({ ok: false, text: (e as Error).message }))}>Esporta Excel</button>
      </VitaHeader>

      <VitaGate vita={vita}>
        {flashNode}
        {vita.rows.length === 0 ? <VitaEmpty what="non c'è documentazione sanitaria da seguire." /> : <>
          {cfg && <CompanyTabs cfg={cfg} value={tab} onChange={setTab} counts={counts} />}

          <div className="rsm-kpis">
            <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Fino a {eur(cfg!.rules.noDocUpTo)}</span></div><div className="rsm-kpi-num">{bands.nessuna}</div><div className="rsm-kpi-line">nessun documento richiesto</div></div>
            <div className="rsm-kpi"><div className="rsm-kpi-top"><span>{eur(cfg!.rules.noDocUpTo)} – {eur(cfg!.rules.visitUpTo)}</span></div><div className="rsm-kpi-num">{bands.visita}</div><div className="rsm-kpi-line">rapporto di visita del medico curante</div></div>
            <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Oltre {eur(cfg!.rules.visitUpTo)}</span></div><div className="rsm-kpi-num">{bands.plus}</div><div className="rsm-kpi-line">visita + accertamenti o check-up ({cfg!.rules.checkupMonths} mesi)</div></div>
            <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Da ricordare</span></div><div className="rsm-kpi-num" style={{ color: toAsk.length ? 'var(--c-error)' : undefined }}>{toAsk.length}</div><div className="rsm-kpi-line">{waiting.length} in attesa dell&apos;ok di C.A. Vita</div></div>
          </div>

          {mail && (
            <div className="rsm-panel">
              <div className="rsm-box-title">Mail per la referente in Azienda</div>
              <div className="rsm-row">
                <label className="rsm-field">A<input value={to} onChange={(e) => setTo(e.target.value)} placeholder="referente in Azienda" style={{ width: 260 }} /></label>
                <label className="rsm-field">Cc<input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="operatori CSA in copia" style={{ width: 340 }} /></label>
              </div>
              <label className="rsm-field rsm-mail">Testo<textarea readOnly value={body} /></label>
              <div className="rsm-row">
                <button className="btn btn-primary" onClick={copy}>{copied ? 'Copiata' : 'Copia il testo'}</button>
                <a className="btn btn-secondary" href={`mailto:${encodeURIComponent(to)}?cc=${encodeURIComponent(cc)}&subject=${encodeURIComponent(`Polizza vita${policy ? ` n. ${policy}` : ''} - documentazione sanitaria`)}&body=${encodeURIComponent(body)}`}>Apri nella posta</a>
                {vita.editor && toAsk.length > 0 && <button className="btn btn-secondary" disabled={busy} onClick={markReminded}>Segna come ricordato oggi</button>}
              </div>
              <p className="rsm-note">Nella mail compaiono solo i nomi e il documento mancante. Le note sanitarie (esclusioni, patologie) non vengono mai incluse.</p>
            </div>
          )}

          <div className="rsm-box">
            <div className="rsm-box-head"><span className="rsm-box-title">Chi deve consegnare documenti</span><span className="rsm-muted">{need.length} assicurati sopra {eur(cfg!.rules.noDocUpTo)}</span></div>
            <div className="rsm-scroll">
              <table className="rsm-table">
                <thead><tr><th>Assicurato</th><th className="num">Capitale previsto</th><th>Richiesto</th><th>Stato</th><th className="num">Capitale ora</th><th>Ultimo promemoria</th></tr></thead>
                <tbody>
                  {need.map((r) => (
                    <tr key={r.id}>
                      <td><button className="rsm-who-btn" onClick={() => setOpen(r.id)}>{r.cognome} {r.nome}</button>{r.keyFigure && <> <span className="rsm-pill promo">figura chiave</span></>}{r.note && <div className="rsm-sub">{r.note}</div>}</td>
                      <td className="num">{eur(r.c.target)}</td>
                      <td>{docState(r).need}</td>
                      <td><DocPill r={r} /></td>
                      <td className="num">{eur(r.c.capital)}{r.c.scopertura > 0 && <div className="rsm-sub" style={{ color: 'var(--c-error)' }}>non coperti {eur(r.c.scopertura)}</div>}</td>
                      <td className="nowrap">{r.remindedOn ? fmtDate(r.remindedOn) : '—'}</td>
                    </tr>
                  ))}
                  {need.length === 0 && <tr><td colSpan={6} className="rsm-empty">Nessuno deve consegnare documenti: tutti i capitali sono entro {eur(cfg!.rules.noDocUpTo)}.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>}
        {current && <PersonPanel vita={vita} row={current} at={at} onClose={() => setOpen(null)} onDone={(text, opId) => setFlash({ ok: true, text, opId })} />}
      </VitaGate>
    </div>
  )
}
