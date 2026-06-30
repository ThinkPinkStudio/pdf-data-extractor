import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { writeFile, mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { extractPolizza } from '@/lib/polizzaEngine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Estrazione polizza con il meccanismo ESATTO dell'app (server-side).
// Accetta 1+ PDF (un fascicolo). Ritorna { fields } come si aspetta la pagina.
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'

  const session = await getSession()
  if (!session.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const files = formData.getAll('pdf').filter((f): f is File => f instanceof File)
  if (files.length === 0) {
    return NextResponse.json({ error: 'Nessun file PDF' }, { status: 400 })
  }

  const dir = await mkdtemp(join(tmpdir(), 'polizza-'))
  const paths: string[] = []
  await logAction({ email: session.email, action: 'polizza.start', resource: files[0].name, ip })

  try {
    for (const f of files) {
      const p = join(dir, `${randomUUID()}.pdf`)
      await writeFile(p, Buffer.from(await f.arrayBuffer()))
      paths.push(p)
    }

    const { data } = await extractPolizza(paths)

    await logAction({ email: session.email, action: 'polizza.complete', resource: files[0].name, ip })
    return NextResponse.json({ fields: data, data, log: [] })
  } catch (err) {
    await logAction({
      email: session.email, action: 'polizza.error', resource: files[0].name,
      success: false, ip, metadata: { error: String(err) },
    })
    return NextResponse.json({ error: String((err as Error)?.message || err) }, { status: 500 })
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
