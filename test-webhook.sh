#!/bin/bash

# Test script for WhatsApp webhook
# Usage: ./test-webhook.sh [url]
# Default URL: http://localhost:3000

URL=${1:-http://localhost:3000}

echo "Testing WhatsApp webhook at: $URL/api/webhook/whatsapp"
echo "=================================================="

# Test 1: Send a test message
echo -e "\n📤 Test 1: Sending test WhatsApp message..."
RESPONSE=$(curl -s -X POST "$URL/api/webhook/whatsapp" \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "test-'$(date +%s)'",
    "channel": "whatsapp",
    "from": "917874949091",
    "to": "15558346206",
    "receivedAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "content": {
      "contentType": "text",
      "text": "Hello from test script!"
    },
    "whatsapp": {
      "senderName": "Test User"
    },
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "event": "MoMessage",
    "isin24window": true,
    "isResponded": false,
    "UserResponse": "Hello from test script!"
  }')

echo "Response: $RESPONSE"
echo ""

# Test 2: Send duplicate message
echo -e "\n📤 Test 2: Sending duplicate message (should be handled)..."
RESPONSE2=$(curl -s -X POST "$URL/api/webhook/whatsapp" \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "duplicate-test-123",
    "channel": "whatsapp",
    "from": "917874949091",
    "to": "15558346206",
    "receivedAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "content": {
      "contentType": "text",
      "text": "Duplicate message test"
    },
    "whatsapp": {
      "senderName": "Test User"
    },
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "event": "MoMessage",
    "isin24window": true,
    "isResponded": false
  }')

echo "First attempt: $RESPONSE2"

RESPONSE3=$(curl -s -X POST "$URL/api/webhook/whatsapp" \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "duplicate-test-123",
    "channel": "whatsapp",
    "from": "917874949091",
    "to": "15558346206",
    "receivedAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "content": {
      "contentType": "text",
      "text": "Duplicate message test"
    },
    "whatsapp": {
      "senderName": "Test User"
    },
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "event": "MoMessage",
    "isin24window": true,
    "isResponded": false
  }')

echo "Second attempt (duplicate): $RESPONSE3"
echo ""

# Test 3: Invalid request (missing required fields)
echo -e "\n📤 Test 3: Sending invalid request (missing messageId)..."
RESPONSE4=$(curl -s -X POST "$URL/api/webhook/whatsapp" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "whatsapp",
    "from": "917874949091",
    "content": {
      "contentType": "text",
      "text": "Invalid message"
    }
  }')

echo "Response (should show error): $RESPONSE4"
echo ""

# Test 4: Retrieve messages
echo -e "\n📥 Test 4: Retrieving stored messages..."
MESSAGES=$(curl -s "$URL/api/whatsapp/messages?limit=5")
echo "Recent messages: $MESSAGES"
echo ""

echo "=================================================="
echo "✅ Tests completed!"
echo ""
echo "To test with your live server:"
echo "./test-webhook.sh https://your-app.vercel.app"
