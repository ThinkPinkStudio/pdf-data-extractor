// Impostazioni complete di CSA Adesioni (server): unisce config maschera (da
// config.ts) con SMTP/FTP/notifiche, applicando default da env. Gestisce il
// mascheramento dei segreti in lettura e la loro conservazione in scrittura.
import { getSettings, saveSettings } from '../settingsStore'
import { getAdesioniConfig } from './serverConfig'
import type { AdesioniConfig } from './config'

export interface SmtpConfig { host: string; port: number; secure: boolean; user: string; pass: string; from: string }
export interface FtpConfig { protocol: 'ftp' | 'ftps' | 'sftp'; host: string; port: number; user: string; pass: string; secure: boolean; dir: string; privateKey: string; passphrase: string }
export interface ExportNotify { enabled: boolean; sharedEmail: string; mode: 'user' | 'shared' | 'both' }

export interface Attachment { name: string; dataBase64: string }
export interface AdesioniFullSettings extends AdesioniConfig {
  smtp: SmtpConfig
  ftp: { staging: FtpConfig; prod: FtpConfig }
  exportNotify: ExportNotify
  templateId: string
  templateHtml: string
  attachments: Attachment[]
}

const MASK = '***'

// Maschera tutti i segreti di un profilo FTP: password, passphrase e chiave privata.
function maskFtp(f: FtpConfig): FtpConfig {
  return { ...f, pass: f.pass ? MASK : '', passphrase: f.passphrase ? MASK : '', privateKey: f.privateKey ? MASK : '' }
}

function defaultSmtp(): SmtpConfig {
  return {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '') === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  }
}
function defaultFtp(kind: 'staging' | 'prod'): FtpConfig {
  const p = kind.toUpperCase()
  return {
    protocol: (process.env[`FTP_${p}_PROTOCOL`] as FtpConfig['protocol']) || 'ftp',
    host: process.env[`FTP_${p}_HOST`] || '',
    port: Number(process.env[`FTP_${p}_PORT`] || 21),
    user: process.env[`FTP_${p}_USER`] || '',
    pass: process.env[`FTP_${p}_PASS`] || '',
    secure: String(process.env[`FTP_${p}_SECURE`] || '') === 'true',
    dir: process.env[`FTP_${p}_DIR`] || '',
    privateKey: process.env[`FTP_${p}_KEY`] || '',
    passphrase: process.env[`FTP_${p}_PASSPHRASE`] || '',
  }
}
function defaultExportNotify(): ExportNotify {
  const mode = process.env.EXPORT_NOTIFY_MODE
  return { enabled: true, sharedEmail: process.env.EXPORT_NOTIFY_SHARED || '', mode: (['user', 'shared', 'both'].includes(mode || '') ? mode : 'user') as ExportNotify['mode'] }
}

/** Impostazioni complete risolte (segreti in chiaro) — per uso server (invio email/FTP). */
export async function getAdesioniFullSettings(): Promise<AdesioniFullSettings> {
  const s = await getSettings()
  const config = await getAdesioniConfig()
  return {
    ...config,
    smtp: { ...defaultSmtp(), ...(s.adesioniSmtp as Partial<SmtpConfig> | undefined) },
    ftp: {
      staging: { ...defaultFtp('staging'), ...(s.adesioniFtpStaging as Partial<FtpConfig> | undefined) },
      prod: { ...defaultFtp('prod'), ...(s.adesioniFtpProd as Partial<FtpConfig> | undefined) },
    },
    exportNotify: { ...defaultExportNotify(), ...(s.adesioniExportNotify as Partial<ExportNotify> | undefined) },
    templateId: s.adesioniTemplateId || 'default',
    templateHtml: s.adesioniTemplateHtml || '',
    attachments: Array.isArray(s.adesioniAttachments) ? s.adesioniAttachments : [],
  }
}

/** Versione per il client (GET): password/passphrase mascherate. */
export async function getAdesioniSettingsMasked() {
  const full = await getAdesioniFullSettings()
  return {
    fields: full.fields,
    idd: full.idd,
    prezzi: full.prezzi,
    dateOffsetDays: full.dateOffsetDays,
    exportNotify: full.exportNotify,
    smtp: { ...full.smtp, pass: full.smtp.pass ? MASK : '' },
    ftp: {
      staging: maskFtp(full.ftp.staging),
      prod: maskFtp(full.ftp.prod),
    },
    templateId: full.templateId,
    templateHtml: full.templateHtml,
    attachments: full.attachments,
  }
}

// Rimpiazza i placeholder '***' con il valore già salvato (non sovrascrive i segreti).
function unmaskSecret<T extends Record<string, unknown>>(incoming: T | undefined, current: T | undefined, keys: string[]): T | undefined {
  if (!incoming) return incoming
  const out = { ...incoming }
  for (const k of keys) if (out[k] === MASK) (out as Record<string, unknown>)[k] = (current || ({} as T))[k] ?? ''
  return out
}

export async function saveAdesioniSettings(patch: {
  fields?: unknown[]
  idd?: unknown[]
  prezzi?: Record<string, unknown>
  dateOffsetDays?: number
  exportNotify?: ExportNotify
  smtp?: SmtpConfig
  ftp?: { staging?: FtpConfig; prod?: FtpConfig }
  templateId?: string
  templateHtml?: string
  attachments?: Attachment[]
}) {
  const s = await getSettings()
  const update: Record<string, unknown> = {}
  if (patch.fields) update.adesioniFields = patch.fields
  if (patch.idd) update.adesioniIdd = patch.idd
  if (patch.prezzi) update.adesioniPrezzi = patch.prezzi
  if (patch.dateOffsetDays !== undefined) update.adesioniDateOffsetDays = patch.dateOffsetDays
  if (patch.exportNotify) update.adesioniExportNotify = patch.exportNotify
  if (patch.templateId !== undefined) update.adesioniTemplateId = patch.templateId
  if (patch.templateHtml !== undefined) update.adesioniTemplateHtml = patch.templateHtml
  if (patch.attachments !== undefined) update.adesioniAttachments = patch.attachments
  if (patch.smtp) update.adesioniSmtp = unmaskSecret(patch.smtp as unknown as Record<string, unknown>, s.adesioniSmtp, ['pass'])
  if (patch.ftp?.staging) update.adesioniFtpStaging = unmaskSecret(patch.ftp.staging as unknown as Record<string, unknown>, s.adesioniFtpStaging, ['pass', 'passphrase', 'privateKey'])
  if (patch.ftp?.prod) update.adesioniFtpProd = unmaskSecret(patch.ftp.prod as unknown as Record<string, unknown>, s.adesioniFtpProd, ['pass', 'passphrase', 'privateKey'])
  await saveSettings(update)
}
