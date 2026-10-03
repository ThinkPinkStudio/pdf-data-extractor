#!/usr/bin/env node
/**
 * PUSH + DEPLOY IN PRODUZIONE DAL MAC, NEL MOMENTO SICURO (26/09/2026).
 *
 * Coolify (192.168.37.10:8000) sta dietro la VPN del cliente: i webhook di
 * GitHub non arrivano e il push su test_branch NON fa partire il deploy. Questo
 * script fa push → deploy in un comando, e il deploy parte SOLO quando in
 * produzione non gira niente (misure del Mac e job del cliente).
 *
 *   node scripts/deploy-prod.mjs [--dry-run] [--feature m1,m2] [--skip-push]
 *        [--no-wait] [--wait-max 180] [--quiet-checks 3] [--quiet-interval 60]
 *        [--deploy-timeout 30] [--verify-timeout 10] [--grace 120]
 *        [--keep-pause] [--ignore-queue] [--allow-files] [--max-file-mb 5]
 *        [--config ~/.config/csa-coolify.env] [--branch test_branch]
 *
 * Va lanciato IN BACKGROUND (l'attesa può durare ore; un comando in primo piano
 * dell'assistente viene ucciso dopo 10 minuti), con l'output su file:
 *   node scripts/deploy-prod.mjs > .goldens-out/deploy-$(date +%H%M).out 2>&1
 *
 * Configurazione FUORI dal repo, mai in argv (si legge con `ps`), mai nei log.
 * File ~/.config/csa-coolify.env (chmod 600), righe CHIAVE=valore:
 *   COOLIFY_URL=http://192.168.37.10:8000          (senza /api/v1)
 *   COOLIFY_APP_UUID=<uuid dell'applicazione di produzione>
 *   COOLIFY_TOKEN_KEYCHAIN=coolify-deploy          (default; servizio nel Portachiavi)
 *   APP_BASE_URL=https://genius.csabroker.it
 *   APP_EMAIL=<utente di un dominio ammesso>       (il login dell'app è senza
 *                                                   password: l'email È la credenziale)
 *   APP_CA_FILE=<pem della CA interna>             (facoltativo: senza, il
 *                                                   certificato dell'APP non si verifica)
 * Il token Coolify (permessi deploy + read) sta nel Portachiavi macOS:
 *   security add-generic-password -s coolify-deploy -a "$USER" -w
 * (-w in fondo e senza valore: lo chiede a prompt, non finisce nella history).
 * In mancanza della voce nel Portachiavi si accetta COOLIFY_TOKEN nel file di
 * configurazione SOLO se il file è chmod 600 (configurazione del 26/09/2026);
 * mai dall'ambiente. APP_EMAIL si può passare anche con --email (come
 * golden-prod).
 *
 * Passi:
 *  0. lock .goldens-out/DEPLOY.lock (un deploy-prod alla volta; lock orfano =
 *     pid morto → si riprende).
 *  1. git: fetch; si pusha il ramo LOCALE test_branch solo in fast-forward (mai
 *     --force, mai add/commit). Oggetti da pushare controllati: niente .env,
 *     chiavi, archivi, documenti dei clienti, file > --max-file-mb.
 *  2. push (sempre, anche se poi il deploy aspetta o la configurazione manca).
 *  3. Coolify: token/API/IP, app con quell'UUID che builda test_branch e NON ha
 *     un commit fissato (git_commit_sha vuoto o HEAD).
 *  4. PAUSE (.goldens-out/PAUSE, firmata con pid) riletta a OGNI controllo: se
 *     qualcuno la toglie si ricrea e i golden-prod già vivi contano come misure
 *     in corso. Finestra = N controlli consecutivi puliti: niente job
 *     queued/running sul server, niente batch in caricamento recente, niente
 *     misure vive sul Mac, niente code queue-*.sh con passi che ignorano PAUSE.
 *  5. Deploy: se Coolify ha già un deploy attivo per l'app lo si segue; se non
 *     contiene lo SHA, POST /deploy. Si segue fino a finished/failed; il commit
 *     costruito deve CONTENERE lo SHA pushato. Durante la build si continua a
 *     guardare la produzione: ciò che parte in quei minuti viene registrato
 *     (il riavvio lo colpirà: la misura va rifatta).
 *  6. /api/version: marcatori attesi (--feature, o i nuovi di BUILD_FEATURES).
 *     Senza lo stato «finished» di Coolify, dopo i marcatori si aspetta ancora
 *     --grace secondi (rolling update: il vecchio container può essere su).
 *  7. PAUSE tolta solo se è la propria e solo a deploy verificato. Deploy
 *     fallito/non verificabile → PAUSE RESTA. Interrotto (SIGINT/SIGTERM/SIGHUP)
 *     prima del deploy → PAUSE tolta; dopo → resta.
 *
 * Endpoint Coolify (sorgente v4, commit 510a2d8): POST /api/v1/deploy?uuid=,
 * GET /api/v1/deployments (attivi, permesso read), GET /api/v1/deployments/{uuid},
 * GET /api/v1/version, GET /api/v1/applications. Sempre POST per il deploy
 * (dalla v4.2.0 il GET risponde 405). Niente `force` (bug della beta.462).
 */
import { execFileSync, spawnSync } from 'child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'fs'
import http from 'http'
import https from 'https'
import { homedir } from 'os'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1 || i + 1 >= process.argv.length) return fallback
  return process.argv[i + 1]
}
const has = (name) => process.argv.includes(`--${name}`)
const num = (name, fallback) => {
  const v = Number(arg(name, String(fallback)))
  if (!Number.isFinite(v) || v <= 0) { console.error(`--${name}: numero positivo`); process.exit(2) }
  return v
}

// --repo serve solo a provare lo script da fuori (scratchpad); nel repo vale scripts/..
const ROOT = resolve(arg('repo', join(dirname(fileURLToPath(import.meta.url)), '..')))
const BRANCH = arg('branch', 'test_branch')
const DRY = has('dry-run')
const SKIP_PUSH = has('skip-push')
const NO_WAIT = has('no-wait')
const KEEP_PAUSE = has('keep-pause')
const IGNORE_QUEUE = has('ignore-queue')
const ALLOW_FILES = has('allow-files')
const WAIT_MAX_MIN = num('wait-max', 180)
const QUIET_CHECKS = num('quiet-checks', 3)
const QUIET_INTERVAL_S = num('quiet-interval', 60)
const DEPLOY_TIMEOUT_MIN = num('deploy-timeout', 30)
const VERIFY_TIMEOUT_MIN = num('verify-timeout', 10)
const GRACE_S = num('grace', 120)
const MAX_FILE_MB = num('max-file-mb', 5)
const BUILD_CHECK_S = 60
const FEATURES = arg('feature') ? arg('feature').split(',').map((s) => s.trim()).filter(Boolean) : null
// Batch aperto (upload_complete=false) da meno di così = caricamento IN CORSO.
// updated_at non si aggiorna a ogni dossier: conta l'età da created_at.
const UPLOAD_GRACE_MIN = 30
const OUT_DIR = join(ROOT, '.goldens-out')
const PAUSE_FILE = join(OUT_DIR, 'PAUSE')
const LOCK_FILE = join(OUT_DIR, 'DEPLOY.lock')
const DEPLOY_LOG = join(OUT_DIR, 'deploy.log')

