-- Add 11za Auth Token and Origin columns to rag_files table
-- This allows each file to have its own WhatsApp credentials instead of relying on environment variables

ALTER TABLE rag_files
ADD COLUMN auth_token TEXT,
ADD COLUMN origin TEXT;

-- Add comment to document the purpose
COMMENT ON COLUMN rag_files.auth_token IS '11za WhatsApp API authentication token for this file';
COMMENT ON COLUMN rag_files.origin IS '11za WhatsApp API origin website URL for this file';
