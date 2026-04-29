import { Button } from "@/components/ui/button";

export default function HomePage() {
    return (
        <main className="min-h-screen flex items-center justify-center">
            <div className="space-y-4">
                <h1 className="text-2xl font-bold">RAG Chatbot Starter</h1>
                <Button>Test Shadcn Button</Button>
            </div>
        </main>
    );
}
