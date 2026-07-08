/**
 * Login con "account condiviso" (SSO) tramite il release-distributor come
 * identity provider, in stile OAuth per app desktop (RFC 8252 loopback):
 *
 *  1. startSsoLoginAndWait() apre il browser di sistema su /identity/authorize
 *     del release-distributor, con client_id, redirect_uri loopback e uno
 *     `state` casuale anti-CSRF, poi attende il callback.
 *  2. L'utente accede (password, oppure primo accesso via link + password).
 *  3. Il release-distributor reindirizza a http://127.0.0.1:<porta>/sso/callback
 *     con code + state, servito dallo stesso server loopback del magic link.
 *  4. Il callback valida lo `state`, scambia il `code` server-to-server su
 *     /identity/token e ottiene l'email; la password non transita mai da qui.
 *
 * Il magic-link locale resta invariato: questo è un percorso aggiuntivo.
 */
import { shell } from 'electron'
import { randomBytes } from 'crypto'
import { ensureCallbackServer, registerCallbackRoute, isAllowedDomain } from './magicLink.js'
import { saveSession } from './session.js'
import { resilientFetch, describeNetworkError } from '../services/netFetch.js'
import { logAction } from '../services/actionLogger.js'

/* global __SSO_BASE_URL__ */
const SSO_BASE_URL =
  (typeof __SSO_BASE_URL__ !== 'undefined' && __SSO_BASE_URL__) ||
  'https://downloads.thinkpinkstudio.it'

const CLIENT_ID = 'pdf-data-extractor-desktop'
const STATE_TTL_MS = 10 * 60 * 1000

// `state` in sospeso (in memoria): valore → { resolve, reject, expiresAt }.
const pendingStates = new Map()
let ssoRouteRegistered = false

function prunePending() {
  const now = Date.now()
  for (const [state, entry] of pendingStates) {
    if (entry.expiresAt < now) pendingStates.delete(state)
  }
}

async function exchangeCode(code) {
  const tokenUrl =
    `${SSO_BASE_URL}/identity/token` +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&code=${encodeURIComponent(code)}`
  let res
  try {
    res = await resilientFetch(tokenUrl, { signal: AbortSignal.timeout(15000) })
  } catch (err) {
    throw new Error(describeNetworkError(err).message)
  }
  if (!res.ok) throw new Error(`Scambio codice fallito (HTTP ${res.status}).`)
  const data = await res.json()
  const email = data && typeof data.email === 'string' ? data.email.toLowerCase() : null
  if (!email) throw new Error('Risposta di autenticazione non valida.')
  return email
}

function registerSsoRoute() {
  if (ssoRouteRegistered) return
  registerCallbackRoute('/sso/callback', async (req, res, url) => {
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')

    prunePending()
    const entry = state ? pendingStates.get(state) : null
    if (!code || !entry) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<h2>Richiesta non valida o scaduta.</h2><p>Puoi chiudere questa finestra.</p>')
      return
    }
    pendingStates.delete(state)

    try {
      const email = await exchangeCode(code)
      // L'IdP autentica; l'autorizzazione (dominio) resta locale a questa app.
      if (!isAllowedDomain(email)) {
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<h2>Dominio email non autorizzato.</h2><p>Puoi chiudere questa finestra.</p>')
        entry.reject(new Error('Dominio email non autorizzato.'))
        return
      }
      await saveSession(email)
      logAction({ email, action: 'auth.verify', metadata: { source: 'electron', method: 'sso' } })

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f0f1a;color:#e8e8f0">
          <h2 style="color:#e91e8c">Accesso effettuato!</h2>
          <p>Puoi chiudere questa finestra e tornare all'applicazione.</p>
          <script>setTimeout(() => window.close(), 2000)</script>
        </body></html>
      `)
      entry.resolve(email)
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<h2>Errore durante l\'accesso.</h2><p>Puoi chiudere questa finestra e riprovare.</p>')
      entry.reject(err)
    }
  })
  ssoRouteRegistered = true
}

/** Avvia il login SSO e attende l'email autenticata. Rigetta su timeout/errore. */
export async function startSsoLoginAndWait() {
  const port = await ensureCallbackServer()
  registerSsoRoute()

  const state = randomBytes(16).toString('hex')
  const redirectUri = `http://127.0.0.1:${port}/sso/callback`

  let resolveLogin, rejectLogin
  const loginPromise = new Promise((resolve, reject) => {
    resolveLogin = resolve
    rejectLogin = reject
  })

  const timeout = setTimeout(() => {
    pendingStates.delete(state)
    rejectLogin(new Error('Timeout: nessun accesso ricevuto entro 10 minuti.'))
  }, STATE_TTL_MS)

  pendingStates.set(state, {
    expiresAt: Date.now() + STATE_TTL_MS,
    resolve: (email) => { clearTimeout(timeout); resolveLogin(email) },
    reject: (err) => { clearTimeout(timeout); rejectLogin(err) },
  })

  const authorizeUrl =
    `${SSO_BASE_URL}/identity/authorize` +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`

  logAction({ action: 'auth.send_link', metadata: { source: 'electron', method: 'sso' } })
  await shell.openExternal(authorizeUrl)

  return loginPromise
}
