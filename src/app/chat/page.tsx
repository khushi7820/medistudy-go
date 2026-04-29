"use client";

import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { v4 as uuid } from "uuid";
import ReactMarkdown from "react-markdown";

type ChatMessage = {
    role: "user" | "assistant";
    content: string;
};

type FileItem = {
    id: string;
    name: string;
};

export default function ChatPage() {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [isSending, setIsSending] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const bottomRef = useRef<HTMLDivElement | null>(null);

    const [files, setFiles] = useState<FileItem[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);

    useEffect(() => {
        async function loadFiles() {
            const res = await fetch("/api/files");
            if (!res.ok) {
                console.error("Failed to load files");
                return;
            }
            const data = await res.json();
            const fetchedFiles: FileItem[] = data.files || [];
            setFiles(fetchedFiles);

            const hadSelection = Boolean(selectedFile);
            let nextSelection = selectedFile;

            if (
                nextSelection &&
                !fetchedFiles.some((f) => f.id === nextSelection)
            ) {
                nextSelection = null;
            }

            if (!hadSelection && !nextSelection && fetchedFiles.length > 0) {
                nextSelection = fetchedFiles[0].id;
            }

            if (nextSelection !== selectedFile) {
                setSelectedFile(nextSelection);
                // Reset chat when file changes
                if (hadSelection) {
                    resetChat();
                }
            }
        }

        loadFiles();
    }, [selectedFile]);


    // Create / load persistent session id
    useEffect(() => {
        let id = localStorage.getItem("chat_session_id");
        if (!id) {
            id = uuid();
            localStorage.setItem("chat_session_id", id);
        }
        setSessionId(id);
    }, []);

    // Load history for this session
    useEffect(() => {
        if (!sessionId) return;

        async function loadHistory() {
            try {
                const res = await fetch(`/api/get-messages?session_id=${sessionId}`);
                if (!res.ok) {
                    console.error("Failed to load history");
                    return;
                }
                const data = await res.json();
                setMessages(data.messages || []);
            } catch (err) {
                console.error("loadHistory error", err);
            }
        }

        loadHistory();
    }, [sessionId]);

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    async function sendMessage() {
        if (!input.trim() || !sessionId || isSending || !selectedFile) return;

        const content = input.trim();
        const userMessage: ChatMessage = { role: "user", content };

        setIsSending(true);
        setInput("");
        setMessages((prev) => [...prev, userMessage]);

        try {
            // Save user message
            await fetch("/api/save-message", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    session_id: sessionId,
                    role: "user",
                    content,
                }),
            });

            // Show thinking indicator
            setIsThinking(true);

            // Call chat API with streaming
            const res = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    session_id: sessionId,
                    message: content,
                    file_id: selectedFile,  // <-- important
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                console.error("Chat error:", data.error);
                setIsThinking(false);
                setMessages((prev) => [
                    ...prev,
                    {
                        role: "assistant",
                        content: "Server error while talking to the model.",
                    },
                ]);
                return;
            }

            // Hide thinking indicator and add streaming message
            setIsThinking(false);

            // Add an empty AI message that we'll update as we stream
            const aiMessageIndex = messages.length + 1;
            setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

            // Handle streaming response
            const reader = res.body?.getReader();
            const decoder = new TextDecoder();
            let fullReply = "";

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    fullReply += chunk;

                    // Update the AI message with accumulated content
                    setMessages((prev) => {
                        const updated = [...prev];
                        updated[aiMessageIndex] = {
                            role: "assistant",
                            content: fullReply,
                        };
                        return updated;
                    });
                }
            }

            // Save AI message
            await fetch("/api/save-message", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    session_id: sessionId,
                    role: "assistant",
                    content: fullReply,
                }),
            });
        } catch (err) {
            console.error("sendMessage error", err);
            setIsThinking(false);
            setMessages((prev) => [
                ...prev,
                {
                    role: "assistant",
                    content: "Something went wrong while sending the message.",
                },
            ]);
        } finally {
            setIsSending(false);
        }
    }

    function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }

    function resetChat() {
        const newSessionId = uuid();
        localStorage.setItem("chat_session_id", newSessionId);
        setSessionId(newSessionId);
        setMessages([]);
    }

    return (
        <main className="p-6 max-w-xl mx-auto space-y-4">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Chat</h1>
                <Button onClick={resetChat} variant="outline" size="sm">
                    New Chat
                </Button>
            </div>

            <div className="mb-3">
                <label className="text-sm font-medium">Select PDF</label>
                <select
                    className="border rounded p-2 w-full"
                    value={selectedFile ?? ""}
                    onChange={(e) => setSelectedFile(e.target.value)}
                >
                    {files.map((f: FileItem) => (
                        <option key={f.id} value={f.id}>
                            {f.name}
                        </option>
                    ))}
                </select>
            </div>

            {!selectedFile ? (
                <div className="p-4 text-center text-gray-600">
                    No PDF selected. Upload one on the /files page.
                </div>
            ) : (
                <>
                    <ScrollArea className="h-[60vh] rounded-md border p-4 bg-white">
                        {messages.map((msg, index) => (
                            <div key={index} className="mb-4">
                                <strong className="text-sm font-semibold">
                                    {msg.role === "user" ? "You" : "AI"}
                                </strong>
                                <div className={`mt-1 ${msg.role === "assistant" ? "prose prose-sm max-w-none" : ""}`}>
                                    {msg.role === "assistant" ? (
                                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                                    ) : (
                                        <p className="text-gray-800">{msg.content}</p>
                                    )}
                                </div>
                            </div>
                        ))}
                        {isThinking && (
                            <div className="mb-4">
                                <strong className="text-sm font-semibold">AI</strong>
                                <div className="mt-1 flex items-center gap-2 text-gray-500">
                                    <div className="flex gap-1">
                                        <span className="animate-bounce inline-block w-2 h-2 bg-gray-400 rounded-full" style={{ animationDelay: '0ms' }}></span>
                                        <span className="animate-bounce inline-block w-2 h-2 bg-gray-400 rounded-full" style={{ animationDelay: '150ms' }}></span>
                                        <span className="animate-bounce inline-block w-2 h-2 bg-gray-400 rounded-full" style={{ animationDelay: '300ms' }}></span>
                                    </div>
                                    <span className="text-sm">Thinking...</span>
                                </div>
                            </div>
                        )}
                        <div ref={bottomRef} />
                    </ScrollArea>

                    <div className="flex gap-2">
                        <Input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Type your message..."
                            disabled={!selectedFile}
                        />
                        <Button
                            onClick={sendMessage}
                            disabled={isSending || !input.trim() || !selectedFile}
                        >
                            Send
                        </Button>
                    </div>
                </>
            )}
        </main>
    );
}
