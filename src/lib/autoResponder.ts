// ================================================================
// 🔒 LOCKED autoResponder.ts v2.5 — SUBJECT-FIRST SCOPE GUARD
// 🔒 New in v2.5:
// 🔒   - Removed "pharmacy" from OOS (it's an alias for Pharmacology!)
// 🔒   - Removed ambiguous words that can mean approved subjects
// 🔒   - More conservative OOS — only flags CLEAR career/exam questions
// 🔒   - Subject validation runs FIRST always
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

// 🔒 OUT-OF-SCOPE patterns — career advice, exam help, non-product queries
// Bot should NOT answer these from LLM training data (causes hallucination)
//
// 🔒 IMPORTANT: Only put words that CANNOT be an approved subject.
// "pharmacy" is REMOVED (it's an alias for Pharmacology).
// "physio" is REMOVED (it's an alias for Physiology).
// We catch career-y phrasings instead, like "physiotherapist career".
const OUT_OF_SCOPE_PATTERNS = [
    // Specific career degree codes (NOT our products)
    /\b(BHMS|BAMS|BPT|BUMS|BSMS|MBA|BBA|MCA)\b/i,
    // Career professions (full word — these are NEVER subjects in our catalog)
    /\b(physiotherapist|physiotherapy|homeopath|homeopathy|homoeopath|homoeopathy|nurse|nursing|paramedic|ayurveda|ayurvedic|unani)\b/i,
    // Career path queries
    /\b(career|salary|earning|income|job opportunit|job after|career after|future scope|scope after)\b/i,
    /\b(should I (do|choose|take|pursue|join|opt for|go for))\b/i,
    /\b(kya karu|kya choose karu|kya lena chahiye|kaunsa karu|konsa lu)\b/i,
    /\b(MBBS vs|BDS vs|vs MBBS|vs BDS|better than|which is better)\b/i,
    /\b(if i (choose|take|do|pick|select|opt for|go for))\b/i, // "if i choose physio..."
    // Exam-specific queries (we don't give exam guidance)
    /\b(exam (cutoff|pattern|date|tips|preparation tips)|how (much|many) (marks|score|rank))\b/i,
    /\b(NEET (cutoff|score|rank|preparation tips|exam tips)|INICET (cutoff|tips))\b/i,
    /\b(score (we |I )?need (in |for ))/i, // "how much score we need in NEET"
    // General medical queries (not our domain)
    /\b(treatment for|disease|symptoms?|medicine for|cure for|doctor for|prescribe)\b/i,
    // Generic life advice
    /\b(future planning|guide me on (career|life))\b/i,
    // Admission/college specific
    /\b(college (list|admission|fees)|admission process|cut-?off marks)\b/i,
    // "what is X" where X is a non-product term (broader catch-all)
    /\b(what is|kya hai)\s+(BHMS|BAMS|BPT|homeopathy|homoeopathy|ayurveda|physiotherapy|nursing)\b/i,
];

// 🔒 PRICING/COST patterns — boost retrieval for these
const PRICING_PATTERNS = [
    /\b(price|cost|kitne ka|kitna|kya rate|how much|fees|charges|paisa|rupee|rs|₹)/i,
    /\b(discount|coupon|offer|sasta|cheap|expensive|mehnga)/i,
];

