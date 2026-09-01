// Multi-document vector store
let documents = new Map() // id -> { filePath, fileName, text, chunks, numPages }
let nextId = 1

export function addDocument(data) {
  const id = String(nextId++)
  documents.set(id, { ...data, id })
  return id
}

export function getDocument(id) {
  if (id) return documents.get(id) || null
  // Return first document for backward compat
  const first = documents.values().next()
  return first.done ? null : first.value
}

export function getDocuments() {
  return Array.from(documents.values())
}

export function removeDocument(id) {
  documents.delete(id)
}

export function clearDocuments() {
  documents.clear()
}

export function hasDocument() {
  return documents.size > 0
}

export function getChunks(id) {
  if (id) {
    const doc = documents.get(id)
    return doc ? doc.chunks : []
  }
  // Backward compat: return chunks of first document
  const first = documents.values().next()
  return first.done ? [] : first.value.chunks
}

export function getAllChunks() {
  const all = []
  for (const doc of documents.values()) {
    all.push(...doc.chunks.map(c => ({ ...c, docId: doc.id, fileName: doc.fileName })))
  }
  return all
}

// Legacy backward compat aliases
export function setDocument(data) {
  // If there is already exactly one document, replace it
  if (documents.size === 1) {
    const [[existingId]] = documents.entries()
    documents.set(existingId, { ...data, id: existingId })
    return existingId
  }
  return addDocument(data)
}

export function clearDocument() {
  clearDocuments()
}

export function getFullText() {
  const first = documents.values().next()
  return first.done ? '' : first.value.text
}
