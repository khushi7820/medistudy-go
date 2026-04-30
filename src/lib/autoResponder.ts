// ================================================================
// 🔒 LOCKED autoResponder.ts v2.2 — CONVERSATION-AWARE
// 🔒 New in v2.2:
// 🔒   - Conversation context-aware retrieval (handles "give me the notes")
// 🔒   - Multi-version detection (NEET MDS asks which one)
// 🔒   - Internal-leak post-processing guard
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

// 🔒 Multi-version subjects (need clarification — don't pick one randomly)
const MULTI_VERSION_SUBJECTS = [
    "neet mds", "neetmds", "mds prep", "mds notes",
];

// 🔒 Pronoun-style queries (refer to previous message subject)
// These patterns match phrases that DON'T contain a specific subject name
// but reference something previously discussed.
const PRONOUN_PATTERNS = [
    // "give me the notes", "ok give me notes", "send the link"
    /\b(give|send|share|provide|do|please)\s+(me\s+)?(the\s+|wo\s+|us\s+|that\s+)?(notes?|material|link|pdf|file|stuff)/i,
    // "the notes", "that link"
    /^(the|wo|woh|us|that)\s+(notes?|material|link|pdf|file)/i,
    // "send it", "share it", "bhejo it"
    /\b(send|share|give|bhejo|bhej do|do na)\s+(it|wo|usko|that)/i,
    // Standalone Hindi requests without subject
    /^(bhej\s*do|bhejo|wo bhejo|usko bhejo|do na|de do|share kar|share karo)$/i,
    // Just "it" or "wo" alone
    /^(it|wo|woh|usko)$/i,
];

// 🔒 SAFE FALLBACK
const SAFE_FALLBACK_PROMPT = `You are the Medi Study Go WhatsApp assistant.

CRITICAL RULES:
- NEVER use markdown (no asterisks, hashes, underscores, brackets)
- NEVER expose internal words like CONTEXT, INTENT, prompt, rule, instruction
- Reply only from CONTEXT provided
- If info not in CONTEXT, say "not available"
- Match user's language (Hinglish for Hindi input, English for English)
- Keep replies 4-6 lines max
- Do not reply with only emoji — always include text

WARNING: Run UPDATE_PROMPT_v2.1.sql to set proper prompt in DB.`;

// ────────────────────────────────────────────────────────────────
// HELPERS
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

/**
 * Strip internal-leak phrases that LLM accidentally exposes.
 * Things like "(based on CONTEXT)" or "(If you ask...)" leaks.
 */
function stripInternalLeaks(text: string): string {
    return text
        // Remove parenthetical asides that mention CONTEXT/INTENT/prompt
        .replace(/\([^)]*(?:CONTEXT|INTENT|prompt|rule|instruction)[^)]*\)/gi, '')
        // Remove sentences that mention these words
        .replace(/(?:^|\.\s|\n)[^.\n]*(?:CONTEXT|INTENT|system prompt)[^.\n]*\.?/gi, ' ')
        // Remove "If you ask about X again, I'll provide Y" style leaks
        .replace(/\(?If you ask[^.)\n]*(?:provide|give|share)[^.)\n]*\)?\.?/gi, '')
        // Cleanup extra spaces/newlines
        .replace(/\s{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\n\s+\n/g, '\n\n')
        .trim();
}

/**
 * Detect if message is a pronoun-style request (needs prior context).
 */
