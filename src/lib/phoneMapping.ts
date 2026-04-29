import { supabase } from "./supabaseClient";

/**
 * Get all file IDs mapped to a phone number
 */
export async function getFilesForPhoneNumber(phoneNumber: string): Promise<string[]> {
    const { data, error } = await supabase
        .from("phone_document_mapping")
        .select("file_id")
        .eq("phone_number", phoneNumber);

    if (error) {
        console.error("Error fetching files for phone number:", error);
        return [];
    }

    return data?.map(row => row.file_id) || [];
}

/**
 * Check if a phone number has any document mappings
 */
export async function hasDocumentMapping(phoneNumber: string): Promise<boolean> {
    const { count, error } = await supabase
        .from("phone_document_mapping")
        .select("*", { count: "exact", head: true })
        .eq("phone_number", phoneNumber);

    if (error) {
        console.error("Error checking document mapping:", error);
        return false;
    }

    return (count || 0) > 0;
}
