export default function UploadPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-8">Upload</h1>
      <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white p-12 text-center hover:border-gray-400 transition-colors">
        <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p className="text-gray-600 mb-2">Drag and drop photos or videos here</p>
        <p className="text-sm text-gray-400">JPG, PNG, WEBP, MP4, MOV — up to 200MB</p>
        <button className="mt-6 inline-flex items-center rounded-xl bg-gray-900 px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-gray-800 transition-colors">
          Choose Files
        </button>
      </div>
    </div>
  );
}
