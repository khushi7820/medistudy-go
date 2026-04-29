"use client";

import { ChangeEvent, useCallback, useEffect, useState } from "react";

type FileItem = {
    id: string;
    name: string;
    chunk_count?: number;
};

type PhoneMapping = {
    id: number;
    phone_number: string;
    file_id: string;
    created_at: string;
};

export default function FilesPage() {
    const [files, setFiles] = useState<FileItem[]>([]);
    const [uploading, setUploading] = useState(false);
    const [phoneNumbers, setPhoneNumbers] = useState("");
    const [authToken, setAuthToken] = useState("");
    const [origin, setOrigin] = useState("");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [editingFileId, setEditingFileId] = useState<string | null>(null);
    const [fileMappings, setFileMappings] = useState<Record<string, PhoneMapping[]>>({});
    const [newPhoneNumber, setNewPhoneNumber] = useState("");

    const loadFiles = useCallback(async () => {
        const res = await fetch("/api/files");
        const data = await res.json();
        setFiles(data.files || []);
    }, []);

    useEffect(() => {
        // Initial load of files on mount
        void loadFiles();
    }, [loadFiles]);

    function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
        }
    }

    async function handleUpload() {
        if (!selectedFile) {
            alert("Please select a file first");
            return;
        }

        if (!authToken.trim() || !origin.trim()) {
            alert("Please provide both 11za Auth Token and Origin");
            return;
        }

        const form = new FormData();
        form.append("file", selectedFile);

        // Add 11za credentials
        form.append("auth_token", authToken.trim());
        form.append("origin", origin.trim());

        // Add phone numbers if provided
        if (phoneNumbers.trim()) {
            form.append("phone_numbers", phoneNumbers.trim());
        }

        setUploading(true);
        try {
            const res = await fetch("/api/process-pdf", { method: "POST", body: form });
            const payload = await res.json();

            if (!res.ok) {
                console.error("Upload failed:", payload?.error);
                alert(payload?.error ?? "Failed to process PDF");
                return;
            }

            alert(`Success! ${payload.chunks} chunks processed${payload.phone_numbers_mapped ? `, mapped to ${payload.phone_numbers_mapped} phone number(s)` : ''}`);

            // Reset form
            setSelectedFile(null);
            setPhoneNumbers("");
            setAuthToken("");
            setOrigin("");

            // Reset file input
            const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
            if (fileInput) fileInput.value = "";

            loadFiles();
        } finally {
            setUploading(false);
        }
    }

    async function deleteFile(id: string) {
        await fetch(`/api/files?id=${id}`, { method: "DELETE" });
        loadFiles();
    }

    async function loadMappingsForFile(fileId: string) {
        const res = await fetch(`/api/phone-mappings?file_id=${fileId}`);
        const data = await res.json();
        if (data.success) {
            setFileMappings(prev => ({ ...prev, [fileId]: data.mappings }));
        }
    }

    async function toggleEditMappings(fileId: string) {
        if (editingFileId === fileId) {
            setEditingFileId(null);
            setNewPhoneNumber("");
        } else {
            setEditingFileId(fileId);
            setNewPhoneNumber("");
            await loadMappingsForFile(fileId);
        }
    }

    async function addPhoneMapping(fileId: string) {
        if (!newPhoneNumber.trim()) {
            alert("Please enter a phone number");
            return;
        }

        const res = await fetch("/api/phone-mappings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                phone_number: newPhoneNumber.trim(),
                file_id: fileId,
            }),
        });

        const data = await res.json();

        if (res.ok) {
            setNewPhoneNumber("");
            await loadMappingsForFile(fileId);
            alert("Phone number added successfully!");
        } else {
            alert(data.error || "Failed to add phone number");
        }
    }

    async function deletePhoneMapping(mappingId: number, fileId: string) {
        if (!confirm("Remove this phone number mapping?")) return;

        const res = await fetch(`/api/phone-mappings?id=${mappingId}`, {
            method: "DELETE",
        });

        if (res.ok) {
            await loadMappingsForFile(fileId);
            alert("Phone number removed successfully!");
        } else {
            alert("Failed to remove phone number");
        }
    }

    return (
        <main className="p-6 max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">Manage PDFs</h1>

            {/* Webhook Instructions */}
            <div className="border rounded-lg p-4 bg-blue-50 border-blue-200 mb-6">
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

            <div className="border rounded-lg p-6 bg-white mb-6">
                <h2 className="text-lg font-semibold mb-4">Upload PDF</h2>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-2">
                            Select PDF File
                        </label>
                        <input
                            type="file"
                            accept=".pdf"
                            onChange={handleFileSelect}
                            className="block w-full text-sm text-gray-500
                                file:mr-4 file:py-2 file:px-4
                                file:rounded-md file:border-0
                                file:text-sm file:font-semibold
                                file:bg-blue-50 file:text-blue-700
                                hover:file:bg-blue-100"
                        />
                        {selectedFile && (
                            <p className="mt-2 text-sm text-gray-600">
                                Selected: {selectedFile.name}
                            </p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">
                            11za Auth Token <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={authToken}
                            onChange={(e) => setAuthToken(e.target.value)}
                            placeholder="Your 11za authentication token"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                            Required: 11za WhatsApp API authentication token
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">
                            11za Origin <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={origin}
                            onChange={(e) => setOrigin(e.target.value)}
                            placeholder="https://example.com/"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                            Required: Origin website URL for 11za API
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">
                            WhatsApp Business Numbers (optional)
                        </label>
                        <input
                            type="text"
                            value={phoneNumbers}
                            onChange={(e) => setPhoneNumbers(e.target.value)}
                            placeholder="15558346206"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                            Enter WhatsApp Business numbers (TO numbers) separated by commas. These are the numbers that will receive messages and use these credentials to respond.
                        </p>
                    </div>

                    <button
                        onClick={handleUpload}
                        disabled={uploading || !selectedFile}
                        className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                        {uploading ? "Processing..." : "Upload & Process"}
                    </button>
                </div>
            </div>

            <h2 className="text-lg font-semibold mb-4">Uploaded Files</h2>
            <ul className="space-y-3">
                {files.map((f) => {
                    const count = f.chunk_count ?? 0;
                    const isEditing = editingFileId === f.id;
                    const mappings = fileMappings[f.id] || [];

                    return (
                        <li key={f.id} className="border rounded-lg bg-white">
                            <div className="p-4 flex justify-between items-center">
                                <div className="flex flex-col">
                                    <span className="font-medium">{f.name}</span>
                                    <span className="text-sm text-gray-500">{count} chunks</span>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded-md"
                                        onClick={() => toggleEditMappings(f.id)}
                                    >
                                        {isEditing ? "Close" : "Manage Numbers"}
                                    </button>
                                    <button
                                        className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded-md"
                                        onClick={() => deleteFile(f.id)}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>

                            {isEditing && (
                                <div className="border-t p-4 bg-gray-50">
                                    <h3 className="font-medium text-sm mb-3">WhatsApp Business Number Mappings</h3>

                                    {mappings.length > 0 ? (
                                        <ul className="space-y-2 mb-4">
                                            {mappings.map((mapping) => (
                                                <li
                                                    key={mapping.id}
                                                    className="flex justify-between items-center bg-white p-2 rounded border"
                                                >
                                                    <span className="text-sm font-mono">{mapping.phone_number}</span>
                                                    <button
                                                        className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded"
                                                        onClick={() => deletePhoneMapping(mapping.id, f.id)}
                                                    >
                                                        Remove
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-sm text-gray-500 mb-4">No business numbers mapped yet.</p>
                                    )}

                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={newPhoneNumber}
                                            onChange={(e) => setNewPhoneNumber(e.target.value)}
                                            placeholder="15558346206"
                                            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <button
                                            onClick={() => addPhoneMapping(f.id)}
                                            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                                        >
                                            Add
                                        </button>
                                    </div>
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </main>
    );
}
