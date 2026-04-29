# System Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    RAG Chatbot with WhatsApp                    │
│                         Auto-Responder                          │
└─────────────────────────────────────────────────────────────────┘

┌────────────┐   ┌────────────┐   ┌─────────────┐
│   User     │   │  WhatsApp  │   │   Admin     │
│   (Chat)   │   │  Business  │   │   (Upload)  │
└─────┬──────┘   └──────┬─────┘   └──────┬──────┘
      │                 │                 │
      v                 v                 v
┌──────────────────────────────────────────────────┐
│              Next.js Application                 │
├──────────────────────────────────────────────────┤
│  ┌────────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ Chat UI    │  │ Webhook  │  │ File Upload │ │
│  │ (Streaming)│  │ Receiver │  │  & Mapping  │ │
│  └─────┬──────┘  └────┬─────┘  └──────┬──────┘ │
│        │              │                │        │
│        v              v                v        │
│  ┌──────────────────────────────────────────┐  │
│  │         API Routes (Next.js)             │  │
│  │  - /api/chat (streaming)                 │  │
│  │  - /api/webhook/whatsapp                 │  │
│  │  - /api/process-pdf                      │  │
│  │  - /api/phone-mappings                   │  │
│  │  - /api/whatsapp/auto-respond            │  │
│  └────────────────┬─────────────────────────┘  │
│                   │                             │
│  ┌────────────────v─────────────────────────┐  │
│  │      Business Logic (src/lib)            │  │
│  │  - autoResponder.ts                      │  │
│  │  - retrieval.ts (RAG)                    │  │
│  │  - embeddings.ts                         │  │
│  │  - phoneMapping.ts                       │  │
│  └────────────────┬─────────────────────────┘  │
└───────────────────┼──────────────────────────────┘
                    │
       ┌────────────┴────────────┐
       │                         │
       v                         v
┌─────────────┐          ┌──────────────┐
│  Supabase   │          │   Groq AI    │
│  (Database  │          │   (LLM)      │
│   & Vector  │          │              │
│   Storage)  │          └──────────────┘
└─────────────┘
```

## Data Flow

### 1. PDF Upload with Phone Mapping

```
Admin uploads PDF with phone numbers
         ↓
POST /api/process-pdf
         ↓
Extract text (unpdf)
         ↓
Chunk text (1500 chars)
         ↓
Generate embeddings (Mistral AI)
         ↓
Store in Supabase:
  - rag_files (PDF metadata)
  - rag_chunks (text + embeddings)
  - phone_document_mapping (phone ↔ file)
```

### 2. WhatsApp Message → Auto-Response

```
WhatsApp sends message
         ↓
POST /api/webhook/whatsapp
         ↓
Store in whatsapp_messages table
         ↓
Trigger auto-responder (async)
         ↓
┌─────────────────────────────┐
│  Auto-Responder Pipeline    │
├─────────────────────────────┤
│ 1. Get mapped documents     │
│    (phone_document_mapping) │
│         ↓                   │
│ 2. Embed user query         │
│    (Mistral AI)             │
│         ↓                   │
│ 3. Vector search            │
│    (Supabase pgvector)      │
│         ↓                   │
│ 4. Get conversation history │
│    (last 5 messages)        │
│         ↓                   │
│ 5. Build prompt with        │
│    context + history        │
│         ↓                   │
│ 6. Generate response        │
│    (Groq LLM)               │
│         ↓                   │
│ 7. Log response in DB       │
└─────────────────────────────┘
         ↓
[Your WhatsApp API integration]
         ↓
Send to user
```

### 3. Chat Interface (Web)

```
User types message
         ↓
POST /api/chat (streaming enabled)
         ↓
Embed query → Vector search → Get history
         ↓
Stream response from Groq
         ↓
Frontend displays chunks in real-time
  - Shows "Thinking..." indicator
  - Streams text as it arrives
  - Markdown rendering
```

## Database Schema

### Tables

```sql
┌─────────────────┐
│   rag_files     │
├─────────────────┤
│ id (PK)         │
│ name            │
│ created_at      │
└────────┬────────┘
         │
         │ 1:N
         │
         v
┌─────────────────┐
│   rag_chunks    │
├─────────────────┤
│ id (PK)         │
│ file_id (FK)    │
│ chunk           │
│ embedding       │◄──── Vector similarity search
│ pdf_name        │
└─────────────────┘

┌──────────────────────┐
│ phone_document_      │
│      mapping         │
├──────────────────────┤
│ id (PK)              │
│ phone_number         │
│ file_id (FK)         │◄──── References rag_files
│ created_at           │
└──────────────────────┘

┌──────────────────────┐
│ whatsapp_messages    │
├──────────────────────┤
│ id (PK)              │
│ message_id (UNIQUE)  │
│ from_number          │
│ to_number            │
│ content_text         │
│ event_type           │
│ auto_respond_sent    │
│ response_sent_at     │
│ raw_payload (JSONB)  │
└──────────────────────┘
```

### Relationships

```
phone_number (917874949091)
         │
         │ can have multiple documents
         v
