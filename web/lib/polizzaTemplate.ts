import { writeFile, mkdtemp, rm, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// Export non distruttivo sul template del gestionale — usa le funzioni ESATTE
// del meccanismo (readExcelStructure, previewTemplateChanges, exportApprovedChanges).
// Stateless: il template viene ricaricato a ogni richiesta (la pagina lo tiene in memoria).

export interface CellTarget { sheet: string; cell: string }
export interface Change { sheet: string; cell: string; label: string; oldValue: string; newValue: string; approved?: boolean }

interface TemplateMech {
  readExcelStructure: (path: string) => Promise<Record<string, unknown>>
  previewTemplateChanges: (templatePath: string, data: unknown, userMapping: unknown, fieldsConfig?: unknown) => Promise<Change[]>
  exportApprovedChanges: (templatePath: string, outputPath: string, approvedChanges: Change[]) => Promise<void>
  CSA_MAPPING: Record<string, CellTarget[]>
}

async function mech(): Promise<TemplateMech> {
  // @ts-ignore — modulo JS del processo main (externalDir)
  const m = await import('../../src/main/services/polizzaService.js')
  return m as unknown as TemplateMech
}

async function withTempFile<T>(bytes: Buffer, fn: (path: string, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'tpl-'))
  const p = join(dir, `${randomUUID()}.xlsx`)
  await writeFile(p, bytes)
  try {
    return await fn(p, dir)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function templateStructure(bytes: Buffer) {
  const m = await mech()
  return withTempFile(bytes, async (path) => {
    const structure = await m.readExcelStructure(path)
    return { structure, defaultMapping: m.CSA_MAPPING }
  })
}

export async function templatePreview(bytes: Buffer, data: unknown, userMapping: unknown, fields: unknown[]) {
  const m = await mech()
  return withTempFile(bytes, async (path) => {
    const changes = await m.previewTemplateChanges(path, data, userMapping, fields)
    return { changes }
  })
}

export async function templateExport(bytes: Buffer, approvedChanges: Change[]): Promise<Buffer> {
  const m = await mech()
  return withTempFile(bytes, async (path, dir) => {
    const out = join(dir, 'out.xlsx')
    await m.exportApprovedChanges(path, out, approvedChanges)
    return readFile(out)
  })
}
