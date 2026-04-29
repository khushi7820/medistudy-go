import { NextResponse } from "next/server";
import { extractPdfText } from "@/lib/pdf";
import { chunkText } from "@/lib/chunk";
import { embedText } from "@/lib/embeddings";
import { supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";

export async function POST(req: Request) {
    let fileId: string | null = null;

    try {
        const form = await req.formData();
        const file = form.get("file") as File | null;
        const phoneNumbers = form.get("phone_numbers") as string | null;
        const authToken = form.get("auth_token") as string | null;
        const origin = form.get("origin") as string | null;

        if (!file) {
            return NextResponse.json({ error: "No PDF uploaded" }, { status: 400 });
        }

        if (!authToken || !origin) {
            return NextResponse.json({
                error: "11za auth_token and origin are required"
            }, { status: 400 });
        }

        const buffer = await file.arrayBuffer();
        const pdfName = file.name;

        // Parse phone numbers (comma-separated)
        const phoneNumberList = phoneNumbers
            ? phoneNumbers.split(",").map(num => num.trim()).filter(Boolean)
            : [];

        // 1) Create file record with 11za credentials
        const { data: fileRow, error: fileError } = await supabase
            .from("rag_files")
            .insert({
                name: pdfName,
                auth_token: authToken,
                origin: origin,
            })
            .select()
            .single();

        if (fileError) {
            throw fileError;
        }

        fileId = fileRow.id as string;

        // 2) Extract text + chunk
        const text = await extractPdfText(buffer);
        const chunks = chunkText(text, 1500).filter((c) => c.trim().length > 0);

        if (chunks.length === 0) {
            throw new Error("No text chunks produced from PDF");
        }

        // 3) Build embeddings + rows with batch processing
        const rows: {
            file_id: string;
            pdf_name: string;
            chunk: string;
            embedding: number[];
        }[] = [];

        // Process in batches of 55 to stay under rate limit (60/min with buffer)
        const BATCH_SIZE = 55;
        const BATCH_DELAY_MS = 61000; // Wait 61s between batches

        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);
            const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);

            console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} chunks)...`);

            // Process batch in parallel
            const embeddings = await Promise.all(
                batch.map((chunk) => embedText(chunk))
            );

            // Validate and add to rows
            for (let j = 0; j < batch.length; j++) {
                const embedding = embeddings[j];
                if (!embedding || !Array.isArray(embedding)) {
                    throw new Error(`Failed to generate embedding for chunk ${i + j + 1}`);
                }

                rows.push({
                    file_id: fileId,
                    pdf_name: pdfName,
                    chunk: batch[j],
                    embedding,
                });
            }

            // Wait before next batch (except for the last batch)
            if (i + BATCH_SIZE < chunks.length) {
                console.log(`Waiting ${BATCH_DELAY_MS / 1000}s before next batch to avoid rate limits...`);
                await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
            }
        }

        // 4) Insert all chunks in one go
        const { error: insertError } = await supabase
            .from("rag_chunks")
            .insert(rows);

        if (insertError) {
            throw insertError;
        }

        // 5) Map phone numbers to this document
        if (phoneNumberList.length > 0) {
            const mappingRows = phoneNumberList.map(phoneNumber => ({
                phone_number: phoneNumber,
                file_id: fileId,
            }));

            const { error: mappingError } = await supabase
                .from("phone_document_mapping")
                .insert(mappingRows);

            if (mappingError) {
                console.error("Phone mapping error:", mappingError);
                // Don't fail the whole request if mapping fails
            }
        }

        return NextResponse.json({
            message: "PDF processed successfully",
            file_id: fileId,
            chunks: chunks.length,
            phone_numbers_mapped: phoneNumberList.length,
        });
    } catch (err: unknown) {
        console.error("PROCESS_PDF_ERROR:", err);
        if (err && typeof err === "object") {
            console.error("PROCESS_PDF_ERROR_DETAIL:", JSON.stringify(err));
        }

        // Clean up orphaned file rows when chunk insertion fails
        if (fileId) {
            // best-effort cleanup; ignore result to avoid masking original error
            void supabase.from("rag_files").delete().eq("id", fileId);
        }

        const message = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
