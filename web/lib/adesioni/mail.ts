// Invio email di riepilogo (nodemailer) per esportazioni/upload FTP di CSA
// Adesioni. Porta la logica di mailService.js usando la config SMTP esplicita
// (settingsWeb) invece del getSettings Electron. Best-effort: non deve bloccare.
import nodemailer from 'nodemailer'
import type { SmtpConfig, ExportNotify } from './settingsWeb'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const isEmail = (v: unknown) => EMAIL_RE.test(String(v || '').trim())

function transporter(smtp: SmtpConfig) {
  if (!smtp || !smtp.host) throw new Error('SMTP non configurato')
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port || 587,
    secure: !!smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  })
}

function fromHeader(smtp: SmtpConfig): string {
  const from = smtp.from || smtp.user
  return /</.test(from) ? from : `"CSA Adesioni" <${smtp.user}>`
}

export function resolveNotifyRecipients(userEmail: string, exportNotify: ExportNotify): { to: string; cc?: string } | null {
  if (!exportNotify || exportNotify.enabled === false) return null
  const user = isEmail(userEmail) ? String(userEmail).trim() : ''
  const shared = isEmail(exportNotify.sharedEmail) ? String(exportNotify.sharedEmail).trim() : ''
  const mode = exportNotify.mode || 'user'
  if (mode === 'shared' && shared) return { to: shared, cc: user && user !== shared ? user : undefined }
  if (mode === 'both' && shared) return { to: user || shared, cc: user && shared !== user ? shared : undefined }
  return user ? { to: user } : shared ? { to: shared } : null
}

export interface SummaryParams {
  smtp: SmtpConfig
  to: string
  cc?: string
  kind: 'export' | 'export-append' | 'ftp-upload'
  count?: number
  env?: string
  remotePath?: string
  user?: string
  attachment?: { filename: string; content: Buffer }
}

export async function sendExportSummary(p: SummaryParams): Promise<{ to: string; cc: string | null }> {
  const when = new Date().toLocaleString('it-IT')
  const isFtp = p.kind === 'ftp-upload'
  const title = isFtp ? 'Caricamento FTP completato' : 'Esportazione completata'
  const subject = isFtp ? `CSA Adesioni — File caricato su FTP ${p.env || ''}`.trim() : 'CSA Adesioni — Riepilogo esportazione'

  const rows: [string, string][] = [
    ['Operazione', isFtp ? `Upload FTP (${p.env || '—'})` : p.kind === 'export-append' ? 'Esportazione (append)' : 'Esportazione'],
    ...(typeof p.count === 'number' ? ([['Record', String(p.count)]] as [string, string][]) : []),
    ['File', p.attachment?.filename || '—'],
    ...(isFtp && p.remotePath ? ([['Percorso remoto', p.remotePath]] as [string, string][]) : []),
    ['Eseguita da', p.user || '—'],
    ['Data e ora', when],
  ]

  const rowsHtml = rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6a6a8a">${k}</td><td style="padding:4px 0"><strong>${v}</strong></td></tr>`).join('')
  const rowsText = rows.map(([k, v]) => `${k}: ${v}`).join('\n')
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:auto;color:#1a1b2e">
      <h2 style="color:#e91e8c;margin:0 0 8px">CSA Adesioni</h2>
      <p><strong>${title}.</strong> Trovi in allegato il foglio XLS.</p>
      <table style="border-collapse:collapse;font-size:14px;margin:12px 0">${rowsHtml}</table>
      <p style="font-size:12px;color:#6a6a8a">Email automatica di riepilogo dell'operazione.</p>
    </div>`

  await transporter(p.smtp).sendMail({
    from: fromHeader(p.smtp),
    to: p.to,
    cc: p.cc || undefined,
    subject,
    text: `${title}.\n\n${rowsText}\n\nIn allegato il foglio XLS.`,
    html,
    attachments: p.attachment ? [{ filename: p.attachment.filename, content: p.attachment.content }] : [],
  })
  return { to: p.to, cc: p.cc || null }
}
