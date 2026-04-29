import { supabase } from "@/lib/supabaseClient";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { session_id, role, content } = body;

        const { error } = await supabase
            .from("messages")
            .insert([{ session_id, role, content }]);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("SUPABASE_SAVE_ERROR:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
