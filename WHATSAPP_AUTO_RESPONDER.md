# WhatsApp Auto-Responder with Document Mapping

This system allows you to map phone numbers to documents and automatically respond to WhatsApp messages using RAG (Retrieval-Augmented Generation).

## How It Works

1. **Upload a PDF** and assign it to one or more phone numbers
2. **Receive WhatsApp messages** via webhook
3. **Auto-respond** with answers based on the mapped documents
4. **Conversation history** is maintained for context

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│  WhatsApp   │─────>│   Webhook    │─────>│  Database   │
│   Message   │      │  /api/webhook│      │   Storage   │
└─────────────┘      └──────────────┘      └─────────────┘
                              │
                              v
                     ┌──────────────────┐
                     │  Auto-Responder  │
                     │  - Get Docs      │
                     │  - RAG Search    │
                     │  - LLM Response  │
                     └──────────────────┘
                              │
                              v
                     ┌──────────────────┐
                     │  WhatsApp API    │
                     │  (Your impl.)    │
                     └──────────────────┘
```

## Setup

### 1. Run Database Migration

Execute the consolidated migration in your Supabase SQL Editor:

```sql
-- Run the single migration file
-- migrations/create_database.sql

-- This creates all tables, indexes, functions, and views in one step!
```

### 2. Environment Variables

Add to your `.env.local`:

```env
GROQ_API_KEY=your_groq_api_key
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_key
WHATSAPP_VERIFY_TOKEN=your_webhook_token
```

## Usage

### Step 1: Upload PDF with Phone Number Mapping

```bash
curl -X POST http://localhost:3000/api/process-pdf \
  -F "file=@document.pdf" \
  -F "phone_numbers=917874949091,919876543210"
```

Multiple phone numbers can be comma-separated.

### Step 2: Verify Mapping

```bash
# Get all mappings for a phone number
curl "http://localhost:3000/api/phone-mappings?phone_number=917874949091"

# Response:
{
  "success": true,
  "mappings": [
    {
      "id": 1,
      "phone_number": "917874949091",
      "file_id": "uuid-here",
      "file_name": "document.pdf",
      "created_at": "2025-11-21T..."
    }
  ]
}
```

### Step 3: Test Auto-Response (Manual)

```bash
curl -X POST http://localhost:3000/api/whatsapp/auto-respond \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "917874949091",
    "message": "What is this document about?"
  }'

# Response:
{
  "success": true,
  "response": "Based on the document, this is about..."
}
```

### Step 4: Webhook Integration

When a WhatsApp message arrives, send it to:

```
POST /api/webhook/whatsapp
```

The webhook will:
1. Store the message in the database
2. Automatically check for document mappings
3. Generate and log the response
4. Return immediately (async processing)

## API Endpoints

### Document Upload

**POST `/api/process-pdf`**

Upload PDF and map to phone numbers.

```bash
FormData:
- file: PDF file
- phone_numbers: "917874949091,919876543210" (optional)
```

### Phone-Document Mapping

**GET `/api/phone-mappings`**

Query parameters:
- `phone_number`: Filter by phone number
- `file_id`: Filter by file ID

**POST `/api/phone-mappings`**

```json
{
  "phone_number": "917874949091",
  "file_id": "uuid-here"
}
```

**DELETE `/api/phone-mappings?id=123`**

Remove a mapping.

### WhatsApp Messages

**GET `/api/whatsapp/messages`**

Query parameters:
- `from`: Filter by phone number
- `limit`: Number of messages (default: 50)
- `offset`: Pagination offset

### Auto-Response

**POST `/api/whatsapp/auto-respond`**

Manually trigger auto-response (for testing):

```json
{
  "phone_number": "917874949091",
  "message": "Your question here",
  "message_id": "optional-message-id"
}
```

### Webhook

**POST `/api/webhook/whatsapp`**

Receive WhatsApp messages (see [WEBHOOK_SETUP.md](WEBHOOK_SETUP.md) for details).

**GET `/api/webhook/whatsapp`**

Webhook verification endpoint.

## Database Schema

### `phone_document_mapping`

Maps phone numbers to documents:

- `phone_number`: WhatsApp phone number (with country code)
- `file_id`: References `rag_files.id`
- Unique constraint on `(phone_number, file_id)`

### `whatsapp_messages`

Stores all incoming messages:

- `message_id`: Unique WhatsApp message ID
- `from_number`: Sender's phone number
- `content_text`: Message content
- `auto_respond_sent`: Whether auto-response was sent
- `response_sent_at`: When response was sent
- `raw_payload`: Complete webhook payload (JSONB)

### View: `phone_document_view`

Convenient view joining mappings with file names:

```sql
SELECT * FROM phone_document_view WHERE phone_number = '917874949091';
```

## Features

### ✅ Multiple Documents per Phone Number

One phone number can have multiple documents mapped:

```bash
# Upload first document
curl -X POST /api/process-pdf \
  -F "file=@manual.pdf" \
  -F "phone_numbers=917874949091"