class Stop extends Error {
  constructor(message, code = 1) { super(message); this.code = code }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mins = (t0) => `${Math.round((Date.now() - t0) / 60000)} min`
const short = (sha) => String(sha || '?').slice(0, 12)

// Mai il token né l'email in chiaro, neanche dentro un messaggio d'errore di
// terzi: tutto ciò che si stampa passa di qui.
const SECRETS = []
const redact = (s) => SECRETS.reduce((acc, sec) => (sec && sec.length >= 6 ? acc.split(sec).join('***') : acc), String(s))
const log = (...a) => console.log(redact(a.join(' ')))
const warn = (...a) => console.log(redact(`ATTENZIONE: ${a.join(' ')}`))

// ─── configurazione ─────────────────────────────────────────────────────────
function loadConfig() {
  const file = resolve(arg('config') || process.env.CSA_COOLIFY_ENV || join(homedir(), '.config', 'csa-coolify.env'))
  const problems = [] // bloccano il deploy (non il push)
  const notes = []
  const fromFile = {}
  if (existsSync(file)) {
    const rel = relative(ROOT, file)
    if (!rel.startsWith('..') && !isAbsolute(rel)) {
      throw new Stop(`Il file di configurazione ${file} sta DENTRO il repo: spostalo fuori (es. ~/.config/csa-coolify.env).`, 2)
    }
    if (statSync(file).mode & 0o077) notes.push(`${file} è leggibile da altri utenti: chmod 600 "${file}"`)
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      let v = m[2]
      if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1)
      else v = v.replace(/\s+#.*$/, '')
      fromFile[m[1]] = v
    }
  } else {
    problems.push(`file di configurazione assente: ${file}`)
  }
  const pick = (k) => process.env[k] || fromFile[k] || ''
  // Token dal Portachiavi; in mancanza, dal file di configurazione SOLO se il
  // file è chmod 600. Mai dall'ambiente: finirebbe nei processi figli (git).
  if (process.env.COOLIFY_TOKEN) {
    SECRETS.push(process.env.COOLIFY_TOKEN)
    problems.push('COOLIFY_TOKEN nell\'ambiente non accettato: mettilo nel Portachiavi o nel file di configurazione (chmod 600)')
  }
  delete process.env.COOLIFY_TOKEN
  if (fromFile.COOLIFY_TOKEN) SECRETS.push(fromFile.COOLIFY_TOKEN)
  const keychain = pick('COOLIFY_TOKEN_KEYCHAIN') || 'coolify-deploy'
  let token = ''
  try {
    token = execFileSync('security', ['find-generic-password', '-s', keychain, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { /* nessuna voce: si prova il file */ }
  if (!token && fromFile.COOLIFY_TOKEN) {
    if (existsSync(file) && (statSync(file).mode & 0o077)) problems.push(`COOLIFY_TOKEN in ${file} leggibile da altri utenti: chmod 600 "${file}"`)
    else { token = fromFile.COOLIFY_TOKEN; notes.push(`token letto da ${file} (chmod 600); più sicuro nel Portachiavi: security add-generic-password -s ${keychain} -a "$USER" -w`) }
  }
  if (!token && !fromFile.COOLIFY_TOKEN) problems.push(`nessun token: né la voce «${keychain}» nel Portachiavi né COOLIFY_TOKEN nel file (chmod 600)`)
  if (token) { SECRETS.push(token); if (token.includes('|')) SECRETS.push(token.split('|').slice(1).join('|')) }
  const email = pick('APP_EMAIL') || arg('email') || ''
  if (email) SECRETS.push(email)
  const caFile = pick('APP_CA_FILE')
  let appCa = null
  if (caFile) {
    try { appCa = readFileSync(caFile) } catch { problems.push(`APP_CA_FILE illeggibile: ${caFile}`) }
  }
  const cfg = {
    file,
    coolifyUrl: pick('COOLIFY_URL').replace(/\/+$/, '').replace(/\/api\/v1$/, ''),
    appUuid: pick('COOLIFY_APP_UUID'),
    token,
    keychain,
    appBase: (pick('APP_BASE_URL') || 'https://genius.csabroker.it').replace(/\/+$/, ''),
    email,
    appCa,
  }
  if (!cfg.coolifyUrl) problems.push('manca COOLIFY_URL')
  if (!cfg.appUuid) problems.push('manca COOLIFY_APP_UUID')
  if (!cfg.email) problems.push('manca APP_EMAIL')
  if (/^http:/i.test(cfg.coolifyUrl)) notes.push('Coolify è in HTTP: il token passa in chiaro sulla LAN/VPN (tienilo a deploy+read, con scadenza breve)')
  if (!appCa && /^https:/i.test(cfg.appBase)) notes.push('certificato dell\'app NON verificato (manca APP_CA_FILE): la deroga vale solo per le chiamate all\'app, non per Coolify')
  return { cfg, problems, notes }
}

// ─── lock: un deploy-prod alla volta ────────────────────────────────────────
let lockHeld = false
function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch (err) { return err.code === 'EPERM' }
}
function acquireLock() {
  mkdirSync(OUT_DIR, { recursive: true })
  for (let i = 0; i < 2; i++) {
    try {
      writeFileSync(LOCK_FILE, `${process.pid} ${new Date().toISOString()}\n`, { flag: 'wx' })
      lockHeld = true
      return
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
    }
    let other = 0
    try { other = Number(readFileSync(LOCK_FILE, 'utf8').split(/\s/)[0]) } catch { /* sparito nel frattempo */ }
    if (other && pidAlive(other)) throw new Stop(`Un altro deploy-prod è in corso (pid ${other}, ${LOCK_FILE}).`, 3)
    warn(`lock orfano (pid ${other || '?'} non esiste più): lo tolgo.`)
    try { unlinkSync(LOCK_FILE) } catch { /* già tolto */ }
  }
  throw new Stop(`Lock ${LOCK_FILE} non acquisito.`, 3)
}
function releaseLock() {
  if (!lockHeld) return
  try { if (readFileSync(LOCK_FILE, 'utf8').startsWith(`${process.pid} `)) unlinkSync(LOCK_FILE) } catch { /* niente */ }
  lockHeld = false
}

// ─── git ────────────────────────────────────────────────────────────────────
// GIT_TERMINAL_PROMPT=0: senza credenziali il comando fallisce subito invece di
// restare appeso. Niente segreti nell'ambiente dei figli.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
delete GIT_ENV.COOLIFY_TOKEN
function git(args, { allowFail = false, input } = {}) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', env: GIT_ENV, input, maxBuffer: 64 * 1024 * 1024, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] }).trimEnd()
  } catch (err) {
    if (allowFail) return null
    throw new Stop(`git ${args.join(' ')} → ${String(err.stderr || err.message).trim().slice(0, 300)}`, 1)
  }
}
const isAncestor = (a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: ROOT, env: GIT_ENV }).status === 0

