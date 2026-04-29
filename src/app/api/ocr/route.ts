import { NextRequest, NextResponse } from "next/server";
import { Mistral } from '@mistralai/mistralai';
import { chunkText } from "@/lib/chunk";
import { embedText } from "@/lib/embeddings";
import { supabase } from "@/lib/supabaseClient";

const apiKey = process.env.MISTRAL_API_KEY;

if (!apiKey) {
    console.error("MISTRAL_API_KEY is not set in environment variables");
}

export async function POST(request: NextRequest) {
    let fileId: string | null = null;

    try {
        if (!apiKey) {
            return NextResponse.json(
                { error: "Mistral API key is not configured" },
                { status: 500 }
            );
        }

        const formData = await request.formData();
        const imageFile = formData.get("image") as File;
        const shouldStore = formData.get("store") === "true";
        const phoneNumbers = formData.get("phone_numbers") as string | null;
        const authToken = formData.get("auth_token") as string | null;
        const origin = formData.get("origin") as string | null;

        if (!imageFile) {
            return NextResponse.json(
                { error: "No image file provided" },
                { status: 400 }
            );
        }

        // If storing, validate required fields
        if (shouldStore && (!authToken || !origin)) {
            return NextResponse.json({
                error: "11za auth_token and origin are required when storing OCR results"
            }, { status: 400 });
        }

        console.log("Processing image:", imageFile.name, imageFile.type, imageFile.size, "bytes");

        // Convert image to base64
        const bytes = await imageFile.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const base64Image = buffer.toString('base64');
        const mimeType = imageFile.type || 'image/png';
        const dataUrl = `data:${mimeType};base64,${base64Image}`;

        console.log("Image converted to base64, length:", base64Image.length);
        console.log("MIME type:", mimeType);

        // Initialize Mistral client
        const client = new Mistral({ apiKey });

        console.log("Calling Mistral OCR API...");

        // Process OCR
        const ocrResponse = await client.ocr.process({
            model: "mistral-ocr-latest",
            document: {
                type: "image_url",
                imageUrl: dataUrl,
            },
            includeImageBase64: true
        });

        console.log("Mistral OCR Response received");
        console.log("Raw response type:", typeof ocrResponse);
        console.log("Raw response keys:", Object.keys(ocrResponse || {}));
        console.log("Full response:", JSON.stringify(ocrResponse, null, 2));

        // Extract text from response
        let extractedText = "";

        const respAny = ocrResponse as any;

        console.log("Extracting text from response...");

        if (typeof respAny.text === "string" && respAny.text.length > 0) {
            console.log("Found text property directly");
            extractedText = respAny.text;
        } else if (Array.isArray(respAny.pages)) {
            console.log("Found pages array, length:", respAny.pages.length);

            // Extract markdown from each page
            extractedText = respAny.pages
                .map((p: any) => {
                    // First try to get markdown field
                    if (p.markdown) {
                        console.log("Found markdown field in page");
                        return p.markdown;
                    }
                    // Fallback to lines/paragraphs structure
                    if (Array.isArray(p.lines)) return p.lines.map((l: any) => l.text || '').join('\n');
                    if (Array.isArray(p.paragraphs)) return p.paragraphs.map((par: any) => par.text || '').join('\n');
                    return '';
                })
                .filter(Boolean)
                .join('\n\n');
        } else if (Array.isArray(respAny.blocks)) {
            console.log("Found blocks array, length:", respAny.blocks.length);
            extractedText = respAny.blocks.map((b: any) => b.text || '').filter(Boolean).join('\n');
        } else {
            console.log("No recognized text structure found in response");
        }

        console.log("Extracted text length:", extractedText.length);
        console.log("Extracted text preview:", extractedText.substring(0, 200));

        // Store OCR results if requested
        let storedChunks = 0;
        let phoneNumbersMapped = 0;

        if (shouldStore && extractedText.trim().length > 0) {
            console.log("Storing OCR results to database...");

            // Parse phone numbers (comma-separated)
            const phoneNumberList = phoneNumbers
                ? phoneNumbers.split(",").map(num => num.trim()).filter(Boolean)
                : [];

            // 1) Create file record with 11za credentials
            const { data: fileRow, error: fileError } = await supabase
                .from("rag_files")
                .insert({
                    name: `OCR_${imageFile.name}`,
                    auth_token: authToken,
                    origin: origin,
                })
                .select()
                .single();

            if (fileError) {
                throw fileError;
            }

            fileId = fileRow.id as string;

            // 2) Chunk the extracted text
            const chunks = chunkText(extractedText, 1500).filter((c) => c.trim().length > 0);

            if (chunks.length > 0) {
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
                            pdf_name: `OCR_${imageFile.name}`,
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

                storedChunks = chunks.length;

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
                    } else {
                        phoneNumbersMapped = phoneNumberList.length;
                    }
                }
            }
        }

        return NextResponse.json({
            text: extractedText,
            success: true,
            model: "mistral-ocr-latest",
            stored: shouldStore,
            file_id: fileId,
            chunks: storedChunks,
            phone_numbers_mapped: phoneNumbersMapped,
            rawResponse: ocrResponse,
            debugInfo: {
                responseKeys: Object.keys(ocrResponse || {}),
                responseType: typeof ocrResponse,
                hasText: !!respAny.text,
                hasPages: !!respAny.pages,
                hasBlocks: !!respAny.blocks,
                hasChoices: !!respAny.choices,
            }
        });

    } catch (error) {
        console.error("OCR processing error:", error);

        // Clean up orphaned file rows when chunk insertion fails
        if (fileId) {
            void supabase.from("rag_files").delete().eq("id", fileId);
        }

        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to process image",
                details: error instanceof Error ? error.stack : undefined
            },
            { status: 500 }
        );
    }
}
