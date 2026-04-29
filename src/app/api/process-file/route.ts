import { NextResponse } from "next/server";
import { extractPdfText } from "@/lib/pdf";
import { chunkText } from "@/lib/chunk";
import { embedText } from "@/lib/embeddings";
import { supabase } from "@/lib/supabaseClient";
import { Mistral } from '@mistralai/mistralai';

export const runtime = "nodejs";

const mistralApiKey = process.env.MISTRAL_API_KEY;

export async function POST(req: Request) {
    let fileId: string | null = null;

    try {
        const form = await req.formData();
        const file = form.get("file") as File | null;
        const phoneNumber = form.get("phone_number") as string | null;
        const intent = form.get("intent") as string | null;
        const authToken = form.get("auth_token") as string | null;
        const origin = form.get("origin") as string | null;
        const devMode = form.get("dev_mode") === "true";
        const processingMode = form.get("processing_mode") as "ocr" | "transcribe";

        if (!file) {
            return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
        }

        if (!phoneNumber) {
            return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
        }

        if (!authToken || !origin) {
            return NextResponse.json({
                error: "11za auth_token and origin are required"
            }, { status: 400 });
        }

        const buffer = await file.arrayBuffer();
        const fileName = file.name;
        const fileType = file.type;

        // Determine file type (PDF or Image)
        let extractedText = "";
        let detectedFileType = "pdf";

        if (fileType === "application/pdf") {
            console.log("Processing PDF file:", fileName);
            detectedFileType = "pdf";
            extractedText = await extractPdfText(buffer);
        } else if (fileType.startsWith("image/")) {
            console.log("Processing image file:", fileName);
            detectedFileType = "image";

            if (!mistralApiKey) {
                return NextResponse.json({
                    error: "Mistral API key is not configured for image processing"
                }, { status: 500 });
            }

            const base64Image = Buffer.from(buffer).toString('base64');
            const dataUrl = `data:${fileType};base64,${base64Image}`;

            if (processingMode === "ocr") {
                // Use Mistral OCR API
                const client = new Mistral({ apiKey: mistralApiKey });

                const ocrResponse = await client.ocr.process({
                    model: "mistral-ocr-latest",
                    document: {
                        type: "image_url",
                        imageUrl: dataUrl,
                    },
                    includeImageBase64: true
                });

                const respAny = ocrResponse as any;

                if (typeof respAny.text === "string" && respAny.text.length > 0) {
                    extractedText = respAny.text;
                } else if (Array.isArray(respAny.pages)) {
                    extractedText = respAny.pages
                        .map((p: any) => {
                            if (p.markdown) return p.markdown;
                            if (Array.isArray(p.lines)) return p.lines.map((l: any) => l.text || '').join('\n');
                            if (Array.isArray(p.paragraphs)) return p.paragraphs.map((par: any) => par.text || '').join('\n');
                            return '';
                        })
                        .filter(Boolean)
                        .join('\n\n');
                } else if (Array.isArray(respAny.blocks)) {
                    extractedText = respAny.blocks.map((b: any) => b.text || '').filter(Boolean).join('\n');
                }
            } else {
                // Use Pixtral vision model
                const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${mistralApiKey}`,
                    },
                    body: JSON.stringify({
                        model: "pixtral-12b-2409",
                        messages: [
                            {
                                role: "user",
                                content: [
                                    {
                                        type: "text",
                                        text: "Extract all text from this image. Provide the text as it appears, maintaining the structure and formatting where possible."
                                    },
                                    {
                                        type: "image_url",
                                        image_url: {
                                            url: dataUrl
                                        }
                                    }
                                ]
                            }
                        ]
                    })
                });

                if (!response.ok) {
                    throw new Error(`Mistral API error: ${response.statusText}`);
                }

                const chatResponse = await response.json();
                extractedText = chatResponse.choices[0].message.content || "";
            }
        } else {
            return NextResponse.json({
                error: "Unsupported file type. Please upload a PDF or image file."
            }, { status: 400 });
        }

        // 1) Create file record with 11za credentials and file type
        const { data: fileRow, error: fileError } = await supabase
            .from("rag_files")
            .insert({
                name: fileName,
                file_type: detectedFileType,
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
        const chunks = chunkText(extractedText, 1500).filter((c) => c.trim().length > 0);

        if (chunks.length === 0) {
            throw new Error("No text chunks produced from file");
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
                    pdf_name: fileName,
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

        // 5) Check if phone number mapping already exists
        const { data: existingMappings } = await supabase
            .from("phone_document_mapping")
            .select("*")
            .eq("phone_number", phoneNumber);

        // Check if there's a mapping without a file_id (created via generate-system-prompt)
        const placeholderMapping = existingMappings?.find(m => m.file_id === null);

        if (placeholderMapping) {
            // Update the existing placeholder mapping with the file_id and credentials
            const { error: mappingError } = await supabase
                .from("phone_document_mapping")
                .update({
                    file_id: fileId,
                    intent: intent || placeholderMapping.intent,
                    auth_token: authToken,
                    origin: origin,
                })
                .eq("id", placeholderMapping.id);

            if (mappingError) {
                throw mappingError;
            }
        } else if (existingMappings && existingMappings.length > 0) {
            // Add new file to existing phone number (create additional mapping)
            const { error: mappingError } = await supabase
                .from("phone_document_mapping")
                .insert({
                    phone_number: phoneNumber,
                    file_id: fileId,
                    intent: intent || existingMappings[0].intent,
                    system_prompt: existingMappings[0].system_prompt,
                    auth_token: authToken,
                    origin: origin,
                });

            if (mappingError) {
                throw mappingError;
            }
        } else {
            // Create new phone number mapping with intent and credentials
            const { error: mappingError } = await supabase
                .from("phone_document_mapping")
                .insert({
                    phone_number: phoneNumber,
                    file_id: fileId,
                    intent: intent || null,
                    auth_token: authToken,
                    origin: origin,
                });

            if (mappingError) {
                throw mappingError;
            }
        }

        return NextResponse.json({
            message: "File processed successfully",
            file_id: fileId,
            file_type: detectedFileType,
            chunks: chunks.length,
            phone_number: phoneNumber,
            ...(devMode && { extractedText, processingMode }),
        });
    } catch (err: unknown) {
        console.error("PROCESS_FILE_ERROR:", err);
        if (err && typeof err === "object") {
            console.error("PROCESS_FILE_ERROR_DETAIL:", JSON.stringify(err));
        }

        // Clean up orphaned file rows when chunk insertion fails
        if (fileId) {
            void supabase.from("rag_files").delete().eq("id", fileId);
        }

        const message = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
