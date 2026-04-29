-- =========================================
-- Migration: Add credentials to phone_document_mapping
-- =========================================

-- Add auth_token and origin columns to phone_document_mapping
-- This allows storing credentials at phone number level, not just at file level
ALTER TABLE phone_document_mapping
ADD COLUMN IF NOT EXISTS auth_token TEXT,
ADD COLUMN IF NOT EXISTS origin TEXT;

-- Copy existing credentials from files to phone mappings
UPDATE phone_document_mapping pdm
SET
    auth_token = rf.auth_token,
    origin = rf.origin
FROM rag_files rf
WHERE pdm.file_id = rf.id
  AND pdm.auth_token IS NULL
  AND rf.auth_token IS NOT NULL;

-- =========================================
-- Migration Complete
-- =========================================
