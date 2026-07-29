import nodemailer from 'nodemailer'

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'localhost',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth:
      process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS || '',
          }
        : undefined,
  })
}

interface Email {
  from: string
  to: string
  subject: string
  text: string
  html: string
}

/**
 * Invia via Resend HTTP API (https://api.resend.com/emails). Usa solo HTTPS in
 * uscita (porta 443), utile su server VPN dove le porte SMTP sono chiuse.
 * `from` deve usare un dominio verificato su Resend (o onboarding@resend.dev in test).
 */
async function sendViaResend(apiKey: string, mail: Email) {
  let res: Response
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
    })
  } catch (e) {
    throw new Error(`Resend non raggiungibile (rete/HTTPS in uscita bloccata?): ${(e as Error).message}`)
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => '')
    let msg = raw
    let name = ''
    try { const j = JSON.parse(raw); msg = j.message || raw; name = j.name || '' } catch { /* raw */ }
    throw new Error(`Resend ${res.status}${name ? ` [${name}]` : ''}: ${explainResend(res.status, name, msg, mail.from)}`)
  }
}

// Traduce gli errori più comuni di Resend in un messaggio azionabile in italiano,
// includendo sempre il testo originale dell'API.
function explainResend(status: number, name: string, message: string, from: string): string {
  const m = `${name} ${message}`.toLowerCase()
  const domain = (from.match(/<([^>]+)>/)?.[1] || from).split('@')[1] || '(sconosciuto)'
  if (status === 401 || /api key|unauthorized|invalid.*key/.test(m)) {
    return `RESEND_API_KEY non valida o revocata. — Dettaglio: ${message}`
  }
  if (status === 403 && /domain is not verified|not verified|verify a domain/.test(m)) {
    return `Il dominio del mittente "${domain}" NON è verificato su Resend. Verifica il dominio su Resend (Domains) oppure imposta SMTP_FROM su un dominio verificato. — Dettaglio: ${message}`
  }
  if (status === 403 && /testing|own email|only send/.test(m)) {
    return `In modalità test Resend può inviare SOLO all'indirizzo del proprietario dell'account (mittente onboarding@resend.dev). Verifica un tuo dominio e usa SMTP_FROM con quel dominio per inviare ad altri destinatari. — Dettaglio: ${message}`
  }
  if (status === 422 || /validation/.test(m)) {
    return `Richiesta rifiutata (dati mittente/destinatario). Controlla il formato di SMTP_FROM (es. "Nome <noreply@tuodominio.it>"). — Dettaglio: ${message}`
  }
  if (status === 429) return `Limite di invio Resend superato (rate limit). Riprova tra poco. — Dettaglio: ${message}`
  return message || `Errore ${status}`
}

// Invio generico: Resend (HTTP API) se configurato, altrimenti fallback SMTP.
export async function sendEmail(mail: Email) {
  const resendKey = process.env.RESEND_API_KEY
  if (resendKey) {
    await sendViaResend(resendKey, mail)
    return
  }
  await createTransport().sendMail(mail)
}

// Notifica di fine elaborazione batch/bulk al proprietario (chi ha lanciato il lavoro).
export async function sendBatchCompleteEmail(
  to: string,
  opts: { label: string; total: number; done: number; error: number; canceled: number },
) {
  const from = process.env.SMTP_FROM || 'PDF Extractor <noreply@localhost>'
  const baseUrl = process.env.MAGIC_LINK_BASE_URL || 'http://localhost:3000'
  const link = `${baseUrl}/polizza/jobs`
  const esito = opts.error > 0 ? 'con alcuni errori' : 'con successo'
  const righe = [
    `Cartella: ${opts.label}`,
    `Dossier totali: ${opts.total}`,
    `Completati: ${opts.done}`,
    `Con errori: ${opts.error}`,
    `Annullati: ${opts.canceled}`,
  ]
  const mail: Email = {
    from,
    to,
    subject: `Elaborazione bulk completata: ${opts.label}`,
    text: `L'elaborazione della cartella "${opts.label}" è terminata ${esito}.\n\n${righe.join('\n')}\n\nApri il riepilogo: ${link}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #1a1a2e; margin-bottom: 8px;">Elaborazione bulk completata</h2>
        <p style="color: #444; margin-bottom: 16px;">La cartella <strong>${opts.label}</strong> è stata elaborata ${esito}.</p>
        <ul style="color:#444;font-size:14px;line-height:1.8;padding-left:18px;margin:0 0 24px;">
          <li>Dossier totali: <strong>${opts.total}</strong></li>
          <li>Completati: <strong>${opts.done}</strong></li>
          <li>Con errori: <strong>${opts.error}</strong></li>
          <li>Annullati: <strong>${opts.canceled}</strong></li>
        </ul>
        <a href="${link}" style="display:inline-block;background:#6c63ff;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;">
          Apri il riepilogo
        </a>
      </div>
    `,
  }
  await sendEmail(mail)
}

export async function sendMagicLink(email: string, token: string) {
  const baseUrl = process.env.MAGIC_LINK_BASE_URL || 'http://localhost:3000'
  const link = `${baseUrl}/auth/verify?token=${token}`
  const from = process.env.SMTP_FROM || 'PDF Extractor <noreply@localhost>'

  const mail: Email = {
    from,
    to: email,
    subject: 'Accedi a PDF Data Extractor',
    text: `Clicca il link seguente per accedere (valido 15 minuti):\n\n${link}\n\nSe non hai richiesto questo accesso, ignora questa email.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #1a1a2e; margin-bottom: 8px;">PDF Data Extractor</h2>
        <p style="color: #444; margin-bottom: 24px;">Clicca il pulsante per accedere. Il link è valido per <strong>15 minuti</strong>.</p>
        <a href="${link}" style="display:inline-block;background:#6c63ff;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;">
          Accedi ora
        </a>
        <p style="color:#999;font-size:12px;margin-top:24px;">
          Oppure copia questo URL nel browser:<br/>
          <a href="${link}" style="color:#6c63ff;">${link}</a>
        </p>
        <p style="color:#bbb;font-size:11px;margin-top:16px;">Se non hai richiesto questo accesso, ignora questa email.</p>
      </div>
    `,
  }

  // Resend (HTTP API) ha la precedenza se configurato: niente SMTP da gestire e
  // funziona anche dove le porte 465/587 sono chiuse. Altrimenti fallback SMTP.
  await sendEmail(mail)
}
