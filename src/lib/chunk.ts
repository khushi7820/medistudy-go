export function chunkText(text: string, size = 1600, overlap = 200): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
        const chunk = text.slice(start, start + size);
        const trimmed = chunk.trim();

        if (trimmed.length > 0) {
            chunks.push(trimmed);
        }

        // Move forward by (size - overlap) to create overlapping chunks
        start += size - overlap;
    }

    return chunks;
}
