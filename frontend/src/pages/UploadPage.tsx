import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { usePhotos } from "../hooks/usePhotos";

type UploadStatus = "idle" | "uploading" | "done" | "error";

const ACCEPTED = ".jpg,.jpeg,.png,.webp,.heic,.mp4,.mov,.webm";

export default function UploadPage() {
  const { uploadFiles } = usePhotos();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [dragOver, setDragOver] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;

      setStatus("uploading");
      setErrorMsg("");
      try {
        const result = await uploadFiles(fileArray);
        setUploadedCount(result.length);
        setStatus("done");
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Upload failed");
        setStatus("error");
      }
    },
    [uploadFiles],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const reset = () => {
    setStatus("idle");
    setUploadedCount(0);
    setErrorMsg("");
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-8">Upload</h1>

      {status === "done" ? (
        <div className="rounded-2xl bg-white p-12 text-center shadow-sm">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-green-100 mb-4">
            <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {uploadedCount} file{uploadedCount !== 1 ? "s" : ""} uploaded
          </h2>
          <div className="flex justify-center gap-3 mt-6">
            <button
              onClick={reset}
              className="rounded-xl px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Upload more
            </button>
            <Link
              to="/"
              className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
            >
              View Gallery
            </Link>
          </div>
        </div>
      ) : (
        <div
          className={`rounded-2xl border-2 border-dashed bg-white p-12 text-center transition-colors ${
            dragOver
              ? "border-gray-900 bg-gray-50"
              : "border-gray-300 hover:border-gray-400"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {status === "uploading" ? (
            <>
              <div className="inline-flex h-12 w-12 items-center justify-center mb-4">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-gray-900" />
              </div>
              <p className="text-gray-600">Uploading...</p>
            </>
          ) : (
            <>
              <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-gray-600 mb-2">
                Drag and drop photos or videos here
              </p>
              <p className="text-sm text-gray-400 mb-6">
                JPG, PNG, WEBP, MP4, MOV — up to 200MB
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center rounded-xl bg-gray-900 px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-gray-800 transition-colors"
              >
                Choose Files
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleFiles(e.target.files);
                }}
              />
              {status === "error" && (
                <p className="mt-4 text-sm text-red-500">{errorMsg}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
