# Quick Start Guide - 5 Minutes to WhatsApp Auto-Responder

## Step 1: Database (2 minutes)

1. Open [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql)
2. Copy contents of `migrations/create_database.sql`
3. Paste and click "Run"
4. ✅ Done! All tables, indexes, and functions created

## Step 2: Environment Variables (1 minute)

Create `.env.local`:

```env
MISTRAL_API_KEY=your_mistral_key
GROQ_API_KEY=your_groq_key
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_key
WHATSAPP_VERIFY_TOKEN=random_secure_token
```

## Step 3: Install & Run (1 minute)

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Step 4: Upload PDF with Phone Mapping (30 seconds)

```bash
curl -X POST http://localhost:3000/api/process-pdf \
  -F "file=@your-document.pdf" \
  -F "phone_numbers=917874949091"
```

## Step 5: Test Auto-Response (30 seconds)

```bash
node test-auto-responder.js
```

You should see:
- ✅ Documents found for phone number
- ✅ Auto-response generated
- ✅ Message stored in database

## What You Get

✅ **Web Chat UI** at `/chat` with:
- Streaming responses
- Thinking indicator
- Document selection
- Conversation history

✅ **WhatsApp Integration** at `/api/webhook/whatsapp`:
- Receives messages
- Auto-generates responses using RAG
- Maps phone numbers to documents
- Maintains conversation context

✅ **Document Management**:
- Upload PDFs with phone mapping
- One phone → multiple documents
- One document → multiple phones
- Vector search across mapped docs

## API Quick Reference

```bash
# Upload PDF
POST /api/process-pdf
  FormData: { file, phone_numbers }

# Test auto-response
POST /api/whatsapp/auto-respond
  JSON: { phone_number, message }

# Manage mappings
GET /api/phone-mappings?phone_number=...
POST /api/phone-mappings
  JSON: { phone_number, file_id }

# Webhook (WhatsApp sends here)
POST /api/webhook/whatsapp

# Get messages
GET /api/whatsapp/messages?from=...
```

## Testing Checklist

- [ ] Database migration ran successfully
- [ ] Environment variables set
- [ ] App running at http://localhost:3000
- [ ] PDF uploaded with phone number
- [ ] Mapping verified: `GET /api/phone-mappings?phone_number=...`
- [ ] Auto-response test passed: `node test-auto-responder.js`
- [ ] Webhook test passed: `node test-webhook.js`

## Next Steps

1. **Configure WhatsApp Webhook**:
   - Deploy to Vercel: `vercel --prod`
   - Set webhook URL: `https://your-app.vercel.app/api/webhook/whatsapp`
   - Set verify token (same as `WHATSAPP_VERIFY_TOKEN`)

2. **Integrate WhatsApp Sending**:
   - Edit `src/lib/autoResponder.ts`
   - Add WhatsApp API call to send responses
   - See comments in code

3. **Customize**:
   - Adjust system prompt in `src/lib/autoResponder.ts`
   - Change chunk size in `src/lib/chunk.ts`
   - Modify UI in `src/app/chat/page.tsx`

## Troubleshooting

**"No documents mapped"**
```bash
# Check mappings
curl http://localhost:3000/api/phone-mappings?phone_number=917874949091

# Add mapping manually
curl -X POST http://localhost:3000/api/phone-mappings \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"917874949091","file_id":"your-uuid"}'
```

**"Database error"**
- Check Supabase credentials in `.env.local`
- Verify migration ran successfully
- Check Supabase logs

**"No response generated"**
- Check Groq API key is valid
- Look at server logs for errors
- Test manual endpoint first

## Full Documentation

- [README.md](README.md) - Project overview
- [WHATSAPP_AUTO_RESPONDER.md](WHATSAPP_AUTO_RESPONDER.md) - Complete guide
- [WEBHOOK_SETUP.md](WEBHOOK_SETUP.md) - Webhook details
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture
- [SETUP_SUMMARY.md](SETUP_SUMMARY.md) - Detailed setup

## Need Help?

1. Check the documentation above
2. Review test scripts output
3. Check server logs for errors
4. Verify all environment variables are set

Happy building! 🚀
