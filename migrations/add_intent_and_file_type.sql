-- =========================================
-- Migration: Add intent and file type support
-- =========================================

-- Add file_type column to rag_files to track PDF vs Image
ALTER TABLE rag_files
ADD COLUMN IF NOT EXISTS file_type TEXT DEFAULT 'pdf' CHECK (file_type IN ('pdf', 'image'));

-- Add intent and system_prompt columns to phone_document_mapping
ALTER TABLE phone_document_mapping
ADD COLUMN IF NOT EXISTS intent TEXT,
ADD COLUMN IF NOT EXISTS system_prompt TEXT;

-- Make file_id nullable to allow phone number creation before file upload
ALTER TABLE phone_document_mapping
ALTER COLUMN file_id DROP NOT NULL;

-- Create index for faster intent lookups
CREATE INDEX IF NOT EXISTS idx_phone_document_mapping_intent
  ON phone_document_mapping(phone_number, intent);

-- Update existing records to have 'pdf' as default file_type
UPDATE rag_files SET file_type = 'pdf' WHERE file_type IS NULL;

-- =========================================
-- Updated view to include intent and system_prompt
-- =========================================
-- Drop the existing view first to avoid column mismatch errors
DROP VIEW IF EXISTS phone_document_view;

-- Recreate the view with new columns (LEFT JOIN to include phone numbers without files)
CREATE VIEW phone_document_view AS
SELECT
    pdm.id,
    pdm.phone_number,
    pdm.file_id,
    rf.name AS file_name,
    rf.file_type,
    pdm.intent,
    pdm.system_prompt,
    pdm.created_at,
    pdm.updated_at
FROM phone_document_mapping pdm
LEFT JOIN rag_files rf ON pdm.file_id = rf.id
ORDER BY pdm.phone_number, pdm.created_at DESC;

-- =========================================
-- Migration Complete
-- =========================================
