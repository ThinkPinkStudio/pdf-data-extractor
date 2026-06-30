import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { extractPolizza } from '@/lib/polizzaEngine'
import { logAction } from '@/lib/logger'
import { writeFile, mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Estrazione polizza con avanzamento in streaming (consumato via fetch reader).
// Frame: `data: {json}\n\n`. Eventi: progress | done | error.
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return new Response('Unauthorized', { status: 401 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return new Response('Invalid form data', { status: 400 })
  }
  const incoming = form.getAll('pdf').filter((f): f is File => f instanceof File)
  if (incoming.length === 0) return new Response('Nessun PDF', { status: 400 })

  const dir = await mkdtemp(join(tmpdir(), 'polizza-'))
  const paths: string[] = []
  for (const f of incoming) {
    const p = join(dir, `${randomUUID()}.pdf`)
    await writeFile(p, Buffer.from(await f.arrayBuffer()))
    paths.push(p)
  }

  await logAction({ email: session.email, action: 'polizza.start', resource: incoming[0].name, ip })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      ;(async () => {
        try {
          const { data } = await extractPolizza(paths, (progress) => send({ type: 'progress', progress }))
          send({ type: 'done', data })
          await logAction({ email: session.email, action: 'polizza.complete', resource: incoming[0].name, ip })
        } catch (err) {
          send({ type: 'error', error: String((err as Error)?.message || err) })
          await logAction({
            email: session.email, action: 'polizza.error', resource: incoming[0].name,
            success: false, ip, metadata: { error: String(err) },
          })
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(() => {})
          controller.close()
        }
      })()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
