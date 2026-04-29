export interface MaterialItem {
    name: string;
    keywords: string[];
    link: string;
}

export const MATERIAL_DATABASE: MaterialItem[] = [
    {
        name: "MICROBIOLOGY",
        keywords: ["micro", "microbiology", "mbbs micro", "bds micro", "micro pdf"],
        link: "https://drive.google.com/drive/folders/sample-microbiology-link"
    },
    {
        name: "PHYSIOLOGY",
        keywords: ["physio", "physiology", "mbbs physio", "physio pdf"],
        link: "https://drive.google.com/drive/folders/sample-physiology-link"
    },
    {
        name: "ANATOMY",
        keywords: ["anatomy", "anat", "mbbs anatomy", "anatomy pdf"],
        link: "https://drive.google.com/drive/folders/sample-anatomy-link"
    },
    {
        name: "BIOCHEMISTRY",
        keywords: ["biochem", "biochemistry", "mbbs biochem"],
        link: "https://drive.google.com/drive/folders/sample-biochemistry-link"
    }
];
