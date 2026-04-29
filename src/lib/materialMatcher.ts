import { MATERIAL_DATABASE, MaterialItem } from "./materialLinks";

/**
 * Normalizes text for better matching (lowercase, removes special chars)
 */
function normalizeText(text: string): string {
    return text.toLowerCase().replace(/[^\w\s]/gi, '').trim();
}

export type MaterialMatchResult = 
    | { isMaterialIntent: false }
    | { isMaterialIntent: true; exactMatch: true; material: MaterialItem }
    | { isMaterialIntent: true; exactMatch: false };

/**
 * Detects if the user is asking for study material and tries to find the exact match.
 */
export function detectMaterialIntent(userMessage: string): MaterialMatchResult {
    const normalizedMessage = normalizeText(userMessage);
    
    // Check if it sounds like a material request
    const intentKeywords = ["pdf", "notes", "material", "link", "drive", "send me", "bhejo", "chahiye"];
    
    // Quick check if any intent keyword is present OR if it directly matches a subject keyword
    let isMaterialIntent = intentKeywords.some(keyword => normalizedMessage.includes(keyword));

    let matchedMaterial: MaterialItem | null = null;
    let longestMatchLength = 0;

    for (const material of MATERIAL_DATABASE) {
        for (const keyword of material.keywords) {
            // We look for whole word matches or significant substrings
            const normalizedKeyword = normalizeText(keyword);
            
            // If the message contains the exact keyword (with boundaries)
            const keywordRegex = new RegExp(`\\b${normalizedKeyword}\\b`, 'i');
            
            if (keywordRegex.test(normalizedMessage)) {
                // If it contains a subject name, it IS a material intent even if no "pdf/notes" keyword was used
                isMaterialIntent = true;
                
                // Keep the most specific (longest) match to avoid "micro" matching when "microbiology" is typed
                if (normalizedKeyword.length > longestMatchLength) {
                    longestMatchLength = normalizedKeyword.length;
                    matchedMaterial = material;
                }
            }
        }
    }

    if (!isMaterialIntent) {
        return { isMaterialIntent: false };
    }

    if (matchedMaterial) {
        return { isMaterialIntent: true, exactMatch: true, material: matchedMaterial };
    }

    return { isMaterialIntent: true, exactMatch: false };
}
