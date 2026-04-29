import { extractText, getDocumentProxy } from "unpdf";

export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
    const uint8 = new Uint8Array(buffer);
    const pdf = await getDocumentProxy(uint8);
    const { text } = await extractText(pdf, { mergePages: true });

    // `text` is a single string (since mergePages:true)
    // You can optionally do: textArray when mergePages:false
    return text;
}
