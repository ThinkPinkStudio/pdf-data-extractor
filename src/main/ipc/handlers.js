import { dialog } from 'electron'
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
}
