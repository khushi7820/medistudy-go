# WhatsApp Sending Setup (11za.in API)

Your system is now configured to **automatically send responses** back to WhatsApp users!

## Quick Setup

### 1. Add Environment Variables

Add these to your `.env.local` file:

```env
# WhatsApp Sending (11za.in API)
WHATSAPP_11ZA_AUTH_TOKEN=U2FsdGVkX19GIH+ESsy8TAh3evzXxDZP0ISpLPdWf1WlPGKWrx8+x2rJCn4RsMi6Q5c6zSm3gEr8zUfO3E0C3179IBXCIdh8WhzrgVXtjR/OMwgYnj5ZLFvSV6/LyDBDaujEWknr3lvBAC8o3AS85Ki+32ekvP2MTaCpzbFC7uGO+xjk1j5LAdZON72jl4Nj
WHATSAPP_11ZA_ORIGIN=https://medistudygo.com/
```

### 2. Deploy or Restart

```bash
# Local development
npm run dev

# Or deploy to Vercel
vercel --prod
```

### 3. Test!

Send a WhatsApp message to your number and watch the magic happen! 🎉

## How It Works

```
User sends WhatsApp message
         ↓
Webhook receives message → Stores in database
         ↓
Auto-responder triggered (async)
         ↓
1. Gets mapped documents
2. Performs RAG search
3. Generates LLM response
4. 🚀 SENDS via 11za.in API
         ↓
User receives response!
```

## API Details

### Endpoint

```
POST https://api.11za.in/apis/sendMessage/sendMessages
```

### Request Format

```json
{
	"sendto": "917874949091",
	"authToken": "your_auth_token",
	"originWebsite": "https://medistudygo.com/",
	"contentType": "text",
	"text": "Your message here"
}
```

## Features

✅ **Automatic Sending** - Responses are sent immediately after generation
✅ **Error Handling** - Failed sends are logged and tracked in database
✅ **Status Tracking** - Each message tracks if it was successfully sent
✅ **Async Processing** - Webhook returns immediately, sending happens in background
✅ **Retry Logic** - Can be enhanced with retry mechanism if needed

## Monitoring

### Check Logs

**Local:**

```bash
# Watch your console for these messages:
✅ Auto-response sent successfully to 917874949091
Response preview: Based on the document...
```

**Vercel:**

```bash
vercel logs --follow
```

### Database Status

Check if messages were sent:

```sql
SELECT
  from_number,
  content_text,
  auto_respond_sent,
  response_sent_at
FROM whatsapp_messages
ORDER BY received_at DESC
LIMIT 10;
```

Or via API:

```bash
curl "http://localhost:3000/api/whatsapp/messages?limit=10"
```

## Error Handling

The system handles various error scenarios:

### Scenario 1: No Documents Mapped

```
User sends message → No documents found for phone number
→ Nothing sent (logged as "No documents mapped")
```

### Scenario 2: LLM Failure

```
User sends message → Documents found → LLM fails to generate
→ Nothing sent (logged as error)
```

### Scenario 3: Sending Failure

```
User sends message → Response generated → 11za.in API fails
→ Response saved but not sent (auto_respond_sent = false)
→ Can be retried manually
```

## Testing

### Test Locally

```bash
# 1. Start your app
npm run dev

# 2. Send a test webhook
node test-webhook.js

# 3. Check console for:
✅ Auto-response sent successfully to 917874949091
```

### Test on Vercel

```bash
# Send real WhatsApp message to your number
# Check Vercel logs:
vercel logs --follow
```

## Troubleshooting

### "WhatsApp API credentials not configured"

**Problem:** `WHATSAPP_11ZA_AUTH_TOKEN` is not set

**Solution:**

```bash
# Check .env.local
cat .env.local | grep WHATSAPP_11ZA

# Add if missing
echo 'WHATSAPP_11ZA_AUTH_TOKEN=your_token' >> .env.local
```

### "Failed to send WhatsApp message"

**Problem:** 11za.in API returned an error

**Check:**

1. Auth token is correct
2. Phone number format is correct (with country code)
3. 11za.in API is accessible
4. Check response in logs for specific error

**Test API directly:**

```bash
curl --location 'https://api.11za.in/apis/sendMessage/sendMessages' \
--data '{
    "sendto": "917874949091",
    "authToken": "your_auth_token",
    "originWebsite": "https://medistudygo.com/",
    "contentType": "text",
    "text": "Test message"
}'
```

### Messages stored but not sent

**Problem:** `auto_respond_sent = false` in database

**Possible causes:**

1. Environment variables not set on Vercel
2. API credentials expired
3. Network issues

**Check Vercel env vars:**

```bash
vercel env ls
```

## Advanced Configuration

### Custom Origin Website

If you need a different origin:

```env
WHATSAPP_11ZA_ORIGIN=https://your-domain.com/
```

### Template Messages

The system also supports template messages (future use):

```typescript
import { sendWhatsAppTemplate } from '@/lib/whatsappSender'

await sendWhatsAppTemplate('917874949091', {
	templateId: 'your_template_id',
	parameters: {
		name: 'John',
		code: '1234',
	},
})
```

## Rate Limiting

Consider adding rate limiting to prevent spam:

```typescript
// In autoResponder.ts (future enhancement)
const recentMessages = await getRecentMessageCount(fromNumber, 60000) // 1 min
if (recentMessages > 5) {
	return {
		success: false,
		error: 'Rate limit exceeded',
	}
}
```

## Security Best Practices

1. **Never commit credentials**

    - Use `.env.local` (gitignored)
    - Use Vercel environment variables

2. **Rotate auth tokens regularly**

    - Update in your 11za.in dashboard
    - Update environment variables

3. **Validate webhook signatures**

    - Add webhook signature verification
    - Prevent unauthorized requests

4. **Monitor usage**
    - Track message volumes
    - Set up alerts for unusual activity

## Cost Monitoring

Track your 11za.in API usage:

-   Messages sent per day
-   Failed sends
-   Response times

Add to your monitoring:

```typescript
// Log each send for analytics
console.log({
	event: 'whatsapp_send',
	to: phoneNumber,
	success: result.success,
	timestamp: new Date().toISOString(),
})
```

## Next Steps

1. ✅ Setup complete - Responses are being sent!
2. Monitor logs to ensure everything works
3. Add custom system prompts per phone number (optional)
4. Implement retry logic for failed sends (optional)
5. Add analytics dashboard (optional)

## Support

If messages aren't being sent:

1. Check server logs for errors
2. Verify environment variables
3. Test 11za.in API directly with cURL
4. Check database `auto_respond_sent` status
5. Review Vercel logs for deployment issues

---

**Status:** 🟢 Active - Your WhatsApp auto-responder is now fully functional!

Messages will be automatically sent back to users when they message your WhatsApp number.
