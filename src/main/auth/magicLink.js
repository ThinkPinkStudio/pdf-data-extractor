import { createServer } from 'http'
import { shell } from 'electron'
import { randomUUID } from 'crypto'
import { saveSession } from './session.js'
import { logAction } from '../services/actionLogger.js'

// In-memory token store for Electron (tokens valid 15 min)
const pendingTokens = new Map()
const EXPIRY_MS = 15 * 60 * 1000

let callbackServer = null
let callbackPort = null

async function ensureCallbackServer() {
  if (callbackServer) return callbackPort

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost`)
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
        res.end('<h2>Link scaduto.</h2><p>Richiedi un nuovo accesso dall\'app.</p>')
        return
      }

      pendingTokens.delete(token)
      await saveSession(entry.email)
      logAction({ email: entry.email, action: 'auth.verify', metadata: { source: 'electron' } })

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f0f1a;color:#e8e8f0">
          <h2 style="color:#6c63ff">Accesso effettuato!</h2>
          <p>Puoi chiudere questa finestra e tornare all'applicazione.</p>
          <script>setTimeout(() => window.close(), 2000)</script>
        </body></html>
      `)

      // Notify main process that login succeeded
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

/**
 * Send magic link via SMTP (uses env vars) and wait for callback.
 * Returns the authenticated email or throws on timeout/error.
 */
export async function sendMagicLinkAndWait(email, smtpConfig) {
  const port = await ensureCallbackServer()
  const token = randomUUID()
  const expiresAt = Date.now() + EXPIRY_MS

  let resolveLogin, rejectLogin
  const loginPromise = new Promise((res, rej) => {
    resolveLogin = res
    rejectLogin = rej
  })

  pendingTokens.set(token, { email, expiresAt, resolve: resolveLogin })

  // Timeout after 10 minutes
  const timeout = setTimeout(() => {
    pendingTokens.delete(token)
    rejectLogin(new Error('Timeout: nessun accesso ricevuto entro 10 minuti.'))
  }, 10 * 60 * 1000)

  const link = `http://127.0.0.1:${port}/auth/callback?token=${token}`

  // Send email
  await sendEmail(email, link, smtpConfig)
  logAction({ email, action: 'auth.send_link', metadata: { source: 'electron' } })

  // Open browser for user convenience
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

async function sendEmail(email, link, cfg) {
  const nodemailer = await import('nodemailer')
  const transport = nodemailer.default.createTransport({
    host: cfg.smtpHost || process.env.SMTP_HOST || 'localhost',
    port: parseInt(cfg.smtpPort || process.env.SMTP_PORT || '587', 10),
    secure: (cfg.smtpSecure ?? process.env.SMTP_SECURE) === 'true',
    auth: (cfg.smtpUser || process.env.SMTP_USER)
      ? { user: cfg.smtpUser || process.env.SMTP_USER, pass: cfg.smtpPass || process.env.SMTP_PASS || '' }
      : undefined,
  })

  const from = cfg.smtpFrom || process.env.SMTP_FROM || 'PDF Extractor <noreply@localhost>'

  await transport.sendMail({
    from,
    to: email,
    subject: 'Accedi a PDF Data Extractor',
    text: `Clicca per accedere (valido 15 minuti): ${link}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
        <h2 style="color:#1a1a2e">PDF Data Extractor</h2>
        <p>Clicca per accedere. Valido <strong>15 minuti</strong>.</p>
        <a href="${link}" style="display:inline-block;background:#6c63ff;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600">
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
