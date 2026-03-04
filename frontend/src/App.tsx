import { Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import GalleryPage from "./pages/GalleryPage";
import UploadPage from "./pages/UploadPage";
import SettingsPage from "./pages/SettingsPage";
import SlideshowPage from "./pages/SlideshowPage";

export default function App() {
  return (
    <Routes>
      <Route path="/slideshow" element={<SlideshowPage />} />
      <Route
        path="*"
        element={
          <div className="min-h-screen bg-ink relative">
            {/* Ambient gallery lighting */}
            <div
              className="fixed inset-0 pointer-events-none overflow-hidden"
              aria-hidden="true"
            >
              <div className="absolute -top-[200px] left-[10%] w-[600px] h-[600px] bg-copper/[0.04] rounded-full blur-[150px]" />
              <div className="absolute bottom-[10%] right-[5%] w-[500px] h-[500px] bg-indigo-400/[0.02] rounded-full blur-[150px]" />
            </div>
            {/* Film grain */}
            <div className="grain-overlay" aria-hidden="true" />
            {/* Content */}
            <div className="relative z-10">
              <Navbar />
              <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
                <Routes>
                  <Route path="/" element={<GalleryPage />} />
                  <Route path="/upload" element={<UploadPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Routes>
              </main>
            </div>
          </div>
        }
      />
    </Routes>
  );
}
