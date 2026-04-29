import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { phone_number, intent, system_prompt, auth_token, origin } = body;

        if (!phone_number) {
            return NextResponse.json(
                { error: "Phone number is required" },
                { status: 400 }
            );
        }

        console.log("Updating phone settings for:", phone_number);

        // Check if phone number has any mappings
        const { data: existingMappings } = await supabase
            .from("phone_document_mapping")
            .select("*")
            .eq("phone_number", phone_number);

        if (!existingMappings || existingMappings.length === 0) {
            return NextResponse.json(
                { error: "Phone number not found" },
                { status: 404 }
            );
        }

        // Update all mappings for this phone number
        const updateData: any = {};
        if (intent !== undefined) updateData.intent = intent;
        if (system_prompt !== undefined) updateData.system_prompt = system_prompt;
        if (auth_token !== undefined) updateData.auth_token = auth_token;
        if (origin !== undefined) updateData.origin = origin;

        const { error: updateMappingError } = await supabase
            .from("phone_document_mapping")
            .update(updateData)
            .eq("phone_number", phone_number);

        if (updateMappingError) {
            console.error("Error updating phone_document_mapping:", updateMappingError);
            throw updateMappingError;
        }

        // Also update credentials in all associated files for consistency
        if (auth_token !== undefined || origin !== undefined) {
            const fileIds = existingMappings
                .map(m => m.file_id)
                .filter(id => id !== null);

            if (fileIds.length > 0) {
                const updateFileData: any = {};
                if (auth_token !== undefined) updateFileData.auth_token = auth_token;
                if (origin !== undefined) updateFileData.origin = origin;

                const { error: updateFileError } = await supabase
                    .from("rag_files")
                    .update(updateFileData)
                    .in("id", fileIds);

                if (updateFileError) {
                    console.error("Error updating rag_files:", updateFileError);
                    throw updateFileError;
                }
            }
        }

        return NextResponse.json({
            success: true,
            message: "Phone settings updated successfully",
        });

    } catch (error) {
        console.error("Update phone settings error:", error);

        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to update phone settings",
            },
            { status: 500 }
        );
    }
}
