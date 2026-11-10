'use client'

// Documentazione sanitaria: fasce di capitale, chi deve ancora consegnare e la
// mail di promemoria per la referente in Azienda (solo nomi e documento
// mancante: le note sanitarie restano interne).
import { useMemo, useState } from 'react'
import { COMPANIES, ROWS, TODAY, eur, fmtDate, statusAt } from '@/lib/vita/demo'
import { CompanyTabs, DocPill, PersonPanel, VitaEmpty, VitaHeader, docState } from '@/components/vita/VitaUi'
import type { CompanyTab, DocMissing } from '@/components/vita/VitaUi'

export default function VitaSanitariaPage() {
  const [tab, setTab] = useState<CompanyTab>('sgr')
  const [mail, setMail] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const active = useMemo(() => ROWS.filter((r) => statusAt(r, TODAY) === 'attivo'), [])
  const counts = { sgr: active.filter((r) => r.company === 'sgr').length, re: active.filter((r) => r.company === 're').length, all: active.length }
  const scope = active.filter((r) => tab === 'all' || r.company === tab)
  const bands = { nessuna: scope.filter((r) => r.band === 'nessuna').length, visita: scope.filter((r) => r.band === 'visita').length, plus: scope.filter((r) => r.band === 'visita+accertamenti').length }
  const need = scope.filter((r) => r.band !== 'nessuna').sort((a, b) => (docState(a).tone === 'ok' ? 1 : 0) - (docState(b).tone === 'ok' ? 1 : 0) || b.target - a.target)
  // Tre situazioni diverse, che nella mail non vanno confuse.
  const byMissing = (k: DocMissing) => need.filter((r) => docState(r).missing === k)
  const noVisit = byMissing('visita')
  const noExtra = byMissing('accertamenti')
  const waiting = byMissing('ok')
  const toAsk = [...noVisit, ...noExtra]
  const current = open ? ROWS.find((r) => r.id === open) || null : null

  const policy = tab === 'all' ? '60037 e 60038' : COMPANIES[tab].policy
  const list = (rows: typeof need) => rows.map((r) => `- ${r.cognome} ${r.nome} (capitale assicurato oggi € ${eur(r.capital)}, previsto € ${eur(r.target)})`).join('\n')
  const body = toAsk.length === 0 && waiting.length === 0 ? `Buongiorno,

per la polizza vita (n. ${policy}) la documentazione sanitaria è completa per tutti gli assicurati: i capitali sono quelli previsti.

Restiamo a disposizione.
Un saluto` : `Buongiorno,

ti ricordiamo che per le persone qui sotto manca ancora la documentazione sanitaria della polizza vita (n. ${policy}): finché non arriva, il capitale assicurato resta quello indicato.
${noVisit.length ? `
Manca il rapporto di visita medica compilato dal medico curante:

${list(noVisit)}
` : ''}${noExtra.length ? `
Il rapporto di visita è stato accettato; per arrivare al capitale previsto mancano gli accertamenti sanitari o un check-up degli ultimi 6 mesi:

${list(noExtra)}
` : ''}${waiting.length ? `
Per queste persone abbiamo inviato la documentazione e attendiamo la risposta di Crédit Agricole Vita:

${waiting.map((r) => `- ${r.cognome} ${r.nome}`).join('\n')}
` : ''}
Fateci sapere se preferite che contattiamo noi gli assicurati.

Restiamo a disposizione.
Un saluto`

  async function copy() {
    try { await navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignora */ }
  }

  return (
    <div className="rsm">
      <VitaHeader kicker="Polizza Vita 2026 · situazione di oggi" title="Documentazione sanitaria">
        <button className="btn btn-primary" disabled={ROWS.length === 0} onClick={() => setMail((v) => !v)}>Prepara la mail per l&apos;Azienda</button>
        <button className="btn btn-secondary">Esporta Excel</button>
      </VitaHeader>

      {ROWS.length === 0 ? <VitaEmpty what="non c'è documentazione sanitaria da seguire." /> : <>
      <CompanyTabs value={tab} onChange={setTab} counts={counts} />

      <div className="rsm-kpis">
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Fino a 400.000</span></div><div className="rsm-kpi-num">{bands.nessuna}</div><div className="rsm-kpi-line">nessun documento richiesto</div></div>
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>400.000 – 800.000</span></div><div className="rsm-kpi-num">{bands.visita}</div><div className="rsm-kpi-line">rapporto di visita del medico curante</div></div>
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Oltre 800.000</span></div><div className="rsm-kpi-num">{bands.plus}</div><div className="rsm-kpi-line">visita + accertamenti o check-up (6 mesi)</div></div>
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Da ricordare</span></div><div className="rsm-kpi-num" style={{ color: toAsk.length ? 'var(--c-error)' : undefined }}>{toAsk.length}</div><div className="rsm-kpi-line">{waiting.length} in attesa dell&apos;ok di C.A. Vita</div></div>
      </div>

      {mail && (
        <div className="rsm-panel">
          <div className="rsm-box-title">Mail per la referente in Azienda</div>
          <div className="rsm-row">
            <label className="rsm-field">A<input placeholder="referente in Azienda" style={{ width: 260 }} /></label>
            <label className="rsm-field">Cc<input placeholder="operatori CSA in copia" style={{ width: 340 }} /></label>
          </div>
          <label className="rsm-field rsm-mail">Testo<textarea readOnly value={body} /></label>
          <div className="rsm-row"><button className="btn btn-primary" onClick={copy}>{copied ? 'Copiata' : 'Copia il testo'}</button><button className="btn btn-secondary">Apri nella posta</button><button className="btn btn-secondary">Scarica .eml</button></div>
          <p className="rsm-note">Nella mail compaiono solo i nomi e il documento mancante. Le note sanitarie (esclusioni, patologie) non vengono mai incluse.</p>
        </div>
      )}

      <div className="rsm-box">
        <div className="rsm-box-head"><span className="rsm-box-title">Chi deve consegnare documenti</span><span className="rsm-muted">{need.length} assicurati sopra i 400.000</span></div>
        <div className="rsm-scroll">
          <table className="rsm-table">
            <thead><tr><th>Assicurato</th><th className="num">Capitale previsto</th><th>Richiesto</th><th>Stato</th><th className="num">Capitale ora</th><th>Ultimo promemoria</th></tr></thead>
            <tbody>
              {need.map((r) => (
                <tr key={r.id}>
                  <td><button className="rsm-who-btn" onClick={() => setOpen(r.id)}>{r.cognome} {r.nome}</button>{r.keyFigure && <> <span className="rsm-pill promo">figura chiave</span></>}{r.note && <div className="rsm-sub">{r.note}</div>}</td>
                  <td className="num">{eur(r.target)}</td>
                  <td>{docState(r).need}</td>
                  <td><DocPill r={r} /></td>
                  <td className="num">{eur(r.capital)}{r.scopertura > 0 && <div className="rsm-sub" style={{ color: 'var(--c-error)' }}>non coperti {eur(r.scopertura)}</div>}</td>
                  <td className="nowrap">{r.remindedOn ? fmtDate(r.remindedOn) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </>}
      {current && <PersonPanel row={current} onClose={() => setOpen(null)} />}
    </div>
  )
}
