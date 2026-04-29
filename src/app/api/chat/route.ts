import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { supabase } from "@/lib/supabaseClient";
import { embedText } from "@/lib/embeddings";
import { retrieveRelevantChunks } from "@/lib/retrieval";

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY!,
});

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { session_id, message, file_id } = body;

        if (!session_id || !message) {
            return NextResponse.json(
                { error: "session_id and message are required" },
                { status: 400 }
            );
        }

        // 1. Embed the user query
        const queryEmbedding = await embedText(message);

        if (!queryEmbedding) {
            return NextResponse.json(
                { error: "Failed to generate embedding" },
                { status: 500 }
            );
        }

        // 2. Retrieve relevant chunks
        const matches = await retrieveRelevantChunks(queryEmbedding, file_id, 5);

        const contextText = matches.map((m) => m.chunk).join("\n\n");

        // 3. Load conversation history
        const { data: historyRows } = await supabase
            .from("messages")
            .select("role, content")
            .eq("session_id", session_id)
            .order("created_at", { ascending: true });

        const history = (historyRows || []).map(m => ({
            role: m.role,
            content: m.content
        }));

        // 4. Inject RAG context into Groq LLM
        const messages = [
            {
                role: "system",
                content:
                    `You are a helpful document assistant. Your ONLY job is to answer questions based strictly on the provided document context.\n\n` +
                    `STRICT RULES:\n` +
                    `- ONLY answer questions using information from the CONTEXT below\n` +
                    `- If the answer is not in the CONTEXT, say "I don't have that information in the document"\n` +
                    `- NEVER use your general knowledge or make assumptions beyond the document\n` +
                    `- NEVER offer to do tasks you cannot do (generate QR codes, create files, etc.)\n` +
                    `- If asked about yourself or your technology, say "I can only answer questions about the document"\n` +
                    `- Be concise, friendly, and use natural language\n` +
                    `- Format responses with paragraphs and bullet points when appropriate\n\n` +
                    `CONTEXT:\n${contextText}`
            },
            ...history,
            { role: "user", content: message }
        ];

        // 5. Call Groq with streaming
        const completion = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages,
            temperature: 0.2,
            stream: true
        });

        // Create a streaming response
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of completion) {
                        const content = chunk.choices[0]?.delta?.content || "";
                        if (content) {
                            controller.enqueue(encoder.encode(content));
                        }
                    }
                    controller.close();
                } catch (error) {
                    controller.error(error);
                }
            }
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Transfer-Encoding': 'chunked'
            }
        });
    } catch (err: unknown) {
        console.error("CHAT_ERROR:", err);
        const message = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
