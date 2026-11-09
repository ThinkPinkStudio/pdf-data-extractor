// Invio del BDX delle inclusioni per email. Il server di posta è quello già
// configurato in CSA Adesioni → Impostazioni (stessa società, stesso
// mittente); destinatari, copia e oggetto stanno nelle Impostazioni di questa
// sezione.
import nodemailer from 'nodemailer'
import { getAdesioniFullSettings } from '../adesioni/settingsWeb'
import { splitAddresses } from './rules.js'
import type { InfortuniConfig } from './store'

export async function sendBdx(p: { config: InfortuniConfig; file: { filename: string; content: Buffer }; count: number; user: string }) {
  const to = splitAddresses(p.config.mailTo)
  const cc = splitAddresses(p.config.mailCc)
  if (!to.length) throw new Error('Nessun destinatario: impostalo in CSA Adesioni Infortuni → Impostazioni')
  const { smtp } = await getAdesioniFullSettings()
  if (!smtp.host) throw new Error('Server di posta non configurato: impostalo in CSA Adesioni → Impostazioni (SMTP)')
  const from = String(smtp.from || smtp.user || '').trim()
  if (!from) throw new Error('Mittente non configurato: imposta il mittente o l\'utente SMTP in CSA Adesioni → Impostazioni')
  const when = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })
  const subject = String(p.config.mailSubject || '').trim() || 'CSA Adesioni Infortuni — BDX inclusioni'
  const text = `In allegato il BDX delle inclusioni alla polizza infortuni collettiva ${p.config.polizzaCollettiva}: ${p.count} ${p.count === 1 ? 'adesione' : 'adesioni'}.\n\nInviato da ${p.user} il ${when}.`
  await nodemailer.createTransport({
    host: smtp.host, port: smtp.port || 587, secure: !!smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  }).sendMail({
    from: /</.test(from) ? from : `"CSA Adesioni Infortuni" <${from}>`,
    to: to.join(', '),
    cc: cc.length ? cc.join(', ') : undefined,
    subject,
    text,
    attachments: [{ filename: p.file.filename, content: p.file.content }],
  })
  return { to: to.join(', '), cc: cc.join(', ') }
}
