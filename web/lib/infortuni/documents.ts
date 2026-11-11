// Certificato di adesione e questionario delle esigenze in PDF. I due Word del
// cliente («CSA Broker _Certificato_draft_clean», «Questionario AIG INFORTUNI
// Conducenti CSA REV. CSA») sono ricostruiti in HTML con gli stessi testi e
// stampati con Chromium (Playwright), come il modulo di CSA Adesioni: nel
// container non c'è un convertitore da Word. Le parti HTML sono pure
// (certificateHtml, questionnaireHtml: test senza browser); renderPdf stampa.
import { readFileSync, existsSync } from 'fs'
import JSZip from 'jszip'
import { fmtDate, optionOf, shortEuro, QUESTIONS, docBaseName, configForRecord } from './rules.js'
import { infortuniAssetPath } from './bdx'
import type { Rec } from './store'
import type { InfortuniConfig } from './store'

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
const date = (v: unknown) => esc(fmtDate(String(v || '')))

function dataUri(file: string): string {
  const p = infortuniAssetPath(file)
  try { if (existsSync(p)) return `data:image/png;base64,${readFileSync(p).toString('base64')}` } catch { /* niente immagine */ }
  return ''
}

const NAVY = '#00205B'

const BASE_CSS = `
  @page { size: A4; margin: 22mm 20mm 26mm 20mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`

/* ─── Certificato di adesione ──────────────────────────────────────────── */

