import { Link } from "react-router-dom";

export default function SlideshowPage() {
  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      <div className="text-center">
        <p className="text-white/60 text-lg mb-4">No photos to display</p>
        <Link
          to="/upload"
          className="text-white/80 hover:text-white text-sm underline underline-offset-4 transition-colors"
        >
          Upload photos to start slideshow
        </Link>
      </div>
    </div>
  );
}
