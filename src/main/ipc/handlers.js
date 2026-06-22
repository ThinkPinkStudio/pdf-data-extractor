import { dialog, app, Notification, BrowserWindow, shell } from 'electron'
import { writeFile, copyFile, mkdir } from 'fs/promises'
import { readFileSync } from 'fs'
import { join } from 'path'
import { loadPDF, searchChunks } from '../services/pdfService.js'
import { getSettings, saveSettings } from '../services/settingsService.js'
import { resilientFetch, describeNetworkError } from '../services/netFetch.js'
import { runDeepDiagnostics, buildHumanReport } from '../services/netDiagnostics.js'
import { logDiagnostics, logLlmFailure, getLogDir } from '../services/diagLogger.js'
import {
  getOllamaStatus,
  extractDataWithProvider,
  streamChatWithProvider,
  testOpenAI,
  testAnthropic,
  testProviderConnection
} from '../services/llmService.js'
import {
  addDocument,
  getDocument,
  getDocuments,
  removeDocument,
  clearDocuments,
  hasDocument,
  getChunks,
  getAllChunks
} from '../services/vectorStore.js'
import {
  listSessions,
  saveSession,
  loadSession,
  deleteSession,
  clearAllSessions
} from '../services/historyService.js'
import {
  extractPolizzaFromPDFs,
  extractPolizzaFromImages,
  extractPolizzaRolling,
  updateStateWithVisionPage,
  exportToNewExcel,
  exportToTemplateExcel,
  exportApprovedChanges,
  previewTemplateChanges,
  readExcelStructure,
  buildMappingFromFields,
  ALL_POLIZZA_FIELDS,
  CSA_MAPPING
} from '../services/polizzaService.js'
import { basename } from 'path'

