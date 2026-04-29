"use client";

import { useCallback, useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileUpload } from "@/components/ui/file-upload";
import { Switch } from "@/components/ui/switch";

type FileItem = {
    id: string;
    name: string;
    file_type: string;
    chunk_count?: number;
    created_at: string;
};

type PhoneNumberGroup = {
    phone_number: string;
    intent: string | null;
    system_prompt: string | null;
    files: FileItem[];
    auth_token: string;
    origin: string;
};

export default function FilesPage() {
    const [phoneGroups, setPhoneGroups] = useState<PhoneNumberGroup[]>([]);
    const [uploading, setUploading] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [generatingPrompt, setGeneratingPrompt] = useState(false);

    // Selected phone number in the left panel
    const [selectedPhoneNumber, setSelectedPhoneNumber] = useState<string | null>(null);

    // Edit form state
    const [editPhoneNumber, setEditPhoneNumber] = useState("");
    const [editIntent, setEditIntent] = useState("");
    const [editAuthToken, setEditAuthToken] = useState("");
    const [editOrigin, setEditOrigin] = useState("");
    const [editSystemPrompt, setEditSystemPrompt] = useState("");
    const [isNewPhone, setIsNewPhone] = useState(false);
    const [savingSettings, setSavingSettings] = useState(false);

    // Dev mode state
    const [devMode, setDevMode] = useState(false);
    const [processingMode, setProcessingMode] = useState<"ocr" | "transcribe">("transcribe");
    const [devInfo, setDevInfo] = useState<{ extractedText?: string, chunks?: number, mode?: string } | null>(null);

    const loadPhoneGroups = useCallback(async () => {
        const res = await fetch("/api/phone-groups");
        const data = await res.json();
        if (data.success) {
            setPhoneGroups(data.groups || []);
        }
    }, []);

    useEffect(() => {
        void loadPhoneGroups();
    }, [loadPhoneGroups]);

    // When a phone number is selected, populate the edit form
    useEffect(() => {
        if (selectedPhoneNumber) {
            const group = phoneGroups.find(g => g.phone_number === selectedPhoneNumber);
            if (group) {
                setEditPhoneNumber(group.phone_number);
                setEditIntent(group.intent || "");
                setEditAuthToken(group.auth_token || "");
                setEditOrigin(group.origin || "");
                setEditSystemPrompt(group.system_prompt || "");
                setIsNewPhone(false);
            }
        }
    }, [selectedPhoneNumber, phoneGroups]);

    function handleFileSelect(file: File) {
        setSelectedFile(file);
    }

    function handleNewPhone() {
        setSelectedPhoneNumber(null);
        setEditPhoneNumber("");
        setEditIntent("");
        setEditAuthToken("");
        setEditOrigin("");
        setEditSystemPrompt("");
        setSelectedFile(null);
        setIsNewPhone(true);
    }

    async function generateSystemPrompt() {
        if (!editIntent.trim() || !editPhoneNumber.trim()) {
            alert("Please provide both phone number and intent");
            return;
        }

        setGeneratingPrompt(true);
        try {
            const res = await fetch("/api/generate-system-prompt", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    intent: editIntent.trim(),
                    phone_number: editPhoneNumber.trim(),
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Failed to generate system prompt");
            }

            // Update the displayed system prompt immediately
            setEditSystemPrompt(data.system_prompt);
            setEditIntent(data.intent);

            alert("System prompt generated and saved successfully!");
            await loadPhoneGroups();

            // If this was a new phone, select it
            if (isNewPhone) {
                setSelectedPhoneNumber(editPhoneNumber.trim());
                setIsNewPhone(false);
            }
        } catch (err) {
            console.error("Error generating system prompt:", err);
            alert(err instanceof Error ? err.message : "Failed to generate system prompt");
        } finally {
            setGeneratingPrompt(false);
        }
    }

    async function handleUpload() {
        if (!selectedFile) {
            alert("Please select a file first");
            return;
        }

        if (!editPhoneNumber.trim()) {
            alert("Please provide a phone number");
            return;
        }

        if (!editAuthToken.trim() || !editOrigin.trim()) {
            alert("Please provide both 11za Auth Token and Origin");
            return;
        }

        const form = new FormData();
        form.append("file", selectedFile);
        form.append("phone_number", editPhoneNumber.trim());
        form.append("auth_token", editAuthToken.trim());
        form.append("origin", editOrigin.trim());
        form.append("dev_mode", devMode.toString());
        form.append("processing_mode", processingMode);

        if (editIntent.trim()) {
            form.append("intent", editIntent.trim());
        }

        setUploading(true);
        try {
            const res = await fetch("/api/process-file", { method: "POST", body: form });
            const payload = await res.json();

            if (!res.ok) {
                console.error("Upload failed:", payload?.error);
                alert(payload?.error ?? "Failed to process file");
                return;
            }

            alert(`Success! ${payload.chunks} chunks processed for ${payload.file_type} file`);

            // Reset file selection
            setSelectedFile(null);

            // Set dev info if dev mode
            if (devMode) {
                setDevInfo({
                    extractedText: payload.extractedText,
                    chunks: payload.chunks,
                    mode: payload.processingMode
                });
            }

            await loadPhoneGroups();

            // Select the phone number that was just uploaded to
            setSelectedPhoneNumber(editPhoneNumber.trim());
            setIsNewPhone(false);
        } finally {
            setUploading(false);
        }
    }

    async function deleteFile(fileId: string) {
        if (!confirm("Delete this file and all its chunks?")) return;

        await fetch(`/api/files?id=${fileId}`, { method: "DELETE" });
        await loadPhoneGroups();
    }

    async function deletePhoneNumber(phoneNum: string) {
        if (!confirm("Delete this phone number and all associated files?")) return;

        const res = await fetch(`/api/phone-mappings?phone_number=${phoneNum}`, {
            method: "DELETE",
        });

        if (res.ok) {
            alert("Phone number deleted successfully!");
            setSelectedPhoneNumber(null);
            setEditPhoneNumber("");
            setEditIntent("");
            setEditAuthToken("");
            setEditOrigin("");
            setEditSystemPrompt("");
            await loadPhoneGroups();
        } else {
            alert("Failed to delete phone number");
        }
    }

    async function savePhoneSettings() {
        if (!editPhoneNumber.trim()) {
            alert("Phone number is required");
            return;
        }

        setSavingSettings(true);
        try {
            const res = await fetch("/api/update-phone-settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    phone_number: editPhoneNumber.trim(),
                    intent: editIntent.trim() || null,
                    system_prompt: editSystemPrompt.trim() || null,
                    auth_token: editAuthToken.trim() || null,
                    origin: editOrigin.trim() || null,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Failed to save settings");
            }

            alert("Settings saved successfully!");
            await loadPhoneGroups();
        } catch (err) {
            console.error("Error saving settings:", err);
            alert(err instanceof Error ? err.message : "Failed to save settings");
        } finally {
            setSavingSettings(false);
        }
    }

    const selectedGroup = phoneGroups.find(g => g.phone_number === selectedPhoneNumber);

    return (
        <main className="flex h-screen">
            {/* LEFT PANEL - Phone Numbers List */}
            <div className="w-80 border-r bg-gray-50 overflow-y-auto">
                <div className="p-4 border-b bg-white sticky top-0 z-10">
                    <h1 className="text-xl font-bold mb-2">Phone Numbers</h1>
                    <button
                        onClick={handleNewPhone}
                        className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
                    >
                        + New Phone Number
                    </button>
                </div>

                <div className="p-2">
                    {phoneGroups.map((group) => (
                        <div
                            key={group.phone_number}
                            onClick={() => setSelectedPhoneNumber(group.phone_number)}
                            className={`p-3 mb-2 rounded-lg cursor-pointer border transition-colors ${selectedPhoneNumber === group.phone_number
                                ? "bg-blue-100 border-blue-400"
                                : "bg-white border-gray-200 hover:bg-gray-50"
                                }`}
                        >
                            <div className="font-mono font-semibold text-sm">{group.phone_number}</div>
                            {group.intent && (
                                <div className="text-xs text-gray-600 mt-1 line-clamp-1">
                                    {group.intent}
                                </div>
                            )}
                            <div className="flex gap-2 mt-2">
                                <span className="text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded">
                                    {group.files.length} files
                                </span>
                            </div>
                        </div>
                    ))}

                    {phoneGroups.length === 0 && (
                        <div className="text-center py-12 text-gray-500 text-sm">
                            <p>No phone numbers yet.</p>
                            <p>Click "+ New Phone Number" to start.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* RIGHT PANEL - Tabs */}
            <div className="flex-1 overflow-y-auto">
                <div className="p-6 max-w-4xl mx-auto">
                    {(selectedPhoneNumber || isNewPhone) ? (
                        <>
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-2xl font-bold">
                                    {isNewPhone ? "New Phone Number" : selectedPhoneNumber}
                                </h2>
                                {selectedPhoneNumber && (
                                    <button
                                        onClick={() => deletePhoneNumber(selectedPhoneNumber)}
                                        className="px-4 py-2 text-sm text-red-600 border border-red-600 rounded-md hover:bg-red-50"
                                    >
                                        Delete Phone Number
                                    </button>
                                )}
                            </div>

                            <Tabs defaultValue="configuration" className="w-full">
                                <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="configuration">Configuration</TabsTrigger>
                                    <TabsTrigger value="files">Files</TabsTrigger>
                                </TabsList>

                                {/* CONFIGURATION TAB */}
                                <TabsContent value="configuration" className="space-y-6 mt-6">
                                    {/* Phone Number */}
                                    <div>
                                        <label className="block text-sm font-medium mb-2">
                                            WhatsApp Business Number <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={editPhoneNumber}
                                            onChange={(e) => setEditPhoneNumber(e.target.value)}
                                            placeholder="15558346206"
                                            disabled={!isNewPhone}
                                            className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isNewPhone ? "bg-gray-100 cursor-not-allowed" : ""
                                                }`}
                                        />
                                    </div>

                                    {/* Intent */}
                                    <div>
                                        <label className="block text-sm font-medium mb-2">
                                            Intent/Purpose
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={editIntent}
                                                onChange={(e) => setEditIntent(e.target.value)}
                                                placeholder="E.g., Booking chatbot for restaurant reservations"
                                                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                            <button
                                                onClick={generateSystemPrompt}
                                                disabled={generatingPrompt || !editIntent.trim() || !editPhoneNumber.trim()}
                                                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm whitespace-nowrap"
                                            >
                                                {generatingPrompt ? "Generating..." : "Generate Prompt"}
                                            </button>
                                        </div>
                                        <p className="mt-1 text-xs text-gray-500">
                                            Describe the chatbot's purpose. Click "Generate Prompt" to create a system prompt using AI.
                                        </p>
                                    </div>

                                    {/* System Prompt - Editable */}
                                    {editSystemPrompt && (
                                        <div>
                                            <label className="block text-sm font-medium mb-2">
                                                System Prompt (Editable)
                                            </label>
                                            <textarea
                                                value={editSystemPrompt}
                                                onChange={(e) => setEditSystemPrompt(e.target.value)}
                                                rows={8}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                                placeholder="System prompt for the chatbot..."
                                            />
                                            <p className="mt-1 text-xs text-gray-500">
                                                Edit the system prompt to customize how the chatbot responds.
                                            </p>
                                        </div>
                                    )}

                                    {/* 11za Credentials */}
                                    <div className="border-t pt-6">
                                        <h3 className="text-lg font-semibold mb-4">11za Credentials</h3>

                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-sm font-medium mb-2">
                                                    Auth Token <span className="text-red-500">*</span>
                                                </label>
                                                <input
                                                    type="text"
                                                    value={editAuthToken}
                                                    onChange={(e) => setEditAuthToken(e.target.value)}
                                                    placeholder="Your 11za authentication token"
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium mb-2">
                                                    Origin <span className="text-red-500">*</span>
                                                </label>
                                                <input
                                                    type="text"
                                                    value={editOrigin}
                                                    onChange={(e) => setEditOrigin(e.target.value)}
                                                    placeholder="https://example.com/"
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                            </div>

                                            {/* Save Settings Button */}
                                            <button
                                                onClick={savePhoneSettings}
                                                disabled={savingSettings || isNewPhone}
                                                className="w-full px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
                                            >
                                                {savingSettings ? "Saving..." : "Save Configuration"}
                                            </button>
                                            {isNewPhone && (
                                                <p className="text-xs text-gray-500 text-center">
                                                    Generate a system prompt first to create the phone number
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </TabsContent>

                                {/* FILES TAB */}
                                <TabsContent value="files" className="space-y-6 mt-6">
                                    {/* Webhook Info */}
                                    <div className="border rounded-lg p-4 bg-blue-50 border-blue-200">
                                        <h3 className="text-sm font-semibold text-blue-900 mb-2">11za Webhook Configuration</h3>
                                        <p className="text-xs text-blue-800 mb-2">
                                            Configure this webhook URL in your 11za WhatsApp settings:
                                        </p>
                                        <div className="flex items-center gap-2 bg-white p-2 rounded border border-blue-300">
                                            <code className="text-xs font-mono text-blue-900 flex-1">
                                                https://rag-chatbot-ochre.vercel.app/api/webhook/whatsapp
                                            </code>
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText("https://rag-chatbot-ochre.vercel.app/api/webhook/whatsapp");
                                                    alert("Webhook URL copied to clipboard!");
                                                }}
                                                className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                                            >
                                                Copy
                                            </button>
                                        </div>
                                    </div>

                                    {/* File Upload Section */}
                                    <div className="border rounded-lg p-6 bg-white">
                                        <div className="flex justify-between items-center mb-4">
                                            <h3 className="text-lg font-semibold">Upload New File</h3>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-medium text-gray-700">Dev Mode</span>
                                                <Switch checked={devMode} onCheckedChange={setDevMode} />
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <FileUpload
                                                onFileSelect={handleFileSelect}
                                                accept=".pdf,image/*"
                                                maxSize={50}
                                                selectedFile={selectedFile}
                                            />

                                            {devMode && selectedFile && selectedFile.type.startsWith("image/") && (
                                                <div className="border rounded-lg p-4 bg-gray-50">
                                                    <h4 className="text-sm font-medium mb-3">Processing Mode</h4>
                                                    <div className="flex gap-4">
                                                        <label className="flex items-center gap-2 cursor-pointer">
                                                            <input
                                                                type="radio"
                                                                name="processingMode"
                                                                value="ocr"
                                                                checked={processingMode === "ocr"}
                                                                onChange={(e) => setProcessingMode(e.target.value as "ocr")}
                                                                className="w-4 h-4 text-blue-600"
                                                            />
                                                            <span className="text-sm">OCR (Mistral OCR)</span>
                                                        </label>
                                                        <label className="flex items-center gap-2 cursor-pointer">
                                                            <input
                                                                type="radio"
                                                                name="processingMode"
                                                                value="transcribe"
                                                                checked={processingMode === "transcribe"}
                                                                onChange={(e) => setProcessingMode(e.target.value as "transcribe")}
                                                                className="w-4 h-4 text-blue-600"
                                                            />
                                                            <span className="text-sm">Transcribe (Pixtral Vision)</span>
                                                        </label>
                                                    </div>
                                                </div>
                                            )}

                                            <button
                                                onClick={handleUpload}
                                                disabled={uploading || !selectedFile || !editPhoneNumber.trim() || !editAuthToken.trim() || !editOrigin.trim()}
                                                className="w-full px-4 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
                                            >
                                                {uploading ? "Processing..." : "Upload & Process File"}
                                            </button>

                                            {(!editAuthToken.trim() || !editOrigin.trim()) && !isNewPhone && (
                                                <p className="text-xs text-amber-600 text-center">
                                                    Please set credentials in the Configuration tab before uploading files
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Dev Info Display */}
                                    {devInfo && (
                                        <div className="border rounded-lg p-6 bg-gray-50">
                                            <h3 className="text-lg font-semibold mb-4">Dev Mode: Parsed Content</h3>
                                            <div className="space-y-4">
                                                <div>
                                                    <h4 className="text-sm font-medium text-gray-700 mb-2">Extracted Text:</h4>
                                                    <div className="bg-white p-4 rounded border max-h-96 overflow-y-auto">
                                                        <pre className="text-xs text-gray-800 whitespace-pre-wrap">{devInfo.extractedText}</pre>
                                                    </div>
                                                </div>
                                                <div>
                                                    <h4 className="text-sm font-medium text-gray-700 mb-2">Processing Info:</h4>
                                                    <p className="text-sm text-gray-600">Mode: {devInfo.mode === "ocr" ? "OCR (Mistral OCR)" : "Transcribe (Pixtral Vision)"}</p>
                                                    <p className="text-sm text-gray-600">Chunks created: {devInfo.chunks}</p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Files List */}
                                    {selectedGroup && selectedGroup.files.length > 0 && (
                                        <div>
                                            <h3 className="text-lg font-semibold mb-4">
                                                Uploaded Files ({selectedGroup.files.length})
                                            </h3>

                                            <div className="space-y-2">
                                                {selectedGroup.files.map((file) => (
                                                    <div
                                                        key={file.id}
                                                        className="flex justify-between items-center p-4 border rounded-lg bg-white hover:bg-gray-50 transition-colors"
                                                    >
                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-medium text-sm">{file.name}</span>
                                                                <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded">
                                                                    {file.file_type}
                                                                </span>
                                                            </div>
                                                            <p className="text-xs text-gray-500 mt-1">
                                                                {file.chunk_count || 0} chunks • {new Date(file.created_at).toLocaleDateString()}
                                                            </p>
                                                        </div>
                                                        <button
                                                            onClick={() => deleteFile(file.id)}
                                                            className="px-3 py-1.5 text-sm text-red-600 border border-red-300 rounded hover:bg-red-50"
                                                        >
                                                            Delete
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {(!selectedGroup || selectedGroup.files.length === 0) && (
                                        <div className="text-center py-12 text-gray-500">
                                            <p>No files uploaded yet.</p>
                                            <p className="text-sm mt-2">Upload your first PDF or image file above.</p>
                                        </div>
                                    )}
                                </TabsContent>
                            </Tabs>
                        </>
                    ) : (
                        <div className="flex items-center justify-center h-96 text-gray-500">
                            <div className="text-center">
                                <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                <p className="text-lg">Select a phone number from the left</p>
                                <p className="text-sm mt-2">or click "+ New Phone Number" to create one</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}
