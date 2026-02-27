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
          <div className="min-h-screen bg-gray-50">
            <Navbar />
            <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
              <Routes>
                <Route path="/" element={<GalleryPage />} />
                <Route path="/upload" element={<UploadPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </main>
          </div>
        }
      />
    </Routes>
  );
}
