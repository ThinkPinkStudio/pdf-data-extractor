import { createServer } from 'http'
import { shell } from 'electron'
import { randomUUID } from 'crypto'
import { saveSession } from './session.js'
import { logAction } from '../services/actionLogger.js'

const pendingTokens = new Map()
const EXPIRY_MS = 15 * 60 * 1000

let callbackServer = null
let callbackPort = null

function isAllowedDomain(email) {
  const allowed = process.env.ALLOWED_DOMAINS || '*'
  if (allowed === '*') return true
  const domain = email.toLowerCase().split('@')[1] ?? ''
  return allowed.split(',').map((d) => d.trim().toLowerCase()).includes(domain)
}

async function ensureCallbackServer() {
  if (callbackServer) return callbackPort

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname !== '/auth/callback') {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const token = url.searchParams.get('token')
      if (!token || !pendingTokens.has(token)) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<h2>Link non valido o già utilizzato.</h2><p>Puoi chiudere questa finestra.</p>')
        return
      }

      const entry = pendingTokens.get(token)
      if (Date.now() > entry.expiresAt) {
        pendingTokens.delete(token)
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end("<h2>Link scaduto.</h2><p>Richiedi un nuovo accesso dall'app.</p>")
        return
      }

      pendingTokens.delete(token)
      await saveSession(entry.email)
      logAction({ email: entry.email, action: 'auth.verify', metadata: { source: 'electron' } })

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f0f1a;color:#e8e8f0">
          <h2 style="color:#e91e8c">Accesso effettuato!</h2>
          <p>Puoi chiudere questa finestra e tornare all'applicazione.</p>
          <script>setTimeout(() => window.close(), 2000)</script>
        </body></html>
      `)

      entry.resolve(entry.email)
    })

    server.listen(0, '127.0.0.1', () => {
      callbackPort = server.address().port
      callbackServer = server
      resolve(callbackPort)
    })

    server.on('error', reject)
  })
}

export async function sendMagicLinkAndWait(email) {
  if (!isAllowedDomain(email)) {
    throw new Error('Dominio email non autorizzato.')
  }

  const port = await ensureCallbackServer()
  const token = randomUUID()
  const expiresAt = Date.now() + EXPIRY_MS

  let resolveLogin, rejectLogin
  const loginPromise = new Promise((res, rej) => {
    resolveLogin = res
    rejectLogin = rej
  })

  pendingTokens.set(token, { email, expiresAt, resolve: resolveLogin })

  const timeout = setTimeout(() => {
    pendingTokens.delete(token)
    rejectLogin(new Error('Timeout: nessun accesso ricevuto entro 10 minuti.'))
  }, 10 * 60 * 1000)

  const link = `http://127.0.0.1:${port}/auth/callback?token=${token}`

  await sendEmail(email, link)
  logAction({ email, action: 'auth.send_link', metadata: { source: 'electron' } })

  await shell.openExternal(link)

  try {
    const authedEmail = await loginPromise
    clearTimeout(timeout)
    return authedEmail
  } catch (err) {
    clearTimeout(timeout)
    throw err
  }
}

async function sendEmail(email, link) {
  const nodemailer = await import('nodemailer')
  const transport = nodemailer.default.createTransport({
    host: process.env.SMTP_HOST || 'localhost',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
      : undefined,
  })

  const from = process.env.SMTP_FROM || 'PDF Extractor <noreply@localhost>'

  await transport.sendMail({
    from,
    to: email,
    subject: 'Accedi a PDF Data Extractor',
    text: `Clicca per accedere (valido 15 minuti): ${link}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
        <h2 style="color:#e91e8c">PDF Data Extractor</h2>
        <p>Clicca per accedere. Valido <strong>15 minuti</strong>.</p>
        <a href="${link}" style="display:inline-block;background:#e91e8c;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600">
          Accedi ora
        </a>
        <p style="color:#bbb;font-size:11px;margin-top:16px">Se non hai richiesto questo accesso, ignora questa email.</p>
      </div>
    `,
  })
}

export function closeCallbackServer() {
  if (callbackServer) {
    callbackServer.close()
    callbackServer = null
    callbackPort = null
  }
}
