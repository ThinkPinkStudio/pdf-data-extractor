import { dialog, app } from 'electron'
import { writeFile } from 'fs/promises'
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

  ipcMain.handle('app:version', () => app.getVersion())
}
