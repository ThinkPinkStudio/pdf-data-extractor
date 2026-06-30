import type { NextRequest } from 'next/server'

// ─── Auth a token di servizio (macchina-a-macchina) ──────────────────────────
// Le rotte /api/extract-jobs sono chiamate dall'orchestratore batch (e da
// eventuali script/n8n), non da un browser: usano un token di servizio invece
// della sessione. Stesso modello del webhook desktop. Fail-closed: se il token
// non è configurato lato server, ogni richiesta è negata.

const TOKEN = process.env.EXTRACT_SERVICE_TOKEN || ''

export function checkServiceToken(req: NextRequest): boolean {
  if (!TOKEN) return false
  const auth = req.headers.get('authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  const provided = (m?.[1] || req.headers.get('x-extract-token') || '').trim()
  return provided.length > 0 && safeEqual(provided, TOKEN)
}

/** Confronto a tempo costante per non rivelare il token via timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}
