import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

// GET: Retrieve phone-document mappings
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const phoneNumber = searchParams.get("phone_number");
        const fileId = searchParams.get("file_id");

        let query = supabase
            .from("phone_document_view")
            .select("*")
            .order("created_at", { ascending: false });

        if (phoneNumber) {
            query = query.eq("phone_number", phoneNumber);
        }

        if (fileId) {
            query = query.eq("file_id", fileId);
        }

        const { data, error } = await query;

        if (error) {
            throw error;
        }

        return NextResponse.json({
            success: true,
            mappings: data,
            count: data?.length || 0,
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("GET_MAPPINGS_ERROR:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

// POST: Create new phone-document mapping
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { phone_number, file_id } = body;

        if (!phone_number || !file_id) {
            return NextResponse.json(
                { error: "phone_number and file_id are required" },
                { status: 400 }
            );
        }

        const { data, error } = await supabase
            .from("phone_document_mapping")
            .insert([{ phone_number, file_id }])
            .select();

        if (error) {
            // Handle duplicate constraint
            if (error.code === "23505") {
                return NextResponse.json(
                    { error: "This phone number is already mapped to this document" },
                    { status: 409 }
                );
            }
            throw error;
        }

        return NextResponse.json({
            success: true,
            mapping: data?.[0],
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("CREATE_MAPPING_ERROR:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

// DELETE: Remove phone-document mapping
export async function DELETE(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");

        if (!id) {
            return NextResponse.json(
                { error: "Mapping id is required" },
                { status: 400 }
            );
        }

        const { error } = await supabase
            .from("phone_document_mapping")
            .delete()
            .eq("id", id);

        if (error) {
            throw error;
        }

        return NextResponse.json({
            success: true,
            message: "Mapping deleted successfully",
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("DELETE_MAPPING_ERROR:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
