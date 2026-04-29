import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const fromNumber = searchParams.get("from");
        const limit = parseInt(searchParams.get("limit") || "50");
        const offset = parseInt(searchParams.get("offset") || "0");

        let query = supabase
            .from("whatsapp_messages")
            .select("*")
            .order("received_at", { ascending: false })
            .range(offset, offset + limit - 1);

        // Filter by from_number if provided
        if (fromNumber) {
            query = query.eq("from_number", fromNumber);
        }

        const { data, error } = await query;

        if (error) {
            throw error;
        }

        return NextResponse.json({
            success: true,
            messages: data,
            count: data?.length || 0,
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("GET_MESSAGES_ERROR:", message);
        return NextResponse.json(
            { error: message },
            { status: 500 }
        );
    }
}
