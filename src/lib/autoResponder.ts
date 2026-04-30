// ================================================================
// 🔒 LOCKED autoResponder.ts v2.1 — DB PROMPT IS ENFORCED
// 🔒 If DB prompt is empty, bot uses minimal safe fallback (NO MARKDOWN)
// 🔒 All real prompt logic lives in DB column: phone_document_mapping.system_prompt
// 🔒 Run INSTALL_PROMPT.sql once to set the DB prompt permanently
// ================================================================

import { supabase } from "./supabaseClient";
import { embedText } from "./embeddings";
import { retrieveRelevantChunksFromFiles } from "./retrieval";
import { getFilesForPhoneNumber } from "./phoneMapping";
import { sendWhatsAppMessage } from "./whatsappSender";
import { validateSubjectRequest } from "./materialMatcher";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

export type AutoResponseResult = {
    success: boolean;
    response?: string;
    error?: string;
    noDocuments?: boolean;
    sent?: boolean;
};

// 🔒 SAFE FALLBACK — used ONLY if DB prompt is missing/empty
// This is intentionally minimal. Real prompt should be in DB.
const SAFE_FALLBACK_PROMPT = `You are the Medi Study Go WhatsApp assistant.

CRITICAL RULES:
- NEVER use markdown (no asterisks, hashes, underscores, brackets)
- Reply only from CONTEXT provided
- If info not in CONTEXT, say "not available"
- Match user's language (Hinglish for Hindi input, English for English)
- Keep replies 4-6 lines max
- Do not reply with only emoji — always include text
- For "hi/hello/hey": Reply with greeting text + question what they need
- For "ok/thanks": Reply "You're welcome 😊 Aur kis subject me help chahiye?"

WARNING: This is a fallback prompt. Run INSTALL_PROMPT.sql to set proper prompt in DB.`;

// ────────────────────────────────────────────────────────────────
// POST-PROCESSING HELPERS
// ────────────────────────────────────────────────────────────────