function isPronounQuery(messageText: string): boolean {
    const trimmed = messageText.trim();
    return PRONOUN_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * Detect if user's message refers to a multi-version subject without specifying version.
 */
function detectMultiVersionAmbiguity(messageText: string): string | null {
    const lower = messageText.toLowerCase();
    for (const subject of MULTI_VERSION_SUBJECTS) {
        if (lower.includes(subject)) {
            // If they specified part 1/2/3 or "complete", it's not ambiguous
            const hasVersion = /\b(part\s*[123]|complete|full|all)\b/i.test(lower);
            if (!hasVersion) return subject;
        }
    }
    return null;
}

/**
 * Build a context-aware retrieval query using conversation history.
 * For pronoun queries like "give me the notes", grab the subject from prior messages.
 */
function buildRetrievalQuery(
    messageText: string,
    history: Array<{ role: string; content: string }>
): string {
    if (!isPronounQuery(messageText) || history.length === 0) {
        return messageText;
    }

    // Look at last 2 user messages for a subject mention
    const recentUserMessages = history
        .filter(m => m.role === "user")
        .slice(-2)
        .map(m => m.content)
        .join(" ");

    // Combine for retrieval (gets better embedding match)
    return `${recentUserMessages} ${messageText}`.trim();
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
        const { data: phoneMappings } = await supabase
            .from("phone_document_mapping")
            .select("system_prompt, intent, auth_token, origin")
            .eq("phone_number", toNumber);

        const dbPrompt = phoneMappings?.[0]?.system_prompt;
        const auth_token = phoneMappings?.[0]?.auth_token || process.env.WHATSAPP_11ZA_AUTH_TOKEN;
        const origin = phoneMappings?.[0]?.origin || process.env.WHATSAPP_11ZA_ORIGIN;

        if (!auth_token || !origin) {
            return { success: false, error: "No WhatsApp credentials." };
        }

        const systemPrompt = (dbPrompt && dbPrompt.trim().length > 100)
            ? dbPrompt
            : SAFE_FALLBACK_PROMPT;

        if (systemPrompt === SAFE_FALLBACK_PROMPT) {
            console.warn(`⚠️ DB prompt missing. Using safe fallback.`);
        } else {
            console.log(`✅ Using DB prompt (${dbPrompt!.length} chars)`);
        }

        // ─── 3. Get conversation history FIRST (needed for context-aware retrieval) ──
        const { data: historyRows } = await supabase
            .from("whatsapp_messages")
            .select("content_text, event_type, from_number, to_number, received_at")
            .or(`from_number.eq.${fromNumber},to_number.eq.${fromNumber}`)
            .order("received_at", { ascending: false })
            .limit(5); // 5 last messages for better context

        const history = (historyRows || [])
            .filter(m => m.content_text && (m.event_type === "MoMessage" || m.event_type === "MtMessage"))
            .map(m => ({
                role: m.event_type === "MoMessage" ? "user" as const : "assistant" as const,
                content: m.content_text
            }))
            .reverse();

        // ─── 4. Validate subject (with conversation awareness) ───
        const validation = validateSubjectRequest(messageText);
        const isPronoun = isPronounQuery(messageText);
        const multiVersionSubject = detectMultiVersionAmbiguity(messageText);

        console.log(`🔍 Validation:`, validation);
        console.log(`🔍 Pronoun query: ${isPronoun} | Multi-version: ${multiVersionSubject}`);

        // ─── 5. Build retrieval query (uses history for pronouns) ──
        const retrievalQuery = buildRetrievalQuery(messageText, history);
        if (retrievalQuery !== messageText) {
            console.log(`🔄 Context-aware query: "${retrievalQuery.slice(0, 80)}..."`);
        }

        // ─── 6. Embed + retrieve ─────────────────────────────────
        const queryEmbedding = await embedText(retrievalQuery);
        if (!queryEmbedding) {
            return { success: false, error: "Embedding failed" };
        }

        const allMatches = await retrieveRelevantChunksFromFiles(
            queryEmbedding, fileIds, 6
        );
        const matches = allMatches.filter(m => m.similarity > 0.30); // Slightly lower for pronoun queries
        const contextText = matches.map(m => m.chunk).join("\n\n");

        // ─── 7. Quick intent detection ───────────────────────────
        const lower = messageText.trim().toLowerCase();
        const isGreeting = /^(hi+|hello+|hey+|hy+|heyy+|hii+|hlo+|helo+|hola|namaste|salaam|good\s*(morning|evening|afternoon))$/i.test(lower);
        const isAck = /^(ok+|okk+|okay+|kk+|thanks?|thank\s*you|thx|tks|hmm+|achha|theek)$/i.test(lower);

        // ─── 8. Build dynamic intent hint ────────────────────────
        let intentHint = "";

        if (isGreeting) {
            intentHint = `INTERNAL_HINT: User sent a greeting. Reply with the GREETING template (full text + question). Do NOT reply with only an emoji.`;
        } else if (isAck) {
            intentHint = `INTERNAL_HINT: User sent acknowledgment. Reply: "You're welcome 😊 Aur kis subject me help chahiye?"`;
        } else if (multiVersionSubject) {
            intentHint = `INTERNAL_HINT: User asked for "${multiVersionSubject}" but did NOT specify which version (Complete/Part 1/Part 2/Part 3).
Use the NEET_MDS_CLARIFICATION template. Ask which version they need. Do NOT pick one yourself.
Do NOT share any link yet.`;
        } else if (isPronoun) {
            intentHint = `INTERNAL_HINT: User used a pronoun reference (like "the notes", "send it", "wo bhejo").
Look at the conversation history above to identify which subject they mean.
If history shows a multi-version subject (NEET MDS) without specified version, use NEET_MDS_CLARIFICATION template.
If the prior subject is clear, share that subject's link from the retrieved context.
If unclear, ask: "Aap kis subject ki notes chahiye?"`;
        } else if (validation.status === "NOT_IN_CATALOG") {
            intentHint = `INTERNAL_HINT: User asked for "${validation.detectedTerm}" — NOT in our catalog.
DO NOT provide any link. DO NOT substitute. Use NOT_IN_CATALOG template.`;
        } else if (validation.status === "MATCHED") {
            const linksInContext = extractDriveLinks(contextText);
            intentHint = `INTERNAL_HINT: Subject "${validation.matchedSubject}" matched.
${linksInContext.length > 0
                    ? `Drive link in context: ${linksInContext[0]}\nInclude this FULL URL using MATERIAL_FOUND template.`
                    : `No link available. Reply: "Sorry, [Subject] ka link abhi catalog me nahi hai"`}`;
        } else if (validation.status === "NO_SUBJECT_DETECTED") {
            intentHint = `INTERNAL_HINT: Material request without specific subject. Ask which subject they need.`;
        } else {
            intentHint = `INTERNAL_HINT: General query. Answer briefly from retrieved info. Keep reply 4-6 lines.`;
        }

        // ─── 9. Build messages ───────────────────────────────────
        const finalContext = (isGreeting || isAck) ? "" : contextText;

        const messages = [
            {
                role: "system" as const,
                content: `${systemPrompt}\n\n────────\n${intentHint}\n────────\nRETRIEVED INFO:\n${finalContext || "(no info available)"}`
            },
            ...history,
            { role: "user" as const, content: messageText }
        ];

        console.log(`📝 Intent: ${intentHint.split('\n')[0]}`);
        console.log(`📊 Context: ${contextText.length} chars | Links: ${extractDriveLinks(contextText).length} | History: ${history.length} msgs`);

        // ─── 10. Generate ────────────────────────────────────────
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

        // ─── 11. POST-PROCESSING ─────────────────────────────────
        // (a) Strip markdown
        response = stripMarkdown(response);

        // (b) NEW: Strip internal-leak phrases
        response = stripInternalLeaks(response);

        // (c) Guard: emoji-only or too-short greeting
        const onlyEmojiOrTooShort = /^[\s\p{Emoji}\p{Emoji_Presentation}]+$/u.test(response) || response.trim().length < 10;
        if (onlyEmojiOrTooShort && isGreeting) {
            response = "Hi 😊 Main Medi Study Go assistant hoon. Hum MBBS, BDS aur NEET MDS students ke liye visual study materials provide karte hain. Aapko kis subject me help chahiye?";
            console.log(`🔧 Replaced emoji-only response with proper greeting`);
        }

        // (d) Guard: missing link auto-append (only for non-multi-version)
        if (validation.status === "MATCHED" && !multiVersionSubject) {
            const ctxLinks = extractDriveLinks(contextText);
            const respLinks = extractDriveLinks(response);
            if (ctxLinks.length > 0 && respLinks.length === 0) {
                response += `\n\n👉 ${ctxLinks[0]}`;
                console.log(`🔧 Auto-appended missing link`);
            }
        }

        // ─── 12. Send ────────────────────────────────────────────
        const sendResult = await sendWhatsAppMessage(fromNumber, response, auth_token, origin);

        if (!sendResult.success) {
            await supabase
                .from("whatsapp_messages")
                .update({ auto_respond_sent: false, response_sent_at: new Date().toISOString() })
                .eq("message_id", messageId);
            return { success: false, response, sent: false, error: `Send failed: ${sendResult.error}` };
        }

        // ─── 13. Save AI response ────────────────────────────────
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