export function certificateHtml(rec: Rec, current: InfortuniConfig, images: { logo?: string; firma?: string } = {}): string {
  // Premi e massimali della tariffa dell'adesione, interruttori attuali.
  const config = configForRecord(current, rec) as InfortuniConfig
  const opt = optionOf(config, rec.opzione)
  const row = (label: string, value: unknown) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`
  const optionBlock = (o: InfortuniConfig['options'][number]) => {
    const chosen = opt && o.key === opt.key
    return `
      <div class="opt${chosen ? ' chosen' : ''}">
        <div class="opt-head"><span class="box">${chosen ? '&#10005;' : ''}</span>
          <b>${esc(String(o.name).toUpperCase())} - Premio annuale ${esc(shortEuro(o.premio))}€</b> <i>(di cui ${esc(o.imposte)}€ imposte)</i></div>
        <ul>
          <li>Morte del conducente da infortunio con massimale <u>${esc(o.morte)}€</u></li>
          <li>Invalidità Permanente da infortunio con massimale <u>${esc(o.invalidita)}€</u> (franchigia ${esc(o.franchigia)})</li>
          <li>Rimborso spese mediche da infortunio <u>${esc(o.speseMediche)}€</u>${o.franchigiaSpese && config.showFranchigiaSpese !== false ? ` (franchigia ${esc(o.franchigiaSpese)}€)` : ''}</li>
        </ul>
      </div>`
  }
  const pagamento = String(config.pagamento || '').trim() || '[…]'
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Certificato ${esc(rec.numero)}</title><style>
    ${BASE_CSS}
    body { font-family: "Times New Roman", "Liberation Serif", Times, serif; font-size: 10.5pt; line-height: 1.3; }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    h1 { font-size: 15pt; margin: 0; flex: 1; text-align: center; }
    .logo { height: 40px; }
    .sub { text-align: center; font-weight: bold; font-size: 10pt; margin: 10px 0 18px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    .cap { background: ${NAVY}; color: #fff; font-weight: bold; text-align: center; padding: 4px 6px; font-size: 11pt; border: 1px solid ${NAVY}; }
    th, td { border: 1px solid ${NAVY}; padding: 4px 6px; text-align: left; vertical-align: top; font-size: 10pt; }
    th { width: 34%; font-weight: bold; }
    .pol td { padding: 8px 10px; }
    .opt { margin: 6px 0 10px; }
    .opt-head { display: flex; align-items: baseline; gap: 6px; }
    .box { display: inline-flex; width: 12px; height: 12px; border: 1px solid #000; align-items: center; justify-content: center; font-size: 9pt; line-height: 1; flex: none; position: relative; top: 2px; }
    ul { margin: 4px 0 0 18px; padding-left: 12px; }
    li { margin: 2px 0; }
    h2 { font-size: 11.5pt; margin: 16px 0 6px; }
    ol { margin: 0; padding-left: 20px; }
    ol li { font-weight: bold; margin-bottom: 4px; }
    .sign-aig { margin: 10px 0 0 auto; width: 240px; text-align: center; font-size: 9.5pt; }
    .sign-aig img { width: 150px; display: block; margin: 0 auto 2px; }
    .decl li { margin-bottom: 6px; }
    .sig { display: flex; justify-content: space-between; margin: 10px 30px 16px; font-size: 10pt; }
    .sig div { text-align: center; }
    .sig span { display: block; margin-top: 18px; border-top: 1px solid #000; width: 160px; }
    .arts { margin: 4px 0 0 24px; }
    .arts div { margin: 1px 0; }
    .avoid { break-inside: avoid; }
  </style></head><body>
    <div class="top">
      <span style="width:80px"></span>
      <h1>CERTIFICATO DI ADESIONE N° ${esc(rec.numero)}</h1>
      ${images.logo ? `<img class="logo" src="${images.logo}" alt="AIG">` : '<span style="width:80px"></span>'}
    </div>
    <div class="sub">ALLA POLIZZA INFORTUNI COLLETTIVA N. ${esc(config.polizzaCollettiva)} CON CONTRAENTE CSA Consulenze &amp; Soluzioni Aziendali S.r.l., Sezione RUI n° B000014417 CON AIG EUROPE S.A.</div>

    <table class="avoid">
      <tr><td class="cap" colspan="2">ANAGRAFICA – DATI DELL’ADERENTE/ ASSICURATO</td></tr>
      ${row('Nome', rec.nome)}
      ${row('Cognome', rec.cognome)}
      ${row('Ragione Sociale', config.showRagioneSociale ? rec.ragione_sociale : '')}
      <tr><th>Data di Nascita</th><td>${date(rec.data_nascita)}</td></tr>
      ${row('Codice Fiscale/ P. IVA', rec.codice_fiscale)}
      ${row('Mail/PEC', rec.email)}
      ${row('Targa', rec.targa)}
      ${row('Tipo Veicolo', rec.tipo_veicolo)}
      ${row('Marca', rec.marca)}
      ${row('Modello', rec.modello)}
    </table>

    <table class="pol">
      <tr><td class="cap" colspan="4">INFORMAZIONI RELATIVE ALLA POLIZZA</td></tr>
      <tr><th style="width:22%">Data di Adesione</th><td style="width:28%">${date(rec.data_adesione)}</td><th style="width:22%">Data di Scadenza</th><td>${date(rec.data_scadenza)}</td></tr>
      <tr><td colspan="4">
        ${(config.options || []).map(optionBlock).join('')}
        <div style="margin-top:6px">Il pagamento del premio avverrà annualmente tramite ${esc(pagamento)}</div>
      </td></tr>
    </table>

    <div class="avoid">
      <h2>AVVERTENZE</h2>
      <ol>
        <li>Le dichiarazioni non veritiere inesatte o reticenti rese per la conclusione del contratto, possono compromettere il diritto alla prestazione</li>
        <li>Qualora siano oggetto della polizza prestazioni o altre coperture che richiedono di acquisire informazioni sullo stato di salute dell’assicurato, si precisa che: (a) prima della sottoscrizione del questionario sanitario colui che rilascia le dichiarazioni deve verificarne l’esattezza; e (b) l’assicurato può chiedere di essere sottoposto a visita medica per certificare l’effettivo stato di salute, con evidenza del costo a suo carico</li>
      </ol>
      <div class="sign-aig">${images.firma ? `<img src="${images.firma}" alt="">` : ''}AIG Europe S.A. – Rappresentanza Generale per l’Italia</div>
    </div>

    <h2>DICHIARAZIONI IN MATERIA DI CONSEGNA DELLA DOCUMENTAZIONE</h2>
    <ul class="decl">
      <li>L’Aderente/ Assicurato dichiara di aver ricevuto e di aver preso visione dei seguenti documenti, in conformità a quanto previsto dal Regolamento IVASS 41/2018 e smi:
        <ul>
          <li>Dip Danni (Documento Informativo Precontrattuale Danni);</li>
          <li>Dip Aggiuntivo Danni (Documento Informativo Precontrattuale Aggiuntivo Danni);</li>
          <li>Condizioni di Assicurazione, comprensive di glossario;</li>
          <li>Informativa privacy di AIG Europe S.A. – Rappresentanza Generale per l’Italia</li>
        </ul>
      </li>
      <li>Dichiara inoltre di aver ricevuto prima della conclusione del contratto la documentazione di cui all’art. 56 Reg. 40/2018, unitamente al questionario, che ha provveduto a compilare, per la valutazione delle richieste ed esigenze dell’aderente/assicurato ai sensi e per gli effetti dell’art. 58 del Regolamento IVASS n. 40/2018.</li>
    </ul>
    <div class="sig avoid"><div>Luogo e Data<span></span></div><div>L’Aderente/ Assicurato<span></span></div></div>
    <ul class="decl"><li>L’Aderente/ assicurato dopo aver visionato attentamente l’informativa privacy fornita dalla Compagnia ai sensi dell’art. 13 del D.lgs. 196/2003 e s.m.i. ed aver preso visione dei diritti attribuiti dall’art. 7 del Decreto Legislativo stesso esprime il consenso al trattamento dei dati personali.</li></ul>
    <div class="sig avoid"><div>Luogo e data<span></span></div><div>L’Aderente/Assicurato<span></span></div></div>
    <div class="avoid">
      <ul class="decl"><li>Si dichiara ai sensi e per gli effetti dell’art. 1341 c.c. di ave preso atto e di approvare specificamente le limitazioni e le esclusioni di cui agli articoli di seguito elencati:</li></ul>
      <div class="arts">
        <div>Articolo 6 – Pagamento e mezzi di pagamento del premio</div>
        <div>Articolo 7 – Oneri fiscali</div>
        <div>Articolo 13 – Diritto di ripensamento</div>
        <div>Articolo 15 – Decorrenza, durata e cessazione delle garanzie</div>
        <div>Articolo 16 – Recesso in caso di sinistro</div>
        <div>Articolo 17 – Persone assicurabili</div>
        <div>Articolo 19 – Limiti di età</div>
        <div>Articolo 30 – Sanzioni internazionali</div>
        <div>Articolo 31 – Esclusioni</div>
        <div>Articolo 32 – Cumulo di Indennità</div>
        <div>Articolo 33 – Dichiarazioni e decadenza</div>
        <div>Articolo 34 – Denuncia del sinistro</div>
        <div>Articolo 36 – Pareri medici – Controversie</div>
      </div>
      <div class="sig"><div>Luogo e data<span></span></div><div>L’Aderente/Assicurato<span></span></div></div>
    </div>
  </body></html>`
}

