import { readdir } from 'fs/promises'
import { join, resolve, basename } from 'path'
import { createHash } from 'crypto'
import type { MatcherConfig } from './config'

export interface PolicyUnit {
  policyKey: string
  rootPath: string
  folderPath: string
  pdfPaths: string[]
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex')
}

/**
 * Walk ricorsivo in streaming (nessuna lista enorme in RAM).
 * Una cartella è "polizza" se sta dentro un sottoalbero il cui nome matcha la
 * regex (o regex assente) e contiene ≥1 PDF diretto. `group='file'` emette una
 * polizza per ogni PDF; `policyKey` (hash del path assoluto) garantisce
 * l'idempotenza dell'enqueue tra ri-scansioni.
 */
export async function* discover(
  roots: string[],
  matcher: MatcherConfig
): AsyncGenerator<PolicyUnit> {
  const re = matcher.nameRegex ? new RegExp(matcher.nameRegex, 'i') : null
  for (const root of roots) {
    const absRoot = resolve(root)
    yield* walk(absRoot, absRoot, re, matcher, false)
  }
}

async function* walk(
  dir: string,
  rootPath: string,
  re: RegExp | null,
  matcher: MatcherConfig,
  insideMatched: boolean
): AsyncGenerator<PolicyUnit> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return // permessi negati / symlink rotto: salta
  }

  const here = insideMatched || (re ? re.test(basename(dir)) : true)
  const pdfPaths = entries
    .filter((e) => e.isFile() && /\.pdf$/i.test(e.name))
    .map((e) => join(dir, e.name))
    .sort()

  if (here && pdfPaths.length > 0) {
    if (matcher.group === 'file') {
      for (const p of pdfPaths) {
        yield { policyKey: sha1(p), rootPath, folderPath: dir, pdfPaths: [p] }
      }
    } else {
      yield { policyKey: sha1(dir), rootPath, folderPath: dir, pdfPaths }
    }
  }

  for (const e of entries) {
    if (e.isDirectory()) {
      yield* walk(join(dir, e.name), rootPath, re, matcher, here)
    }
  }
}
