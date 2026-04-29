# Implementation Summary: Multi-File Upload with OCR & Dynamic System Prompts

## Overview
Successfully implemented a comprehensive system that supports:
1. **Multi-file uploads** (PDFs and Images) per phone number
2. **OCR processing** for images using Mistral OCR
3. **Dynamic system prompts** generated based on intent using Groq
4. **Phone number-centric architecture** with multiple documents per number

---

## Database Changes

### Migration File
**Location:** `migrations/add_intent_and_file_type.sql`

**Changes Made:**
1. Added `file_type` column to `rag_files` table (tracks 'pdf' or 'image')
2. Added `intent` and `system_prompt` columns to `phone_document_mapping` table
3. Created index for faster intent lookups
4. Updated `phone_document_view` to include new fields

**To Apply Migration:**
```sql
-- Run this in your Supabase SQL editor
\i migrations/add_intent_and_file_type.sql
```

---

## New API Endpoints

### 1. `/api/process-file` (POST)
**Purpose:** Unified file upload endpoint for PDFs and Images

**Parameters:**
- `file` (File): PDF or Image file
- `phone_number` (string): WhatsApp Business number
- `intent` (string, optional): Purpose/intent for the chatbot
- `auth_token` (string): 11za authentication token
- `origin` (string): 11za origin URL

**Features:**
- Auto-detects file type (PDF vs Image)
- Uses `extractPdfText()` for PDFs
- Uses Mistral OCR for images
- Creates embeddings and stores chunks
- Links files to phone numbers
- Supports multiple files per phone number

### 2. `/api/generate-system-prompt` (POST)
**Purpose:** Generate AI-powered system prompts based on intent

**Parameters:**
- `intent` (string): Description of chatbot purpose
- `phone_number` (string): Phone number to update

**How it works:**
- Uses Groq's `llama-3.3-70b-versatile` model
- Generates professional system prompt from intent
- Automatically saves to database
- Updates all file mappings for the phone number

**Example:**
```json
{
  "intent": "Booking chatbot for restaurant reservations",
  "phone_number": "15558346206"
}
```

### 3. `/api/phone-groups` (GET)
**Purpose:** Fetch all phone numbers with their files and settings

**Response:**
```json
{
  "success": true,
  "groups": [
    {
      "phone_number": "15558346206",
      "intent": "Booking chatbot",
      "system_prompt": "You are a restaurant booking assistant...",
      "files": [
        {
          "id": "uuid",
          "name": "menu.pdf",
          "file_type": "pdf",
          "chunk_count": 15,
          "created_at": "2025-01-01T00:00:00Z"
        }
      ]
    }
  ]
}
```

---

## Updated Files Page

### Location: `src/app/files/page.tsx`

### New UI Features:
1. **Phone Number-Centric View**
   - Groups all files by phone number
   - Shows file count per phone number
   - Expandable/collapsible sections

2. **File Type Support**
   - Accepts both PDFs and images
   - Shows file type badge (pdf/image)
   - Auto-processes based on type

3. **Intent & System Prompt**
   - Input field for chatbot intent/purpose
   - "Generate Prompt" button using AI
   - Displays generated system prompt
   - Shows intent for each phone number

4. **Single Phone Number Upload**
   - Upload one file at a time
   - All files mapped to same phone number
   - Shared auth credentials

### Workflow:
1. Enter phone number
2. (Optional) Enter intent and click "Generate Prompt"
3. Select file (PDF or image)
4. Enter 11za credentials
5. Click "Upload & Process"
6. File is processed and added to phone number's document collection

---

## OCR Implementation

### API Endpoint: `/api/ocr/route.ts`

**Features:**
- Processes images using Mistral OCR (`mistral-ocr-latest`)
- Extracts markdown-formatted text
- Optional storage with embeddings
- Supports phone number mapping

**Usage in Unified Upload:**
The `/api/process-file` endpoint automatically uses OCR when it detects an image file type (`image/*`).

---

## Auto-Responder Updates

### Location: `src/lib/autoResponder.ts`

