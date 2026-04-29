/**
 * Test script for WhatsApp webhook
 * Usage: node test-webhook.js [url]
 */

const BASE_URL = process.argv[2] || 'http://localhost:3000';

const samplePayload = {
    messageId: `test-${Date.now()}`,
    channel: "whatsapp",
    from: "917874949091",
    to: "15558346206",
    receivedAt: new Date().toISOString(),
    content: {
        contentType: "text",
        text: "Hello from Node.js test!"
    },
    whatsapp: {
        senderName: "Test User"
    },
    timestamp: new Date().toISOString(),
    event: "MoMessage",
    isin24window: true,
    isResponded: false,
    UserResponse: "Hello from Node.js test!"
};

async function testWebhook() {
    console.log('🧪 Testing WhatsApp webhook at:', `${BASE_URL}/api/webhook/whatsapp`);
    console.log('='.repeat(60));

    try {
        // Test 1: Send valid message
        console.log('\n📤 Test 1: Sending valid WhatsApp message...');
        const response1 = await fetch(`${BASE_URL}/api/webhook/whatsapp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(samplePayload)
        });
        const result1 = await response1.json();
        console.log('Status:', response1.status);
        console.log('Response:', JSON.stringify(result1, null, 2));

        // Test 2: Send duplicate message
        console.log('\n📤 Test 2: Sending duplicate message...');
        const duplicatePayload = { ...samplePayload, messageId: 'duplicate-test-123' };

        const response2a = await fetch(`${BASE_URL}/api/webhook/whatsapp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(duplicatePayload)
        });
        const result2a = await response2a.json();
        console.log('First attempt:', JSON.stringify(result2a, null, 2));

        const response2b = await fetch(`${BASE_URL}/api/webhook/whatsapp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(duplicatePayload)
        });
        const result2b = await response2b.json();
        console.log('Second attempt (should be duplicate):', JSON.stringify(result2b, null, 2));

        // Test 3: Invalid request
        console.log('\n📤 Test 3: Sending invalid request (missing messageId)...');
        const invalidPayload = { channel: "whatsapp", from: "123456789" };
        const response3 = await fetch(`${BASE_URL}/api/webhook/whatsapp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(invalidPayload)
        });
        const result3 = await response3.json();
        console.log('Status:', response3.status);
        console.log('Response (should show error):', JSON.stringify(result3, null, 2));

        // Test 4: Retrieve messages
        console.log('\n📥 Test 4: Retrieving stored messages...');
        const response4 = await fetch(`${BASE_URL}/api/whatsapp/messages?limit=5`);
        const result4 = await response4.json();
        console.log('Status:', response4.status);
        console.log(`Found ${result4.count} messages`);
        console.log('Recent messages:', JSON.stringify(result4, null, 2));

        console.log('\n' + '='.repeat(60));
        console.log('✅ All tests completed!');
        console.log('\nTo test with your live server:');
        console.log('node test-webhook.js https://your-app.vercel.app');
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error);
    }
}

testWebhook();
