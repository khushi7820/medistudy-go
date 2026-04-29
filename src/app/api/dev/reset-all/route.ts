import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";

export async function DELETE() {
    try {
        // 1. Clear chat messages
        let { error } = await supabase
            .from("messages")
            .delete()
            .not("id", "is", null);

        if (error) throw error;

        // 2. Clear RAG chunks
        ({ error } = await supabase
            .from("rag_chunks")
            .delete()
            .not("id", "is", null));

        if (error) throw error;

        // 3. Clear files
        ({ error } = await supabase
            .from("rag_files")
            .delete()
            .not("id", "is", null));

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (err: unknown) {
        console.error("RESET_ALL_ERROR:", err);
        const message = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
