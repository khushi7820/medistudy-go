import { supabase } from "./supabaseClient";
import { embedText } from "./embeddings";
import { retrieveRelevantChunksFromFiles } from "./retrieval";
import { getFilesForPhoneNumber } from "./phoneMapping";
import { sendWhatsAppMessage, formatMaterialLinkMessage } from "./whatsappSender";
import { detectMaterialIntent } from "./materialMatcher";
import Groq from "groq-sdk";

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY!,
});

export type AutoResponseResult = {
    success: boolean;
    response?: string;
    error?: string;
    noDocuments?: boolean;
    sent?: boolean; // Whether message was sent via WhatsApp
};

/**
 * Generate an automatic response for a WhatsApp message
 * @param fromNumber - The sender's phone number (who sent the message)
 * @param toNumber - The business WhatsApp number (where message was received)
 * @param messageText - The text of the message
 * @param messageId - The unique message ID
 */
export async function generateAutoResponse(
    fromNumber: string,
    toNumber: string,
    messageText: string,
    messageId: string
): Promise<AutoResponseResult> {
    try {
        // 1. Get all documents mapped to this 'to' number (business number)
        const fileIds = await getFilesForPhoneNumber(toNumber);

        console.log(`Found ${fileIds.length} document(s) for business number ${toNumber}`);

        // 1.5. Fetch phone mapping details including system prompt and credentials
        const { data: phoneMappings, error: mappingError } = await supabase
            .from("phone_document_mapping")
            .select("system_prompt, intent, auth_token, origin")
            .eq("phone_number", toNumber);

        if (mappingError) {
            console.error("Error fetching phone mappings:", mappingError);
        }

        // Get system prompt and credentials from first mapping
        // Fallback to environment variables if not found in database
        const customSystemPrompt = phoneMappings?.[0]?.system_prompt;
        const auth_token = phoneMappings?.[0]?.auth_token || process.env.WHATSAPP_11ZA_AUTH_TOKEN;
        const origin = phoneMappings?.[0]?.origin || process.env.WHATSAPP_11ZA_ORIGIN;

        if (phoneMappings && phoneMappings.length > 0) {
            console.log(`Retrieved ${phoneMappings.length} mappings for phone ${toNumber}`);
            console.log(`Intent: ${phoneMappings[0].intent}`);
        } else {
            console.log(`No specific mappings found for phone ${toNumber}, using default/env fallback.`);
        }

        if (customSystemPrompt) {
            console.log(`Custom system prompt (first 100 chars): ${customSystemPrompt.substring(0, 100)}...`);
        }

        if (!auth_token || !origin) {
            console.error("No credentials found for phone number");
            return {
                success: false,
                error: "No WhatsApp API credentials found. Please set credentials in the Configuration tab.",
            };
        }

        // 1.8. Material Request Detection & Query Optimization
        const isMaterialRequest = /pdf|material|notes|link|bundle|drive|study material/i.test(messageText.toLowerCase());
        
        // If user asks for material, we explicitly add "link" to the search to pull chunks containing URLs
        const retrievalQuery = isMaterialRequest 
            ? `${messageText} Google Drive Link` 
            : messageText;

        console.log(`Retrieval Query: "${retrievalQuery}" (Material Request: ${isMaterialRequest})`);

        // 2. Embed the query
        const queryEmbedding = await embedText(retrievalQuery);

        if (!queryEmbedding) {
            return {
                success: false,
                error: "Failed to generate embedding for message",
            };
        }

        // 3. Retrieve relevant chunks from all mapped documents
        const allMatches = await retrieveRelevantChunksFromFiles(
            queryEmbedding,
            fileIds,
            8 // Increased from 5 to 8 to get more potential links
        );

        // Filter by similarity threshold
        const matches = allMatches.filter(m => m.similarity > 0.4); // Slightly lower threshold

        if (matches.length === 0) {
            console.log("No relevant chunks found above threshold");
        }

        const contextText = matches.map((m) => m.chunk).join("\n\n");

        // 3.5 Detect Small Talk / Greetings
        const isGreeting = /^(hi|hello|hey|heyy|greeting|greetings|hola|namaste|hlo|hii|helo|hy|hyy|)$/i.test(messageText.trim().toLowerCase());

        // If it's just a greeting, we can clear the context to avoid irrelevant answers
        const finalContext = isGreeting ? "" : contextText;

        // 4. Get conversation history for this phone number
        const { data: historyRows } = await supabase
            .from("whatsapp_messages")
            .select("content_text, event_type, from_number, to_number")
            .or(`from_number.eq.${fromNumber},to_number.eq.${fromNumber}`) // Messages involving this user
            .order("received_at", { ascending: true })
            .limit(20); // Last 20 messages for better context

        // Build conversation history (user messages and AI responses)
        const history = (historyRows || [])
            .filter(m => m.content_text && (m.event_type === "MoMessage" || m.event_type === "MtMessage"))
            .map(m => ({
                role: m.event_type === "MoMessage" ? "user" as const : "assistant" as const,
                content: m.content_text
            }));

        // 5. Generate response using Groq with dynamic system prompt
        const documentRules =
            `==================================================\n` +
            `STRICT KNOWLEDGE RULE\n` +
            `==================================================\n` +
            `Answer ONLY from the provided CONTEXT. If info is missing, say you don't have it.\n\n` +
            `==================================================\n` +
            `MATERIAL / LINK REQUEST RULE (CRITICAL)\n` +
            `==================================================\n` +
            `If the user asks for PDF, material, or study notes:\n` +
            `1. You MUST provide the exact GOOGLE DRIVE LINK (URL) if it exists in the CONTEXT.\n` +
            `2. DO NOT just list the subject names; the link is the most important part.\n` +
            `3. Format: Subject Name\nDownload Link: [URL]\n` +
            `4. If multiple links exist for different parts, list them clearly.\n\n` +
            `==================================================\n` +
            `RESPONSE STYLE & FORMATTING (IMPORTANT)\n` +
            `==================================================\n` +
            `- DO NOT BE ROBOTIC: Explain briefly why you are providing the link (e.g., "Humare paas NEET ke liye yeh material hai...").\n` +
            `- KEEP IT CONCISE: Around 4 to 6 lines maximum.\n` +
            `- DO NOT USE '*' (STARS) OR '#' (HASHES).\n` +
            `- Use plain text and line breaks for clarity.\n` +
            `- Use Hinglish/Hindi/English based on user's current message.\n` +
            `- Be professional and helpful.`;

        let systemPrompt: string;
        if (customSystemPrompt) {
            systemPrompt = `${customSystemPrompt}\n\n${documentRules}`;
        } else {
            systemPrompt = `You are the official professional WhatsApp assistant of Medi Study Go.\n\n${documentRules}`;
        }

        const messages = [
            {
                role: "system" as const,
                content: `${systemPrompt}\n\nCONTEXT:\n${finalContext || "No relevant context found. If this is a greeting, you MUST reply exactly with: '😊 Hi! Main Medi Study Go assistant hoon. Aapko kis subject ya material me help chahiye? Humare paas MBBS, BDS, aur NEET MDS ke liye alag-alag subjects ke liye materials hain. Bataiye, aapko kis cheez mein help chahiye?'"}`
            },
            ...history.slice(-10), // Include last 10 messages (5 pairs) for context
            { role: "user" as const, content: messageText }
        ];

        console.log(`Final system prompt (first 200 chars): ${systemPrompt.substring(0, 200)}...`);
        console.log(`Context text length: ${contextText?.length || 0} characters`);
        console.log(`Conversation history: ${history.length} messages`);

        const completion = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages,
            temperature: 0.2,
            max_tokens: 500, // Keep responses concise for WhatsApp
        });

        const response = completion.choices[0].message.content;

        if (!response) {
            return {
                success: false,
                error: "No response generated from LLM",
            };
        }

        // 6. Send the response via WhatsApp using file-specific credentials
        const sendResult = await sendWhatsAppMessage(fromNumber, response, auth_token, origin);

        if (!sendResult.success) {
            console.error("Failed to send WhatsApp message:", sendResult.error);
            // Still mark as attempted in database
            await supabase
                .from("whatsapp_messages")
                .update({
                    auto_respond_sent: false,
                    response_sent_at: new Date().toISOString(),
                })
                .eq("message_id", messageId);

            return {
                success: false,
                response,
                sent: false,
                error: `Generated response but failed to send: ${sendResult.error}`,
            };
        }

        // 6.5. Store the AI response in the database for conversation history
        const responseMessageId = `auto_${messageId}_${Date.now()}`;
        await supabase
            .from("whatsapp_messages")
            .insert([
                {
                    message_id: responseMessageId,
                    channel: "whatsapp",
                    from_number: toNumber, // Business number (sender)
                    to_number: fromNumber, // Customer number (recipient)
                    received_at: new Date().toISOString(),
                    content_type: "text",
                    content_text: response,
                    sender_name: "AI Assistant",
                    event_type: "MtMessage", // Mobile Terminated (outgoing)
                    is_in_24_window: true,
                    is_responded: false,
                    raw_payload: {
                        messageId: responseMessageId,
                        channel: "whatsapp",
                        from: toNumber,
                        to: fromNumber,
                        content: { contentType: "text", text: response },
                        event: "MtMessage",
                        isAutoResponse: true
                    },
                },
            ]);

        // 7. Mark the message as responded in database
        await supabase
            .from("whatsapp_messages")
            .update({
                auto_respond_sent: true,
                response_sent_at: new Date().toISOString(),
            })
            .eq("message_id", messageId);

        console.log(`✅ Auto-response sent successfully to ${fromNumber}`);

        return {
            success: true,
            response,
            sent: true,
        };
    } catch (error) {
        console.error("Auto-response error:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
