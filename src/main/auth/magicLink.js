import { createServer } from 'http'
import { shell } from 'electron'
import { randomUUID } from 'crypto'
import { saveSession } from './session.js'
import { logAction } from '../services/actionLogger.js'
import { resilientFetch, describeNetworkError } from '../services/netFetch.js'

/* global __RESEND_API_KEY__ __MAGIC_LINK_FROM__ __ALLOWED_DOMAINS__ */
// Configurazione iniettata SOLO a build time (vedi electron.vite.config.mjs):
// nei PC dei clienti le variabili d'ambiente non esistono, quindi qualsiasi
// process.env.* a runtime sarebbe sempre vuoto. La fonte unica è il `define`.
const RESEND_API_KEY = typeof __RESEND_API_KEY__ !== 'undefined' ? __RESEND_API_KEY__ : ''
const MAGIC_LINK_FROM =
  (typeof __MAGIC_LINK_FROM__ !== 'undefined' && __MAGIC_LINK_FROM__) ||
  'PDF Data Extractor <noreply@thinkpinkstudio.it>'
const ALLOWED_DOMAINS = (typeof __ALLOWED_DOMAINS__ !== 'undefined' && __ALLOWED_DOMAINS__) || '*'

const pendingTokens = new Map()
const EXPIRY_MS = 15 * 60 * 1000

let callbackServer = null
let callbackPort = null

// Loopback callback routes keyed by pathname. The magic-link route is
// registered below; the SSO flow (auth/sso.js) registers /sso/callback on the
// same ephemeral server so both share one port.
const routes = new Map()

export function registerCallbackRoute(pathname, handler) {
  routes.set(pathname, handler)
}

export function isAllowedDomain(email) {
  if (ALLOWED_DOMAINS === '*') return true
  const domain = email.toLowerCase().split('@')[1] ?? ''
  return ALLOWED_DOMAINS.split(',').map((d) => d.trim().toLowerCase()).includes(domain)
}

export async function ensureCallbackServer() {
  if (callbackServer) return callbackPort

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost')
      const handler = routes.get(url.pathname)
      if (!handler) {
        res.writeHead(404)
        res.end('Not found')
        return
      }
      try {
        await handler(req, res, url)
      } catch {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<h2>Errore interno.</h2><p>Puoi chiudere questa finestra.</p>')
      }
    })

    server.listen(0, '127.0.0.1', () => {
      callbackPort = server.address().port
      callbackServer = server
      resolve(callbackPort)
    })

    server.on('error', reject)
  })
}

// Magic-link callback (unchanged behavior, now a registered route handler).
registerCallbackRoute('/auth/callback', async (req, res, url) => {
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

// Invia il magic link tramite l'API HTTPS di Resend (https://api.resend.com).
// Niente SMTP dal client: la chiamata esce su 443, l'unica porta che i firewall
// aziendali restrittivi lasciano praticamente sempre aperta. resilientFetch
// gestisce retry sui blip di rete e, in caso di TLS inspection/proxy aziendale,
// ricade sullo stack di rete di Chromium (proxy di sistema + CA del SO).
async function sendEmail(email, link) {
  if (!RESEND_API_KEY) {
    throw new Error(
      'Invio email non configurato: chiave Resend mancante nel build (RESEND_API_KEY).'
    )
  }

  let res
  try {
    res = await resilientFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: MAGIC_LINK_FROM,
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
      }),
      signal: AbortSignal.timeout(15000),
    })
  } catch (err) {
    // Errore di rete prima ancora di una risposta HTTP: diagnosi leggibile
    // (proxy/firewall/TLS) per il supporto.
    throw new Error(describeNetworkError(err).message)
  }

  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      detail = body?.message || body?.error?.message || ''
    } catch {
      /* corpo non-JSON o vuoto */
    }
    throw new Error(
      `Invio email fallito (HTTP ${res.status})${detail ? `: ${detail}` : ''}.`
    )
  }
}

export function closeCallbackServer() {
  if (callbackServer) {
    callbackServer.close()
    callbackServer = null
    callbackPort = null
  }
}