### Changes Made:
1. **Dynamic System Prompts**
   - Fetches custom system prompt from database
   - Falls back to default if not set
   - Appends document context to system prompt

2. **Multi-Document Retrieval**
   - Already supported (uses `getFilesForPhoneNumber()`)
   - Retrieves chunks from ALL files mapped to phone number
   - Searches across PDFs and images seamlessly

3. **Code Flow:**
```typescript
// 1. Get all file IDs for phone number
const fileIds = await getFilesForPhoneNumber(toNumber);

// 2. Fetch system prompt and credentials
const phoneMapping = await supabase
    .from("phone_document_mapping")
    .select("system_prompt, intent, rag_files(auth_token, origin)")
    .eq("phone_number", toNumber)
    .single();

// 3. Use custom or default system prompt
const systemPrompt = phoneMapping.system_prompt || defaultSystemPrompt;

// 4. Retrieve relevant chunks from ALL files
const matches = await retrieveRelevantChunksFromFiles(
    queryEmbedding,
    fileIds,  // Multiple files
    5
);

// 5. Generate response with custom system prompt
```

---

## How It All Works Together

### Example: Restaurant Booking Bot

1. **Setup Phase:**
   ```
   - Enter phone number: 15558346206
   - Enter intent: "Restaurant booking chatbot for table reservations"
   - Click "Generate Prompt"
   - AI creates: "You are a professional restaurant booking assistant..."
   ```

2. **Upload Documents:**
   ```
   - Upload menu.pdf → Extracted and chunked
   - Upload hours.jpg → OCR'd and chunked
   - Upload special-offers.png → OCR'd and chunked
   ```

3. **Customer Interaction:**
   ```
   Customer: "What are your lunch hours?"

   System:
   1. Searches chunks from all 3 documents
   2. Finds relevant info from hours.jpg
   3. Uses custom system prompt
   4. Responds as restaurant booking assistant
   ```

---

## Testing Steps

### 1. Run Migration
```bash
# In Supabase SQL Editor
\i migrations/add_intent_and_file_type.sql
```

### 2. Test File Upload
```
1. Go to http://localhost:3000/files
2. Enter phone number: 15558346206
3. Enter intent: "Customer support chatbot"
4. Click "Generate Prompt" and verify system prompt is created
5. Upload a PDF file
6. Upload an image file
7. Verify both appear under the same phone number
```

### 3. Test Auto-Responder
```
1. Send WhatsApp message to configured number
2. Verify response uses custom system prompt
3. Verify response includes info from both PDF and image files
```

---

## Files Created/Modified

### New Files:
- `migrations/add_intent_and_file_type.sql`
- `src/app/api/process-file/route.ts`
- `src/app/api/generate-system-prompt/route.ts`
- `src/app/api/phone-groups/route.ts`
- `src/app/files/page.tsx` (completely redesigned)

### Modified Files:
- `src/lib/autoResponder.ts` - Added dynamic system prompt support
- `src/app/api/ocr/route.ts` - Added storage capabilities

### Backup Files:
- `src/app/files/page_old.tsx` - Original implementation

---

## Key Features Summary

✅ **Multi-file support** - Upload multiple PDFs and images per phone number
✅ **Auto file type detection** - Automatically processes PDFs or images
✅ **OCR for images** - Mistral OCR extracts text from images
✅ **Dynamic system prompts** - AI-generated based on intent
✅ **Phone number grouping** - All files organized by phone number
✅ **Multi-document search** - Searches across all files for a number
✅ **Intent-based customization** - Different chatbot personalities
✅ **Backward compatible** - Existing files continue to work

---

## Next Steps

1. **Run the migration** to update your database schema
2. **Test the new files page** at `/files`
3. **Try generating a system prompt** for a phone number
4. **Upload both a PDF and an image** to test both flows
5. **Send a test WhatsApp message** to verify dynamic prompts work

---

## Support

For issues or questions:
- Check the logs in the terminal/console
- Review the debug information in the UI
- Verify database migration was applied successfully
- Ensure Mistral API key is configured for OCR

Happy coding! 🚀
