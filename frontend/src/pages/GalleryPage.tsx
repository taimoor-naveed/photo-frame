import { Link } from "react-router-dom";

export default function GalleryPage() {
  return (
    <div className="text-center py-20">
      <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-gray-100 mb-6">
        <svg className="h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
      <h2 className="text-2xl font-semibold text-gray-900 mb-2">No photos yet</h2>
      <p className="text-gray-500 mb-8 max-w-sm mx-auto">
        Upload your first photos to get started with your photo frame.
      </p>
      <Link
        to="/upload"
        className="inline-flex items-center rounded-xl bg-gray-900 px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-gray-800 transition-colors"
      >
        Upload Photos
      </Link>
    </div>
  );
}