┌─────────────────────────────┐
│  Documents:                 │
│  - product-manual.pdf       │
│  - faq.pdf                  │
│  - support-guide.pdf        │
└─────────────────────────────┘
         │
         │ each contains multiple chunks
         v
┌─────────────────────────────┐
│  Chunks with embeddings     │
│  - Chunk 1 [vector 1024d]   │
│  - Chunk 2 [vector 1024d]   │
│  - Chunk 3 [vector 1024d]   │
│  - ...                      │
└─────────────────────────────┘
```

## API Architecture

### Endpoints

```
/api/
├── chat/
│   └── route.ts (POST - streaming)
│
├── process-pdf/
│   └── route.ts (POST - with phone_numbers)
│
├── phone-mappings/
│   └── route.ts (GET, POST, DELETE)
│
├── webhook/
│   └── whatsapp/
│       └── route.ts (POST, GET verification)
│
└── whatsapp/
    ├── messages/
    │   └── route.ts (GET)
    └── auto-respond/
        └── route.ts (POST)
```

### Request/Response Flow

**Upload with Mapping:**
```
POST /api/process-pdf
Content-Type: multipart/form-data

file: [PDF binary]
phone_numbers: "917874949091,919876543210"
         ↓
Response: {
  message: "PDF processed successfully",
  file_id: "uuid",
  chunks: 45,
  phone_numbers_mapped: 2
}
```

**Auto-Response:**
```
POST /api/whatsapp/auto-respond
Content-Type: application/json

{
  "phone_number": "917874949091",
  "message": "What is X?"
}
         ↓
Response: {
  "success": true,
  "response": "Based on the document, X is..."
}
```

## Technology Stack

### Frontend
- **Next.js 15** - React framework with App Router
- **React 19** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **shadcn/ui** - UI components

### Backend
- **Next.js API Routes** - Serverless functions
- **Supabase** - PostgreSQL with pgvector
- **Groq SDK** - LLM API (llama-3.3-70b-versatile)
- **Mistral AI** - Embeddings (mistral-embed)

### Libraries
- **unpdf** - PDF text extraction
- **uuid** - Unique identifiers
- **react-markdown** - Markdown rendering

## Performance Considerations

### Streaming
- **Chat**: Responses stream in real-time
- **UI**: Shows chunks as they arrive
- **UX**: Feels 10x faster than waiting for full response

### Batching
- **Embeddings**: Process 55 chunks/batch (under rate limit)
- **Rate limiting**: 60 requests/minute to Mistral

### Caching Opportunities
- ❌ Not implemented yet:
  - Query embeddings (repeated questions)
  - Common responses (FAQ-style)
  - Document embeddings (already done during upload)

### Optimization Tips
1. Reduce chunk count in retrieval (currently 5)
2. Use smaller embeddings (currently 1024d)
3. Implement response caching
4. Add CDN for static assets
5. Consider edge deployment (Vercel Edge)

## Security

### Current Measures
- Environment variables for secrets
- Duplicate message prevention (message_id unique constraint)
- Input validation on all endpoints

### Recommended Additions
- [ ] Webhook signature verification
- [ ] Rate limiting per phone number
- [ ] Phone number format validation
- [ ] Input sanitization (SQL injection prevention)
- [ ] API key rotation
- [ ] Access control for document upload

## Scalability

### Current Limits
- **Supabase Free Tier**: 500 MB database, 2 GB bandwidth/month
- **Groq**: API rate limits apply
- **Mistral**: 60 requests/minute

### Scaling Strategies
1. **Database**: Upgrade Supabase tier or self-host PostgreSQL
2. **LLM**: Cache responses, use cheaper models for simple queries
3. **Embeddings**: Pre-compute and cache
4. **Queue**: Add job queue (BullMQ, Inngest) for async processing
5. **CDN**: Cache static responses

## Monitoring

### What to Monitor
- [ ] API response times
- [ ] LLM token usage
- [ ] Database query performance
- [ ] Webhook processing success rate
- [ ] Error rates by endpoint

### Logging
Current logging locations:
- `console.log()` in API routes
- Vercel/local terminal

Recommended additions:
- Structured logging (Winston, Pino)
- Error tracking (Sentry)
- Analytics (PostHog, Mixpanel)

## Deployment

### Vercel
```bash
vercel --prod
```

### Environment Variables Required
- `GROQ_API_KEY`
- `MISTRAL_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `WHATSAPP_VERIFY_TOKEN`

### Build Configuration
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "installCommand": "npm install",
  "framework": "nextjs"
}
```

## Future Enhancements

1. **Admin Dashboard** - Manage mappings visually
2. **Analytics** - Track usage, costs, performance
3. **Multi-language** - Support multiple languages
4. **Media Support** - Handle images, videos in messages
5. **Custom Prompts** - Per-phone-number system prompts
6. **A/B Testing** - Test different prompts/models
7. **Feedback Loop** - Collect user feedback on responses
8. **Voice Support** - Transcribe voice messages
9. **Scheduled Messages** - Send proactive messages
10. **Integrations** - CRM, helpdesk systems
