// Persistenza delle conversazioni della chat sul corpus documentale.

import { pool } from './db'
import { randomUUID } from 'crypto'
import type { CorpusFilters } from './corpusSearch'

export interface Citation {
  n: number
  documentId: string
  fileName: string
  gruppo?: string | null
  societa?: string | null
  ramo?: string | null
  pageFrom?: number | null
  pageTo?: number | null
}

export interface ConversationRow {
  id: string
  email: string
  title: string | null
  filters: CorpusFilters
  created_at: number
  updated_at: number
}

export interface MessageRow {
  id: number
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  citations: Citation[]
  created_at: number
}

const now = () => Math.floor(Date.now() / 1000)

export async function createConversation(email: string, filters: CorpusFilters = {}): Promise<string> {
  const id = randomUUID()
  await pool.query(
    `INSERT INTO chat_conversations (id, email, filters, created_at, updated_at) VALUES ($1,$2,$3::jsonb,$4,$4)`,
    [id, email, JSON.stringify(filters), now()]
  )
  return id
}

export async function listConversations(email: string): Promise<ConversationRow[]> {
  const { rows } = await pool.query<ConversationRow>(
    'SELECT * FROM chat_conversations WHERE email = $1 ORDER BY updated_at DESC LIMIT 100', [email]
  )
  return rows
}

export async function getConversation(id: string, email: string): Promise<ConversationRow | null> {
  const { rows } = await pool.query<ConversationRow>(
    'SELECT * FROM chat_conversations WHERE id = $1 AND email = $2', [id, email]
  )
  return rows[0] ?? null
}

export async function deleteConversation(id: string, email: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM chat_conversations WHERE id = $1 AND email = $2', [id, email])
  return (rowCount ?? 0) > 0
}

export async function getMessages(conversationId: string, limit = 200): Promise<MessageRow[]> {
  const { rows } = await pool.query<MessageRow>(
    'SELECT * FROM chat_messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2', [conversationId, limit]
  )
  return rows.reverse()
}

export async function appendMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  citations: Citation[] = []
): Promise<void> {
  await pool.query(
    `INSERT INTO chat_messages (conversation_id, role, content, citations, created_at) VALUES ($1,$2,$3,$4::jsonb,$5)`,
    [conversationId, role, content, JSON.stringify(citations), now()]
  )
  await pool.query('UPDATE chat_conversations SET updated_at = $1 WHERE id = $2', [now(), conversationId])
}

// Il titolo nasce dal primo messaggio utente (troncato).
export async function maybeSetTitle(conversationId: string, firstMessage: string): Promise<void> {
  await pool.query(
    `UPDATE chat_conversations SET title = $1 WHERE id = $2 AND title IS NULL`,
    [firstMessage.slice(0, 80), conversationId]
  )
}

export async function updateFilters(conversationId: string, email: string, filters: CorpusFilters): Promise<void> {
  await pool.query(
    `UPDATE chat_conversations SET filters = $1::jsonb, updated_at = $2 WHERE id = $3 AND email = $4`,
    [JSON.stringify(filters), now(), conversationId, email]
  )
}
