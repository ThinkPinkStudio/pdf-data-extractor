/**
 * Pubblicazione dei file esportati verso i profili configurati in settings.ftp
 * (staging e prod). Ogni profilo supporta tre protocolli:
 *   - 'ftp'  → FTP semplice (basic-ftp)
 *   - 'ftps' → FTP su TLS (basic-ftp, secure)
 *   - 'sftp' → SFTP su SSH (ssh2-sftp-client), autenticazione a chiave o password
 *
 * Forma profilo: { protocol, host, port, user, pass, secure, dir,
 *                  privateKey, passphrase }.
 */
import { basename } from 'path'
import * as ftp from 'basic-ftp'
import SftpClient from 'ssh2-sftp-client'

function assertProfile(profile) {
  if (!profile || !String(profile.host || '').trim()) {
    throw new Error('Profilo di pubblicazione non configurato: imposta host e credenziali nelle Configurazioni')
  }
}

/** Protocollo effettivo del profilo (retrocompat: secure → ftps). */
function protocolOf(profile) {
  const p = String(profile?.protocol || '').trim().toLowerCase()
  if (['ftp', 'ftps', 'sftp'].includes(p)) return p
  return profile?.secure ? 'ftps' : 'ftp'
}

function portOf(profile, protocol) {
  return Number(profile?.port) || (protocol === 'sftp' ? 22 : 21)
}

// ─── Diagnostica errori ─────────────────────────────────────────────────────
/** Etichetta leggibile della destinazione, es. "utente@host:22". */
function connLabel(profile, protocol) {
  const host = String(profile?.host || '').trim() || '(host non impostato)'
  const port = portOf(profile, protocol)
  const user = String(profile?.user || '').trim()
  return `${user ? user + '@' : ''}${host}:${port}`
}

/**
 * Trasforma un errore grezzo di rete/SFTP/FTP in un messaggio esplicativo in
 * italiano: quale operazione stava fallendo, verso quale server, la causa più
 * probabile e infine il dettaglio tecnico originale (utile per il supporto).
 * `opLabel` descrive la fase, es. "la connessione" / 'l'accesso alla cartella "…"'.
 */
function decorateError(err, profile, protocol, opLabel) {
  if (err && err.__decorated) return err
  const raw = String((err && err.message) || err || '').trim()
  const code = err && (err.code != null ? err.code : err.errno)
  const lower = `${raw} ${code != null ? code : ''}`.toLowerCase()
  const dir = String(profile?.dir || '').trim()
  const where = connLabel(profile, protocol)
  const proto = protocol.toUpperCase()

  let hint = ''
  if (/enotfound|getaddrinfo|eai_again/.test(lower)) {
    hint = "Host non trovato: il nome del server non è risolvibile. Controlla di aver scritto bene l'indirizzo e che ci sia connessione di rete."
  } else if (/econnrefused/.test(lower)) {
    hint = 'Connessione rifiutata: nessun servizio in ascolto su host/porta indicati. Verifica host, numero di porta e che il server sia attivo.'
  } else if (/etimedout|timed out|timeout|ehostunreach|enetunreach/.test(lower)) {
    hint = 'Timeout: il server non ha risposto in tempo. Possibili cause: host o porta errati, un firewall che blocca la connessione, oppure server offline.'
  } else if (/econnreset|epipe/.test(lower)) {
    hint = `Connessione chiusa dal server. Spesso significa protocollo errato (stai usando ${proto} verso un server che parla un altro protocollo) oppure TLS non supportato: prova a cambiare protocollo o porta.`
  } else if (/encrypted private key/.test(lower) && /passphrase/.test(lower)) {
    hint = 'La chiave privata è cifrata ma manca la passphrase: compila il campo Passphrase.'
  } else if (/bad passphrase|integrity check failed|bad decrypt|incorrect passphrase|unable to decrypt/.test(lower)) {
    hint = 'Passphrase della chiave privata errata.'
  } else if (/cannot parse privatekey|unsupported key|malformed|invalid key|failed to parse/.test(lower)) {
    hint = 'Chiave privata non valida o in un formato non supportato (sono ammessi OpenSSH/PEM e PuTTY .ppk).'
  } else if (/all configured authentication methods failed|authentication failed|auth fail/.test(lower)) {
    hint = 'Autenticazione fallita: username, password o chiave privata non sono accettati dal server. Verifica le credenziali (e, se usi una chiave, la relativa passphrase).'
  } else if (/\b530\b/.test(lower) || /login incorrect|not logged in|user cannot log in/.test(lower)) {
    hint = 'Login rifiutato: username o password errati.'
  } else if (/handshake/.test(lower)) {
    hint = 'Handshake SSH fallito: il server potrebbe non essere un vero server SFTP oppure usare algoritmi non compatibili.'
  } else if (/permission denied|eacces|access denied|\bcode 3\b|\b553\b|\b550 .*permission/.test(lower)) {
    hint = dir
      ? `Permessi insufficienti sulla cartella remota "${dir}": l'utente non può scrivere/leggere lì.`
      : 'Permessi insufficienti sul server per questa operazione.'
  } else if (/no such file|enoent|\b550\b|not found|no such directory|\bcode 2\b/.test(lower)) {
    hint = dir
      ? `Cartella remota non trovata o non accessibile: verifica che il percorso "${dir}" esista sul server.`
      : 'Percorso remoto non trovato o non accessibile.'
  }

  const detail = raw ? raw + (code != null ? ` (codice: ${code})` : '') : (code != null ? `codice: ${code}` : 'nessun dettaglio')
  const message = `${proto}: errore durante ${opLabel} su ${where}.` +
    (hint ? ` ${hint}` : '') +
    ` — Dettaglio tecnico: ${detail}`
  const decorated = new Error(message)
  decorated.__decorated = true
  decorated.cause = err
  return decorated
}

