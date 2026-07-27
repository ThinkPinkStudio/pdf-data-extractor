// Preset di configurazione completi di CSA Adesioni (server): snapshot COMPLETO
// dei settings (inclusi SMTP/FTP), attivabile con un click (applyPreset →
// saveAdesioniSettings) ed esportabile/importabile come JSON con i segreti
// azzerati. Porta la parità con l'app desktop (configPresets.js) adattandolo al
// modello web: lo store vive nella tabella `settings` (chiave `adesioniPresets`)
// invece che in userData/config-presets.json.
//
// Forma memorizzata:
//   { active: '<nome>', presets: [{ name, savedAt, settings }] }
import { pool } from '../db'
import {
  getAdesioniFullSettings,
  saveAdesioniSettings,
  getAdesioniSettingsMasked,
  type AdesioniFullSettings,
  type SmtpConfig,
  type FtpConfig,
} from './settingsWeb'

const KEY = 'adesioniPresets'

export interface StoredPreset { name: string; savedAt: string; settings: AdesioniFullSettings }
interface PresetStore { active: string; presets: StoredPreset[] }

async function readStore(): Promise<PresetStore> {
  const { rows } = await pool.query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [KEY])
  if (!rows[0]?.value) return { active: '', presets: [] }
  try {
    const raw = JSON.parse(rows[0].value)
    return {
      active: typeof raw.active === 'string' ? raw.active : '',
      presets: Array.isArray(raw.presets) ? raw.presets : [],
    }
  } catch {
    return { active: '', presets: [] }
  }
}

async function writeStore(store: PresetStore): Promise<PresetStore> {
  await pool.query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [KEY, JSON.stringify(store)]
  )
  return store
}

// ─── Redazione / conservazione dei segreti ──────────────────────────────────
/** Azzera i segreti di un profilo FTP/SFTP (password, chiave privata, passphrase). */
function redactFtpProfile(p: FtpConfig): FtpConfig {
  return { ...p, pass: '', privateKey: '', passphrase: '' }
}

/** Azzera i segreti (SMTP/FTP/SFTP) prima di esporre uno snapshot al di fuori dell'app (export JSON). */
function redactSecrets(settings: AdesioniFullSettings): AdesioniFullSettings {
  return {
    ...settings,
    smtp: { ...settings.smtp, pass: '' },
    ftp: {
      staging: redactFtpProfile(settings.ftp.staging),
      prod: redactFtpProfile(settings.ftp.prod),
    },
  }
}

/** Mantiene un segreto FTP/SFTP corrente se la patch "ripulita" non ne porta uno. */
function keepFtpSecrets(inc: FtpConfig | undefined, cur: FtpConfig | undefined): FtpConfig {
  return {
    ...(inc as FtpConfig),
    pass: inc?.pass || cur?.pass || '',
    privateKey: inc?.privateKey || cur?.privateKey || '',
    passphrase: inc?.passphrase || cur?.passphrase || '',
  }
}

/** Se la patch in arrivo non porta i segreti (preset "ripulito"), mantiene quelli attualmente configurati. */
function keepExistingSecrets(incoming: AdesioniFullSettings, current: AdesioniFullSettings): AdesioniFullSettings {
  return {
    ...incoming,
    smtp: { ...incoming.smtp, pass: incoming.smtp?.pass || current.smtp?.pass || '' } as SmtpConfig,
    ftp: {
      staging: keepFtpSecrets(incoming.ftp?.staging, current.ftp?.staging),
      prod: keepFtpSecrets(incoming.ftp?.prod, current.ftp?.prod),
    },
  }
}

// ─── API ────────────────────────────────────────────────────────────────────
/** Elenco preset (senza i settings completi, per la UI) + preset attivo. */
export async function listPresets(): Promise<{ active: string; presets: { name: string; savedAt: string }[] }> {
  const s = await readStore()
  return { active: s.active, presets: s.presets.map((p) => ({ name: p.name, savedAt: p.savedAt })) }
}

/** Salva (o sovrascrive) un preset con lo snapshot COMPLETO dei settings correnti. */
export async function saveCurrentAsPreset(name: string) {
  const trimmed = String(name || '').trim()
  if (!trimmed) throw new Error('Nome del preset mancante')
  const s = await readStore()
  const preset: StoredPreset = { name: trimmed, savedAt: new Date().toISOString(), settings: await getAdesioniFullSettings() }
  const idx = s.presets.findIndex((p) => p.name === trimmed)
  if (idx >= 0) s.presets[idx] = preset
  else s.presets.push(preset)
  s.active = trimmed
  await writeStore(s)
  return listPresets()
}

/** Applica un preset: i suoi settings diventano quelli correnti. Ritorna i settings mascherati applicati. */
export async function applyPreset(name: string) {
  const s = await readStore()
  const preset = s.presets.find((p) => p.name === name)
  if (!preset) throw new Error(`Preset «${name}» non trovato`)
  const merged = keepExistingSecrets(preset.settings, await getAdesioniFullSettings())
  await saveAdesioniSettings(merged as unknown as Parameters<typeof saveAdesioniSettings>[0])
  s.active = name
  await writeStore(s)
  return getAdesioniSettingsMasked()
}

export async function deletePreset(name: string) {
  const s = await readStore()
  s.presets = s.presets.filter((p) => p.name !== name)
  if (s.active === name) s.active = ''
  await writeStore(s)
  return listPresets()
}

/** Ritorna il preset per l'export JSON, con le password SMTP/FTP azzerate. */
export async function getPresetForExport(name: string) {
  const s = await readStore()
  const preset = s.presets.find((p) => p.name === name)
  if (!preset) return null
  return { name: preset.name, savedAt: preset.savedAt, settings: redactSecrets(preset.settings) }
}

/** Importa un preset da un oggetto JSON { name, settings }; upsert per nome. */
export async function importPreset(obj: { name?: string; settings?: AdesioniFullSettings }) {
  const name = String(obj?.name || '').trim()
  const settings = obj?.settings
  if (!name) throw new Error('Il JSON importato non contiene un nome di preset')
  if (!settings || typeof settings !== 'object') throw new Error('Il JSON importato non contiene una configurazione valida')
  const s = await readStore()
  const preset: StoredPreset = { name, savedAt: new Date().toISOString(), settings }
  const idx = s.presets.findIndex((p) => p.name === name)
  if (idx >= 0) s.presets[idx] = preset
  else s.presets.push(preset)
  await writeStore(s)
  return listPresets()
}
