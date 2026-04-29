import { supabase } from "@/lib/supabaseClient";

export async function retrieveRelevantChunks(
    queryEmbedding: number[],
    fileId?: string,
    limit = 5
) {
    const { data, error } = await supabase.rpc("match_documents", {
        query_embedding: queryEmbedding,
        match_count: limit,
        target_file: fileId ?? null,
    });

    if (error) {
        console.error("VECTOR SEARCH ERROR:", error);
        throw error;
    }

    return data as { id: string; chunk: string; similarity: number }[];
}

/**
 * Retrieve relevant chunks from multiple files (for phone number mappings)
 */
export async function retrieveRelevantChunksFromFiles(
    queryEmbedding: number[],
    fileIds: string[],
    limit = 5
) {
    if (fileIds.length === 0) {
        return [];
    }

    if (fileIds.length === 1) {
        return retrieveRelevantChunks(queryEmbedding, fileIds[0], limit);
    }

    // For multiple files, we need to search across all of them
    // We'll get results from each file and then merge them
    const allChunks: { id: string; chunk: string; similarity: number; file_id: string }[] = [];

    for (const fileId of fileIds) {
        const chunks = await retrieveRelevantChunks(queryEmbedding, fileId, limit);
        allChunks.push(...chunks.map(c => ({ ...c, file_id: fileId })));
    }

    // Sort by similarity and return top N
    return allChunks
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
}
