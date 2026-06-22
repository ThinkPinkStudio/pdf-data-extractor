import { Resend } from 'resend';
import { config } from '../config.js';

const client = config.RESEND_API_KEY ? new Resend(config.RESEND_API_KEY) : null;

export async function sendMagicLink(email, token) {
  const link = `${config.BASE_URL}/auth/verify?token=${token}`;
  const expiryLabel = new Date(Date.now() + config.MAGIC_LINK_EXPIRY_MINUTES * 60_000)
    .toLocaleString('it-IT', { timeZone: 'Europe/Rome' });

  if (!client) {
    console.log(`\n🔗 [DEV] Magic link per ${email}:\n${link}\n`);
    return;
  }

  await client.emails.send({
    from: config.EMAIL_FROM,
    to:   email,
    subject: 'Accesso a PDF Data Extractor',
    html: `
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#f9f9f9;border-radius:8px">
  <h2 style="color:#1a1a2e;margin-bottom:8px">PDF Data Extractor</h2>
  <p style="color:#333">Hai richiesto l'accesso. Clicca il pulsante per entrare:</p>
  <a href="${link}"
     style="display:inline-block;background:#e94560;color:#fff;padding:12px 28px;
            border-radius:6px;text-decoration:none;font-weight:bold;margin:16px 0;font-size:15px">
    Accedi ora
  </a>
  <p style="color:#666;font-size:13px">Il link è valido per <b>${config.MAGIC_LINK_EXPIRY_MINUTES} minuti</b> (fino alle ${expiryLabel}).</p>
  <p style="color:#999;font-size:12px">Se non hai richiesto questo accesso, ignora questa email.</p>
</div>`,
  });
}
