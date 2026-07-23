// Wrapper web per la pubblicazione FTP/SFTP: adatta ftpService.js (che carica da
// un path locale) all'upload di un Buffer, scrivendolo in un file temporaneo.
import os from 'os'
import path from 'path'
import { writeFileSync, unlinkSync } from 'fs'
// ftpService.js è puro rispetto a Electron (basic-ftp / ssh2-sftp-client).
import { testConnection, uploadFile } from './ftpService.js'
import type { FtpConfig } from './settingsWeb'

export async function testFtp(profile: FtpConfig): Promise<{ ok: boolean; dir?: string }> {
  return testConnection(profile) as Promise<{ ok: boolean; dir?: string }>
}

export async function uploadBufferToFtp(profile: FtpConfig, buffer: Buffer, filename: string): Promise<{ ok: boolean; remotePath?: string }> {
  const tmp = path.join(os.tmpdir(), `csa-${Date.now()}-${filename.replace(/[^\w.-]+/g, '_')}`)
  writeFileSync(tmp, buffer)
  try {
    return (await uploadFile(profile, tmp)) as { ok: boolean; remotePath?: string }
  } finally {
    try { unlinkSync(tmp) } catch { /* ignore */ }
  }
}