// 🔒 Pronoun-style queries (refer to previous message subject)
const PRONOUN_PATTERNS = [
    /\b(give|send|share|provide|do|please)\s+(me\s+)?(the\s+|wo\s+|us\s+|that\s+)?(notes?|material|link|pdf|file|stuff)/i,
    /^(the|wo|woh|us|that)\s+(notes?|material|link|pdf|file)/i,
    /\b(send|share|give|bhejo|bhej do|do na)\s+(it|wo|usko|that)/i,
    /^(bhej\s*do|bhejo|wo bhejo|usko bhejo|do na|de do|share kar|share karo)$/i,
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
 * Detect if query is OUT OF SCOPE (career advice, exam tips, non-product).
 * These should NEVER be answered by LLM — too risky for hallucination.
 *
 * 🔒 IMPORTANT: If the message matches an APPROVED subject (like "physiology"),
 * it's NOT out-of-scope even if it contains a trigger word.
 *
 * 🔒 EXCEPTION: If the message has STRONG career indicators (BHMS, "should I",
 * "if i choose", career, salary), treat as OOS even if a subject keyword appears.
 * Example: "if i choose physio theropist" — "physio" is matched, but the phrase
 * is clearly career advice.
 */
const STRONG_CAREER_INDICATORS = [
    /\b(BHMS|BAMS|BPT|BUMS|BSMS)\b/i,
    /\b(should I (do|choose|take|pursue))\b/i,
    /\b(if i (choose|take|opt for|go for))\b/i,
    /\b(career|salary|future scope|job opportunit)\b/i,
    /\b(MBBS vs|BDS vs|vs MBBS|vs BDS|better than)\b/i,
    /\b(theropist|therapist)\b/i, // "physio theropist", "physiotherapist"
    /\b(NEET (cutoff|score|rank))/i,
    /\b(score (we |I )?need (in |for ))/i,
    /\b(kya karu|kaunsa karu|konsa lu)\b/i,
];

function hasStrongCareerIndicator(text: string): boolean {
    return STRONG_CAREER_INDICATORS.some(p => p.test(text));
}

function isOutOfScope(messageText: string): boolean {
    // 🛡️ Special override: strong career indicators ALWAYS win
    if (hasStrongCareerIndicator(messageText)) {
        return true;
    }

    // 🛡️ FIRST: Check if it's a valid subject request — if yes, NOT out of scope
    const subjectCheck = validateSubjectRequest(messageText);
    if (subjectCheck.status === "MATCHED") {
        return false;
    }

    // 🔍 THEN: Check if it matches OOS patterns
    return OUT_OF_SCOPE_PATTERNS.some(pattern => pattern.test(messageText));
}

/**
 * Detect if query is asking about pricing/cost.
 */
function isPricingQuery(messageText: string): boolean {
    return PRICING_PATTERNS.some(pattern => pattern.test(messageText));
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

        // ─── 3. EARLY DETECTION — Greeting/Ack FIRST (no LLM call) ──
        // 🔒 Bypass LLM entirely for these to prevent pattern repetition from history
        const lower = messageText.trim().toLowerCase();
        const isGreeting = /^(hi+|hello+|hey+|hy+|heyy+|hii+|hlo+|helo+|hola|namaste|salaam|good\s*(morning|evening|afternoon))[\s!.?]*$/i.test(lower);
        const isAck = /^(ok+|okk+|okay+|kk+|thanks?|thank\s*you|thx|tks|hmm+|achha|theek|cool|nice|got it)[\s!.?]*$/i.test(lower);

        // 🎯 GREETING SHORTCUT — hardcoded reply, skip LLM completely
        if (isGreeting) {
            console.log(`👋 Greeting detected — using hardcoded reply (no LLM)`);
            const isEnglishGreeting = /^(hello|hey|hi+|good\s)/i.test(lower) && !/[ा-ौ]/u.test(messageText);
            const greetingReply = isEnglishGreeting
                ? "Hi 😊 I'm the Medi Study Go assistant. We provide visual study bundles and materials for MBBS, BDS and NEET MDS students. Which subject do you need help with?"
                : "Hi 😊 Main Medi Study Go assistant hoon. Hum MBBS, BDS aur NEET MDS students ke liye visual study bundles aur materials provide karte hain. Aapko kis subject me help chahiye?";

            return await sendAndStore(fromNumber, toNumber, greetingReply, messageId, auth_token, origin);
        }

        // 🎯 ACK SHORTCUT — hardcoded reply, skip LLM completely
        if (isAck) {
            console.log(`👍 Acknowledgment detected — using hardcoded reply (no LLM)`);
            const ackReply = "You're welcome 😊 Aur kis subject me help chahiye?";
            return await sendAndStore(fromNumber, toNumber, ackReply, messageId, auth_token, origin);
        }

        // 🎯 OUT-OF-SCOPE SHORTCUT — career/exam/non-product queries
        // 🔒 CRITICAL: Bypass LLM entirely to prevent hallucination
        if (isOutOfScope(messageText)) {
            console.log(`🚫 Out-of-scope query detected — using hardcoded redirect (no LLM)`);
            // Detect language for the redirect
            const isEnglish = /^[a-zA-Z\s.,!?'"0-9-]+$/.test(messageText) && !/[ा-ौ]/u.test(messageText);
            const offTopicReply = isEnglish
                ? "Sorry, I'm not the right assistant for that. 😊 I'm here to help you with Medi Study Go's MBBS & BDS study materials. Which subject do you need notes for?"
                : "Sorry, ye topic mere domain me nahi hai 😊 Main Medi Study Go ke MBBS aur BDS study materials me aapki help kar sakta hoon. Kaunsa subject ya bundle chahiye?";
            return await sendAndStore(fromNumber, toNumber, offTopicReply, messageId, auth_token, origin);
        }

        // ─── 4. Get conversation history (only for non-greeting flows) ──
        const { data: historyRows } = await supabase
            .from("whatsapp_messages")
            .select("content_text, event_type, from_number, to_number, received_at")
            .or(
                `and(from_number.eq.${fromNumber},to_number.eq.${toNumber}),` +
                `and(from_number.eq.${toNumber},to_number.eq.${fromNumber})`
            )
            .order("received_at", { ascending: false })
            .limit(5);

        const history = (historyRows || [])
            .filter(m => m.content_text && (m.event_type === "MoMessage" || m.event_type === "MtMessage"))
            .map(m => ({
                role: m.event_type === "MoMessage" ? "user" as const : "assistant" as const,
                content: m.content_text
            }))
            .reverse();

        // ─── 5. Validate subject (with conversation awareness) ───
        const validation = validateSubjectRequest(messageText);
        const isPronoun = isPronounQuery(messageText);
        const multiVersionSubject = detectMultiVersionAmbiguity(messageText);
        const isPricing = isPricingQuery(messageText);

        console.log(`🔍 Validation:`, validation);
        console.log(`🔍 Pronoun: ${isPronoun} | Multi-ver: ${multiVersionSubject} | Pricing: ${isPricing}`);


        // ─── 6. Build retrieval query ──
        let retrievalQuery = buildRetrievalQuery(messageText, history);

        // IMPORTANT FIX: if subject matcher found canonical subject, force exact retrieval on that
        if (validation.status === "MATCHED") {
            retrievalQuery = validation.matchedSubject;
            console.log(`🎯 Canonical subject retrieval forced: ${retrievalQuery} `);
        }

        // 🎯 Pricing boost: append pricing keywords for better chunk match
        if (isPricing) {
            retrievalQuery = `${retrievalQuery} price cost rupees coupon NEW10 discount bundle`;
            console.log(`💰 Pricing query — boosted retrieval`);
        }

        if (retrievalQuery !== messageText) {
            console.log(`🔄 Boosted query: "${retrievalQuery.slice(0, 80)}..."`);
        }


        // ─── 7. Embed + retrieve ─────────────────────────────────
        const queryEmbedding = await embedText(retrievalQuery);
        if (!queryEmbedding) {
            return { success: false, error: "Embedding failed" };
        }

        const allMatches = await retrieveRelevantChunksFromFiles(
            queryEmbedding, fileIds, 6
        );
        const matches = allMatches.filter(m => m.similarity > 0.30);
        const contextText = matches.map(m => m.chunk).join("\n\n");

        // 🛡️ EMPTY CONTEXT GUARD — anti-hallucination
        // If we have NO context AND no specific intent matched, refuse to answer from general knowledge
        const hasNoContext = contextText.length < 50 || matches.length === 0;
        const hasNoSpecificIntent =
            validation.status === "GENERAL_QUERY" &&
            !isPronoun &&
            !multiVersionSubject &&
            !isPricing;

        if (hasNoContext && hasNoSpecificIntent) {
            console.log(`🛡️ Empty context guard triggered — refusing to hallucinate`);
            const isEnglish = /^[a-zA-Z\s.,!?'"0-9-]+$/.test(messageText) && !/[ा-ौ]/u.test(messageText);
            const noContextReply = isEnglish
                ? "Sorry, I don't have info on that. 😊 I'm here to help with Medi Study Go's MBBS & BDS study materials, prices and bundles. Which subject can I help you with?"
                : "Sorry, iske baare me mere paas info nahi hai 😊 Main Medi Study Go ke study materials, pricing aur bundles me help kar sakta hoon. Kaunsa subject chahiye?";
            return await sendAndStore(fromNumber, toNumber, noContextReply, messageId, auth_token, origin);
        }

        // ─── 8. Build dynamic intent hint ────────────────────────
        let intentHint = "";

        if (multiVersionSubject) {
            intentHint = `INTERNAL_HINT: User asked for "${multiVersionSubject}" but did NOT specify which version (Complete/Part 1/Part 2/Part 3).
Use the NEET_MDS_CLARIFICATION template. Ask which version they need. Do NOT pick one yourself.
Do NOT share any link yet.`;
        } else if (isPronoun) {
            intentHint = `INTERNAL_HINT: User used a pronoun reference (like "the notes", "send it", "wo bhejo").
Look at the conversation history above to identify which subject they mean.
If history shows a multi-version subject (NEET MDS) without specified version, use NEET_MDS_CLARIFICATION template.
If the prior subject is clear, share that subject's link from the retrieved info.
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
        const messages = [
            {
                role: "system" as const,
                content: `${systemPrompt}\n\n────────\n${intentHint}\n────────\nRETRIEVED INFO:\n${contextText || "(no info available)"}`
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
        response = stripMarkdown(response);
        response = stripInternalLeaks(response);

        // Guard: missing link auto-append (only for non-multi-version)
        if (validation.status === "MATCHED" && !multiVersionSubject) {
            const ctxLinks = extractDriveLinks(contextText);
            const respLinks = extractDriveLinks(response);
            if (ctxLinks.length > 0 && respLinks.length === 0) {
                response += `\n\n👉 ${ctxLinks[0]}`;
                console.log(`🔧 Auto-appended missing link`);
            }
        }

        // ─── 12. Send + Store ────────────────────────────────────
        return await sendAndStore(fromNumber, toNumber, response, messageId, auth_token, origin);

    } catch (error) {
        console.error("❌ Auto-response error:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

// ────────────────────────────────────────────────────────────────
// 🔒 SEND + STORE HELPER (used by both shortcut and LLM paths)
// ────────────────────────────────────────────────────────────────
async function sendAndStore(
    fromNumber: string,
    toNumber: string,
    response: string,
    messageId: string,
    auth_token: string,
    origin: string
): Promise<AutoResponseResult> {
    const sendResult = await sendWhatsAppMessage(fromNumber, response, auth_token, origin);

    if (!sendResult.success) {
        await supabase
            .from("whatsapp_messages")
            .update({ auto_respond_sent: false, response_sent_at: new Date().toISOString() })
            .eq("message_id", messageId);
        return { success: false, response, sent: false, error: `Send failed: ${sendResult.error}` };
    }

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
}