export const CERTIFICATE_FOOTER = `<div style="width:100%;font-family:Arial,'Liberation Sans',sans-serif;font-size:6.5px;color:#444;text-align:center;line-height:1.35;padding:0 20mm">
  AIG Europe S.A. Rappresentanza Generale per l'Italia - Piazza Vetra, 17 - 20123 Milano. Tel: +39 02 36901. Fax: +39 02 3690222. www.aig.co.it.<br>
  Registro Imprese Milano / C.F. 97819940152 - REA Milano n. 2530954. Sede secondaria di AIG Europe S.A. - Registrata in Lussemburgo con il numero R.C.S. B 218806.<br>
  Sede legale: Avenue John F. Kennedy n. 35D, L-1855 Lussemburgo - Capitale Sociale Euro 47.176.225
  <div style="text-align:right;margin-top:2px">Pag. <span class="pageNumber"></span> a <span class="totalPages"></span></div>
</div>`

/* ─── Questionario delle richieste ed esigenze ─────────────────────────── */

export function questionnaireHtml(rec: Rec, config: InfortuniConfig): string {
  const answers = rec.questionario || {}
  const opt = (q: string, v: 'SI' | 'NO') => `<div class="ans"><span class="dot">${answers[q] === v ? '&#9679;' : '&#9675;'}</span> ${v === 'SI' ? 'SI;' : 'NO.'}</div>`
  const who = [rec.cognome, rec.nome].filter(Boolean).join(' ') || (config.showRagioneSociale ? rec.ragione_sociale : '') || ''
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Questionario ${esc(rec.numero)}</title><style>
    ${BASE_CSS}
    body { font-family: Arial, "Liberation Sans", Helvetica, sans-serif; font-size: 10pt; line-height: 1.35; }
    h1 { font-size: 10.5pt; font-weight: normal; text-align: center; margin: 0 0 18px; }
    p { text-align: justify; margin: 0 0 14px; }
    .sec { margin: 18px 0 6px; }
    .info td { padding: 3px 12px 3px 0; }
    .info b { font-weight: bold; }
    .q { margin: 14px 0 4px; text-align: justify; }
    .ans { margin: 6px 0 0 2px; }
    .dot { font-size: 12pt; }
    .num { font-size: 8pt; color: #333; margin-top: 4px; }
  </style></head><body>
    <h1>QUESTIONARIO SULLA VALUTAZIONE DELLE RICHIESTE ED ESIGENZE DEL CONTRAENTE<br>AIG INFORTUNI CONDUCENTI</h1>
    <p>II presente questionario, la cui proposizione è obbligatoria ai sensi della normativa vigente, ha lo scopo di acquisire le informazioni necessarie a valutare I‘ adeguatezza del contratto rispetto alle richieste ed esigenze assicurative del contraente.</p>
    <div class="sec">INFORMAZIONI SULL’ADERENTE/ ASSICURATO</div>
    <table class="info">
      <tr><td>Cognome e Nome/Ragione sociale</td><td><b>${esc(who)}</b></td></tr>
      <tr><td>Codice fiscale/Partita IVA</td><td><b>${esc(rec.codice_fiscale)}</b></td></tr>
    </table>
    ${config.questionarioNumero !== false ? `<div class="num">Certificato di adesione N° ${esc(rec.numero)}</div>` : ''}
    <div class="sec" style="margin-top:22px">INDIVIDUAZIONE DELLE RICHIESTE ED ESIGENZE ASSICURATIVE</div>
    ${QUESTIONS.map((q: { id: string; text: string }, i: number) => `<div class="q">${i + 1}. ${esc(q.text)}</div>${opt(q.id, 'SI')}${opt(q.id, 'NO')}`).join('')}
    <p style="margin-top:28px">Il Contraente approva e conferma le risposte sopra riportate.</p>
    <p>Il Contraente</p>
    <div style="margin-top:28px;width:160px;border-top:1px solid #000"></div>
  </body></html>`
}

export const QUESTIONNAIRE_FOOTER = `<div style="width:100%;font-family:Arial,'Liberation Sans',sans-serif;font-size:7px;color:#444;padding:0 20mm;display:flex;justify-content:space-between">
  <span>MIL-#2980980-v4</span><span>Pag. <span class="pageNumber"></span> a <span class="totalPages"></span></span>
</div>`

/* ─── Stampa ───────────────────────────────────────────────────────────── */

type Browser = Awaited<ReturnType<typeof import('playwright')['chromium']['launch']>>

async function printPdf(browser: Browser, html: string, footer: string): Promise<Buffer> {
  const page = await browser.newPage()
  try {
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate('document.fonts ? document.fonts.ready.then(() => true) : true')
    const pdf = await page.pdf({
      format: 'A4', printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footer,
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

/** Certificato e questionario di ogni adesione, in uno ZIP. */
export async function documentsZip(records: Rec[], config: InfortuniConfig): Promise<Buffer> {
  const { chromium } = await import('playwright')
  const images = { logo: dataUri('aig-logo.png'), firma: dataUri('aig-firma.png') }
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  const zip = new JSZip()
  try {
    for (const rec of records) {
      const base = docBaseName(rec)
      zip.file(`${base}_Certificato.pdf`, await printPdf(browser, certificateHtml(rec, config, images), CERTIFICATE_FOOTER))
      zip.file(`${base}_Questionario.pdf`, await printPdf(browser, questionnaireHtml(rec, config), QUESTIONNAIRE_FOOTER))
    }
  } finally {
    await browser.close()
  }
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
}
