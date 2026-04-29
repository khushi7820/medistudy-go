import { Mistral } from "@mistralai/mistralai";

const client = new Mistral({
    apiKey: process.env.MISTRAL_API_KEY!,
});

export async function embedText(text: string, retries = 3): Promise<number[]> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await client.embeddings.create({
                model: "mistral-embed", // consistent with docs
                inputs: [text],
            });

            const embedding = response.data[0]?.embedding;
            if (!embedding || !Array.isArray(embedding)) {
                throw new Error("Invalid embedding response from API");
            }

            return embedding; // array of 1024 floats
        } catch (error: unknown) {
            const isRateLimitError =
                error &&
                typeof error === "object" &&
                "statusCode" in error &&
                error.statusCode === 429;

            if (isRateLimitError && attempt < retries) {
                // Exponential backoff: wait 2^attempt seconds
                const waitTime = Math.pow(2, attempt) * 1000;
                console.log(
                    `Rate limit hit. Retrying in ${waitTime / 1000}s (attempt ${attempt + 1}/${retries})...`
                );
                await new Promise((resolve) => setTimeout(resolve, waitTime));
                continue;
            }

            // Re-throw if not a rate limit error or out of retries
            throw error;
        }
    }

    throw new Error("Failed to generate embedding after retries");
}