export function registerHandlers(ipcMain, mainWindow) {
  // Auto-cattura forense: se una chiamata reale al provider fallisce con un
  // errore di RETE (non auth/model/parse), in background eseguiamo una
  // diagnostica approfondita e la scriviamo nel log — così la prova esiste
  // anche se l'utente non apre mai la pagina di diagnostica. Fire-and-forget:
  // non blocca né altera l'errore mostrato all'utente.
  const NET_STAGES = ['tls', 'connect', 'proxy', 'dns', 'timeout', 'network']
  const withNetworkAutopsy = async (fn) => {
    try {
      return await fn()
    } catch (err) {
      const stage = describeNetworkError(err).stage
      if (NET_STAGES.includes(stage)) {
        const session = mainWindow?.webContents?.session || null
        runDeepDiagnostics({ settings: getSettings(), session })
          .then(r => logLlmFailure({ stage, message: err.message, verdict: r.verdict, snapshot: r }))
          .catch(() => {})
      }
      throw err
    }
  }

  // ─── PDF ──────────────────────────────────────────────────────────────────

  ipcMain.handle('dialog:openPDF', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleziona PDF',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:openMultiplePDFs', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleziona PDF',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || !result.filePaths.length) return []
    return result.filePaths
  })

  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleziona Cartella',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle('pdf:load', async (_, filePath) => {
    try {
      const data = await loadPDF(filePath)
      const id = addDocument({
        filePath,
        fileName: basename(filePath),
        text: data.text,
        chunks: data.chunks,
        numPages: data.numPages
      })
      return {
        success: true,
        id,
        fileName: basename(filePath),
        numPages: data.numPages,
        buffer: data.buffer
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('pdf:remove', async (_, id) => {
    removeDocument(id)
    return { success: true }
  })

  ipcMain.handle('pdf:getDocuments', () => {
    return getDocuments().map(d => ({ id: d.id, fileName: d.fileName, numPages: d.numPages }))
  })

  ipcMain.handle('pdf:extract', async (_, docId, overrideFields) => {
    if (!hasDocument()) return { success: false, error: 'Nessun documento caricato' }
    const settings = getSettings()

    try {
      const chunks = getChunks(docId)
      const enabledFields = (overrideFields && overrideFields.length > 0)
        ? overrideFields.filter(f => f.enabled)
        : settings.extractions.filter(f => f.enabled)
      const fieldQuery = enabledFields.map(f => f.description).join(' ')
      const relevant = searchChunks(fieldQuery, chunks, 6)

      const result = await withNetworkAutopsy(() => extractDataWithProvider(
        settings,
        enabledFields,
        relevant.length > 0 ? relevant : chunks.slice(0, 4)
      ))

      // Notify if window not focused
      const focused = mainWindow.isFocused()
      if (!focused && settings.notificationsEnabled !== false) {
        const doc = getDocument(docId)
        try {
          new Notification({
            title: 'PDF Extractor',
            body: `Estrazione completata: ${doc?.fileName || 'documento'}`
          }).show()
        } catch (_) {}
      }

      return { success: true, data: result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('pdf:chat', async (event, { message, history, docId }) => {
    if (!hasDocument()) return { success: false, error: 'Nessun documento caricato' }
    const settings = getSettings()

    try {
      const docs = getDocuments()
      const isMultiDoc = docs.length > 1

      let systemPrompt

      if (isMultiDoc) {
        // Multi-document mode: search across all chunks, then group results by document
        const allChunks = getAllChunks()
        const relevant = searchChunks(message, allChunks, 8)
        const pool = relevant.length > 0 ? relevant : allChunks.slice(0, 6)

        // Group chunks by document
        const chunksByDoc = new Map()
        for (const doc of docs) {
          chunksByDoc.set(doc.id, [])
        }
        for (const chunk of pool) {
          const id = chunk.docId
          if (chunksByDoc.has(id)) {
            chunksByDoc.get(id).push(chunk.text)
          }
        }

        // Build labelled context sections
        const docListLines = docs
          .map((d, i) => `${i + 1}. "${d.fileName}" (${d.numPages} pagine)`)
          .join('\n')

        const contextSections = docs
          .map(d => {
            const texts = chunksByDoc.get(d.id) || []
            const content = texts.length > 0 ? texts.join('\n\n') : '(nessuna parte rilevante trovata)'
            return `[Documento: ${d.fileName}]\n---\n${content}\n---`
          })
          .join('\n\n')

        systemPrompt = `Hai accesso a ${docs.length} documenti:
${docListLines}

Quando rispondi, specifica sempre da quale documento proviene l'informazione.
Se una domanda riguarda le differenze tra documenti, analizzale confrontandole direttamente.
Rispondi in modo preciso e conciso, basandoti esclusivamente sul testo fornito.
Se l'informazione non è presente in nessun documento, dillo chiaramente.

Parti rilevanti dei documenti:
${contextSections}`
      } else {
        // Single-document mode
        const doc = getDocument(docId)
        const chunks = docId ? getChunks(docId) : getChunks()
        const relevant = searchChunks(message, chunks, 5)
        const context = (relevant.length > 0 ? relevant : chunks.slice(0, 3))
          .map(c => c.text)
          .join('\n\n---\n\n')

        systemPrompt = `Sei un assistente che risponde a domande su un documento PDF.
Il documento si chiama "${doc?.fileName}" e ha ${doc?.numPages} pagine.
Rispondi in modo preciso e conciso, basandoti esclusivamente sul testo fornito.
Se l'informazione non è presente nel documento, dillo chiaramente.

Parti rilevanti del documento:
---
${context}
---`
      }

      const messages = [
        { role: 'system', content: systemPrompt },
        ...history.slice(-10),
        { role: 'user', content: message }
      ]

      const send = (payload) => {
        if (!event.sender.isDestroyed()) event.sender.send('llm:chunk', payload)
      }

      let fullResponse = ''
      for await (const chunk of streamChatWithProvider(settings, messages)) {
        fullResponse += chunk
        send({ chunk, done: false })
      }
      send({ chunk: '', done: true })

      return { success: true, response: fullResponse }
    } catch (err) {
      if (!event.sender.isDestroyed()) event.sender.send('llm:chunk', { chunk: '', done: true, error: err.message })
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('pdf:clear', () => {
    clearDocuments()
    return { success: true }
  })

  ipcMain.handle('pdf:export', async (_, { format, data, fileName }) => {
    const baseName = (fileName || 'export').replace(/\.pdf$/i, '')
    const extMap = { json: 'json', csv: 'csv', xlsx: 'xlsx' }
    const nameMap = { json: 'JSON', csv: 'CSV', xlsx: 'Excel' }
    const ext = extMap[format] || 'json'

    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Esporta dati estratti',
      defaultPath: `${baseName}_dati.${ext}`,
      filters: [{ name: nameMap[format] || 'File', extensions: [ext] }]
    })

    if (canceled || !filePath) return { success: false, canceled: true }

    try {
      if (format === 'json') {
        await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
      } else if (format === 'csv') {
        const esc = v => {
          const s = String(v ?? '')
          return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        }
        const keys = Object.keys(data)
        const vals = Object.values(data)
        const csv = `${keys.map(esc).join(',')}\n${vals.map(esc).join(',')}`
        await writeFile(filePath, csv, 'utf-8')
      } else if (format === 'xlsx') {
        // ExcelJS (non SheetJS/xlsx): evita la dipendenza 'xlsx' con vulnerabilità
        // HIGH note e senza fix upstream (prototype pollution + ReDoS).
        const { default: ExcelJS } = await import('exceljs')
        const wb = new ExcelJS.Workbook()
        const ws = wb.addWorksheet('Dati Estratti')
        const keys = Object.keys(data)
        ws.addRow(keys)
        ws.addRow(keys.map(k => data[k] ?? ''))
        await wb.xlsx.writeFile(filePath)
      }
      return { success: true, filePath }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── Session ──────────────────────────────────────────────────────────────

  ipcMain.handle('session:savePDFCopy', async () => {
    if (!hasDocument()) return { success: false, error: 'Nessun documento caricato' }
    const doc = getDocument()
    const result = await dialog.showSaveDialog({
      title: 'Salva copia PDF',
      defaultPath: doc.fileName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    try {
      await copyFile(doc.filePath, result.filePath)
      return { success: true, filePath: result.filePath }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('session:exportChat', async (_, { format, messages, fileName }) => {
    const baseName = (fileName || 'chat').replace(/\.pdf$/i, '')
    const isJson = format === 'json'
    const result = await dialog.showSaveDialog({
      title: 'Salva conversazione',
      defaultPath: `${baseName}_conversazione.${isJson ? 'json' : 'txt'}`,
      filters: isJson
        ? [{ name: 'JSON', extensions: ['json'] }]
        : [{ name: 'Testo', extensions: ['txt'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    try {
      let content
      if (isJson) {
        content = JSON.stringify(messages, null, 2)
      } else {
        content = messages.map(m => {
          const label = m.role === 'user' ? 'Utente' : 'Assistente'
          return `[${label}]\n${m.content}`
        }).join('\n\n---\n\n')
      }
      await writeFile(result.filePath, content, 'utf-8')
      return { success: true, filePath: result.filePath }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('session:exportAll', async (_, { messages, extracted, fileName }) => {
    const baseName = (fileName || 'sessione').replace(/\.pdf$/i, '')
    const folderResult = await dialog.showOpenDialog({
      title: 'Scegli cartella di destinazione',
      properties: ['openDirectory', 'createDirectory']
    })
    if (folderResult.canceled || !folderResult.filePaths.length) {
      return { success: false, canceled: true }
    }
    const destDir = folderResult.filePaths[0]
    const saved = []
    try {
      if (hasDocument()) {
        const doc = getDocument()
        const pdfDest = join(destDir, `${baseName}.pdf`)
        await copyFile(doc.filePath, pdfDest)
        saved.push(pdfDest)
      }
      if (messages && messages.length > 0) {
        const chatContent = messages.map(m => {
          const label = m.role === 'user' ? 'Utente' : 'Assistente'
          return `[${label}]\n${m.content}`
        }).join('\n\n---\n\n')
        const chatDest = join(destDir, `${baseName}_conversazione.txt`)
        await writeFile(chatDest, chatContent, 'utf-8')
        saved.push(chatDest)
      }
      if (extracted && Object.keys(extracted).length > 0) {
        const dataDest = join(destDir, `${baseName}_dati.json`)
        await writeFile(dataDest, JSON.stringify(extracted, null, 2), 'utf-8')
        saved.push(dataDest)
      }
      return { success: true, files: saved, folder: destDir }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── History ──────────────────────────────────────────────────────────────

  ipcMain.handle('history:list', () => {
    return listSessions()
  })

  ipcMain.handle('history:save', (_, session) => {
    return saveSession(session)
  })

  ipcMain.handle('history:load', (_, id) => {
    return loadSession(id)
  })

  ipcMain.handle('history:delete', (_, id) => {
    return deleteSession(id)
  })

  ipcMain.handle('history:clearAll', () => {
    return clearAllSessions()
  })

  // ─── Batch ────────────────────────────────────────────────────────────────

  let batchCancelled = false

  ipcMain.handle('batch:start', async (event, { filePaths }) => {
    batchCancelled = false
    const settings = getSettings()
    const total = filePaths.length
    const results = []

    for (let index = 0; index < total; index++) {
      if (batchCancelled) {
        mainWindow.webContents.send('batch:progress', {
          index, total, fileName: filePaths[index], status: 'cancelled'
        })
        break
      }

      const filePath = filePaths[index]
      const fileName = basename(filePath)

      mainWindow.webContents.send('batch:progress', {
        index, total, fileName, status: 'processing'
      })

      try {
        const pdfData = await loadPDF(filePath)
        const enabledFields = settings.extractions.filter(f => f.enabled)
        const fieldQuery = enabledFields.map(f => f.description).join(' ')
        const relevant = searchChunks(fieldQuery, pdfData.chunks, 6)
        const chunks = relevant.length > 0 ? relevant : pdfData.chunks.slice(0, 4)

        const result = await extractDataWithProvider(settings, enabledFields, chunks)

        results.push({ fileName, numPages: pdfData.numPages, data: result })

        mainWindow.webContents.send('batch:progress', {
          index, total, fileName, status: 'done', result
        })
      } catch (err) {
        results.push({ fileName, error: err.message })
        mainWindow.webContents.send('batch:progress', {
          index, total, fileName, status: 'error', error: err.message
        })
      }
    }

    // Show notification when batch is complete
    if (!batchCancelled && settings.notificationsEnabled !== false) {
      try {
        new Notification({
          title: 'PDF Extractor',
          body: `Elaborazione batch completata: ${results.filter(r => !r.error).length}/${total} file`
        }).show()
      } catch (_) {}
    }

    return { success: true, results }
  })

  ipcMain.handle('batch:cancel', () => {
    batchCancelled = true
    return { success: true }
  })

  // ─── Settings ─────────────────────────────────────────────────────────────

  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:save', (_, settings) => {
    saveSettings(settings)
    return { success: true }
  })

  // ─── Ollama / LLM ─────────────────────────────────────────────────────────

  ipcMain.handle('ollama:status', async () => {
    const settings = getSettings()
    return getOllamaStatus(settings.ollamaUrl)
  })

  ipcMain.handle('ollama:statusUrl', async (_, url) => {
    return getOllamaStatus(url)
  })

  ipcMain.handle('llm:testOpenAI', async (_, { apiKey, model }) => {
    return testOpenAI(apiKey, model)
  })

  ipcMain.handle('llm:testAnthropic', async (_, { apiKey, model }) => {
    return testAnthropic(apiKey, model)
  })

  // ─── Sicurezza / Diagnostica rete ───────────────────────────────────────────

  // Testa la connessione verso il provider LLM configurato usando lo stack di
  // rete di Chromium (proxy di sistema + CA del SO). Riporta una diagnosi
  // leggibile distinguendo problemi di rete/proxy/TLS da problemi di credenziali.
  ipcMain.handle('diagnostics:testConnection', async () => {
    try {
      return await testProviderConnection(getSettings())
    } catch (err) {
      return { ok: false, provider: '?', stage: 'network', status: null, message: err.message }
    }
  })

  // Info di sistema utili alla diagnostica (e da allegare al supporto).
  ipcMain.handle('diagnostics:system', () => ({
    platform: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }))

  // Diagnostica di rete APPROFONDITA: spacca la connessione verso il provider in
  // strati (DNS → TCP → TLS+catena cert → HTTP), risolve il proxy di sistema e
  // confronta con endpoint di controllo neutri. Scrive uno snapshot nel log.
  ipcMain.handle('diagnostics:deepNetwork', async () => {
    const settings = getSettings()
    const session = mainWindow?.webContents?.session || null
    try {
      const result = await runDeepDiagnostics({ settings, session })
      logDiagnostics({ kind: 'deep-diagnostics', verdict: result.verdict, provider: result.provider, host: result.host, result })
      return result
    } catch (err) {
      logDiagnostics({ kind: 'deep-diagnostics-error', error: err.message })
      return { type: 'deep-net', verdict: 'error', verdictText: err.message, error: err.message, layers: {}, controls: [], proxy: null }
    }
  })

  // Esporta un report completo: .txt leggibile + .json grezzo affiancato.
  // Solo file locale, nessun invio a server esterni.
  ipcMain.handle('diagnostics:exportReport', async (_, { result, quickReport, system } = {}) => {
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Esporta report diagnostica completo',
      defaultPath: `pdf-extractor-diagnostica-${ts}.txt`,
      filters: [{ name: 'Testo', extensions: ['txt'] }]
    })
    if (canceled || !filePath) return { success: false, canceled: true }
    try {
      const txt = buildHumanReport({ result, quickReport, system })
      await writeFile(filePath, txt, 'utf-8')
      await writeFile(filePath.replace(/\.txt$/i, '.json'), JSON.stringify({ result, quickReport, system }, null, 2), 'utf-8')
      return { success: true, filePath }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Apre la cartella dei log nel file manager del sistema.
  ipcMain.handle('diagnostics:openLogFolder', async () => {
    const dir = getLogDir()
    if (!dir) return { success: false, error: 'cartella log non disponibile' }
    await mkdir(dir, { recursive: true }).catch(() => {})
    const err = await shell.openPath(dir) // '' = successo
    return { success: !err, error: err || null, dir }
  })

  // ─── App ──────────────────────────────────────────────────────────────────

  ipcMain.handle('app:version', () => app.getVersion())

  // Controlla se su GitHub esiste una release più recente di quella in esecuzione.
  // Silenzioso: in assenza di rete o su errore restituisce { hasUpdate: false }.
  ipcMain.handle('app:checkUpdate', async () => {
    try {
      const current = app.getVersion()
      const res = await resilientFetch(
        'https://api.github.com/repos/thinkpinkstudio/pdf-data-extractor/releases/latest',
        { headers: { 'User-Agent': 'pdf-data-extractor' }, signal: AbortSignal.timeout(5000) }
      )
      if (!res.ok) return { hasUpdate: false }
      const data = await res.json()
      const match = data.tag_name?.match(/^v?(\d+\.\d+\.\d+)/)
      if (!match) return { hasUpdate: false }
      const latest = match[1]
      const cur = current.split('.').map(Number)
      const lat = latest.split('.').map(Number)
      let cmp = 0
      for (let i = 0; i < 3 && cmp === 0; i++) cmp = (lat[i] || 0) - (cur[i] || 0)
      return { hasUpdate: cmp > 0, latestVersion: latest, releaseUrl: data.html_url }
    } catch {
      return { hasUpdate: false }
    }
  })

  // ─── Polizza RC ───────────────────────────────────────────────────────────

  ipcMain.handle('dialog:openExcel', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleziona file Excel (template gestionale)',
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle('polizza:getFields', () => {
    const settings = getSettings()
    return (settings.polizzaFields && settings.polizzaFields.length > 0)
      ? settings.polizzaFields
      : ALL_POLIZZA_FIELDS
  })

  ipcMain.handle('polizza:getDefaultMapping', () => {
    const settings = getSettings()
    if (settings.polizzaFields && settings.polizzaFields.length > 0) {
      return buildMappingFromFields(settings.polizzaFields)
    }
    return CSA_MAPPING
  })

  ipcMain.handle('polizza:extract', async (_, { filePaths }) => {
    const settings = getSettings()
    try {
      const { data, scannedFiles, sources } = await withNetworkAutopsy(() => extractPolizzaFromPDFs(filePaths, settings))
      return { success: true, data, scannedFiles, sources: sources || {} }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Legge un file come buffer (per il rendering PDF lato renderer)
  ipcMain.handle('polizza:getFileBuffer', async (_, { filePath }) => {
    try {
      const buf = readFileSync(filePath)
      // Trasferisce come ArrayBuffer
      return { success: true, buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Estrazione vision da immagini già renderizzate
  ipcMain.handle('polizza:visionExtract', async (_, { imageFiles }) => {
    const settings = getSettings()
    try {
      const data = await withNetworkAutopsy(() => extractPolizzaFromImages(imageFiles, settings))
      return { success: true, data }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Estrazione rolling: una pagina alla volta, stato accumulativo date-aware.
  // Emette 'polizza:rollingProgress' durante l'elaborazione per aggiornare la UI.
  // Restituisce anche 'rollingState' (con date) per continuare con le pagine vision.
  ipcMain.handle('polizza:extractRolling', async (_, { filePaths }) => {
    const settings = getSettings()
    let sendFailures = 0
    try {
      const result = await withNetworkAutopsy(() => extractPolizzaRolling(
        filePaths,
        settings,
        (progress) => {
          // L'invio del progresso non deve MAI interrompere l'estrazione
          // (es. finestra distrutta/ricreata)
          try {
            mainWindow.webContents.send('polizza:rollingProgress', progress)
          } catch (err) {
            if (sendFailures++ === 0) {
              console.warn('[polizza] invio progresso alla UI fallito:', err.message)
            }
          }
        }
      ))
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Aggiornamento rolling per una singola pagina vision (PDF scansionato).
  // Il frontend chiama questo handler in loop, pagina per pagina, passando
  // lo stato corrente e ricevendo quello aggiornato.
  ipcMain.handle('polizza:rollingVisionUpdate', async (_, { state, imageBase64, pageNum, totalPages }) => {
    const settings = getSettings()
    try {
      const updatedState = await updateStateWithVisionPage(state, imageBase64, pageNum, totalPages, settings)
      return { success: true, state: updatedState }
    } catch (err) {
      // I flag permettono al renderer di interrompere subito il ciclo vision
      // (Ollama spento) o dopo pochi tentativi (timeout ripetuti)
      return {
        success: false,
        error: err.message,
        connectionError: !!err.isLlmConnectionError,
        timeoutError: !!err.isLlmTimeout
      }
    }
  })

  ipcMain.handle('polizza:exportNew', async (_, { data, suggestedName }) => {
    const settings = getSettings()
    const baseName = suggestedName || 'polizza_rc'
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Salva dati polizza RC',
      defaultPath: `${baseName}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    })
    if (canceled || !filePath) return { success: false, canceled: true }
    try {
      await exportToNewExcel(filePath, data, settings.polizzaFields || null)
      return { success: true, filePath }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('polizza:readTemplateStructure', async (_, { templatePath }) => {
    try {
      const structure = await readExcelStructure(templatePath)
      return { success: true, structure }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('polizza:exportToTemplate', async (_, { templatePath, data, mapping }) => {
    const settings = getSettings()
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Salva gestionale aggiornato',
      defaultPath: basename(templatePath).replace(/\.xlsx?$/, '_aggiornato.xlsx'),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    })
    if (canceled || !filePath) return { success: false, canceled: true }
    try {
      await exportToTemplateExcel(templatePath, filePath, data, mapping, settings.polizzaFields || null)
      return { success: true, filePath }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Preview delle modifiche: legge i valori attuali dal template e mostra il diff
  ipcMain.handle('polizza:previewChanges', async (_, { templatePath, data, mapping }) => {
    const settings = getSettings()
    try {
      const changes = await previewTemplateChanges(templatePath, data, mapping, settings.polizzaFields || null)
      return { success: true, changes }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('polizza:saveDiagnostics', async (_, { content }) => {
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Salva log diagnostica',
      defaultPath: `polizza_diagnostica_${ts}.txt`,
      filters: [{ name: 'Testo', extensions: ['txt'] }]
    })
    if (canceled || !filePath) return { success: false, canceled: true }
    try {
      await writeFile(filePath, content, 'utf-8')
      return { success: true, filePath }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── Window controls ────────────────────────────────────────────────────────
  ipcMain.handle('window:minimize', () => mainWindow.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow.close())
  ipcMain.handle('window:isMaximized', () => mainWindow.isMaximized())

  // Scrive nel template solo i campi approvati dall'utente
  ipcMain.handle('polizza:exportApproved', async (_, { templatePath, approvedChanges }) => {
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Salva gestionale aggiornato',
      defaultPath: basename(templatePath).replace(/\.xlsx?$/, '_aggiornato.xlsx'),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    })
    if (canceled || !filePath) return { success: false, canceled: true }
    try {
      await exportApprovedChanges(templatePath, filePath, approvedChanges)
      return { success: true, filePath }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}
