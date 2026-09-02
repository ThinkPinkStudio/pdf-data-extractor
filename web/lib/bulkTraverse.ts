// Traversal ASINCRONA e incrementale di una cartella, per la sezione "cartella bulk".
// Il problema: l'input `webkitdirectory` percorre l'intero albero in modo SINCRONO e
// materializza tutto il FileList in RAM prima che onChange parta → con migliaia di
// sottocartelle il tab resta bloccato per minuti (fino a OOM → reload → elenco perso).
// Questa scelta enumera la cartella a blocchi, con `await` tra un blocco e l'altro, e
// NON tiene i Blob in memoria: memorizza solo coppie { relPath, getFile } con l'handle
// (leggero). Il contenuto si legge solo all'upload (`getFile`), mai alla selezione.

// Una voce del bulk: un percorso relativo + una fabbrica lazy del File.
export interface BulkEntry {
  relPath: string
  getFile: () => Promise<File>
}

export interface TraverseProgress {
  scanned: number
  /** Totale file, se noto (con showDirectoryPicker/drag non è noto a priori). */
  total?: number
}

// Avanzamento dell'enumerazione. Accetta un totale opzionale: se assente la UI
// mostra una barra indeterminata con il conteggio corrente.
export type OnProgress = (p: TraverseProgress) => void

const BATCH = 100 // letture per giro del directoryReader (il browser le raggruppa)
const PAUSE_MS = 0 // pausa minima tra i batch, per far respirare il main thread
const PROGRESS_INTERVAL_MS = 100 // throttling dell'onProgress: non un setState per file

function pause() {
  // Await di un timeout (anche 0ms) rilascia il main thread al task queue, così lo
  // spinner/barra di avanzamento possono ridisegnarsi durante l'enumerazione.
  return new Promise<void>((r) => setTimeout(r, PAUSE_MS))
}

// Throttler dell'onProgress: aggiorna il chiamante al più ogni ~100ms, così con
// migliaia di file non si generano migliaia di setState (che bloccherebbero la UI).
function makeProgressReporter(onProgress?: OnProgress) {
  let last = 0
  return function report(n: number) {
    if (!onProgress) return
    const now = performance.now()
    if (now - last >= PROGRESS_INTERVAL_MS) {
      last = now
      onProgress({ scanned: n })
    }
  }
}

/**
 * Enumera una cartella partendo da un `FileSystemDirectoryHandle`
 * (via `window.showDirectoryPicker()` in Chromium). Ricorsiva e asincrona.
 */
export async function walkDirectoryHandle(
  root: FileSystemDirectoryHandle,
  onProgress?: OnProgress,
): Promise<BulkEntry[]> {
  const entries: BulkEntry[] = []
  const scanned = { n: 0 }
  const report = makeProgressReporter(onProgress)

  async function walk(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    const rootName = dir.name
    const base = prefix ? `${prefix}/${rootName}` : rootName
    for await (const handle of dir.values()) {
      const relPath = base ? `${base}/${handle.name}` : handle.name
      if (handle.kind === 'directory') {
        await walk(handle as FileSystemDirectoryHandle, base)
      } else {
        // Teniamo solo l'handle (leggero), non il contenuto. `handle` è un
        // FileSystemFileHandle, già chiuso sopra l'albero della cartella scelta.
        entries.push({
          relPath,
          getFile: () => (handle as FileSystemFileHandle).getFile(),
        })
        scanned.n += 1
        report(scanned.n)
        await pause()
      }
    }
  }

  await walk(root, '')
  return entries
}

/**
 * Enumera una cartella da un `DataTransferItem` lasciato con drag-and-drop
 * (funziona in Firefox e in Chromium). Usa `webkitGetAsEntry()` + il
 * `directoryReader.readEntries()` in batch da ~100, con `await` tra un batch e l'altro.
 *
 * Il primo argomento è un singolo DataTransferItem che DEVE essere una cartella:
 * la UI deve controllare `item.webkitGetAsEntry()?.isDirectory` prima di chiamarla.
 */
export async function walkDataTransferItem(
  item: DataTransferItem,
  onProgress?: OnProgress,
): Promise<BulkEntry[]> {
  const entry = item.webkitGetAsEntry()
  if (!entry) return []
  return walkEntry(entry, onProgress)
}

// Implementazione ricorsiva su un `FileSystemEntry` (usata dal drag-and-drop).
async function walkEntry(
  entry: FileSystemEntry,
  onProgress?: OnProgress,
  prefix = '',
): Promise<BulkEntry[]> {
  const entries: BulkEntry[] = []
  const scanned = { n: 0 }
  const report = makeProgressReporter(onProgress)

  async function walk(e: FileSystemEntry, parent: string): Promise<void> {
    const relPath = parent ? `${parent}/${e.name}` : e.name
    if (e.isFile) {
      // `webkitGetAsEntry` espone i file come `FileSystemFileEntry`; `file()` è
      // lazy: legge il contenuto solo quando chiamato, non durante l'enumerazione.
      const fe = e as FileSystemFileEntry
      entries.push({ relPath, getFile: () => new Promise<File>((res, rej) => fe.file(res, rej)) })
      scanned.n += 1
      report(scanned.n)
      await pause()
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader()
      // `readEntries` non restituisce mai l'albero intero in un colpo: i browser
      // raggruppano i risultati; va chiamato in loop finché non arriva una lista
      // vuota (segnala fine). Ogni giro è asincrono → il main thread respira.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
        if (!batch.length) break
        for (const child of batch) await walk(child, relPath)
      }
    }
  }

  await walk(entry, prefix)
  return entries
}
