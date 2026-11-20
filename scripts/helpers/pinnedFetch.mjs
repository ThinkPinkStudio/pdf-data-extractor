// fetch() verso l'app di produzione con il certificato FISSATO (pinning).
// In https Traefik serve un certificato autofirmato («TRAEFIK DEFAULT CERT»,
// rigenerato a ogni riavvio del proxy) e dal 19/11/2026 l'http reindirizza a
// https: invece di disattivare la verifica TLS si accetta SOLO il certificato
// salvato in <dir>/traefik.pem con l'impronta SHA-256 di <dir>/pin.txt.
// Per rileggerlo dopo un riavvio del proxy:
//   echo | openssl s_client -connect genius.csabroker.it:443 -servername genius.csabroker.it 2>/dev/null | openssl x509 > traefik.pem
//   openssl x509 -in traefik.pem -noout -fingerprint -sha256 | cut -d= -f2 > pin.txt
import https from 'node:https'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function makePinnedFetch(dir) {
  const pin = readFileSync(join(dir, 'pin.txt'), 'utf8').trim()
  const agent = new https.Agent({
    ca: [readFileSync(join(dir, 'traefik.pem'))],
    checkServerIdentity: (_host, cert) => (cert.fingerprint256 === pin ? undefined : new Error(`certificato dell'app diverso da quello fissato (${cert.fingerprint256})`)),
  })
  return async function pinnedFetch(url, init = {}) {
    const rq = new Request(url, init)
    const u = new URL(rq.url)
    const body = ['GET', 'HEAD'].includes(rq.method) ? null : Buffer.from(await rq.arrayBuffer())
    const headers = {}
    rq.headers.forEach((v, k) => { headers[k] = v })
    if (body) headers['content-length'] = String(body.length)
    return await new Promise((ok, ko) => {
      const r = https.request({ host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: rq.method, agent, headers }, (res) => {
        const ch = []
        res.on('data', (c) => ch.push(c))
        res.on('end', () => {
          const h = new Headers()
          for (let i = 0; i < res.rawHeaders.length; i += 2) h.append(res.rawHeaders[i], res.rawHeaders[i + 1])
          const status = res.statusCode || 0
          ok(new Response([101, 204, 205, 304].includes(status) ? null : Buffer.concat(ch), { status, headers: h }))
        })
      })
      r.setTimeout(300000, () => r.destroy(new Error('timeout')))
      r.on('error', ko)
      if (body) r.write(body)
      r.end()
    })
  }
}