// In --dry-run un problema non ferma: si elencano TUTTI.
function refuse(message) {
  if (DRY) { warn(`(dry-run) ${message}`); return }
  throw new Stop(message, 2)
}

// Ultima rete contro dati dei clienti e segreti: si guardano TUTTI gli oggetti
// che il push porterebbe su GitHub (anche un file aggiunto e poi tolto in un
// commit successivo), non solo il diff netto.
function scanPushObjects(from, to) {
  const objs = (git(['rev-list', '--objects', `${from}..${to}`]) || '').split('\n')
    .map((l) => { const i = l.indexOf(' '); return i > 0 ? { oid: l.slice(0, i), path: l.slice(i + 1) } : null })
    .filter((o) => o && o.path)
  if (!objs.length) return
  const info = new Map()
  const out = git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], { input: `${objs.map((o) => o.oid).join('\n')}\n` }) || ''
  for (const l of out.split('\n')) { const [oid, type, size] = l.split(' '); info.set(oid, { type, size: Number(size) }) }
  const bad = []
  for (const o of objs) {
    const meta = info.get(o.oid)
    if (!meta || meta.type !== 'blob') continue
    const p = o.path
    const why =
      /(^|\/)\.env(\.|$)/i.test(p) && !/\.(example|sample)$/i.test(p) ? 'file .env' :
      /(\.(pem|key|p12|pfx)|(^|\/)id_(rsa|ed25519|ecdsa)[^/]*)$/i.test(p) ? 'chiave/certificato' :
      /\.(zip|7z|rar|tar|gz|tgz)$/i.test(p) ? 'archivio' :
      /^polizze_test\//.test(p) && !/\.(json|md|txt|mjs|js)$/i.test(p) ? 'documento di cliente (polizze_test/)' :
      /\.(pdf|xlsx|xls|docx|doc|eml|msg)$/i.test(p) && !/^web\/assets\//.test(p) ? 'documento fuori da web/assets/' :
      meta.size > MAX_FILE_MB * 1024 * 1024 ? `più di ${MAX_FILE_MB} MB` : null
    if (why) bad.push(`${p} (${why}, ${(meta.size / 1048576).toFixed(1)} MB)`)
  }
  if (bad.length && !ALLOW_FILES) {
    refuse(`I commit da pushare portano su GitHub file che non devono andarci:\n  ${[...new Set(bad)].join('\n  ')}\n(se è voluto e controllato: --allow-files)`)
  } else if (bad.length) {
    warn(`--allow-files: pusho comunque ${bad.length} file segnalati.`)
  }
}

function checkGit() {
  git(['fetch', '--quiet', 'origin', BRANCH])
  const remoteSha = git(['rev-parse', `refs/remotes/origin/${BRANCH}`])
  const localSha = git(['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`], { allowFail: true })
  const current = git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true })
  // Le modifiche non committate NON vanno su (si pushano solo commit): si dice.
  const dirty = (git(['status', '--porcelain', '--untracked-files=no'], { allowFail: true }) || '').split('\n').filter(Boolean)
  const r = { target: remoteSha, remoteSha, localSha, toPush: false, ahead: [], behind: [], dirty, current }
  if (SKIP_PUSH || !localSha) return r
  if (current && current !== BRANCH) warn(`sei su «${current}»: si pusha il ramo locale ${BRANCH} (${short(localSha)}), non la HEAD che hai davanti.`)
  if (localSha === remoteSha) return r
  if (isAncestor(remoteSha, localSha)) {
    r.toPush = true
    r.target = localSha
    r.ahead = git(['log', '--oneline', `${remoteSha}..${localSha}`]).split('\n').filter(Boolean)
    scanPushObjects(remoteSha, localSha)
  } else if (isAncestor(localSha, remoteSha)) {
    // Un'altra sessione ha pushato: niente da pushare, si deploya origin (che
    // contiene il locale).
    r.behind = git(['log', '--oneline', `${localSha}..${remoteSha}`]).split('\n').filter(Boolean)
  } else {
    refuse(`${BRANCH} locale e origin/${BRANCH} sono divergenti: git pull --rebase (o --ff-only) e rilancia. Mai push --force.`)
  }
  return r
}

function pushBranch(sha) {
  const res = spawnSync('git', ['push', 'origin', `refs/heads/${BRANCH}:refs/heads/${BRANCH}`], { cwd: ROOT, env: GIT_ENV, stdio: 'inherit' })
  if (res.status !== 0) throw new Stop('git push fallito: nessun deploy lanciato.', 1)
  return currentTarget(sha)
}

// Coolify costruisce la HEAD del branch AL MOMENTO del job (git ls-remote dentro
// il deploy). Se nel frattempo un'altra sessione ha pushato va bene, purché
// origin DISCENDA dallo SHA nostro: il target diventa la nuova HEAD.
function currentTarget(sha) {
  git(['fetch', '--quiet', 'origin', BRANCH])
  const remote = git(['rev-parse', `refs/remotes/origin/${BRANCH}`])
  if (remote === sha) return sha
  if (isAncestor(sha, remote)) {
    const extra = git(['log', '--oneline', `${sha}..${remote}`]).split('\n').filter(Boolean)
    warn(`origin/${BRANCH} è andato avanti di ${extra.length} commit (altre sessioni): si deploya ${short(remote)}, che contiene ${short(sha)}.\n  ${extra.join('\n  ')}`)
    return remote
  }
  throw new Stop(`origin/${BRANCH} = ${short(remote)} NON contiene ${short(sha)} (push forzato da qualcuno?). Nessun deploy lanciato.`, 1)
}

// Marcatori di BUILD_FEATURES a uno SHA: unico modo, oggi, per sapere dall'app
// quale codice gira. Solo la PRIMA stringa di ogni riga, commento tolto.
function featuresAt(sha) {
  const src = git(['show', `${sha}:web/app/api/version/route.ts`], { allowFail: true })
  const block = src && src.match(/const BUILD_FEATURES\s*=\s*\[([\s\S]*?)\n\]/)
  if (!block) return null
  return block[1].split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').match(/'([^']+)'|"([^"]+)"/))
    .filter(Boolean)
    .map((m) => m[1] || m[2])
}
function requiredMarkers(sha, before) {
  if (FEATURES) return FEATURES
  const head = featuresAt(sha)
  if (!head || !head.length) return []
  // App giù prima del deploy: almeno l'ultimo marcatore dello SHA deve comparire.
  if (!before) return [head[head.length - 1]]
  return head.filter((f) => !before.includes(f))
}

// Il commit costruito da Coolify contiene lo SHA? null = non si sa (HEAD non risolta).
function commitContains(commit, sha) {
  if (!/^[0-9a-f]{40}$/.test(String(commit || ''))) return null
  if (commit === sha) return true
  git(['fetch', '--quiet', 'origin', BRANCH], { allowFail: true })
  return isAncestor(sha, commit)
}