function stripMarkdown(text: string): string {
    return text
        .replace(/\*+([^*\n]+)\*+/g, '$1')
        .replace(/(?<!https?:\/\/[^\s]*)(?<!\w)_+([^_\n]+)_+(?!\w)/g, '$1')
        .replace(/^#+\s+/gm, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$2')
        .replace(/\*\*/g, '')
        .replace(/(?:^|\s)#(?=\s)/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function extractDriveLinks(text: string): string[] {
    const regex = /https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view(?:\?usp=[a-z_]+)?/gi;
    return text.match(regex) || [];
}

// ────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ────────────────────────────────────────────────────────────────

export async function generateAutoResponse(
    fromNumber: string,
    toNumber: string,
    messageText: string,
    messageId: string
): Promise<AutoResponseResult> {
    try {
        // ─── 1. Get mapped documents ─────────────────────────────
        const fileIds = await getFilesForPhoneNumber(toNumber);
        console.log(`📂 ${fileIds.length} document(s) for ${toNumber}`);

        // ─── 2. Get phone mapping config ─────────────────────────
        const { data: phoneMappings, error: mappingError } = await supabase
            .from("phone_document_mapping")
            .select("system_prompt, intent, auth_token, origin")
            .eq("phone_number", toNumber);

        if (mappingError) console.error("Mapping fetch error:", mappingError);

        const dbPrompt = phoneMappings?.[0]?.system_prompt;
        const auth_token = phoneMappings?.[0]?.auth_token || process.env.WHATSAPP_11ZA_AUTH_TOKEN;
        const origin = phoneMappings?.[0]?.origin || process.env.WHATSAPP_11ZA_ORIGIN;

        if (!auth_token || !origin) {
            return {
                success: false,
                error: "No WhatsApp credentials. Set in Configuration tab.",
            };
        }

        // 🔒 ENFORCE DB PROMPT — log warning if missing
        let systemPrompt: string;
        if (dbPrompt && dbPrompt.trim().length > 100) {
            systemPrompt = dbPrompt;
            console.log(`✅ Using DB prompt (${dbPrompt.length} chars)`);
        } else {
            systemPrompt = SAFE_FALLBACK_PROMPT;
            console.warn(`⚠️ DB prompt missing or too short. Run INSTALL_PROMPT.sql! Using safe fallback.`);
        }

        // ─── 3. Validate subject request ─────────────────────────
        const validation = validateSubjectRequest(messageText);
        console.log(`🔍 Validation:`, validation);

        // ─── 4. Embed + retrieve ─────────────────────────────────
        let retrievalQuery = messageText;
        if (validation.status === "MATCHED") {
            retrievalQuery = `${messageText} ${validation.matchedSubject}`;
        }

        const queryEmbedding = await embedText(retrievalQuery);
        if (!queryEmbedding) {
            return { success: false, error: "Embedding failed" };
        }

        const allMatches = await retrieveRelevantChunksFromFiles(
            queryEmbedding, fileIds, 6
        );
        const matches = allMatches.filter(m => m.similarity > 0.35);
        const contextText = matches.map(m => m.chunk).join("\n\n");

        // ─── 5. Quick intent detection ───────────────────────────
        const lower = messageText.trim().toLowerCase();
        const isGreeting = /^(hi+|hello+|hey+|hy+|heyy+|hii+|hlo+|helo+|hola|namaste|salaam|good\s*(morning|evening|afternoon))$/i.test(lower);
        const isAck = /^(ok+|okk+|okay+|kk+|thanks?|thank\s*you|thx|tks|hmm+|achha|theek)$/i.test(lower);

        // ─── 6. Build dynamic intent hint ────────────────────────
        let intentHint = "";

        if (isGreeting) {
            intentHint = `INTENT: GREETING.
Reply with the GREETING template (full text + question).
Do NOT reply with only an emoji.
Do NOT treat this as acknowledgment — "hey", "hi", "hello" are GREETINGS.`;
        } else if (isAck) {
            intentHint = `INTENT: ACKNOWLEDGMENT.
Reply: "You're welcome 😊 Aur kis subject me help chahiye?"`;
        } else if (validation.status === "NOT_IN_CATALOG") {
            intentHint = `INTENT: SUBJECT_NOT_IN_CATALOG.
User asked for "${validation.detectedTerm}" — NOT in our catalog.
DO NOT provide any link. DO NOT substitute.
Use NOT_IN_CATALOG template.`;
        } else if (validation.status === "MATCHED") {
            const linksInContext = extractDriveLinks(contextText);
            intentHint = `INTENT: MATERIAL_REQUEST_MATCHED.
Subject in our catalog: "${validation.matchedSubject}"
${linksInContext.length > 0
                    ? `CONTEXT contains the Drive link: ${linksInContext[0]}
YOU MUST include this FULL URL in your reply using MATERIAL_FOUND template.`
                    : `CONTEXT has NO link. Reply: "Sorry, [Subject] ka link abhi catalog me nahi hai"`}`;
        } else if (validation.status === "NO_SUBJECT_DETECTED") {
            intentHint = "INTENT: UNCLEAR. Ask which specific subject they need.";
        } else {
            intentHint = `INTENT: GENERAL_QUERY.
Answer briefly from CONTEXT. If user asked about ONE thing (e.g. "mbbs first yr"),
mention ONLY that bundle with price. Do NOT list all bundles. Keep it 4-6 lines.`;
        }

        // ─── 7. Get conversation history ─────────────────────────
        const { data: historyRows } = await supabase
            .from("whatsapp_messages")
            .select("content_text, event_type, from_number, to_number, received_at")
            .or(`from_number.eq.${fromNumber},to_number.eq.${fromNumber}`)
            .order("received_at", { ascending: false })
            .limit(3);

        const history = (historyRows || [])
            .filter(m => m.content_text && (m.event_type === "MoMessage" || m.event_type === "MtMessage"))
            .map(m => ({
                role: m.event_type === "MoMessage" ? "user" as const : "assistant" as const,
                content: m.content_text
            }))
            .reverse();

        // ─── 8. Build messages ───────────────────────────────────
        const finalContext = (isGreeting || isAck) ? "" : contextText;

        const messages = [
            {
                role: "system" as const,
                content: `${systemPrompt}\n\n────────\n${intentHint}\n────────\nCONTEXT:\n${finalContext || "(no context)"}`
            },
            ...history,
            { role: "user" as const, content: messageText }
        ];

        console.log(`📝 Intent: ${intentHint.split('\n')[0]}`);
        console.log(`📊 Context: ${contextText.length} chars | Links: ${extractDriveLinks(contextText).length}`);

        // ─── 9. Generate ─────────────────────────────────────────
        const completion = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages,
            temperature: 0.1,
            max_tokens: 400,
        });

        let response = completion.choices[0].message.content;
        if (!response || response.trim().length === 0) {
            return { success: false, error: "Empty LLM response" };
        }

        // ─── 10. POST-PROCESSING ─────────────────────────────────
        // (a) Strip markdown
        response = stripMarkdown(response);

        // (b) Guard: if response is JUST an emoji, replace with proper greeting
        const onlyEmojiOrTooShort = /^[\s\p{Emoji}\p{Emoji_Presentation}]+$/u.test(response) || response.trim().length < 10;
        if (onlyEmojiOrTooShort && isGreeting) {
            response = "Hi 😊 Main Medi Study Go assistant hoon. Hum MBBS, BDS aur NEET MDS students ke liye visual study materials provide karte hain. Aapko kis subject me help chahiye?";
            console.log(`🔧 Replaced emoji-only/short response with proper greeting`);
        }

        // (c) Guard: missing link auto-append
        if (validation.status === "MATCHED") {
            const ctxLinks = extractDriveLinks(contextText);
            const respLinks = extractDriveLinks(response);
            if (ctxLinks.length > 0 && respLinks.length === 0) {
                response += `\n\n👉 ${ctxLinks[0]}`;
                console.log(`🔧 Auto-appended missing link`);
            }
        }

        // ─── 11. Send ────────────────────────────────────────────
        const sendResult = await sendWhatsAppMessage(fromNumber, response, auth_token, origin);

        if (!sendResult.success) {
            await supabase
                .from("whatsapp_messages")
                .update({ auto_respond_sent: false, response_sent_at: new Date().toISOString() })
                .eq("message_id", messageId);

            return { success: false, response, sent: false, error: `Send failed: ${sendResult.error}` };
        }

        // ─── 12. Save AI response ────────────────────────────────
        const responseMessageId = `auto_${messageId}_${Date.now()}`;
        await supabase.from("whatsapp_messages").insert([{
            message_id: responseMessageId,
            channel: "whatsapp",
            from_number: toNumber,
            to_number: fromNumber,
            received_at: new Date().toISOString(),
            content_type: "text",
            content_text: response,
            sender_name: "AI Assistant",
            event_type: "MtMessage",
            is_in_24_window: true,
            is_responded: false,
            raw_payload: {
                messageId: responseMessageId,
                isAutoResponse: true,
                from: toNumber,
                to: fromNumber,
            },
        }]);

        await supabase
            .from("whatsapp_messages")
            .update({ auto_respond_sent: true, response_sent_at: new Date().toISOString() })
            .eq("message_id", messageId);

        console.log(`✅ Sent to ${fromNumber}`);
        return { success: true, response, sent: true };

    } catch (error) {
        console.error("❌ Auto-response error:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}