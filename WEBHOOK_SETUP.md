# WhatsApp Webhook Setup

This guide explains how to set up the WhatsApp webhook to receive and store messages.

## Database Setup

### 1. Run the Database Migration

Execute the SQL migration in your Supabase SQL Editor:

```bash
# The migration file is located at:
migrations/create_whatsapp_messages.sql
```

Or run it directly in Supabase:
1. Go to your Supabase Dashboard
2. Navigate to SQL Editor
3. Copy the contents of `migrations/create_whatsapp_messages.sql`
4. Run the migration

This will create:
- `whatsapp_messages` table with all necessary fields
- Indexes for better query performance
- Auto-update trigger for `updated_at` timestamp

## Environment Variables

Add the following to your `.env.local` file:

```env
WHATSAPP_VERIFY_TOKEN=your_secure_random_token_here
```

Generate a secure token:
```bash
# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Or use any random string
```

## Webhook Endpoints

### POST `/api/webhook/whatsapp`
Receives WhatsApp messages and stores them in the database.

**Request Body:**
```json
{
  "messageId": "wamid.HBgMOTE3ODc0OTQ5MDkxFQIAEhgWM0VCMDMzMDg2QTY1NkVGQjI1Mzc1QwA=",
  "channel": "whatsapp",
  "from": "917874949091",
  "to": "15558346206",
  "receivedAt": "2025-11-21T04:12:39Z",
  "content": {
    "contentType": "text",
    "text": "Hello"
  },
  "whatsapp": {
    "senderName": "Viraj Zaveri"
  },
  "timestamp": "2025-11-21T04:12:39Z",
  "event": "MoMessage",
  "isin24window": true,
  "isResponded": false,
  "UserResponse": "Hello"
}
```

**Response:**
```json
{
  "success": true,
  "message": "WhatsApp message received and stored",
  "data": { /* stored message data */ }
}
```

### GET `/api/webhook/whatsapp`
Webhook verification endpoint (for WhatsApp/Meta webhook setup).

**Query Parameters:**
- `hub.mode=subscribe`
- `hub.verify_token=your_token`
- `hub.challenge=random_challenge`

### GET `/api/whatsapp/messages`
Retrieve stored WhatsApp messages.

**Query Parameters:**
- `from` (optional): Filter by sender phone number
- `limit` (optional, default: 50): Number of messages to retrieve
- `offset` (optional, default: 0): Pagination offset

**Example:**
```bash
# Get all messages
GET /api/whatsapp/messages

# Get messages from specific number
GET /api/whatsapp/messages?from=917874949091

# Pagination
GET /api/whatsapp/messages?limit=20&offset=20
```

## Testing the Webhook

### Using cURL:

```bash
curl -X POST http://localhost:3000/api/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "test-message-123",
    "channel": "whatsapp",
    "from": "917874949091",
    "to": "15558346206",
    "receivedAt": "2025-11-21T04:12:39Z",
    "content": {
      "contentType": "text",
      "text": "Test message"
    },
    "whatsapp": {
      "senderName": "Test User"
    },
    "timestamp": "2025-11-21T04:12:39Z",
    "event": "MoMessage",
    "isin24window": true,
    "isResponded": false,
    "UserResponse": "Test message"
  }'
```

### Using Postman or Insomnia:

1. Create a new POST request
2. URL: `http://localhost:3000/api/webhook/whatsapp`
3. Headers: `Content-Type: application/json`
4. Body: Use the sample JSON above
5. Send the request

## Deployment

### Vercel

1. Add the environment variable in Vercel Dashboard:
   - Go to Project Settings → Environment Variables
   - Add `WHATSAPP_VERIFY_TOKEN`

2. Your webhook URL will be:
   ```
   https://your-app.vercel.app/api/webhook/whatsapp
   ```

### Configure WhatsApp Business API

1. In your WhatsApp Business Platform settings
2. Set webhook URL: `https://your-app.vercel.app/api/webhook/whatsapp`
3. Set verify token: Use the same token from your environment variable
4. Subscribe to message events

## Database Schema

The `whatsapp_messages` table stores:

- `message_id`: Unique WhatsApp message ID (prevents duplicates)
- `channel`: Communication channel (whatsapp)
- `from_number`: Sender's phone number
- `to_number`: Recipient's phone number
- `received_at`: When message was received
- `content_type`: Type of content (text, image, etc.)
- `content_text`: The actual message text
- `sender_name`: Sender's display name
- `event_type`: Event type (MoMessage, etc.)
- `is_in_24_window`: Whether in 24-hour messaging window
- `is_responded`: Whether message has been responded to
- `raw_payload`: Complete JSON payload for reference
- `created_at`: Record creation timestamp
- `updated_at`: Last update timestamp

## Error Handling

The webhook handles:
- **Duplicate messages**: Returns 200 with `duplicate: true`
- **Missing required fields**: Returns 400 with error message
- **Database errors**: Returns 500 with error details
- **Invalid JSON**: Returns 500 with parsing error

## Monitoring

Check your logs for:
- Received webhook payloads
- Database insertion success/failures
- Duplicate message attempts

```bash
# Local development
npm run dev

# Check Vercel logs
vercel logs --follow
```
