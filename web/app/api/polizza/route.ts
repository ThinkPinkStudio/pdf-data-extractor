import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { writeFile, unlink } from 'fs/promises'
import { join, basename } from 'path'
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
  // Mappa basename-temporaneo → nome originale: i file vengono salvati come
  // polizza-<uuid>.pdf, ma il client deve poter riassociare scannedFiles ai propri
  // File (per nome) per avviare l'OCR/vision. Senza questo, scannedFiles conterrebbe
  // i nomi temporanei e nessun documento verrebbe elaborato.
  const origNameByBase: Record<string, string> = {}
  const names = pdfFiles.map((f) => f.name).join(', ')
  await logAction({ email: session.email, action: 'polizza.start', resource: names, ip, userAgent })

  try {
    for (const pdfFile of pdfFiles) {
      const tmpPath = join(tmpdir(), `polizza-${randomUUID()}.pdf`)
      const buffer = Buffer.from(await pdfFile.arrayBuffer())
      await writeFile(tmpPath, buffer)
      tmpPaths.push(tmpPath)
      origNameByBase[basename(tmpPath)] = pdfFile.name
    }

    const { extractPolizza } = await import('@/lib/polizzaService')
    const result = await extractPolizza(tmpPaths)
    // Riporta i nomi originali, così il client può riassociare i file e avviare la vision.
    result.scannedFiles = (result.scannedFiles || []).map((n) => origNameByBase[n] ?? n)

    await logAction({ email: session.email, action: 'polizza.complete', resource: names, ip, userAgent })

    return NextResponse.json(result)
  } catch (err) {
    await logAction({ email: session.email, action: 'polizza.error', resource: names, success: false, ip, userAgent, metadata: { error: String(err) } })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    await Promise.all(tmpPaths.map((p) => unlink(p).catch(() => {})))
  }
}
