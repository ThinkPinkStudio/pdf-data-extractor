import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { importSharedService } from '@/lib/sharedServices'

export const runtime = 'nodejs'

// Un report da 4.500 righe si elabora in poche centinaia di ms, ma il limite
// tiene conto di file molto più grandi.
export const maxDuration = 120

const MAX_BYTES = 25 * 1024 * 1024

type ProcessResult = {
  buffer: Buffer | null
  blocked: string | null
  report: Record<string, unknown>
}

type WorkbookService = {
  processPremioLordo: (input: Buffer, opts: Record<string, unknown>) => Promise<ProcessResult>
  outputFileName: (name: string) => string
}

/**
 * Calcolo PREMIO LORDO sul report "Tutte le Applicazioni".
 *
 * Un solo giro: si riceve il file, si elabora e si restituiscono INSIEME il
 * riepilogo (che la pagina mostra) e il file in base64 (che la pagina fa
 * scaricare). Due chiamate separate avrebbero significato elaborare due volte
 * lo stesso file.
 *
 * Se compaiono garanzie fuori tabella si risponde 200 con `blocked` valorizzato
 * e SENZA file: l'aliquota non si inventa, la conferma la dà l'utente e la
 * richiesta si ripete con assumeDefault.
 */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Dati del modulo non validi' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Nessun file caricato' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File troppo grande (${(file.size / 1024 / 1024).toFixed(1)} MB, massimo 25 MB)` },
      { status: 413 }
    )
  }
  if (!/\.xlsx$/i.test(file.name)) {
    return NextResponse.json(
      { error: 'Serve un file .xlsx. I vecchi .xls e i CSV vanno prima convertiti da Excel.' },
      { status: 400 }
    )
  }

  const rounding = formData.get('rounding') === 'legacy' ? 'legacy' : 'commerciale'
  const keepExtra = formData.get('keepExtra') === 'true'
  const assumeDefault = formData.get('assumeDefault') === 'true'
  const sheet = (formData.get('sheet') as string | null) || null

  try {
    const svc = await importSharedService<WorkbookService>('premioLordoWorkbook.js')
    const input = Buffer.from(await file.arrayBuffer())
    const { buffer, blocked, report } = await svc.processPremioLordo(input, {
      sheet,
      rounding,
      keepExtra,
      assumeDefault,
    })

    await logAction({
      action: 'premio_lordo',
      email: session.email,
      resource: file.name,
      metadata: {
        righe: report.righeDati,
        polizze: report.polizze,
        totale: report.totaleGenerale,
        rounding,
        blocked,
      },
      success: !blocked,
    }).catch(() => {})

    return NextResponse.json({
      ok: !blocked,
      blocked,
      report,
      fileName: svc.outputFileName(file.name),
      fileBase64: buffer ? buffer.toString('base64') : null,
    })
  } catch (err) {
    const e = err as { code?: string; message?: string; details?: unknown }
    // PremioLordoError porta un codice stabile: la pagina può spiegare il caso
    // invece di mostrare un messaggio tecnico qualsiasi.
    return NextResponse.json(
      { error: e.message || 'Elaborazione fallita', code: e.code ?? null, details: e.details ?? null },
      { status: 422 }
    )
  }
}