// ─── Coolify ────────────────────────────────────────────────────────────────
let CFG = null
let APP = null
async function coolify(method, path) {
  let res
  try {
    res = await fetch(`${CFG.coolifyUrl}/api/v1${path}`, {
      method,
      // Il token SOLO nell'header, mai in query string (finirebbe nei log di accesso).
      headers: { Authorization: `Bearer ${CFG.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    })
  } catch (err) {
    return { status: 0, body: `${err.cause?.code || err.cause?.message || err.message}: Coolify non raggiungibile su ${CFG.coolifyUrl} (VPN attiva?)`, headers: new Headers() }
  }
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body, headers: res.headers }
}
function explainCoolify(status, body) {
  const msg = typeof body === 'string' ? body : (body?.message || JSON.stringify(body))
  if (status === 0) return msg
  if (status === 401) return 'token non valido o scaduto (401): rigeneralo in Coolify → Keys & Tokens → API Tokens'
  if (status === 403 && /API is disabled/i.test(msg)) return 'API di Coolify spenta: Settings → Advanced → «API access» = Enabled'
  if (status === 403 && /not allowed to access the API/i.test(msg)) return 'IP del Mac non ammesso: Settings → Advanced → «Allowed API IPs»'
  if (status === 403 && /Missing required permissions/i.test(msg)) return `permesso mancante nel token (${msg}): servono deploy + read`
  if (status === 404 && /No resources found/i.test(msg)) return 'nessuna risorsa con quell\'UUID per questo token (UUID o team sbagliato)'
  return `HTTP ${status}: ${String(msg).slice(0, 200)}`
}

async function coolifyPreflight({ quiet = false } = {}) {
  const v = await coolify('GET', '/version')
  if (v.status !== 200) throw new Stop(`Coolify /version: ${explainCoolify(v.status, v.body)}`, 2)
  const a = await coolify('GET', '/applications')
  if (a.status !== 200) throw new Stop(`Coolify /applications: ${explainCoolify(a.status, a.body)}`, 2)
  const list = Array.isArray(a.body) ? a.body : (a.body?.data || [])
  const app = list.find((x) => x?.uuid === CFG.appUuid)
  if (!app) {
    const seen = list.map((x) => `${x.name} (${x.uuid}, ${x.git_branch || '?'})`).join('; ') || 'nessuna'
    throw new Stop(`Nessuna app con UUID ${CFG.appUuid} per questo token (UUID o team sbagliato). Visibili: ${seen}`, 2)
  }
  if (app.git_branch && app.git_branch !== BRANCH) throw new Stop(`L'app «${app.name}» in Coolify builda «${app.git_branch}», non ${BRANCH}.`, 2)
  // Commit fissato nell'app: Coolify costruirebbe QUEL commit, non la HEAD del
  // branch; ce ne si accorgerebbe solo a produzione già riavviata.
  const pinned = String(app.git_commit_sha || '').trim()
  if (pinned && pinned.toUpperCase() !== 'HEAD') throw new Stop(`L'app «${app.name}» ha un commit fissato (git_commit_sha = ${short(pinned)}): il deploy costruirebbe quello. Riportalo a HEAD in Coolify.`, 2)
  APP = app
  if (!quiet) log(`Coolify ${String(v.body).replace(/"/g, '').trim().slice(0, 40)} — app «${app.name}» — branch ${app.git_branch || '?'} — commit ${pinned || 'HEAD'}`)
  return app
}

// Deploy attivi (queued/in_progress) di QUESTA app. deployment_url contiene
// /application/<uuid>/deployment/<uuid> (Application::link()). null = non leggibile.
async function activeDeploymentsForApp() {
  const r = await coolify('GET', '/deployments')
  if (r.status !== 200) return null
  const list = Array.isArray(r.body) ? r.body : (r.body && typeof r.body === 'object' ? Object.values(r.body) : [])
  return list
    .filter((d) => d && Number(d.pull_request_id || 0) === 0)
    .filter((d) => String(d.deployment_url || '').includes(`/application/${CFG.appUuid}/`) || (APP?.name && d.application_name === APP.name))
    .sort((x, y) => String(x.created_at || '').localeCompare(String(y.created_at || '')) || Number(x.id || 0) - Number(y.id || 0))
}

async function triggerDeploy() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const r = await coolify('POST', `/deploy?uuid=${encodeURIComponent(CFG.appUuid)}`)
    // Rete caduta DURANTE la POST: non si sa se Coolify l'ha ricevuta. Si
    // tratta come lanciato (PAUSE resta) e lo si cerca tra i deploy attivi.
    if (r.status === 0) return { uuid: null, message: String(r.body), ambiguous: true }
    if (r.status === 429) {
      const wait = Number(r.headers.get('retry-after')) || 60
      log(`  coda dei deploy di Coolify piena, riprovo tra ${wait} s`)
      await sleep(wait * 1000)
      continue
    }
    if (r.status !== 200) throw new Stop(`Deploy rifiutato: ${explainCoolify(r.status, r.body)}`, 4)
    const list = r.body?.deployments || []
    const d = list.find((x) => x.resource_uuid === CFG.appUuid) || list[0]
    if (!d) throw new Stop(`Risposta di Coolify senza deployments: ${JSON.stringify(r.body).slice(0, 200)}`, 4)
    // «already queued»: il deployment_uuid restituito è nuovo e NON esiste
    // (DeployController::deploy_resource): si cerca quello vero tra gli attivi.
    if (/already queued/i.test(d.message || '')) return { uuid: null, message: d.message, already: true }
    // HTTP 200 senza uuid (es. «Unauthorized to deploy this application.»):
    // nessun deploy partito.
    if (!d.deployment_uuid) throw new Stop(`Coolify non ha accodato il deploy: ${d.message || JSON.stringify(d)}`, 4)
    return { uuid: d.deployment_uuid, message: d.message }
  }
  throw new Stop('Coda dei deploy di Coolify piena (429) dopo 5 tentativi.', 4)
}

// ─── app (https con deroga TLS SOLO qui, mai per Coolify) ────────────────────
let APP_AGENT = null
function appRequest(method, path, { body = null, headers = {}, timeoutMs = 30000 } = {}) {
  return new Promise((resolveP, rejectP) => {
    const u = new URL(`${CFG.appBase}${path}`)
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.request(u, {
      method,
      headers: { 'User-Agent': 'deploy-prod-script', Accept: 'application/json', ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) },
      agent: u.protocol === 'https:' ? APP_AGENT : undefined,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolveP({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
      res.on('error', rejectP)
    })
    req.on('timeout', () => req.destroy(new Error(`timeout ${path}`)))
    req.on('error', rejectP)
    if (body) req.write(body)
    req.end()
  })
}
let cookie = ''
async function appLogin() {
  const res = await appRequest('POST', '/api/auth/login', { body: JSON.stringify({ email: CFG.email }), headers: { 'Content-Type': 'application/json' } })
  if (res.status !== 200) throw new Error(`login → HTTP ${res.status}`)
  const sc = [].concat(res.headers['set-cookie'] || []).find((c) => c.startsWith('pdf_extractor_session='))
  cookie = sc ? sc.split(';')[0] : ''
  if (!cookie) throw new Error('login ok ma nessun cookie di sessione')
}
// Niente redirect seguiti: senza cookie le route rispondono 307 verso il login.
async function appApi(path) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await appRequest('GET', path, { headers: { Cookie: cookie } })
    if ((res.status === 401 || (res.status >= 300 && res.status < 400)) && attempt === 1) { await appLogin(); continue }
    if (res.status !== 200) throw new Error(`GET ${path} → HTTP ${res.status}`)
    try { return JSON.parse(res.text) } catch { throw new Error(`GET ${path}: risposta non JSON`) }
  }
  throw new Error(`GET ${path}: login non accettato`)
}
async function appHealthy() {
  try { return (await appRequest('GET', '/api/health', { timeoutMs: 15000 })).status === 200 } catch { return false }
}
async function servedFeatures() {
  if (!(await appHealthy())) return null
  try { return (await appApi('/api/version'))?.buildFeatures || null } catch { return null }
}

// ─── «c'è una misura in corso?» ─────────────────────────────────────────────
// Lato SERVER: job queued/running in qualunque batch o tra i singoli (le run di
// test di golden-prod sono singoli). Copre anche il lavoro VERO del cliente.
async function serverActivity() {
  const reasons = []
  const warnings = []
  if (!(await appHealthy())) return { reasons, warnings: ['app non raggiungibile su /api/health: nessun job può girare adesso'] }
  const { batches = [] } = await appApi('/api/polizza/batch')
  const nowS = Date.now() / 1000
  for (const b of batches) {
    const active = Number(b.running || 0) + Number(b.queued || 0)
    const ageMin = (nowS - Number(b.created_at || 0)) / 60
    if (!b.upload_complete) {
      if (ageMin < UPLOAD_GRACE_MIN) { reasons.push(`batch «${b.label}» in caricamento (aperto da ${Math.round(ageMin)} min)`); continue }
      // Caricamento abbandonato: non gira, ma al riavvio instrumentation.ts lo
      // chiude (upload_complete=TRUE) e i suoi job PARTONO.
      warnings.push(`batch «${b.label}» in caricamento fermo da ${Math.round(ageMin / 60)} h: al riavvio l'app lo chiude${active ? ` e i suoi ${active} job partono` : ''}`)
      continue
    }
    if (active) reasons.push(`batch «${b.label}»: ${b.running || 0} in corso, ${b.queued || 0} in coda`)
  }
  // Pesante (ultimi 100 singoli con log e valori) ma è l'unica lettura che c'è:
  // si fa solo se i batch sono puliti.
  if (!reasons.length) {
    const { jobs = [] } = await appApi('/api/polizza/job')
    const single = jobs.filter((j) => j.status === 'running' || j.status === 'queued')
    if (single.length) reasons.push(`${single.length} estrazioni singole/run di test attive (${single.slice(0, 3).map((j) => j.dossierName || String(j.jobId || '').slice(0, 8)).join(', ')}${single.length > 3 ? ', …' : ''})`)
  }
  return { reasons, warnings }
}

// Lato MAC. golden-prod legge PAUSE solo all'AVVIO: partito DOPO la PAUSE
// (quella attuale) sta aspettando; partito PRIMA è a metà dei suoi casi. Uno
// script che NON legge PAUSE (oggi bulk-prod ed e2e-prod) vivo = occupato; se un
// giorno lo leggerà, lo si vede dal suo sorgente e vale come golden-prod.
const MEASURE_SCRIPTS = ['golden-prod.mjs', 'bulk-prod.mjs', 'e2e-prod.mjs'].map((name) => {
  let obeysPause = false
  try { obeysPause = /['"`]PAUSE['"`]/.test(readFileSync(join(ROOT, 'scripts', name), 'utf8')) } catch { /* assente */ }
  return { name, re: new RegExp(`(^|/)${name.replace('.', '\\.')}$`), obeysPause }
})
const PAUSE_IGNORERS = MEASURE_SCRIPTS.filter((s) => !s.obeysPause).map((s) => s.name.replace(/\.mjs$/, ''))

// Cartella di lavoro di un processo (per gli script lanciati con percorso
// relativo): un golden-prod di un ALTRO checkout (worktree) legge la SUA
// .goldens-out/PAUSE, non questa, quindi non si ferma.
function processCwd(pid) {
  try {
    const out = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const line = out.split('\n').find((l) => l.startsWith('n'))
    return line ? line.slice(1) : null
  } catch { return null }
}
const realOr = (p) => { try { return realpathSync(p) } catch { return p } }
const REAL_ROOT = realOr(ROOT)
const insideRoot = (p) => { const rel = relative(REAL_ROOT, realOr(p)); return !rel.startsWith('..') && !isAbsolute(rel) }
const resolveFor = (pid, p) => { if (isAbsolute(p)) return p; const cwd = processCwd(pid); return cwd ? resolve(cwd, p) : null }

function localActivity(pauseSince) {
  const reasons = []
  const warnings = []
  let out
  try {
    out = execFileSync('ps', ['-ax', '-o', 'pid=,lstart=,command='], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, maxBuffer: 16 * 1024 * 1024 })
  } catch {
    return { reasons: ['lista dei processi illeggibile (ps)'], warnings }
  }
  const queues = new Map()
  const seen = new Set()
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/)
    if (!m || Number(m[1]) === process.pid) continue
    const argv = m[3].trim().split(/\s+/)
    // Solo processi il cui ESEGUIBILE è node o una shell: mai la shell wrapper
    // che contiene lo stesso testo tra virgolette (la trappola di `pgrep -f`).
    if (!/(^|\/)node$/.test(argv[0])) {
      if (/^(\S*\/)?(ba|z)?sh$/.test(argv[0])) {
        const q = argv.slice(1).find((a) => /(^|\/)queue-[\w.-]*\.sh$/.test(a))
        if (q && !queues.has(q)) queues.set(q, m[1]) // le subshell di una pipeline hanno lo stesso argv
      }
      continue
    }
    const script = argv.slice(1).find((a) => MEASURE_SCRIPTS.some((s) => s.re.test(a)))
    if (!script) continue
    const spec = MEASURE_SCRIPTS.find((s) => s.re.test(script))
    const path = resolveFor(m[1], script)
    // Padre e figlio node con lo stesso argv e lo stesso avvio = una misura sola.
    const key = `${path || script}|${m[2]}`
    if (seen.has(key)) continue
    seen.add(key)
    const ours = path ? insideRoot(path) : false
    const started = new Date(m[2]).getTime() // lstart al secondo, ora locale
    if (spec.obeysPause && ours && pauseSince && started > pauseSince) continue
    const where = ours ? '' : path ? ` da ${dirname(dirname(path))}, che non vede questa PAUSE` : ', cartella di lavoro illeggibile'
    reasons.push(`misura sul Mac: pid ${m[1]} ${spec.name} (partita ${m[2].replace(/\s+/g, ' ')}${where})`)
  }
  // Code di misure: i passi che ignorano PAUSE partono anche in pausa, persino
  // DURANTE la build. Coda con passi del genere, di un'altra cartella o
  // illeggibile = occupato.
  for (const [q, pid] of queues) {
    const path = resolveFor(pid, q)
    let text = null
    try { text = path ? readFileSync(path, 'utf8') : null } catch { /* illeggibile */ }
    const ignorers = text ? PAUSE_IGNORERS.filter((n) => text.includes(n)) : null
    const cd = text && text.match(/^\s*cd\s+(["']?)([^"'\s|&;]+)\1/m)
    const elsewhere = cd && isAbsolute(cd[2]) && !insideRoot(cd[2]) ? cd[2] : null
    if (text && /rm\s+(-\w+\s+)*\S*PAUSE\b/.test(text)) warnings.push(`la coda ${q} toglie PAUSE (rm … PAUSE): lo script la ricrea a ogni controllo`)
    const busy = text === null ? `coda di misure ${q} (pid ${pid}) illeggibile`
      : elsewhere ? `coda di misure ${q} (pid ${pid}) che lavora in ${elsewhere}: non vede questa PAUSE`
      : ignorers.length ? `coda di misure ${q} (pid ${pid}) con passi ${ignorers.join('/')} che ignorano PAUSE` : null
    if (!busy) continue
    if (IGNORE_QUEUE) warnings.push(`${busy} (--ignore-queue: non blocca)`)
    else reasons.push(`${busy} — fermala, oppure --ignore-queue se il prossimo passo è un golden-prod`)
  }
  return { reasons, warnings }
}

async function activity(pauseSince) {
  const loc = localActivity(pauseSince)
  let srv
  try { srv = await serverActivity() } catch (err) { srv = { reasons: [`stato dell'app illeggibile (${err.message})`], warnings: [] } }
  return { reasons: [...loc.reasons, ...srv.reasons], warnings: [...new Set([...loc.warnings, ...srv.warnings])] }
}

// ─── PAUSE ──────────────────────────────────────────────────────────────────
// Firma con pid nel contenuto: si toglie solo la PROPRIA pausa. Riletta a ogni
// controllo: le code la tolgono (rm -f) e un altro processo può sostituirla.
const PAUSE_SIGNATURE = `deploy-prod pid=${process.pid} `
let pauseCreated = false
let pauseSince = null
let deployLaunched = false
let targetForPause = ''
function fileTime(p) {
  const st = statSync(p)
  return st.birthtimeMs > 0 ? Math.min(st.birthtimeMs, st.mtimeMs) : st.mtimeMs
}
function ensurePause() {
  let content = null
  try { content = readFileSync(PAUSE_FILE, 'utf8') } catch { /* assente */ }
  if (content !== null) {
    if (pauseCreated && !content.startsWith(PAUSE_SIGNATURE)) {
      pauseCreated = false
      warn('PAUSE sostituita da qualcun altro: non la toglierò io.')
    }
    if (pauseSince == null) {
      try { pauseSince = fileTime(PAUSE_FILE) } catch { pauseSince = Date.now() }
      log(`PAUSE già presente (${PAUSE_FILE}): la lascio com'è anche dopo.`)
    }
    return
  }
  const recreated = pauseSince != null
  mkdirSync(OUT_DIR, { recursive: true })
  try {
    writeFileSync(PAUSE_FILE, `${PAUSE_SIGNATURE}dal ${new Date().toISOString()} — deploy di ${short(targetForPause)}. Se questo pid non esiste più e in Coolify non c'è un deploy in corso: rm "${PAUSE_FILE}"\n`, { flag: 'wx' })
  } catch (err) {
    if (err.code === 'EEXIST') return ensurePause() // creata da altri in questo istante
    throw err
  }
  pauseCreated = true
  pauseSince = Date.now()
  if (recreated) warn('PAUSE era stata tolta da qualcun altro: ricreata; i golden-prod già vivi contano come misure in corso.')
  else log('PAUSE creata: golden-prod non avvia la prossima run finché il deploy non è verificato.')
}
function releasePause() {
  if (!pauseCreated || KEEP_PAUSE) return
  try {
    if (readFileSync(PAUSE_FILE, 'utf8').startsWith(PAUSE_SIGNATURE)) { unlinkSync(PAUSE_FILE); log('PAUSE tolta: le misure in coda ripartono.') }
  } catch { /* già tolta */ }
  pauseCreated = false
}
function keepPauseNotice() {
  if (existsSync(PAUSE_FILE)) log(`PAUSE RESTA (${PAUSE_FILE}): le misure non ripartono su codice incerto. Controlla Coolify, poi: rm "${PAUSE_FILE}"`)
}
function appendDeployLog(entry) {
  try {
    mkdirSync(OUT_DIR, { recursive: true })
    appendFileSync(DEPLOY_LOG, `${redact(JSON.stringify({ at: new Date().toISOString(), ...entry }))}\n`)
  } catch { /* il registro è una comodità */ }
}

function cleanup() {
  if (!DRY) {
    if (!deployLaunched) releasePause()
    else keepPauseNotice()
  }
  releaseLock()
}
for (const [sig, n] of [['SIGINT', 2], ['SIGTERM', 15], ['SIGHUP', 1]]) {
  process.on(sig, () => {
    console.log(`Interrotto (${sig})${deployLaunched ? ' DOPO il lancio del deploy: prosegue in Coolify senza di me.' : ' prima del deploy: niente è cambiato.'}`)
    cleanup()
    process.exit(128 + n)
  })
}
process.on('exit', releaseLock)

// ─── attese ─────────────────────────────────────────────────────────────────
// Finestra = QUIET_CHECKS controlli consecutivi puliti: un solo controllo può
// cadere nel buco tra due job o tra due casi di golden-prod.
async function waitForQuiet() {
  const t0 = Date.now()
  let quiet = 0
  let lastMsg = ''
  let lastPrint = 0
  for (;;) {
    ensurePause()
    const act = await activity(pauseSince)
    if (!act.reasons.length) {
      quiet++
      log(`  produzione libera (${quiet}/${QUIET_CHECKS})`)
      if (quiet >= QUIET_CHECKS) return act.warnings
    } else {
      quiet = 0
      if (NO_WAIT) throw new Stop(`Produzione occupata (--no-wait): ${act.reasons.join(' · ')}`, 3)
      const msg = act.reasons.join(' · ')
      if (msg !== lastMsg || Date.now() - lastPrint > 5 * 60000) {
        log(`  attendo (${mins(t0)}): ${msg}`)
        lastMsg = msg
        lastPrint = Date.now()
      }
    }
    if (Date.now() - t0 > WAIT_MAX_MIN * 60000) throw new Stop(`Dopo ${WAIT_MAX_MIN} min la produzione è ancora occupata (${lastMsg}). Nessun deploy fatto.`, 3)
    await sleep(QUIET_INTERVAL_S * 1000)
  }
}

// Ciò che parte DURANTE la build verrà colpito dal riavvio (finché nell'app non
// c'è un drain): lo si registra, così la misura si sa da rifare.
const HIT = new Set()
let lastBuildCheck = 0
async function watchDuringBuild() {
  ensurePause()
  if (Date.now() - lastBuildCheck < BUILD_CHECK_S * 1000) return
  lastBuildCheck = Date.now()
  const act = await activity(pauseSince)
  for (const r of act.reasons) if (!HIT.has(r)) { HIT.add(r); warn(`partito durante il deploy (il riavvio lo colpirà): ${r}`) }
}

// Stati: queued | in_progress | finished | failed | cancelled-by-user.
async function followDeploy(depUuid) {
  const t0 = Date.now()
  let last = ''
  let notFound = 0
  while (Date.now() - t0 < DEPLOY_TIMEOUT_MIN * 60000) {
    const r = await coolify('GET', `/deployments/${encodeURIComponent(depUuid)}`)
    if (r.status === 200) {
      notFound = 0
      const st = r.body?.status
      const commit = r.body?.commit || null
      const line = `${st}${commit ? ` · commit ${short(commit)}` : ''}`
      if (line !== last) { log(`  Coolify ${depUuid}: ${line} (${mins(t0)})`); last = line }
      if (st === 'finished') return { ok: true, commit, uuid: depUuid }
      if (st === 'failed' || st === 'cancelled-by-user') return { ok: false, status: st, commit, uuid: depUuid }
    } else if (r.status === 404) {
      if (++notFound >= 3) return { ok: null, reason: 'deploy non trovato da Coolify', uuid: depUuid }
    } else if (r.status === 401 || r.status === 403) {
      return { ok: null, reason: explainCoolify(r.status, r.body), uuid: depUuid }
    }
    // status 0 = rete (VPN): si riprova fino al timeout.
    await watchDuringBuild()
    await sleep(15000)
  }
  return { ok: null, reason: `nessun esito entro ${DEPLOY_TIMEOUT_MIN} min`, uuid: depUuid }
}

// Segue TUTTI i deploy attivi dell'app, dal più vecchio, finché non ne resta
// nessuno. Restituisce l'esito dell'ultimo (null = nessuno trovato).
async function followActive({ appearWithinMs = 0 } = {}) {
  const t0 = Date.now()
  let last = null
  const seen = new Set()
  for (let guard = 0; guard < 10; guard++) {
    const list = await activeDeploymentsForApp()
    if (list === null) { warn('elenco dei deploy attivi di Coolify illeggibile (GET /deployments).'); return last }
    const next = list.find((d) => !seen.has(d.deployment_uuid))
    if (!next) {
      if (last || Date.now() - t0 >= appearWithinMs) return last
      await sleep(10000)
      continue
    }
    seen.add(next.deployment_uuid)
    deployLaunched = true // un deploy attivo riavvierà la produzione comunque
    log(`Deploy attivo in Coolify: ${next.deployment_uuid} (${next.status}, commit ${short(next.commit)})`)
    last = await followDeploy(next.deployment_uuid)
  }
  return last
}

// ─── main ───────────────────────────────────────────────────────────────────
async function main() {
  const t00 = Date.now()
  log(`deploy-prod ${DRY ? '(DRY-RUN) ' : ''}— repo ${ROOT} — branch ${BRANCH}`)
  const { cfg, problems, notes } = loadConfig()
  CFG = cfg
  APP_AGENT = new https.Agent(cfg.appCa ? { ca: cfg.appCa } : { rejectUnauthorized: false })
  for (const n of notes) warn(n)
  if (!DRY) acquireLock()
  else if (existsSync(LOCK_FILE)) warn(`esiste ${LOCK_FILE}: ${readFileSync(LOCK_FILE, 'utf8').trim()}`)
  const ignorers = PAUSE_IGNORERS.join(', ')
  if (ignorers) warn(`${ignorers} non leggono PAUSE: vivi o in una coda contano come occupato.`)

  // 1. git
  const g = checkGit()
  targetForPause = g.target
  log(`${g.toPush ? 'Da pushare e deployare' : 'Da deployare'}: ${short(g.target)} — origin/${BRANCH}: ${short(g.remoteSha)}`)
  if (g.ahead.length) log(`Commit da pushare (${g.ahead.length}):\n  ${g.ahead.join('\n  ')}`)
  if (g.behind.length) log(`origin è avanti di ${g.behind.length} commit rispetto al ramo locale: si deploya origin.`)
  if (g.dirty.length) warn(`${g.dirty.length} file modificati NON committati: non vanno su.\n  ${g.dirty.join('\n  ')}`)

  if (DRY) {
    log(`Configurazione: ${cfg.file}${problems.length ? `\n  PROBLEMI: ${problems.join('\n  PROBLEMI: ')}` : ' — ok, token dal Portachiavi'}`)
    if (cfg.coolifyUrl && cfg.token) {
      await coolifyPreflight().catch((err) => warn(err.message))
      if (APP) {
        const act = await activeDeploymentsForApp()
        log(`Deploy attivi in Coolify per l'app: ${act === null ? 'elenco illeggibile' : act.length ? act.map((d) => `${d.deployment_uuid} ${d.status}`).join(', ') : 'nessuno'}`)
      }
    }
    if (cfg.email) {
      const before = await servedFeatures()
      log(`Marcatori serviti ora: ${before ? before.slice(-5).join(' · ') : '? (app giù o login rifiutato)'}`)
      log(`Marcatori attesi dopo il deploy: ${requiredMarkers(g.target, before).join(' · ') || 'nessuno (verifica solo dallo stato Coolify)'}`)
      const act = await activity(existsSync(PAUSE_FILE) ? fileTime(PAUSE_FILE) : null)
      log(act.reasons.length ? `Adesso OCCUPATO:\n  ${act.reasons.join('\n  ')}` : 'Adesso libero (un solo controllo).')
      for (const w of act.warnings) warn(w)
    } else {
      const act = localActivity(existsSync(PAUSE_FILE) ? fileTime(PAUSE_FILE) : null)
      log(`Solo controllo locale (manca APP_EMAIL): ${act.reasons.join(' · ') || 'nessuna misura sul Mac'}`)
      for (const w of act.warnings) warn(w)
    }
    log('DRY-RUN: nessun push, nessuna PAUSE, nessun deploy.')
    return 0
  }

  // 2. push: sempre, anche se poi il deploy deve aspettare o la configurazione manca
  const pushed = g.toPush ? pushBranch(g.target) : currentTarget(g.target)
  targetForPause = pushed
  log(`origin/${BRANCH} = ${short(pushed)}${g.toPush ? ' (push fatto)' : ''}`)
  if (problems.length) {
    throw new Stop(`origin/${BRANCH} è aggiornato, deploy NO:\n  ${problems.join('\n  ')}\nFino ad allora il deploy si lancia a mano in Coolify, tra due misure.`, 2)
  }

  // 3. controlli prima di fermare le misure: un token sbagliato non deve
  // lasciare la coda in pausa per niente.
  await coolifyPreflight()
  await appLogin().catch((err) => { throw new Stop(`Login all'app (${cfg.appBase}) fallito: ${err.message}`, 2) })
  const before = await servedFeatures()
  if (FEATURES && before) {
    const already = FEATURES.filter((f) => before.includes(f))
    if (already.length) warn(`--feature ${already.join(', ')} è GIÀ servito adesso: la sua presenza non prova il deploy nuovo.`)
  }

  // 4. pausa + finestra sicura
  ensurePause()
  log(`Attendo una finestra libera (${QUIET_CHECKS} controlli consecutivi ogni ${QUIET_INTERVAL_S} s, massimo ${WAIT_MAX_MIN} min)…`)
  const windowWarnings = await waitForQuiet()
  for (const w of windowWarnings) warn(w)

  // Tra push e deploy può essere passata un'ora: si ricontrollano origin (può
  // essere andato avanti) e l'app in Coolify (commit fissato nel frattempo?).
  const target = currentTarget(pushed)
  targetForPause = target
  await coolifyPreflight({ quiet: true })
  const required = requiredMarkers(target, before)
  if (required.length) log(`Marcatori attesi dopo il deploy: ${required.join(' · ')}`)
  else warn('nessun marcatore nuovo da aspettare in /api/version: la verifica sarà lo stato del deploy in Coolify. Per il futuro: aggiungi un marcatore in web/app/api/version/route.ts.')

  // 5. deploy
  const t0 = Date.now()
  let followed = null
  // Un deploy già attivo (es. Deploy premuto a mano) riavvierà comunque la
  // produzione: lo si segue; se non contiene il nostro SHA, se ne lancia uno dopo.
  // Si accetta solo se il commit costruito CONTIENE lo SHA (non «non si sa»).
  const pre = await followActive()
  if (pre?.ok && commitContains(pre.commit, target) === true) followed = pre
  else if (pre) log(`Il deploy già attivo ${pre.ok ? `ha costruito ${short(pre.commit)}, che non contiene (o non si sa se contiene) ${short(target)}` : `è finito ${pre.status || `senza esito (${pre.reason})`}`}: ne lancio uno nuovo.`)
  if (!followed) {
    const dep = await triggerDeploy()
    deployLaunched = true
    log(`Coolify: ${dep.message}${dep.uuid ? ` (deploy ${dep.uuid})` : ''}`)
    if (dep.uuid) followed = await followDeploy(dep.uuid)
    else followed = (await followActive({ appearWithinMs: 120000 })) || { ok: null, reason: dep.ambiguous ? 'POST senza risposta e nessun deploy attivo trovato' : 'deploy «already queued» non trovato tra gli attivi' }
  }
  if (followed.ok === false) {
    appendDeployLog({ sha: target, result: `coolify-${followed.status}`, deployment: followed.uuid, hit: [...HIT], minutes: Math.round((Date.now() - t0) / 60000) })
    throw new Stop(`Deploy ${followed.status} in Coolify (${followed.uuid}): di norma resta su il container precedente, ma va controllato nei log del deploy.`, 4)
  }
  if (followed.ok === null) warn(`stato del deploy non seguito fino in fondo: ${followed.reason}. Proseguo coi marcatori.`)
  if (followed.ok) {
    const contains = commitContains(followed.commit, target)
    if (contains === false) {
      appendDeployLog({ sha: target, result: 'commit-diverso', built: followed.commit, deployment: followed.uuid })
      throw new Stop(`Coolify ha costruito ${short(followed.commit)}, che NON contiene ${short(target)}.`, 4)
    }
    if (contains === null) warn(`commit costruito non leggibile (${followed.commit || 'vuoto'}): la prova resta ai marcatori.`)
    else if (followed.commit !== target) warn(`Coolify ha costruito ${short(followed.commit)}, successivo a ${short(target)} (un altro push nel frattempo).`)
  }

  // 6. verifica dall'app
  const verifyMin = VERIFY_TIMEOUT_MIN + (followed.ok ? 0 : DEPLOY_TIMEOUT_MIN)
  if (required.length) {
    log(`Attendo i marcatori in ${cfg.appBase}/api/version (massimo ${verifyMin} min)…`)
    const tv = Date.now()
    let ok = false
    let last = ''
    while (Date.now() - tv < verifyMin * 60000) {
      // Con «finished» il riavvio è già avvenuto: si sorveglia solo la PAUSE.
      if (followed.ok) ensurePause()
      else await watchDuringBuild()
      const served = await servedFeatures()
      const missingNow = served ? required.filter((f) => !served.includes(f)) : required
      if (served && !missingNow.length) { ok = true; break }
      const line = served ? `mancano ancora: ${missingNow.join(' · ')}` : 'app in riavvio o non raggiungibile'
      if (line !== last) { log(`  ${line} (${mins(tv)})`); last = line }
      await sleep(15000)
    }
    if (!ok) {
      appendDeployLog({ sha: target, result: 'marker-timeout', required, deployment: followed.uuid, hit: [...HIT] })
      throw new Stop(`Dopo ${verifyMin} min /api/version non espone ${required.join(', ')}.`, 5)
    }
    // Senza «finished» di Coolify il vecchio container può essere ancora su
    // (rolling update: start nuovo → health check → stop vecchio).
    if (!followed.ok) {
      log(`Marcatori presenti ma senza stato «finished» di Coolify: aspetto ancora ${GRACE_S} s (rolling update).`)
      const tg = Date.now()
      while (Date.now() - tg < GRACE_S * 1000) { await watchDuringBuild(); await sleep(15000) }
      const again = await servedFeatures()
      if (!again || required.some((f) => !again.includes(f))) {
        appendDeployLog({ sha: target, result: 'marker-instabile', required, hit: [...HIT] })
        throw new Stop('I marcatori sono spariti dopo l\'attesa: più container in gioco? Controlla Coolify.', 5)
      }
    }
    log(`Verificato: l'app serve ${required.join(' · ')}.`)
  } else if (!followed.ok) {
    appendDeployLog({ sha: target, result: 'non-verificato', deployment: followed.uuid, hit: [...HIT] })
    throw new Stop('Deploy lanciato ma NON verificabile (niente stato Coolify, niente marcatori nuovi).', 5)
  } else {
    const th = Date.now()
    while (!(await appHealthy()) && Date.now() - th < VERIFY_TIMEOUT_MIN * 60000) { ensurePause(); await sleep(10000) }
    if (!(await appHealthy())) throw new Stop(`Deploy finished in Coolify ma /api/health non risponde da ${VERIFY_TIMEOUT_MIN} min.`, 5)
  }

  // 7. ripresa delle misure
  if (HIT.size) warn(`Il riavvio può aver colpito (misure da rifare):\n  ${[...HIT].join('\n  ')}`)
  releasePause()
  appendDeployLog({ sha: target, result: 'ok', built: followed.commit || null, deployment: followed.uuid || null, required, hit: [...HIT], minutes: Math.round((Date.now() - t00) / 60000) })
  log(`Deploy di ${short(target)} completato in ${mins(t00)}.`)
  return 0
}

// Successo: la PAUSE propria è già stata tolta; si libera solo il lock.
main().then((code) => { releaseLock(); process.exit(code) }).catch((err) => {
  const code = err instanceof Stop ? err.code : 1
  console.error(redact(`ERRORE: ${err.message}`))
  if (!(err instanceof Stop)) console.error(redact(err.stack || ''))
  cleanup()
  process.exit(code)
})
