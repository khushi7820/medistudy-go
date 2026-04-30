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
    { canonical: "Anatomy (Head & Neck)", aliases: ["head and neck", "head & neck", "h&n", "anatomy head neck"] },
    { canonical: "Physiology", aliases: ["physiology", "physio", "physiology bds"] },
    { canonical: "Biochemistry", aliases: ["biochemistry", "biochem", "bio chem"] },
    { canonical: "Dental Anatomy & Histology", aliases: ["dadh", "dental anatomy", "dental histology", "dental anatomy histology"] },
    { canonical: "Osteology (BDS)", aliases: ["osteology bds", "osteo bds", "bds osteology"] },
    { canonical: "General Anatomy (BDS)", aliases: ["general anatomy bds", "ga bds", "bds general anatomy"] },

    // ─── BDS SECOND YEAR ────────────────────────────────────
    { canonical: "General Pathology", aliases: ["general pathology", "g path", "gpath", "pathology", "patho"] },
    { canonical: "Microbiology", aliases: ["microbiology", "micro", "microbio"] },
    { canonical: "Pharmacology", aliases: ["pharmacology", "pharma", "pharmac", "pharmaco"] },
    { canonical: "Dental Materials", aliases: ["dental materials", "dm", "dental material"] },

    // ─── BDS THIRD YEAR ─────────────────────────────────────
    { canonical: "General Medicine", aliases: ["general medicine", "gen medicine", "gm", "medicine"] },
    { canonical: "General Surgery", aliases: ["general surgery", "gen surgery", "gs", "surgery"] },
    { canonical: "Oral Pathology", aliases: ["oral pathology", "o path", "opath", "oral patho"] },

    // ─── BDS FINAL YEAR ─────────────────────────────────────
    { canonical: "Periodontology", aliases: ["periodontology", "periodontics", "perio"] },
    { canonical: "Orthodontics", aliases: ["orthodontics", "ortho"] },
    { canonical: "Endodontics", aliases: ["endodontics", "endo"] },
    { canonical: "Conservative Dentistry", aliases: ["conservative dentistry", "conservative", "cons"] },
    { canonical: "Oral Surgery", aliases: ["oral surgery", "os"] },
    { canonical: "Prosthodontics", aliases: ["prosthodontics", "prostho", "prosth"] },
    { canonical: "Oral Medicine", aliases: ["oral medicine", "oral med"] },
    { canonical: "Oral Radiology", aliases: ["oral radiology", "oral radio"] },
    { canonical: "Pedodontics", aliases: ["pedodontics", "pedo"] },
    { canonical: "Public Health Dentistry", aliases: ["public health dentistry", "phd", "phd dentistry"] },

    // ─── MBBS FIRST YEAR ────────────────────────────────────
    { canonical: "Upper Limb", aliases: ["upper limb", "ul"] },
    { canonical: "Lower Limb", aliases: ["lower limb", "ll"] },
    { canonical: "Abdomen, Thorax & Pelvis", aliases: ["abdomen", "thorax", "pelvis", "abdomen thorax", "atp"] },
    { canonical: "General Anatomy (MBBS)", aliases: ["general anatomy mbbs", "ga mbbs"] },
    { canonical: "Osteology (MBBS)", aliases: ["osteology mbbs", "osteo mbbs", "osteology"] },
    { canonical: "Neuroanatomy", aliases: ["neuroanatomy", "neuro anatomy", "neuro-anatomy"] },
    { canonical: "Physiology (MBBS)", aliases: ["physiology mbbs", "physio mbbs"] },
    { canonical: "Biochemistry (MBBS)", aliases: ["biochemistry mbbs", "biochem mbbs"] },

    // ─── EXAM PREP ──────────────────────────────────────────
    { canonical: "NEET MDS", aliases: ["neet mds", "neetmds", "mds prep"] },
    { canonical: "NEET MDS Part 1", aliases: ["neet mds part 1", "neet mds 1", "mds part 1"] },
    { canonical: "NEET MDS Part 2", aliases: ["neet mds part 2", "neet mds 2", "mds part 2"] },
    { canonical: "NEET MDS Part 3", aliases: ["neet mds part 3", "neet mds 3", "mds part 3"] },
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