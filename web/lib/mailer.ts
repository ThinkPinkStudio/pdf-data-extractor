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

export async function sendMagicLink(email: string, token: string) {
  const baseUrl = process.env.MAGIC_LINK_BASE_URL || 'http://localhost:3000'
  const link = `${baseUrl}/auth/verify?token=${token}`
  const from = process.env.SMTP_FROM || 'PDF Extractor <noreply@localhost>'

  const transport = createTransport()

  await transport.sendMail({
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
  })
}
