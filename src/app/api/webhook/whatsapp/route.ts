import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { generateAutoResponse } from "@/lib/autoResponder";

// Type definition for WhatsApp webhook payload
type WhatsAppWebhookPayload = {
    messageId: string;
    channel: string;
    from: string;
    to: string;
    receivedAt: string;
    content: {
        contentType: string;
        text?: string;
    };
    whatsapp?: {
        senderName?: string;
    };
    timestamp: string;
    event: string;
    isin24window?: boolean;
    isResponded?: boolean;
    UserResponse?: string;
};

export async function POST(req: Request) {
    try {
        const payload: WhatsAppWebhookPayload = await req.json();

        console.log("Received WhatsApp webhook:", payload);

        // Validate required fields
        if (!payload.messageId || !payload.from || !payload.to) {
            return NextResponse.json(
                { error: "Missing required fields: messageId, from, or to" },
                { status: 400 }
            );
        }

        // Insert into database
        const { data, error } = await supabase
            .from("whatsapp_messages")
            .insert([
                {
                    message_id: payload.messageId,
                    channel: payload.channel,
                    from_number: payload.from,
                    to_number: payload.to,
                    received_at: payload.receivedAt,
                    content_type: payload.content?.contentType,
                    content_text: payload.content?.text || payload.UserResponse,
                    sender_name: payload.whatsapp?.senderName,
                    event_type: payload.event,
                    is_in_24_window: payload.isin24window || false,
                    is_responded: payload.isResponded || false,
                    raw_payload: payload,
                },
            ])
            .select();

        if (error) {
            console.error("Database error:", error);

            // Handle duplicate message_id (already processed)
            if (error.code === "23505") {
                return NextResponse.json(
                    {
                        success: true,
                        message: "Message already processed",
                        duplicate: true
                    },
                    { status: 200 }
                );
            }

            throw error;
        }

        console.log("Message stored successfully:", data);

        // Trigger auto-response if it's a user message
        const messageText = payload.content?.text || payload.UserResponse;
        if (messageText && payload.event === "MoMessage") {
            console.log("Processing auto-response for message:", payload.messageId);

            // Process directly - await the full response
            // Use payload.to (the business number) to look up the correct file/credentials
            const result = await generateAutoResponse(
                payload.from,
                payload.to,
                messageText,
                payload.messageId
            );

            if (result.success) {
                console.log("✅ Auto-response sent successfully");
            } else {
                console.error("❌ Auto-response failed:", result.error);
            }
        }

        return NextResponse.json({
            success: true,
            message: "WhatsApp message received and stored",
            data: data?.[0],
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("WEBHOOK_ERROR:", message, err);
        return NextResponse.json(
            { error: message, details: err },
            { status: 500 }
        );
    }
}

// Optional: Add GET endpoint for webhook verification (some services require this)
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("hub.mode");
    const token = searchParams.get("hub.verify_token");
    const challenge = searchParams.get("hub.challenge");

    // Verify token (set this in your environment variables)
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "your_verify_token";

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("Webhook verified successfully");
        return new Response(challenge, { status: 200 });
    }

    return NextResponse.json(
        { error: "Verification failed" },
        { status: 403 }
    );
}
