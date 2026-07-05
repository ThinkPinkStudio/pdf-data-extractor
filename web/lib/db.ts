import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS magic_tokens (
      id        SERIAL PRIMARY KEY,
      token     TEXT NOT NULL UNIQUE,
      email     TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      used      BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    CREATE INDEX IF NOT EXISTS idx_magic_tokens_token ON magic_tokens(token);

    CREATE TABLE IF NOT EXISTS action_logs (
      id         SERIAL PRIMARY KEY,
      timestamp  TEXT NOT NULL,
      email      TEXT,
      action     TEXT NOT NULL,
      resource   TEXT,
      metadata   TEXT,
      ip         TEXT,
      user_agent TEXT,
      success    BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE INDEX IF NOT EXISTS idx_logs_email     ON action_logs(email);
    CREATE INDEX IF NOT EXISTS idx_logs_action    ON action_logs(action);
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON action_logs(timestamp);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         SERIAL PRIMARY KEY,
      email      TEXT NOT NULL,
      file_name  TEXT NOT NULL,
      num_pages  INTEGER NOT NULL DEFAULT 0,
      pdf_base64 TEXT,
      meta       JSONB NOT NULL DEFAULT '{}',
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email);

    -- Batch: raggruppa N job polizza generati dall'upload ricorsivo di una cartella
    -- (una sottocartella = un job/dossier). Permette all'utente di lanciare
    -- l'elaborazione di un'intera alberatura e tornare più tardi a vederne l'esito.
    CREATE TABLE IF NOT EXISTS batch_jobs (
      id              TEXT PRIMARY KEY,
      email           TEXT NOT NULL,
      label           TEXT NOT NULL,
      upload_complete BOOLEAN NOT NULL DEFAULT FALSE,
      created_at      BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      updated_at      BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    ALTER TABLE batch_jobs ADD COLUMN IF NOT EXISTS upload_complete BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE INDEX IF NOT EXISTS idx_batch_jobs_email ON batch_jobs(email);

    -- Job di estrazione polizza eseguiti lato server (continuano a tab chiusa,
    -- recuperabili alla riapertura, riprendibili dopo un restart del container).
    CREATE TABLE IF NOT EXISTS polizza_jobs (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL,
      batch_id      TEXT REFERENCES batch_jobs(id) ON DELETE CASCADE,
      dossier_name  TEXT,
      status        TEXT NOT NULL DEFAULT 'queued',
      whole_dossier BOOLEAN NOT NULL DEFAULT FALSE,
      scanned_files JSONB NOT NULL DEFAULT '[]',
      cursor        JSONB NOT NULL DEFAULT '{}',
      progress      JSONB NOT NULL DEFAULT '{}',
      rolling_state JSONB NOT NULL DEFAULT '{}',
      sources       JSONB NOT NULL DEFAULT '{}',
      field_defs    JSONB NOT NULL DEFAULT '[]',
      error         TEXT,
      logs          JSONB NOT NULL DEFAULT '[]',
      created_at    BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      updated_at    BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    -- ALTER esplicite: CREATE TABLE IF NOT EXISTS non aggiunge colonne a una tabella
    -- polizza_jobs già esistente in produzione (deploy precedenti al batch).
    ALTER TABLE polizza_jobs ADD COLUMN IF NOT EXISTS batch_id TEXT REFERENCES batch_jobs(id) ON DELETE CASCADE;
    ALTER TABLE polizza_jobs ADD COLUMN IF NOT EXISTS dossier_name TEXT;

    CREATE INDEX IF NOT EXISTS idx_polizza_jobs_email ON polizza_jobs(email);
    CREATE INDEX IF NOT EXISTS idx_polizza_jobs_status ON polizza_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_polizza_jobs_batch ON polizza_jobs(batch_id);

    -- PDF di input del job (base64, come la tabella sessions): consente la ripresa
    -- del job anche dopo un riavvio, senza che il client ricarichi i file.
    CREATE TABLE IF NOT EXISTS polizza_job_files (
      job_id     TEXT NOT NULL REFERENCES polizza_jobs(id) ON DELETE CASCADE,
      idx        INTEGER NOT NULL,
      file_name  TEXT NOT NULL,
      pdf_base64 TEXT NOT NULL,
      PRIMARY KEY (job_id, idx)
    );

    -- ─── Corpus documentale ─────────────────────────────────────────────────
    -- Memoria permanente di ogni PDF elaborato: testo per pagina, metadati
    -- ricavati dal percorso di upload (agenzia/gruppo/società/ramo…) e chunk
    -- indicizzati per la ricerca full-text e (se pgvector è attivo) semantica.
    -- Dedup per contenuto: stesso file caricato più volte = una sola riga
    -- documents, più righe document_links.
    CREATE TABLE IF NOT EXISTS documents (
      id           TEXT PRIMARY KEY,
      email        TEXT NOT NULL,
      sha256       TEXT NOT NULL,
      file_name    TEXT NOT NULL,
      num_pages    INTEGER,
      text_status  TEXT NOT NULL DEFAULT 'pending', -- pending|partial|complete|failed
      agenzia      TEXT,
      gruppo       TEXT,
      societa      TEXT,
      stato_vigore TEXT,
      uso          TEXT,
      ramo         TEXT,
      doc_type     TEXT,
      anno         INTEGER,
      meta         JSONB NOT NULL DEFAULT '{}',
      created_at   BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      updated_at   BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_email_sha ON documents(email, sha256);
    CREATE INDEX IF NOT EXISTS idx_documents_ramo     ON documents(ramo);
    CREATE INDEX IF NOT EXISTS idx_documents_gruppo   ON documents(gruppo);
    CREATE INDEX IF NOT EXISTS idx_documents_doc_type ON documents(doc_type);

    CREATE TABLE IF NOT EXISTS document_links (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      job_id      TEXT NOT NULL REFERENCES polizza_jobs(id) ON DELETE CASCADE,
      batch_id    TEXT REFERENCES batch_jobs(id) ON DELETE SET NULL,
      rel_path    TEXT,
      file_idx    INTEGER,
      PRIMARY KEY (document_id, job_id)
    );

    CREATE INDEX IF NOT EXISTS idx_document_links_job ON document_links(job_id);

    CREATE TABLE IF NOT EXISTS document_pages (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      page        INTEGER NOT NULL,
      text        TEXT NOT NULL,
      text_source TEXT NOT NULL DEFAULT 'tesseract', -- tesseract|embedded|vision
      PRIMARY KEY (document_id, page)
    );

    -- Chunk per il retrieval: tsv (full-text italiano) sempre disponibile; la
    -- colonna vettoriale viene aggiunta a runtime da ensureEmbeddingColumn()
    -- solo se l'estensione pgvector esiste (dimensione dipendente dal modello).
    CREATE TABLE IF NOT EXISTS document_chunks (
      id          BIGSERIAL PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      page_from   INTEGER,
      page_to     INTEGER,
      text        TEXT NOT NULL,
      tsv         tsvector GENERATED ALWAYS AS (to_tsvector('italian', text)) STORED,
      embedding_model TEXT,
      UNIQUE (document_id, chunk_index)
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_tsv ON document_chunks USING GIN (tsv);
    CREATE INDEX IF NOT EXISTS idx_chunks_document ON document_chunks(document_id);

    -- ─── Chat sul corpus ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id         TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      title      TEXT,
      filters    JSONB NOT NULL DEFAULT '{}',
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    CREATE INDEX IF NOT EXISTS idx_chat_conversations_email ON chat_conversations(email);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id              BIGSERIAL PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL,
      content         TEXT NOT NULL,
      citations       JSONB NOT NULL DEFAULT '[]',
      created_at      BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id);

    -- ─── Rilevamento profilo sui job ────────────────────────────────────────
    ALTER TABLE polizza_jobs ADD COLUMN IF NOT EXISTS profile_id TEXT;
    ALTER TABLE polizza_jobs ADD COLUMN IF NOT EXISTS profile_candidates JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE polizza_jobs ADD COLUMN IF NOT EXISTS profile_locked BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE polizza_jobs ADD COLUMN IF NOT EXISTS rerun_from_text BOOLEAN NOT NULL DEFAULT FALSE;

    -- Percorso relativo originale dell'upload (fonte dei metadati) e link al
    -- documento del corpus corrispondente.
    ALTER TABLE polizza_job_files ADD COLUMN IF NOT EXISTS rel_path TEXT;
    ALTER TABLE polizza_job_files ADD COLUMN IF NOT EXISTS document_id TEXT;
  `)

  // pgvector è opzionale: senza estensione l'app funziona in modalità solo
  // full-text (nessun errore, ricerca semantica disattivata). CREATE EXTENSION
  // richiede i privilegi del ruolo: su Coolify basta usare l'immagine
  // pgvector/pgvector al posto di postgres.
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector')
    vectorAvailable = true
  } catch {
    const { rows } = await pool.query(`SELECT 1 FROM pg_extension WHERE extname = 'vector'`)
    vectorAvailable = rows.length > 0
  }
}

let vectorAvailable = false

export function isVectorEnabled(): boolean {
  return vectorAvailable
}

// Crea (o ricrea, se la dimensione del modello è cambiata) la colonna embedding
// e l'indice HNSW. Chiamata dal worker embeddings quando conosce modello/dim:
// HNSW e non IVFFlat perché non richiede un training set e il corpus cresce
// in modo incrementale.
export async function ensureEmbeddingColumn(dim: number): Promise<boolean> {
  if (!vectorAvailable || !Number.isFinite(dim) || dim <= 0) return false
  const { rows } = await pool.query<{ atttypmod: number }>(
    `SELECT atttypmod FROM pg_attribute
     WHERE attrelid = 'document_chunks'::regclass AND attname = 'embedding' AND NOT attisdropped`
  )
  const currentDim = rows[0]?.atttypmod // per i tipi vector atttypmod = dimensione
  if (currentDim === dim) return true
  if (rows.length > 0) {
    // Dimensione cambiata (nuovo modello): gli embeddings sono dati derivati,
    // si azzerano e il backfill li rigenera.
    await pool.query('ALTER TABLE document_chunks DROP COLUMN embedding')
    await pool.query(`UPDATE document_chunks SET embedding_model = NULL WHERE embedding_model IS NOT NULL`)
  }
  await pool.query(`ALTER TABLE document_chunks ADD COLUMN embedding vector(${dim})`)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_chunks_hnsw ON document_chunks USING hnsw (embedding vector_cosine_ops)')
  return true
}

export { pool }
