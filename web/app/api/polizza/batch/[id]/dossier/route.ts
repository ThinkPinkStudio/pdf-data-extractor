import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getFieldsAndMapping } from '@/lib/polizzaService'
import { getBatchRow, addDossierToBatch, type JobInputFile } from '@/lib/polizzaJobStore'
import { startBatch } from '@/lib/polizzaBatchWorker'
import { evaluatePath, makeFilters, parseExclusionList, parseKeywords } from '@/lib/bulkExclusions'
import { getSettings } from '@/lib/settingsStore'

export const runtime = 'nodejs'

// Carica UN dossier (sottocartella) di un batch già inizializzato. Riapplica il
// filtro cartelle/file esclusi anche qui (difesa in profondità, non ci si fida del
// solo filtro client) e avvia/mantiene attivo l'orchestratore del batch: il primo
// dossier può iniziare l'elaborazione mentre i successivi sono ancora in upload.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const userAgent = req.headers.get('user-agent') ?? undefined
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const batch = await getBatchRow(params.id)
  // Lavoro condiviso: nessun controllo di proprietà sul batch.
  if (!batch) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (batch.upload_complete) return NextResponse.json({ error: 'Batch già chiuso' }, { status: 409 })

  let formData: FormData
  try { formData = await req.formData() } catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400 }) }

  const pdfFiles = formData.getAll('pdf').filter((f): f is File => f instanceof File)
  const relPaths = formData.getAll('path').map((p) => String(p))
  const dossierName = String(formData.get('dossierName') || 'Polizza')
  const profileId = formData.get('profileId') ? String(formData.get('profileId')) : null
  if (pdfFiles.length === 0 || relPaths.length !== pdfFiles.length) {
    return NextResponse.json({ error: 'File o percorsi mancanti' }, { status: 400 })
  }

  const settings = await getSettings()
  // Parole di questa esecuzione se il client le manda (la pagina bulk permette di
  // ritoccarle per la singola cartella), altrimenti quelle salvate in Impostazioni.
  const rawInclude = formData.get('includeWords')
  const rawExclude = formData.get('excludeWords')
  // Parole di abbinamento "da evitare" dei profili: il server le somma al filtro
  // di enumerazione come difesa in profondità (il client le applica già in UI).
  const profileExcludeWords = (settings.polizzaProfiles || [])
    .flatMap((p: any) => parseKeywords(p?.matchExcludeKeywords || ''))
  const filters = makeFilters({
    excludedNames: parseExclusionList(settings.bulkExcludedFolderNames),
    includeWords: parseKeywords(rawInclude === null ? settings.bulkIncludeKeywords : String(rawInclude)),
    excludeWords: parseKeywords(rawExclude === null ? settings.bulkExcludeKeywords : String(rawExclude)),
    profileExcludeWords,
  })
  const kept: { file: File; relPath: string }[] = []
  for (let i = 0; i < pdfFiles.length; i++) {
    const verdict = evaluatePath(relPaths[i], filters)
    if (verdict.kept) kept.push({ file: pdfFiles[i], relPath: relPaths[i] })
    else if (verdict.reason === 'profileExcludeWord') {
      return NextResponse.json({ error: `Percorso scartato (parola di abbinamento da evitare "${verdict.matched}")` }, { status: 400 })
    }
  }
  if (kept.length === 0) return NextResponse.json({ error: 'Nessun file valido dopo il filtro esclusioni' }, { status: 400 })

  await logAction({ email: session.email, action: 'polizza.batch.dossier', resource: `${batch.label}/${dossierName} (${kept.length} file)`, ip, userAgent })

  try {
    // Profilo/tipo scelto per questo dossier: risolto lato server (autoritativo) dai
    // profili salvati. Se assente/sconosciuto → campi globali attivi (comportamento
    // precedente). fields/prompt/whole-dossier vengono congelati nel job.
    const profile = profileId
      ? (settings.polizzaProfiles || []).find((p) => p.id === profileId) || null
      : null
    let fields: { id: string; label: string; description?: string; type?: string; sheet?: string; enabled?: boolean }[]
    let wholeDossier: boolean
    let promptExtra: string
    if (profile) {
      fields = (profile.fields || []).filter((f) => f.enabled !== false)
      wholeDossier = !!profile.wholeDossier
      promptExtra = profile.promptExtra || ''
    } else {
      const g = await getFieldsAndMapping()
      fields = g.fields || []
      wholeDossier = !!g.wholeDossier
      promptExtra = settings.polizzaPromptExtra || ''
    }
    const fieldDefs = fields.map((f) => ({ id: f.id, label: f.label, description: f.description, type: f.type, sheet: f.sheet }))
    const files: JobInputFile[] = await Promise.all(kept.map(async (k) => ({
      file_name: k.file.name,
      pdf_base64: Buffer.from(await k.file.arrayBuffer()).toString('base64'),
    })))

    const jobId = await addDossierToBatch({
      batchId: params.id, email: session.email, wholeDossier, fieldDefs, dossierName, files, promptExtra,
      // Identità del profilo persistita nel job: serve al pre-check di
      // pertinenza e ai suoi messaggi ("non pertinente al profilo X").
      profileId: profile?.id, profileName: profile?.name,
    })

    startBatch(params.id) // idempotente: avvia/mantiene l'orchestratore del batch
    return NextResponse.json({ jobId })
  } catch (err) {
    await logAction({ email: session.email, action: 'polizza.batch.dossier.error', resource: dossierName, success: false, ip, userAgent, metadata: { error: String(err) } })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
