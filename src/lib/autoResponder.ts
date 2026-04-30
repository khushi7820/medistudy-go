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

        // 1.8. Search Strategy (Optimized)
        const retrievalQuery = messageText;

        console.log(`Retrieval Query: "${retrievalQuery}"`);

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
            5 // Increased to 5 to catch links more reliably
        );

        // Filter by similarity threshold
        const matches = allMatches.filter(m => m.similarity > 0.35); // Lowered to 0.35 for better matching

        if (matches.length === 0) {
            console.log("No relevant chunks found above threshold");
        }

        const contextText = matches.map((m) => m.chunk).join("\n\n");

        // 3.5 Detect Small Talk / Greetings / Identity / Material Requests
        const isGreeting = /^(hi|hello|hey|heyy|greeting|greetings|hola|namaste|hlo|hii|helo|hy|hyy)$/i.test(messageText.trim().toLowerCase());
        const isAcknowledgment = /^(ok|okkk|okay|okayy|kk|k|thanks|thank you|thx|tks)$/i.test(messageText.trim().toLowerCase());

        // Improved: Detect material intent if they mention keywords OR any subject name
        const subjects = ["anatomy", "physiology", "biochemistry", "pharmacology", "pathology", "microbiology", "surgery", "medicine", "dentistry", "bds", "mbbs", "mds", "abdomen", "thorax", "pelvis", "neuroanatomy", "osteology"];
        const hasSubject = subjects.some(s => messageText.toLowerCase().includes(s));
        const hasMaterialKeyword = /(pdf|material|notes|link|bundle|drive|source|bhejo|chahiye|send|give|sample|file)/i.test(messageText.toLowerCase());

        const isMaterialRequest = hasMaterialKeyword || (hasSubject && messageText.length < 20); // Catch single subject names

        // If it's a simple greeting or "ok", we clear the context.
        const finalContext = (isGreeting || isAcknowledgment) ? "" : contextText;

        // Add material intent to system prompt if detected
        const intentInstruction = isMaterialRequest
            ? "CRITICAL: USER WANTS MATERIAL/LINK. Stop selling. Search CONTEXT for a Drive link. If found, give it immediately in ZONE 2 format. If no link found, say it's not in directory."
            : "USER IS ASKING GENERAL QUESTIONS. Answer from FAQ (ZONE 1).";

        // 4. Get conversation history for this phone number
        const { data: historyRows } = await supabase
            .from("whatsapp_messages")
            .select("content_text, event_type, from_number, to_number")
            .order("received_at", { ascending: false })
            .limit(3); // STRICT LIMIT: Last 3 messages only

        // Build conversation history (user messages and AI responses)
        const history = (historyRows || [])
            .filter(m => m.content_text && (m.event_type === "MoMessage" || m.event_type === "MtMessage"))
            .map(m => ({
                role: m.event_type === "MoMessage" ? "user" as const : "assistant" as const,
                content: m.content_text
            }))
            .reverse();

        // 5. Generate response using Groq with dynamic system prompt
        const documentRules =
            `MASTER WORKFLOW GUIDE (STRICT PRECISION):\n\n` +
            `PHASE 1: INTENT DETECTION\n` +
            `- If user says hi/hello/hey/hy: Reply with the FULL GREETING below. Do NOT send only an emoji.\n` +
            `- If user asks about price/delivery/app/bundles: Use FAQ context (ZONE 1).\n` +
            `- If user asks for PDF/Notes/Material/Link: Use MATERIAL DIRECTORY (ZONE 2).\n` +
            `- If user asks for one thing, answer ONLY that thing. Do NOT list other subjects.\n\n` +
            `PHASE 2: KNOWLEDGE RETRIEVAL (STRICT)\n` +
            `- Use ONLY provided CONTEXT. Never create fake links.\n\n` +
            `PHASE 3: RESPONSE FORMATTING (CLEAN TEXT ONLY)\n` +
            `- DO NOT USE STARS (*), HASHES (#), OR ANY MARKDOWN.\n` +
            `- Use plain text and Emojis. Full sentences only.\n\n` +
            `MATERIAL FORMAT (CLEAN):\n` +
            `Study Material Found\n` +
            `Subject: [Name]\n` +
            `Link: [Real Drive Link]\n\n` +
            `ACKNOWLEDGE: You're welcome! 😊\n\n` +
            `GREETING: Hi 😊 Main Medi Study Go assistant hoon. Hum MBBS, BDS aur NEET MDS students ke liye visual study bundles, books aur materials provide karte hain. Aapko kis subject ya bundle me help chahiye?`;

        let systemPrompt: string;
        if (customSystemPrompt) {
            systemPrompt = customSystemPrompt;
        } else {
            systemPrompt = documentRules;
        }

        const messages = [
            {
                role: "system" as const,
                content: `${systemPrompt}\n\nINTENT: ${intentInstruction}\n\nCONTEXT:\n${finalContext || "No relevant context found."}`
            },
            ...history,
            { role: "user" as const, content: messageText }
        ];

        console.log(`Final system prompt (first 200 chars): ${systemPrompt.substring(0, 200)}...`);
        console.log(`Context text length: ${contextText?.length || 0} characters`);
        console.log(`Conversation history: ${history.length} messages`);

        const completion = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant", // Essential to bypass 100k TPD limit of 70b model
            messages,
            temperature: 0.1,
            max_tokens: 500,
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