# Upload second document
curl -X POST /api/process-pdf \
  -F "file=@faq.pdf" \
  -F "phone_numbers=917874949091"

# Queries will search across BOTH documents
```

### ✅ Multiple Phone Numbers per Document

One document can be mapped to multiple phone numbers:

```bash
curl -X POST /api/process-pdf \
  -F "file=@product-guide.pdf" \
  -F "phone_numbers=917874949091,919876543210,918888888888"
```

### ✅ Conversation History

The auto-responder includes the last 5 messages from each phone number for context.

### ✅ RAG-Powered Responses

Responses are generated using:
1. **Embedding** of the user's question
2. **Vector search** across mapped documents
3. **LLM generation** with retrieved context
4. **Conversation history** for continuity

### ✅ Async Processing

Webhook returns immediately while response generation happens in the background.

## Response Flow

1. **Message arrives** → Webhook stores in DB
2. **Auto-responder triggered** → Runs asynchronously
3. **Get documents** → Query `phone_document_mapping`
4. **RAG search** → Retrieve relevant chunks from all mapped docs
5. **Get history** → Last 5-10 messages for context
6. **LLM generates** → Groq API with context
7. **Store response** → Mark message as responded
8. **Send to WhatsApp** → (You implement this part)

## Implementation Notes

### Sending Responses Back to WhatsApp

The current implementation **generates** the response but doesn't send it back. You need to integrate with your WhatsApp Business API provider:

Update [src/lib/autoResponder.ts](src/lib/autoResponder.ts):

```typescript
// After generating response
if (result.success && result.response) {
    // TODO: Send response via WhatsApp API
    await sendWhatsAppMessage(fromNumber, result.response);
}
```

### Rate Limiting

Consider adding rate limiting to prevent abuse:

```typescript
// Check if user sent too many messages in short time
const recentMessages = await getRecentMessageCount(phoneNumber, 60000); // 1 min
if (recentMessages > 10) {
    return { success: false, error: "Rate limit exceeded" };
}
```

### Response Templates

For common queries, you might want to add quick responses:

```typescript
const commonQuestions = {
    "hello": "Hi! How can I help you with the document?",
    "help": "You can ask me any questions about the uploaded documents.",
};
```

## Testing

### Complete Test Flow

```bash
# 1. Upload a PDF with phone mapping
curl -X POST http://localhost:3000/api/process-pdf \
  -F "file=@test.pdf" \
  -F "phone_numbers=917874949091"

# 2. Verify mapping
curl "http://localhost:3000/api/phone-mappings?phone_number=917874949091"

# 3. Test auto-response
curl -X POST http://localhost:3000/api/whatsapp/auto-respond \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "917874949091",
    "message": "What is this document about?"
  }'

# 4. Send webhook message (simulates WhatsApp)
curl -X POST http://localhost:3000/api/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "test-123",
    "channel": "whatsapp",
    "from": "917874949091",
    "to": "15558346206",
    "receivedAt": "2025-11-21T04:12:39Z",
    "content": {
      "contentType": "text",
      "text": "How do I get started?"
    },
    "timestamp": "2025-11-21T04:12:39Z",
    "event": "MoMessage"
  }'

# 5. Check messages
curl "http://localhost:3000/api/whatsapp/messages?from=917874949091"
```

## Troubleshooting

### No Response Generated

1. Check if phone number has documents mapped:
   ```bash
   curl "http://localhost:3000/api/phone-mappings?phone_number=917874949091"
   ```

2. Check server logs for errors:
   ```bash
   # Look for "Auto-response error" in logs
   ```

3. Verify embeddings are working:
   ```bash
   # Test manual endpoint
   curl -X POST http://localhost:3000/api/whatsapp/auto-respond ...
   ```

### "No documents mapped" Error

The phone number doesn't have any documents assigned. Either:
- Upload a new PDF with this phone number
- Add mapping manually:
  ```bash
  curl -X POST http://localhost:3000/api/phone-mappings \
    -H "Content-Type: application/json" \
    -d '{"phone_number": "917874949091", "file_id": "uuid-here"}'
  ```

### Poor Response Quality

1. **Add more documents** for better context
2. **Adjust chunk size** in `src/lib/chunk.ts`
3. **Increase `match_count`** in auto-responder (currently 5)
4. **Adjust temperature** in Groq call (currently 0.2)

## Next Steps

1. **Implement WhatsApp sending** - Connect to your WhatsApp Business API
2. **Add response caching** - Cache common questions
3. **Monitor usage** - Track token usage and costs
4. **Add analytics** - Dashboard for message volume, response quality
5. **Improve prompts** - Fine-tune system prompts for better responses
6. **Add media support** - Handle images, PDFs in messages
7. **Multi-language** - Support multiple languages

## Security Considerations

1. **Verify webhook signatures** - Validate requests are from WhatsApp
2. **Rate limiting** - Prevent spam/abuse
3. **Phone number validation** - Ensure format is correct
4. **Input sanitization** - Clean user messages
5. **API key rotation** - Regularly rotate credentials
6. **Access control** - Restrict who can upload/map documents