// ─── FTP / FTPS (basic-ftp) ─────────────────────────────────────────────────
async function withFtpClient(profile, protocol, fn) {
  const client = new ftp.Client(20000)
  try {
    try {
      await client.access({
        host: String(profile.host).trim(),
        port: portOf(profile, protocol),
        user: profile.user || undefined,
        password: profile.pass || undefined,
        secure: protocol === 'ftps'
      })
    } catch (err) {
      throw decorateError(err, profile, protocol, 'la connessione e autenticazione')
    }
    return await fn(client)
  } finally {
    client.close()
  }
}

async function ftpTest(profile, protocol) {
  return withFtpClient(profile, protocol, async (client) => {
    const dir = String(profile.dir || '').trim()
    try {
      if (dir) await client.cd(dir)
      const pwd = await client.pwd()
      return { ok: true, dir: pwd }
    } catch (err) {
      throw decorateError(err, profile, protocol, dir ? `l'accesso alla cartella "${dir}"` : "l'accesso alla cartella remota")
    }
  })
}

async function ftpUpload(profile, protocol, localPath, onProgress) {
  return withFtpClient(profile, protocol, async (client) => {
    const dir = String(profile.dir || '').trim()
    const name = basename(localPath)
    try {
      if (dir) await client.ensureDir(dir)
      if (onProgress) client.trackProgress((info) => onProgress(info.bytes))
      try {
        await client.uploadFrom(localPath, name)
      } finally {
        if (onProgress) client.trackProgress()
      }
      const pwd = await client.pwd()
      return { ok: true, remotePath: `${pwd.replace(/\/$/, '')}/${name}` }
    } catch (err) {
      throw decorateError(err, profile, protocol, `il caricamento di "${name}"${dir ? ` nella cartella "${dir}"` : ''}`)
    }
  })
}

// ─── SFTP (ssh2-sftp-client) ────────────────────────────────────────────────
// La chiave privata può essere in formato OpenSSH (PEM) o PuTTY (.ppk): ssh2
// riconosce entrambi. Se cifrata, serve la passphrase.
function sftpConnectOptions(profile, protocol) {
  const key = String(profile.privateKey || '').trim()
  return {
    host: String(profile.host).trim(),
    port: portOf(profile, protocol),
    username: profile.user || undefined,
    password: profile.pass || undefined,
    privateKey: key || undefined,
    passphrase: profile.passphrase || undefined,
    readyTimeout: 20000
  }
}

async function withSftpClient(profile, protocol, fn) {
  const sftp = new SftpClient()
  try {
    try {
      await sftp.connect(sftpConnectOptions(profile, protocol))
    } catch (err) {
      throw decorateError(err, profile, protocol, 'la connessione e autenticazione')
    }
    return await fn(sftp)
  } finally {
    try { await sftp.end() } catch (_) {}
  }
}

async function sftpTest(profile, protocol) {
  return withSftpClient(profile, protocol, async (sftp) => {
    const dir = String(profile.dir || '').trim() || '.'
    try {
      // list() valida l'accesso alla cartella remota.
      await sftp.list(dir)
      return { ok: true, dir }
    } catch (err) {
      throw decorateError(err, profile, protocol, `l'accesso alla cartella "${dir}"`)
    }
  })
}

async function sftpUpload(profile, protocol, localPath, onProgress) {
  return withSftpClient(profile, protocol, async (sftp) => {
    const dir = String(profile.dir || '').trim().replace(/\/$/, '')
    const name = basename(localPath)
    const remotePath = dir ? `${dir}/${name}` : name
    try {
      if (dir && !(await sftp.exists(dir))) await sftp.mkdir(dir, true)
      await sftp.fastPut(localPath, remotePath, {
        step: onProgress ? (transferred) => onProgress(transferred) : undefined
      })
      return { ok: true, remotePath }
    } catch (err) {
      throw decorateError(err, profile, protocol, `il caricamento di "${name}"${dir ? ` nella cartella "${dir}"` : ''}`)
    }
  })
}

// ─── API pubblica (agnostica sul protocollo) ────────────────────────────────
/** Verifica la connessione (login + accesso alla cartella remota). Ritorna { ok, dir }. */
export async function testConnection(profile) {
  assertProfile(profile)
  const protocol = protocolOf(profile)
  return protocol === 'sftp' ? sftpTest(profile, protocol) : ftpTest(profile, protocol)
}

/** Carica un file locale nella cartella remota del profilo, con avanzamento opzionale. Ritorna { ok, remotePath }. */
export async function uploadFile(profile, localPath, onProgress) {
  assertProfile(profile)
  const protocol = protocolOf(profile)
  return protocol === 'sftp'
    ? sftpUpload(profile, protocol, localPath, onProgress)
    : ftpUpload(profile, protocol, localPath, onProgress)
}
