'use client'

// Import dello stato di rischio dal file dell'Azienda, in due passi: si sceglie
// il file e si vede che cosa ne capisce il programma, poi si conferma. Niente
// viene salvato prima della conferma.
import Link from 'next/link'
import { useRef, useState } from 'react'
import { VitaGate, VitaHeader, eur, useFlash, useVita } from '@/components/vita/useVita'

interface Dry {
  n: number
  perCompany: Record<string, number>
  premium: number
  warnings: string[]
  missingRal: number
  replaces?: number
}

export default function VitaImportPage() {
  const vita = useVita()
  const cfg = vita.cfg
  const [file, setFile] = useState<File | null>(null)
  const [dry, setDry] = useState<Dry | null>(null)
  const [busy, setBusy] = useState(false)
  const [understood, setUnderstood] = useState(false)
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const { setFlash, node: flashNode } = useFlash(vita)

  async function send(confirm: boolean, f = file) {
    if (!f || !vita.programId) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      if (confirm) fd.append('confirm', '1')
      const r = await fetch(`/api/vita/programs/${vita.programId}/import`, { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Errore')
      if (confirm) {
        await vita.reload()
        setDry(null); setFile(null); setUnderstood(false)
        if (fileRef.current) fileRef.current.value = ''
        setFlash({ ok: true, text: j.label || `Caricati ${j.n} assicurati`, opId: j.opId })
      } else setDry(j)
    } catch (e) { setFlash({ ok: false, text: (e as Error).message }); setDry(null) } finally { setBusy(false) }
  }

  function pick(f: File | null) {
    setFile(f); setDry(null); setUnderstood(false)
    if (f) send(false, f)
  }

  const gravi = dry ? dry.warnings.filter((w) => /RAL|tassi|contraente|intestazione/i.test(w)) : []
  const altri = dry ? dry.warnings.filter((w) => !gravi.includes(w)) : []

  return (
    <div className="rsm">
      <VitaHeader vita={vita} title="Importa lo stato di rischio">
        <Link className="btn btn-secondary" href="/vita">Vai allo stato di rischio</Link>
      </VitaHeader>

      <VitaGate vita={vita}>
        {flashNode}
        {!vita.editor ? <div className="alert alert-error">Sola consultazione: l&apos;import lo fa chi gestisce il programma.</div> : (
          <>
            <ol className="rsm-steps">
              <li className={file ? 'done' : 'on'}><span className="n">{file ? '✓' : '1'}</span>Scegli il file dell&apos;Azienda</li>
              <li className={dry ? 'on' : ''}><span className="n">2</span>Controlla e importa</li>
            </ol>

            <div className="rsm-box">
              <div className="rsm-box-body">
                <div className={`rsm-drop${drag ? ' on' : ''}`} role="button" tabIndex={0}
                  onClick={() => fileRef.current?.click()}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click() }}
                  onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0] || null) }}>
                  <p><b>{file ? file.name : 'Trascina qui il file Excel, oppure fai clic per sceglierlo'}</b></p>
                  <p className="rsm-note">Un foglio per contraente, con le colonne del vostro tracciato: codice fiscale, livello, RAL {vita.program?.year}, figura chiave, documentazione sanitaria.</p>
                </div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0] || null)} />
                {busy && !dry && <p className="rsm-note"><span className="spinner" /> Leggo il file…</p>}
              </div>
            </div>

            {dry && (
              <>
                <div className="rsm-kpis">
                  {cfg?.companies.map((c) => (
                    <div className="rsm-kpi" key={c.key}>
                      <div className="rsm-kpi-top"><span>{c.name}</span><span>{c.policy ? `pol. ${c.policy}` : ''}</span></div>
                      <div className="rsm-kpi-num">{dry.perCompany[c.key] || 0}</div>
                      <div className="rsm-kpi-line">assicurati nel file</div>
                    </div>
                  ))}
                  <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Premio lordo annuo</span></div><div className="rsm-kpi-num">{eur(dry.premium)}</div><div className="rsm-kpi-line">calcolato coi tassi del programma</div></div>
                </div>

                {gravi.map((w, i) => <div key={i} className="alert alert-error">{w}</div>)}

                {altri.length > 0 && (
                  <div className="rsm-box">
                    <details>
                      <summary className="rsm-box-head" style={{ cursor: 'pointer', borderBottom: 0 }}>
                        <span className="rsm-box-title">{altri.length} avvisi sui dati del file</span>
                        <span className="rsm-note">Codici fiscali che non tornano: si importano lo stesso, conviene correggerli dopo.</span>
                      </summary>
                      <div className="rsm-box-body">{altri.map((w, i) => <div key={i} className="rsm-issue warning">{w}</div>)}</div>
                    </details>
                  </div>
                )}

                <div className="rsm-box">
                  <div className="rsm-box-body">
                    <p>Pronti <b>{dry.n}</b> assicurati da caricare in «{vita.program?.name}».</p>
                    {!!dry.replaces && (
                      <label className="rsm-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontSize: 12.5, color: 'var(--c-error)' }}>
                        <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} style={{ height: 16, width: 16 }} />
                        Ho capito: sostituisce i {dry.replaces} assicurati già registrati in questo programma.
                      </label>
                    )}
                    <div className="rsm-row">
                      <button className="btn btn-primary" disabled={busy || !dry.n || (!!dry.replaces && !understood)} onClick={() => send(true)}>Importa {dry.n} assicurati</button>
                      <button className="btn btn-secondary" disabled={busy} onClick={() => { setDry(null); setFile(null); if (fileRef.current) fileRef.current.value = '' }}>Annulla</button>
                    </div>
                    <p className="rsm-note">L&apos;import si annulla dalla scheda della persona o dal messaggio qui sopra, finché è l&apos;ultima operazione del programma.</p>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </VitaGate>
    </div>
  )
}
