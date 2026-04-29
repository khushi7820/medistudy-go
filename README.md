# RAG Chatbot with WhatsApp Auto-Responder

A Retrieval-Augmented Generation (RAG) chatbot built with Next.js and TypeScript. Features include:

-   📄 PDF document processing with vector embeddings
-   💬 Interactive chat interface with streaming responses
-   📱 WhatsApp webhook integration with auto-responder
-   🔗 Phone number to document mapping
-   🗄️ Conversation history and context

**Tech stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Supabase, Groq AI

📖 **[5-Minute Quick Start](QUICK_START.md)** | [How to Add Phone Numbers](HOW_TO_ADD_PHONE_NUMBERS.md) | [Architecture](ARCHITECTURE.md) | [WhatsApp Guide](WHATSAPP_AUTO_RESPONDER.md)

## Quick Start

-   Install

    `npm install`

-   Dev

    `npm run dev`

-   Build

    `npm run build`

## Environment Setup

Create `.env.local` (ignored by git). Required keys:

```env
MISTRAL_API_KEY=your_mistral_api_key_here
GROQ_API_KEY=your_groq_api_key_here
NEXT_PUBLIC_SUPABASE_URL=https://your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
WHATSAPP_VERIFY_TOKEN=your_webhook_verification_token_here

# WhatsApp Sending (11za.in API)
WHATSAPP_11ZA_AUTH_TOKEN=your_11za_auth_token
WHATSAPP_11ZA_ORIGIN=https://medistudygo.com/
```

Do not commit secrets. Use `.env.example` as a template.

**📱 WhatsApp Sending:** See [WHATSAPP_SENDING_SETUP.md](WHATSAPP_SENDING_SETUP.md) for complete setup instructions.

## Database Setup

**One-step setup:** Run `migrations/create_database.sql` in your Supabase SQL Editor.

This single file creates all tables, indexes, functions, and views:

-   ✅ PDF document storage and RAG chunks
-   ✅ Web chat conversation history
-   ✅ WhatsApp message storage
-   ✅ Phone number to document mapping
-   ✅ Vector search functions
-   ✅ Auto-update triggers

## Features

### 📄 Document Upload & Processing

-   Upload PDFs via `/files` page
-   Automatic text extraction and chunking
-   Vector embeddings using Mistral AI
-   Supabase vector storage
-   Map documents to phone numbers during upload

### 💬 Chat Interface

-   Real-time streaming responses
-   Thinking indicator while LLM processes
-   Markdown rendering for responses
-   Session-based conversation history
-   Document selection per chat

### 📱 WhatsApp Auto-Responder

-   Webhook endpoint for WhatsApp messages
-   Automatic response generation using RAG
-   Phone number to document mapping
-   Multi-document support per phone number
-   Conversation context awareness

See [WHATSAPP_AUTO_RESPONDER.md](WHATSAPP_AUTO_RESPONDER.md) for detailed documentation.

## Usage

### Upload a PDF with Phone Mapping

```bash
curl -X POST http://localhost:3000/api/process-pdf \
  -F "file=@document.pdf" \
  -F "phone_numbers=917874949091,919876543210"
```

### Test Auto-Response

```bash
node test-auto-responder.js
```

### Webhook Integration

Configure your WhatsApp Business API to send messages to:

```
POST https://your-app.vercel.app/api/webhook/whatsapp
```

## API Endpoints

-   `POST /api/process-pdf` - Upload and process PDF
-   `POST /api/chat` - Chat with streaming responses
-   `POST /api/webhook/whatsapp` - Receive WhatsApp messages
-   `POST /api/whatsapp/auto-respond` - Manual auto-response
-   `GET/POST/DELETE /api/phone-mappings` - Manage phone-document mappings
-   `GET /api/whatsapp/messages` - Retrieve WhatsApp messages

## Testing

```bash
# Test webhook
node test-webhook.js

# Test auto-responder
node test-auto-responder.js

# Test on deployed version
node test-auto-responder.js https://your-app.vercel.app
```

## Documentation

-   [WEBHOOK_SETUP.md](WEBHOOK_SETUP.md) - WhatsApp webhook configuration
-   [WHATSAPP_AUTO_RESPONDER.md](WHATSAPP_AUTO_RESPONDER.md) - Auto-responder system guide

## Deployment

Deploy to Vercel and add the environment variables in the project settings.

**Note:** The auto-responder generates responses but doesn't send them back to WhatsApp yet. You'll need to integrate with your WhatsApp Business API provider to complete the loop.
