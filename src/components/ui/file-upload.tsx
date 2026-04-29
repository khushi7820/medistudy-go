"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

interface FileUploadProps {
    onFileSelect: (file: File) => void;
    accept?: string;
    maxSize?: number; // in MB
    selectedFile?: File | null;
}

export function FileUpload({ onFileSelect, accept = ".pdf,image/*", maxSize = 10, selectedFile }: FileUploadProps) {
    const [isDragging, setIsDragging] = useState(false);

    const handleDrag = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleDragIn = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            setIsDragging(true);
        }
    }, []);

    const handleDragOut = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];

            // Validate file size
            if (maxSize && file.size > maxSize * 1024 * 1024) {
                alert(`File size must be less than ${maxSize}MB`);
                return;
            }

            // Validate file type
            const fileType = file.type;
            const acceptedTypes = accept.split(',').map(t => t.trim());
            const isValidType = acceptedTypes.some(type => {
                if (type.startsWith('.')) {
                    return file.name.toLowerCase().endsWith(type.toLowerCase());
                }
                if (type.includes('/*')) {
                    const baseType = type.split('/')[0];
                    return fileType.startsWith(baseType + '/');
                }
                return fileType === type;
            });

            if (!isValidType) {
                alert('Invalid file type. Please upload a PDF or image file.');
                return;
            }

            onFileSelect(file);
        }
    }, [accept, maxSize, onFileSelect]);

    const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];

            // Validate file size
            if (maxSize && file.size > maxSize * 1024 * 1024) {
                alert(`File size must be less than ${maxSize}MB`);
                e.target.value = '';
                return;
            }

            onFileSelect(file);
        }
    }, [maxSize, onFileSelect]);

    return (
        <div className="w-full">
            <label
                htmlFor="file-upload"
                onDragEnter={handleDragIn}
                onDragLeave={handleDragOut}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                className={cn(
                    "relative flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-lg cursor-pointer transition-colors",
                    isDragging
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-300 bg-gray-50 hover:bg-gray-100",
                    selectedFile && "border-green-500 bg-green-50"
                )}
            >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    {selectedFile ? (
                        <>
                            <svg
                                className="w-10 h-10 mb-3 text-green-600"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                            </svg>
                            <p className="mb-2 text-sm font-semibold text-green-800">
                                {selectedFile.name}
                            </p>
                            <p className="text-xs text-green-600">
                                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB • {selectedFile.type}
                            </p>
                            <p className="text-xs text-gray-500 mt-2">
                                Click or drag to replace
                            </p>
                        </>
                    ) : isDragging ? (
                        <>
                            <svg
                                className="w-10 h-10 mb-3 text-blue-600 animate-bounce"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                                />
                            </svg>
                            <p className="mb-2 text-sm font-semibold text-blue-800">
                                Drop file here
                            </p>
                        </>
                    ) : (
                        <>
                            <svg
                                className="w-10 h-10 mb-3 text-gray-400"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                                />
                            </svg>
                            <p className="mb-2 text-sm text-gray-600">
                                <span className="font-semibold">Click to upload</span> or drag and drop
                            </p>
                            <p className="text-xs text-gray-500">
                                PDF or Image files (Max {maxSize}MB)
                            </p>
                        </>
                    )}
                </div>
                <input
                    id="file-upload"
                    type="file"
                    className="hidden"
                    accept={accept}
                    onChange={handleFileInput}
                />
            </label>
        </div>
    );
}
