/**
 * Test script for WhatsApp Auto-Responder with Phone-Document Mapping
 * Usage: node test-auto-responder.js [url]
 */

const BASE_URL = process.argv[2] || 'http://localhost:3000';

// Sample test phone number
const TEST_PHONE = '917874949091';

async function testAutoResponder() {
    console.log('🧪 Testing WhatsApp Auto-Responder');
    console.log('Base URL:', BASE_URL);
    console.log('Test Phone:', TEST_PHONE);
    console.log('='.repeat(70));

    try {
        // Test 1: Check phone-document mappings
        console.log('\n📋 Test 1: Checking phone-document mappings...');
        const mappingsRes = await fetch(
            `${BASE_URL}/api/phone-mappings?phone_number=${TEST_PHONE}`
        );
        const mappingsData = await mappingsRes.json();

        if (mappingsData.count === 0) {
            console.log('⚠️  No documents mapped to this phone number');
            console.log('💡 Upload a PDF with phone_numbers parameter first:');
            console.log(`   curl -X POST ${BASE_URL}/api/process-pdf \\`);
            console.log(`     -F "file=@document.pdf" \\`);
            console.log(`     -F "phone_numbers=${TEST_PHONE}"`);
            console.log('\n⏩ Skipping remaining tests...\n');
            return;
        }

        console.log(`✅ Found ${mappingsData.count} document(s) mapped:`);
        mappingsData.mappings.forEach((m, i) => {
            console.log(`   ${i + 1}. ${m.file_name} (ID: ${m.file_id})`);
        });

        // Test 2: Test manual auto-response
        console.log('\n🤖 Test 2: Testing auto-response generation...');
        const testMessage = 'What is this document about?';
        console.log(`Message: "${testMessage}"`);

        const autoRespondRes = await fetch(
            `${BASE_URL}/api/whatsapp/auto-respond`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phone_number: TEST_PHONE,
                    message: testMessage,
                })
            }
        );

        const autoRespondData = await autoRespondRes.json();

        if (autoRespondData.success) {
            console.log('✅ Response generated successfully!');
            console.log('\n📝 Generated Response:');
            console.log('-'.repeat(70));
            console.log(autoRespondData.response);
            console.log('-'.repeat(70));
        } else {
            console.log('❌ Failed to generate response:');
            console.log('Error:', autoRespondData.error);
            if (autoRespondData.noDocuments) {
                console.log('Reason: No documents mapped (this shouldn\'t happen if Test 1 passed)');
            }
        }

        // Test 3: Send webhook message and check storage
        console.log('\n📨 Test 3: Sending webhook message...');
        const webhookPayload = {
            messageId: `test-${Date.now()}`,
            channel: 'whatsapp',
            from: TEST_PHONE,
            to: '15558346206',
            receivedAt: new Date().toISOString(),
            content: {
                contentType: 'text',
                text: 'How do I get started?'
            },
            whatsapp: {
                senderName: 'Test User'
            },
            timestamp: new Date().toISOString(),
            event: 'MoMessage',
            isin24window: true,
            isResponded: false
        };

        console.log(`Message: "${webhookPayload.content.text}"`);

        const webhookRes = await fetch(
            `${BASE_URL}/api/webhook/whatsapp`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(webhookPayload)
            }
        );

        const webhookData = await webhookRes.json();
        console.log('Webhook response:', webhookData.success ? '✅ Success' : '❌ Failed');

        // Wait a bit for async processing
        console.log('\n⏳ Waiting 3 seconds for auto-response processing...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Test 4: Check stored messages
        console.log('\n📥 Test 4: Retrieving stored messages...');
        const messagesRes = await fetch(
            `${BASE_URL}/api/whatsapp/messages?from=${TEST_PHONE}&limit=5`
        );
        const messagesData = await messagesRes.json();

        console.log(`Found ${messagesData.count} message(s):`);
        messagesData.messages?.slice(0, 5).forEach((msg, i) => {
            const respondStatus = msg.auto_respond_sent ? '✅ Responded' : '⏳ Pending';
            console.log(`\n   ${i + 1}. ${respondStatus}`);
            console.log(`      Message: ${msg.content_text?.substring(0, 50)}...`);
            console.log(`      From: ${msg.from_number}`);
            console.log(`      Received: ${msg.received_at}`);
            if (msg.response_sent_at) {
                console.log(`      Response sent: ${msg.response_sent_at}`);
            }
        });

        // Test 5: Add another mapping
        console.log('\n➕ Test 5: Testing manual mapping creation...');
        console.log('(Will try to add duplicate - should fail gracefully)');

        const firstFileId = mappingsData.mappings[0].file_id;
        const addMappingRes = await fetch(
            `${BASE_URL}/api/phone-mappings`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phone_number: TEST_PHONE,
                    file_id: firstFileId
                })
            }
        );

        const addMappingData = await addMappingRes.json();
        if (addMappingRes.status === 409) {
            console.log('✅ Duplicate prevention working (expected behavior)');
        } else if (addMappingData.success) {
            console.log('✅ New mapping created');
        } else {
            console.log('Response:', addMappingData);
        }

        // Test 6: Test with different questions
        console.log('\n🎯 Test 6: Testing various questions...');
        const testQuestions = [
            'Can you summarize the main points?',
            'What are the key features?',
            'How much does it cost?'
        ];

        for (const question of testQuestions) {
            console.log(`\n   Q: "${question}"`);
            const res = await fetch(
                `${BASE_URL}/api/whatsapp/auto-respond`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phone_number: TEST_PHONE,
                        message: question,
                    })
                }
            );

            const data = await res.json();
            if (data.success) {
                const preview = data.response.substring(0, 100);
                console.log(`   A: ${preview}${data.response.length > 100 ? '...' : ''}`);
            } else {
                console.log(`   Error: ${data.error}`);
            }

            // Small delay between requests
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log('\n' + '='.repeat(70));
        console.log('✅ All tests completed!');
        console.log('\n📚 Next steps:');
        console.log('1. Check server logs for auto-response details');
        console.log('2. Integrate WhatsApp sending in src/lib/autoResponder.ts');
        console.log('3. Configure your WhatsApp Business API webhook');
        console.log('\n💡 See WHATSAPP_AUTO_RESPONDER.md for full documentation');

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error(error);
    }
}

testAutoResponder();
