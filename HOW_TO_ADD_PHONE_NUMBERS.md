# How to Add Phone Numbers to Documents

There are **3 ways** to map phone numbers to documents:

## 1. 📱 Via Web UI (Easiest) - NEW!

### Option A: During Upload

1. Go to http://localhost:3000/files
2. Click "Select PDF File"
3. **Enter phone numbers** in the "Phone Numbers" field (optional)
   - Format: `917874949091, 919876543210`
   - Comma-separated
   - Include country code
   - No spaces, dashes, or symbols
4. Click "Upload & Process"

✅ Done! The PDF is now mapped to those phone numbers.

**Example:**
```
Phone Numbers: 917874949091, 919876543210, 918888888888
```

### Option B: Manage Existing Files (Add/Remove Numbers Anytime!)

1. Go to http://localhost:3000/files
2. Find your uploaded PDF in the list
3. Click **"Manage Numbers"** button
4. You'll see:
   - **Current mappings** - All phone numbers already mapped to this file
   - **Add new number** - Input field to add more phone numbers
   - **Remove** - Remove individual phone numbers

**Features:**
- ✅ Add phone numbers to existing PDFs
- ✅ Remove phone numbers you no longer need
- ✅ See all current mappings at a glance
- ✅ No need to re-upload the file!

**Example workflow:**
```
1. Upload document.pdf (without phone numbers)
2. Later, click "Manage Numbers"
3. Add: 917874949091
4. Add: 919876543210
5. Later, remove 917874949091 if needed
```

## 2. 💻 Via cURL Command

```bash
curl -X POST http://localhost:3000/api/process-pdf \
  -F "file=@document.pdf" \
  -F "phone_numbers=917874949091,919876543210"
```

**Multiple numbers:**
```bash
curl -X POST http://localhost:3000/api/process-pdf \
  -F "file=@product-manual.pdf" \
  -F "phone_numbers=917874949091,919876543210,918888888888"
```

## 3. 🔧 Manually Add Mapping (After Upload)

If you already uploaded a PDF without phone numbers, you can add them later:

### Step 1: Get the file ID
```bash
curl http://localhost:3000/api/files
```

Response:
```json
{
  "files": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "manual.pdf"
    }
  ]
}
```

### Step 2: Create the mapping
```bash
curl -X POST http://localhost:3000/api/phone-mappings \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "917874949091",
    "file_id": "123e4567-e89b-12d3-a456-426614174000"
  }'
```

## Phone Number Format

✅ **Correct:**
- `917874949091` (India)
- `14155552671` (USA)
- `447975777666` (UK)
- `8613800138000` (China)

❌ **Incorrect:**
- `+91 787 494 9091` (spaces)
- `+91-787-494-9091` (dashes)
- `(415) 555-2671` (parentheses)
- `91 7874949091` (space in middle)

**Format rules:**
- Include country code
- Numbers only (0-9)
- No spaces, dashes, parentheses, or symbols
- No leading + sign

## Verify Mapping

After uploading, verify the mapping worked:

```bash
curl "http://localhost:3000/api/phone-mappings?phone_number=917874949091"
```

Response:
```json
{
  "success": true,
  "mappings": [
    {
      "id": 1,
      "phone_number": "917874949091",
      "file_id": "123e4567-e89b-12d3-a456-426614174000",
      "file_name": "manual.pdf",
      "created_at": "2025-11-21T10:30:00Z"
    }
  ],
  "count": 1
}
```

## Common Scenarios

### Scenario 1: One Document → Multiple Phones
Upload once with multiple phone numbers:

**Via Web UI:**
```
Phone Numbers: 917874949091, 919876543210, 918888888888
```

**Via cURL:**
```bash
curl -X POST http://localhost:3000/api/process-pdf \
  -F "file=@customer-support.pdf" \
  -F "phone_numbers=917874949091,919876543210,918888888888"
```

### Scenario 2: Multiple Documents → One Phone
Upload each document with the same phone number:

```bash
# Upload first document
curl -X POST http://localhost:3000/api/process-pdf \
  -F "file=@user-manual.pdf" \
  -F "phone_numbers=917874949091"

# Upload second document
curl -X POST http://localhost:3000/api/process-pdf \
  -F "file=@faq.pdf" \
  -F "phone_numbers=917874949091"

# Now 917874949091 can query BOTH documents!
```

### Scenario 3: Add More Phones Later
Already uploaded? Add more phone numbers:

```bash
# Get file ID first
FILE_ID="123e4567-e89b-12d3-a456-426614174000"

# Add new phone number
curl -X POST http://localhost:3000/api/phone-mappings \
  -H "Content-Type: application/json" \
  -d "{
    \"phone_number\": \"919999999999\",
    \"file_id\": \"$FILE_ID\"
  }"
```

## View All Mappings

### For a specific phone number:
```bash
curl "http://localhost:3000/api/phone-mappings?phone_number=917874949091"
```

### For a specific file:
```bash
curl "http://localhost:3000/api/phone-mappings?file_id=123e4567-e89b-12d3-a456-426614174000"
```

### All mappings:
```bash
curl "http://localhost:3000/api/phone-mappings"
```

## Delete a Mapping

```bash
curl -X DELETE "http://localhost:3000/api/phone-mappings?id=1"
```

## Testing

After mapping, test the auto-responder:

```bash
node test-auto-responder.js
```

Or test manually:
```bash
curl -X POST http://localhost:3000/api/whatsapp/auto-respond \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "917874949091",
    "message": "What is this document about?"
  }'
```

## Troubleshooting

### "No documents mapped for this number"

Check if mapping exists:
```bash
curl "http://localhost:3000/api/phone-mappings?phone_number=917874949091"
```

If empty, add the mapping using one of the methods above.

### Duplicate mapping error

You're trying to map the same phone number to the same document twice. This is prevented by a database constraint.

### Invalid phone number format

Make sure:
- Numbers only (no symbols)
- Include country code
- No spaces or dashes

## Quick Reference

| Method | When to Use | Difficulty |
|--------|-------------|------------|
| **Web UI** | Uploading new PDFs | ⭐ Easy |
| **cURL Upload** | Automation, scripts | ⭐⭐ Medium |
| **Manual Mapping** | Existing PDFs | ⭐⭐⭐ Advanced |

## Examples by Country

```bash
# India
phone_numbers=917874949091,919876543210

# USA
phone_numbers=14155552671,12125551234

# UK
phone_numbers=447975777666,442071234567

# Mixed
phone_numbers=917874949091,14155552671,447975777666
```

---

**Next Steps:**
1. Map your documents to phone numbers
2. Test with: `node test-auto-responder.js`
3. Configure WhatsApp webhook
4. Start receiving auto-responses!
