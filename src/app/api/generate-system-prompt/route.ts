import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { supabase } from "@/lib/supabaseClient";

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { intent, phone_number } = body;

        if (!intent || !phone_number) {
            return NextResponse.json(
                { error: "Intent and phone_number are required" },
                { status: 400 }
            );
        }

        console.log("Generating system prompt for intent:", intent);

        // Use Groq to generate a system prompt based on the intent
        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are an AI assistant that generates professional system prompts for chatbots.
Given a business intent/purpose, create a clear, concise, and effective system prompt that will guide the chatbot's behavior.

The system prompt should:
1. Define the chatbot's role and expertise
2. Specify the tone and communication style
3. Outline key responsibilities and limitations
4. Include any relevant guidelines for handling user queries
5. Be professional yet friendly

Keep the system prompt under 250 words.`
                },
                {
                    role: "user",
                    content: `Create a system prompt for a WhatsApp chatbot with the following intent/purpose:\n\n"${intent}"\n\nGenerate only the system prompt text, without any additional explanation or formatting.`
                }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
            max_tokens: 500,
        });

        const systemPrompt = completion.choices[0]?.message?.content || "";

        if (!systemPrompt) {
            throw new Error("Failed to generate system prompt");
        }

        console.log("Generated system prompt:", systemPrompt);

        // Check if phone number has any mappings
        const { data: existingMappings } = await supabase
            .from("phone_document_mapping")
            .select("*")
            .eq("phone_number", phone_number);

        if (existingMappings && existingMappings.length > 0) {
            // Update all existing mappings for this phone number
            const { error: updateError } = await supabase
                .from("phone_document_mapping")
                .update({
                    intent: intent,
                    system_prompt: systemPrompt,
                })
                .eq("phone_number", phone_number);

            if (updateError) {
                console.error("Error updating phone_document_mapping:", updateError);
                throw updateError;
            }
        } else {
            // Create a placeholder mapping with just intent and system_prompt
            // (file_id will be added when first file is uploaded)
            const { error: insertError } = await supabase
                .from("phone_document_mapping")
                .insert({
                    phone_number: phone_number,
                    intent: intent,
                    system_prompt: systemPrompt,
                    file_id: null, // Will be set when file is uploaded
                });

            if (insertError) {
                console.error("Error creating phone_document_mapping:", insertError);
                throw insertError;
            }
        }

        return NextResponse.json({
            success: true,
            system_prompt: systemPrompt,
            intent: intent,
        });

    } catch (error) {
        console.error("System prompt generation error:", error);

        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to generate system prompt",
            },
            { status: 500 }
        );
    }
}
