import { dialog, app } from 'electron'
import { writeFile, copyFile } from 'fs/promises'
import { join } from 'path'
import { loadPDF, searchChunks } from '../services/pdfService.js'
import { getSettings, saveSettings } from '../services/settingsService.js'
import { getOllamaStatus, extractData, streamChat } from '../services/llmService.js'
import { setDocument, getDocument, clearDocument, hasDocument, getChunks } from '../services/vectorStore.js'
import { basename } from 'path'

export function registerHandlers(ipcMain, mainWindow) {
  ipcMain.handle('dialog:openPDF', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleziona PDF',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle('pdf:load', async (_, filePath) => {
    try {
      const data = await loadPDF(filePath)
      setDocument({
        filePath,
        fileName: basename(filePath),
        text: data.text,
        chunks: data.chunks,
        numPages: data.numPages
      })
      return {
        success: true,
        fileName: basename(filePath),
        numPages: data.numPages,
        buffer: data.buffer
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('pdf:extract', async () => {
    if (!hasDocument()) return { success: false, error: 'Nessun documento caricato' }
    const settings = getSettings()
    if (!settings.ollamaModel) return { success: false, error: 'Nessun modello LLM selezionato' }

    try {
      const chunks = getChunks()
      const enabledFields = settings.extractions.filter(f => f.enabled)
      const fieldQuery = enabledFields.map(f => f.description).join(' ')
      const relevant = searchChunks(fieldQuery, chunks, 6)

      const result = await extractData(
        settings.ollamaUrl,
        settings.ollamaModel,
        enabledFields,
        relevant.length > 0 ? relevant : chunks.slice(0, 4)
      )
      return { success: true, data: result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('pdf:chat', async (event, { message, history }) => {
    if (!hasDocument()) return { success: false, error: 'Nessun documento caricato' }
    const settings = getSettings()
    if (!settings.ollamaModel) return { success: false, error: 'Nessun modello LLM selezionato' }

    try {
      const chunks = getChunks()
      const relevant = searchChunks(message, chunks, 5)
      const context = (relevant.length > 0 ? relevant : chunks.slice(0, 3))
        .map(c => c.text)
        .join('\n\n---\n\n')

      const doc = getDocument()
      const systemPrompt = `Sei un assistente che risponde a domande su un documento PDF.
Il documento si chiama "${doc.fileName}" e ha ${doc.numPages} pagine.
Rispondi in modo preciso e conciso, basandoti esclusivamente sul testo fornito.
Se l'informazione non è presente nel documento, dillo chiaramente.

Parti rilevanti del documento:
---
${context}
---`

      const messages = [
        { role: 'system', content: systemPrompt },
        ...history.slice(-10),
        { role: 'user', content: message }
      ]

      let fullResponse = ''
      for await (const chunk of streamChat(settings.ollamaUrl, settings.ollamaModel, messages)) {
        fullResponse += chunk
        event.sender.send('llm:chunk', { chunk, done: false })
      }
      event.sender.send('llm:chunk', { chunk: '', done: true })

      return { success: true, response: fullResponse }
    } catch (err) {
      event.sender.send('llm:chunk', { chunk: '', done: true, error: err.message })
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:save', (_, settings) => {
    saveSettings(settings)
    return { success: true }
  })

  ipcMain.handle('ollama:status', async () => {
    const settings = getSettings()
    return getOllamaStatus(settings.ollamaUrl)
  })

  ipcMain.handle('ollama:statusUrl', async (_, url) => {
    return getOllamaStatus(url)
  })

  ipcMain.handle('pdf:clear', () => {
    clearDocument()
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
        const XLSX = await import('xlsx')
        const ws = XLSX.utils.json_to_sheet([data])
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Dati Estratti')
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
        await writeFile(filePath, buf)
      }
      return { success: true, filePath }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('session:savePDFCopy', async () => {
    if (!hasDocument()) return { success: false, error: 'Nessun documento caricato' }
    const doc = getDocument()
    const { filePath: canceled, canceled: isCanceled } = {}
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

  ipcMain.handle('app:version', () => app.getVersion())
}
