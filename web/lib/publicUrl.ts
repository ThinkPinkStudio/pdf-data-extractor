import { NextRequest } from 'next/server'

/**
 * Restituisce l'origin pubblico dell'app (es. https://csa-pdf.thinkpinkstudio.it)
 * invece dell'indirizzo interno su cui gira il server dietro il reverse proxy
 * (es. http://0.0.0.0:3000, da cui derivava `req.url`).
 *
 * Priorità:
 *  1. MAGIC_LINK_BASE_URL  — URL pubblico canonico configurato
 *  2. header x-forwarded-* impostati dal reverse proxy
 *  3. fallback su req.nextUrl.origin
 */
export function getPublicOrigin(req: NextRequest): string {
  const configured = process.env.MAGIC_LINK_BASE_URL
  if (configured) return configured.replace(/\/+$/, '')

  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim()
  const host =
    req.headers.get('x-forwarded-host')?.split(',')[0].trim() ??
    req.headers.get('host')?.split(',')[0].trim()

  if (host) return `${proto || 'https'}://${host}`

  return req.nextUrl.origin
}

/** Costruisce una URL assoluta verso l'origin pubblico per i redirect. */
export function publicUrl(req: NextRequest, path: string): URL {
  return new URL(path, getPublicOrigin(req))
}
