-- =========================================
-- RAG Chatbot with WhatsApp Auto-Responder
-- Complete Database Schema
-- =========================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS vector;

-- =========================================
-- 1. Files table: one row per uploaded PDF
-- =========================================
CREATE TABLE IF NOT EXISTS rag_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================
-- 2. RAG chunks: text + embedding per chunk
-- =========================================
CREATE TABLE IF NOT EXISTS rag_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID REFERENCES rag_files(id) ON DELETE CASCADE,
  pdf_name TEXT,
  chunk TEXT NOT NULL,
  embedding VECTOR(1024),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster vector similarity search
-- Adjust lists value based on data size later.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'rag_chunks_embedding_ivfflat_idx'
  ) THEN
    CREATE INDEX rag_chunks_embedding_ivfflat_idx
      ON rag_chunks
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
  END IF;
END
$$;

-- =========================================
-- 3. Chat messages: conversation history (web chat)
-- =========================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  file_id UUID REFERENCES rag_files(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups by session
CREATE INDEX IF NOT EXISTS messages_session_id_idx
  ON messages (session_id, created_at);

-- =========================================
-- 4. WhatsApp messages: webhook storage
-- =========================================
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id BIGSERIAL PRIMARY KEY,
    message_id TEXT UNIQUE NOT NULL,
    channel TEXT NOT NULL,
    from_number TEXT NOT NULL,
    to_number TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    content_type TEXT,
    content_text TEXT,
    sender_name TEXT,
    event_type TEXT,
    is_in_24_window BOOLEAN DEFAULT false,
    is_responded BOOLEAN DEFAULT false,
    auto_respond_sent BOOLEAN DEFAULT false,
    response_message_id TEXT,
    response_sent_at TIMESTAMPTZ,
    raw_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for WhatsApp messages
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_message_id
  ON whatsapp_messages(message_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_from_number
  ON whatsapp_messages(from_number);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_received_at
  ON whatsapp_messages(received_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_event_type
  ON whatsapp_messages(event_type);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_auto_respond
  ON whatsapp_messages(auto_respond_sent, received_at DESC);

-- =========================================
-- 5. Phone-Document Mapping
-- =========================================
CREATE TABLE IF NOT EXISTS phone_document_mapping (
    id BIGSERIAL PRIMARY KEY,
    phone_number TEXT NOT NULL,
    file_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Foreign key to rag_files table
    CONSTRAINT fk_file FOREIGN KEY (file_id) REFERENCES rag_files(id) ON DELETE CASCADE,

    -- Unique constraint to prevent duplicate mappings
    CONSTRAINT unique_phone_file UNIQUE (phone_number, file_id)
);

-- Indexes for phone-document mapping
CREATE INDEX IF NOT EXISTS idx_phone_document_mapping_phone
  ON phone_document_mapping(phone_number);

CREATE INDEX IF NOT EXISTS idx_phone_document_mapping_file_id
  ON phone_document_mapping(file_id);

-- =========================================
-- 6. Functions and Triggers
-- =========================================

-- Function to update whatsapp_messages.updated_at
CREATE OR REPLACE FUNCTION update_whatsapp_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for whatsapp_messages
CREATE TRIGGER trigger_update_whatsapp_messages_updated_at
    BEFORE UPDATE ON whatsapp_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_messages_updated_at();

-- Function to update phone_document_mapping.updated_at
CREATE OR REPLACE FUNCTION update_phone_document_mapping_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for phone_document_mapping
CREATE TRIGGER trigger_update_phone_document_mapping_updated_at
    BEFORE UPDATE ON phone_document_mapping
    FOR EACH ROW
    EXECUTE FUNCTION update_phone_document_mapping_updated_at();

-- Vector search function (file-aware)
CREATE OR REPLACE FUNCTION match_documents (
  query_embedding VECTOR(1024),
  match_count INT DEFAULT 5,
  target_file UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  chunk TEXT,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    rag_chunks.id,
    rag_chunks.chunk,
    1 - (rag_chunks.embedding <=> query_embedding) AS similarity
  FROM rag_chunks
  WHERE target_file IS NULL
     OR rag_chunks.file_id = target_file
  ORDER BY rag_chunks.embedding <-> query_embedding
  LIMIT match_count;
$$;

-- =========================================
-- 7. Views
-- =========================================

-- View to easily see phone number mappings with file details
CREATE OR REPLACE VIEW phone_document_view AS
SELECT
    pdm.id,
    pdm.phone_number,
    pdm.file_id,
    rf.name AS file_name,
    pdm.created_at,
    pdm.updated_at
FROM phone_document_mapping pdm
JOIN rag_files rf ON pdm.file_id = rf.id
ORDER BY pdm.phone_number, pdm.created_at DESC;

-- =========================================
-- Setup Complete!
-- =========================================
--
-- Tables created:
--   1. rag_files - PDF file metadata
--   2. rag_chunks - Text chunks with embeddings
--   3. messages - Web chat conversation history
--   4. whatsapp_messages - WhatsApp webhook messages
--   5. phone_document_mapping - Phone number to document mapping
--
-- Functions created:
--   - match_documents() - Vector similarity search
--   - update_whatsapp_messages_updated_at() - Auto-update timestamp
--   - update_phone_document_mapping_updated_at() - Auto-update timestamp
--
-- Views created:
--   - phone_document_view - Easy access to phone-document mappings
--
-- Next steps:
--   1. Upload PDFs with phone number mapping
--   2. Configure webhook at /api/webhook/whatsapp
--   3. Test auto-responder with test-auto-responder.js
-- =========================================
