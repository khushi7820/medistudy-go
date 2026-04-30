// ================================================================
// 🔒 LOCKED materialMatcher.ts — Subject Whitelist Validator
// 🔒 Prevents fuzzy matches like "neurology" → "neuroanatomy"
// 🔒 Returns clear status so autoResponder can tell LLM what to do
// ================================================================

/**
 * APPROVED SUBJECT CATALOG
 * Each entry has:
 * - canonical: the exact subject name to show user
 * - aliases: words/phrases user might type that mean THIS subject
 *
 * ⚠️ Add new subjects here. Never let LLM guess.
 */
const SUBJECT_CATALOG = [
    // ─── BDS FIRST YEAR ─────────────────────────────────────
    { canonical: "PHARMACOLOGY", aliases: ["pharmacy", "pharma", "pharmac", "pharmacology", "pharm"] },

    { canonical: "Product profile for Neuro_com", aliases: ["neuro", "neurology", "neuro material", "neurocom"] },
    { canonical: "Product profile for (Neuroanatomy)", aliases: ["neuroanatomy", "neuro anatomy"] },

    { canonical: "MICRO", aliases: ["micro", "microbio", "microbiology"] },
    { canonical: "BIOCHEMISTRY", aliases: ["biochem", "bio chem", "biochemistry"] },
    { canonical: "PHYSIOLOGY", aliases: ["physio", "physiology"] },

    { canonical: "Anat Bundle", aliases: ["anat", "anatomy", "anat bundle", "anatomy bundle", "full anatomy"] },
    { canonical: "Anat bundle + GA + Osteo", aliases: ["anatomy ga osteo", "anat ga osteo"] },
    { canonical: "HEAD AND NECK", aliases: ["head and neck", "head neck"] },
    { canonical: "OSTEO SAMPLE", aliases: ["osteo", "osteology"] },
    { canonical: "Abdomen Thorax and Pelvis", aliases: ["abdomen", "thorax", "pelvis"] },

    { canonical: "G PATH", aliases: ["g path", "gpath", "general pathology", "pathology", "patho"] },
    { canonical: "G.Path + Micro", aliases: ["path micro", "gpath micro"] },
    { canonical: "Product profile - O path", aliases: ["oral pathology", "opath", "o path"] },

    { canonical: "DM", aliases: ["dm", "dental material", "dental materials"] },
    { canonical: "DADH", aliases: ["dadh", "dental anatomy", "dental histology"] },

    { canonical: "Gen medicine", aliases: ["general medicine", "gen medicine", "gm"] },
    { canonical: "Gen Surgery", aliases: ["general surgery", "gen surgery", "gs"] },

    { canonical: "ENDO", aliases: ["endo", "endodontics"] },
    { canonical: "CONS", aliases: ["cons", "conservative", "conservative dentistry"] },
    { canonical: "PROSTHO", aliases: ["prostho", "prosthodontics"] },
    { canonical: "PERIO", aliases: ["perio", "periodontics"] },
    { canonical: "ORTHO", aliases: ["ortho", "orthodontics"] },
    { canonical: "OS", aliases: ["os", "oral surgery"] },
    { canonical: "oral medicine", aliases: ["oral medicine", "oral med"] },
    { canonical: "ORAL RADIO", aliases: ["oral radio", "oral radiology"] },

    { canonical: "NEET MDS", aliases: ["neet mds", "mds"] },
    { canonical: "First Year BDS", aliases: ["first year bds", "bds first year"] }
];



/**
 * NON-EXISTENT SUBJECTS — explicitly blocked
 * If user asks for these, we DO NOT substitute. We say "not available."
 *
 * This is the fix for the "neurology → neuroanatomy" bug.
 *
 * Note: "radiology" is NOT in this list because we have "Oral Radiology".
 * We block "general radiology" / "diagnostic radiology" instead.
 */
const NOT_IN_CATALOG = [
    "neurology", "neurologist", "cardiology", "cardiologist",
    "dermatology", "dermatologist", "ent specialist",
    "pediatrics", "paediatrics", "pediatrician",
    "gynaecology", "gynecology", "gynaecologist",
    "ophthalmology", "ophthalmologist",
    "psychiatry", "psychiatrist",
    "forensic medicine", "forensic",
    "community medicine", "obg", "obstetrics",
    "general radiology", "diagnostic radiology",
    "oncology", "nephrology", "urology", "pulmonology", "endocrinology",
];

/**
 * Material-request keywords (in English + Hinglish)
 */
const MATERIAL_KEYWORDS = [
    "pdf", "material", "notes", "link", "sample", "source", "file",
    "drive", "study material", "book", "bundle",
    "bhejo", "bhej do", "send", "give", "chahiye", "chaiye", "do",
    "dijiye", "share", "dena", "milega",
];

export type ValidationResult =
    | { status: "MATCHED"; matchedSubject: string; detectedTerm: string }
    | { status: "NOT_IN_CATALOG"; detectedTerm: string }
    | { status: "NO_SUBJECT_DETECTED" }
    | { status: "GENERAL_QUERY" };

/**
 * Main validator. Run BEFORE retrieval.
 *
 * Logic:
 * 1. Check if message looks like a material request
 * 2. If yes, check NOT_IN_CATALOG list FIRST (highest priority)
 * 3. Then check SUBJECT_CATALOG aliases
 * 4. Return clear status
 */
export function validateSubjectRequest(messageText: string): ValidationResult {
    const text = messageText.toLowerCase().trim();

    // Detect if user is asking for material at all
    const isMaterialRequest =
        MATERIAL_KEYWORDS.some(kw => text.includes(kw)) ||
        text.length < 25; // Short messages like "neurology" or "perio" alone

    if (!isMaterialRequest) {
        return { status: "GENERAL_QUERY" };
    }

    // ✅ STEP 1: Check approved catalog FIRST
    // Sort by alias length DESC so "oral radiology" matches before "radiology"
    // and "neuroanatomy" matches before "neuro"
    const allAliases = SUBJECT_CATALOG.flatMap(s =>
        s.aliases.map(a => ({ alias: a, canonical: s.canonical }))
    ).sort((a, b) => b.alias.length - a.alias.length);

    for (const { alias, canonical } of allAliases) {
        const regex = new RegExp(`\\b${alias.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, "i");
        if (regex.test(text)) {
            return {
                status: "MATCHED",
                matchedSubject: canonical,
                detectedTerm: alias,
            };
        }
    }

    // 🔴 STEP 2: Check NOT_IN_CATALOG list AFTER catalog
    // (so legitimate compound subjects like "oral radiology" win first)
    for (const blocked of NOT_IN_CATALOG) {
        const regex = new RegExp(`\\b${blocked}\\b`, "i");
        if (regex.test(text)) {
            return {
                status: "NOT_IN_CATALOG",
                detectedTerm: blocked.charAt(0).toUpperCase() + blocked.slice(1),
            };
        }
    }

    // No subject detected, but it looked like material request
    return { status: "NO_SUBJECT_DETECTED" };
}

/**
 * (Optional) Legacy export — kept for backward compatibility
 * if other files import detectMaterialIntent.
 */
export function detectMaterialIntent(messageText: string): boolean {
    const result = validateSubjectRequest(messageText);
    return result.status === "MATCHED" || result.status === "NOT_IN_CATALOG";
}