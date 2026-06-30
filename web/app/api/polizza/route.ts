import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const userAgent = req.headers.get('user-agent') ?? undefined

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

  // Accetta più PDF (polizza, appendici, condizioni…) caricati insieme.
  const pdfFiles = formData.getAll('pdf').filter((f): f is File => f instanceof File)
  if (pdfFiles.length === 0) {
    return NextResponse.json({ error: 'Nessun file PDF' }, { status: 400 })
  }

  const tmpPaths: string[] = []
  const names = pdfFiles.map((f) => f.name).join(', ')
  await logAction({ email: session.email, action: 'polizza.start', resource: names, ip, userAgent })

  try {
    for (const pdfFile of pdfFiles) {
      const tmpPath = join(tmpdir(), `polizza-${randomUUID()}.pdf`)
      const buffer = Buffer.from(await pdfFile.arrayBuffer())
      await writeFile(tmpPath, buffer)
      tmpPaths.push(tmpPath)
    }

    const { extractPolizza } = await import('@/lib/polizzaService')
    const result = await extractPolizza(tmpPaths)

    await logAction({ email: session.email, action: 'polizza.complete', resource: names, ip, userAgent })

    return NextResponse.json(result)
  } catch (err) {
    await logAction({ email: session.email, action: 'polizza.error', resource: names, success: false, ip, userAgent, metadata: { error: String(err) } })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    await Promise.all(tmpPaths.map((p) => unlink(p).catch(() => {})))
  }
}
