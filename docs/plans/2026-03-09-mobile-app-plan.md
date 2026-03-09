# Mobile App (Capacitor) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wrap the existing React frontend in Capacitor for iOS/Android, adding Live Photo video extraction (iOS native + Android server-side Motion Photo detection) and share sheet integration.

**Architecture:** Capacitor wraps the Vite build output in a native WebView. All existing React code runs unchanged. A custom iOS Swift plugin extracts the MOV component from iOS Live Photos. For Android Motion Photos (Google Pixel, Samsung), the backend detects embedded video in uploaded JPEGs via XMP metadata and extracts it server-side — no native Android plugin needed. The API base URL becomes configurable via `VITE_SERVER_BASE` env var (defaults to empty for web, set to `http://home-pc` for mobile builds). A connectivity guard blocks the app when the server is unreachable.

**Tech Stack:** Capacitor 6, Swift (iOS plugin), Python (server-side Motion Photo extraction), existing React/TypeScript/Vite/Tailwind stack.

---

## Phase 1: Capacitor Setup & Base URL Configuration

### Task 1: Make API base URL configurable

The API client and asset URL helpers use hardcoded relative paths (`/api`, `/uploads/...`). These need to resolve to `http://home-pc` in mobile builds.

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/hooks/useWebSocket.ts`
- Modify: `frontend/src/vite-env.d.ts`

**Step 1: Update `client.ts` to use env var for base URL**

```typescript
// frontend/src/api/client.ts — top of file
const SERVER_BASE = import.meta.env.VITE_SERVER_BASE || "";
const API_BASE = `${SERVER_BASE}/api`;
```

Update all asset URL helpers to prepend `SERVER_BASE`:

```typescript
export function thumbnailUrl(media: Media): string {
  return `${SERVER_BASE}/uploads/thumbnails/${media.thumb_filename}`;
}

export function originalUrl(media: Media): string {
  if (media.media_type === "video" && media.transcoded_filename) {
    return `${SERVER_BASE}/uploads/transcoded/${media.transcoded_filename}`;
  }
  return `${SERVER_BASE}/uploads/originals/${media.filename}`;
}

export function displayUrl(media: Media): string {
  if (media.display_filename) {
    if (media.media_type === "video" && media.transcoded_filename === media.display_filename) {
      return `${SERVER_BASE}/uploads/transcoded/${media.display_filename}`;
    }
    return `${SERVER_BASE}/uploads/display/${media.display_filename}`;
  }
  return originalUrl(media);
}
```

**Step 2: Update `useWebSocket.ts` to use env var**

```typescript
// In connect():
const serverBase = import.meta.env.VITE_SERVER_BASE || "";
let wsUrl: string;
if (serverBase) {
  // Mobile: absolute URL — convert http(s) to ws(s)
  const base = serverBase.replace(/^http/, "ws");
  wsUrl = `${base}/ws`;
} else {
  // Web: relative URL from current host
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  wsUrl = `${protocol}//${window.location.host}/ws`;
}
const ws = new WebSocket(wsUrl);
```

**Step 3: Add type declaration for env var**

```typescript
// frontend/src/vite-env.d.ts — add to ImportMetaEnv
interface ImportMetaEnv {
  readonly VITE_SERVER_BASE?: string;
}
```

**Step 4: Verify web build still works**

Run: `docker compose exec frontend npm run build`
Expected: Build succeeds, no env var set = empty string = same relative URLs as before.

**Step 5: Commit**

```
feat: make API/asset/WS base URL configurable via VITE_SERVER_BASE
```

---

### Task 2: Initialize Capacitor in the frontend project

**Files:**
- Create: `frontend/capacitor.config.ts`
- Modify: `frontend/package.json` (new deps)
- Create: `frontend/.gitignore` additions for native dirs

**Step 1: Install Capacitor (run in frontend container or locally)**

Note: Capacitor CLI and native project setup must run on the Mac host (not Docker), because `npx cap add ios` generates an Xcode project. Docker doesn't have Xcode.

```bash
cd frontend
npm install @capacitor/core @capacitor/cli --save
```

**Step 2: Initialize Capacitor**

```bash
cd frontend
npx cap init "Photo Frame" com.flexoptix.photoframe --web-dir dist
```

This creates `capacitor.config.ts`.

**Step 3: Configure Capacitor**

```typescript
// frontend/capacitor.config.ts
import type { CapacitorConfig } from "@capacitor/core";

const config: CapacitorConfig = {
  appId: "com.flexoptix.photoframe",
  appName: "Photo Frame",
  webDir: "dist",
  server: {
    // During development, point to Vite dev server on local network:
    // url: "http://192.168.x.x:5173",
    // For production builds, comment out url — Capacitor serves from dist/
  },
};

export default config;
```

**Step 4: Build the web app and add iOS platform**

```bash
cd frontend
npm run build  # or: VITE_SERVER_BASE=http://home-pc npx vite build
npx cap add ios
npx cap add android
```

**Step 5: Add native dirs to .gitignore (optional — large generated dirs)**

Decide: track `ios/` and `android/` in git or not. Recommendation: track them (they contain config like Info.plist, entitlements, share extension code that must be version-controlled).

**Step 6: Sync and open**

```bash
npx cap sync
npx cap open ios      # Opens Xcode
npx cap open android  # Opens Android Studio
```

**Step 7: Commit**

```
feat: initialize Capacitor for iOS and Android
```

---

## Phase 2: Connectivity Guard

### Task 3: Add connectivity check on app launch

When the app opens, ping `http://home-pc/api/settings`. If unreachable, show a blocking screen. This only applies to the mobile app (when `VITE_SERVER_BASE` is set).

**Files:**
- Create: `frontend/src/components/ConnectivityGuard.tsx`
- Modify: `frontend/src/App.tsx`

**Step 1: Create ConnectivityGuard component**

```tsx
// frontend/src/components/ConnectivityGuard.tsx
import { useEffect, useState } from "react";

type Status = "checking" | "connected" | "unreachable";

export default function ConnectivityGuard({ children }: { children: React.ReactNode }) {
  const serverBase = import.meta.env.VITE_SERVER_BASE;
  const [status, setStatus] = useState<Status>(serverBase ? "checking" : "connected");

  useEffect(() => {
    if (!serverBase) return; // Web mode — skip check

    let cancelled = false;
    const check = async () => {
      setStatus("checking");
      try {
        const res = await fetch(`${serverBase}/api/settings`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!cancelled) setStatus(res.ok ? "connected" : "unreachable");
      } catch {
        if (!cancelled) setStatus("unreachable");
      }
    };
    check();
    return () => { cancelled = true; };
  }, [serverBase]);

  if (status === "checking") {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center">
        <div className="text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/[0.08] border-t-copper mx-auto mb-4" />
          <p className="text-warm-gray">Connecting to Photo Frame...</p>
        </div>
      </div>
    );
  }

  if (status === "unreachable") {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <svg className="mx-auto h-16 w-16 text-warm-muted mb-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.14 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0" />
          </svg>
          <h1 className="font-display text-2xl text-warm-white mb-3">
            Not Connected
          </h1>
          <p className="text-warm-gray mb-8">
            Connect to your home network to use Photo Frame.
          </p>
          <button
            onClick={() => setStatus("checking")}
            className="rounded-xl bg-copper px-6 py-3 text-sm font-semibold text-ink hover:bg-copper-light transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
```

**Step 2: Wrap App with ConnectivityGuard**

```tsx
// frontend/src/App.tsx — wrap the top-level return
import ConnectivityGuard from "./components/ConnectivityGuard";

export default function App() {
  return (
    <ConnectivityGuard>
      <Routes>
        {/* ... existing routes ... */}
      </Routes>
    </ConnectivityGuard>
  );
}
```

**Step 3: Verify web build is unaffected**

When `VITE_SERVER_BASE` is not set, `ConnectivityGuard` renders children immediately (no check).

**Step 4: Commit**

```
feat: add connectivity guard for mobile app
```

---

## Phase 3: Server-Side Motion Photo Extraction (Android + Web)

### Task 4: Create Motion Photo detection and extraction service

Android Motion Photos (Google Pixel and Samsung) embed a video inside the JPEG file. The backend should detect these on upload and extract the video as a separate media item.

**Format details:**
- **Google Pixel (older):** XMP `GCamera:MicroVideoOffset` = byte offset from EOF. Video starts at `file_size - offset`.
- **Google Pixel (newer):** XMP `Container:Directory` with `Item:Length` for video. Video starts at `file_size - length`.
- **Samsung (older):** ASCII marker `MotionPhoto_Data` (16 bytes) followed by MP4 data.
- **Samsung (newer):** SEF trailer with `SEFH`/`SEFT` markers containing offset table.

All formats: the video is H.264 MP4 appended after the JPEG data.

**Files:**
- Create: `backend/app/services/motion_photo.py`
- Modify: `backend/app/routers/media.py` (call extraction after image upload)
- Test: `backend/tests/unit/test_motion_photo.py`
- Test: `backend/tests/integration/test_motion_photo_upload.py`

**Step 1: Write failing tests for Motion Photo detection**

```python
# backend/tests/unit/test_motion_photo.py
import struct
from app.services.motion_photo import detect_motion_photo, extract_motion_video

# Build a fake Motion Photo: JPEG header + padding + marker + fake MP4
JPEG_HEADER = b'\xff\xd8\xff\xe0'  # minimal JPEG SOI + APP0
FAKE_VIDEO = b'\x00\x00\x00\x1c\x66\x74\x79\x70\x69\x73\x6f\x6d'  # fake ftyp box

def _make_samsung_motion_photo() -> bytes:
    """Samsung format: JPEG + MotionPhoto_Data marker + MP4."""
    jpeg_part = JPEG_HEADER + b'\x00' * 100
    return jpeg_part + b'MotionPhoto_Data' + FAKE_VIDEO

def _make_pixel_motion_photo_xmp() -> bytes:
    """Google Pixel format: JPEG with XMP containing MicroVideoOffset."""
    video_data = FAKE_VIDEO
    offset = len(video_data)
    xmp = f'<x:xmpmeta><rdf:RDF><rdf:Description GCamera:MicroVideo="1" GCamera:MicroVideoOffset="{offset}"/></rdf:RDF></x:xmpmeta>'.encode()
    # Build: JPEG SOI + APP1 (XMP) + padding + video
    app1_length = len(xmp) + 2 + 29  # 2 for length bytes, 29 for XMP namespace header
    jpeg_part = b'\xff\xd8\xff\xe1' + struct.pack('>H', app1_length) + b'http://ns.adobe.com/xap/1.0/\x00' + xmp
    jpeg_part += b'\xff\xd9'  # EOI
    return jpeg_part + video_data

def test_detect_samsung_motion_photo():
    data = _make_samsung_motion_photo()
    result = detect_motion_photo(data)
    assert result is not None
    assert result["format"] == "samsung"

def test_detect_pixel_motion_photo():
    data = _make_pixel_motion_photo_xmp()
    result = detect_motion_photo(data)
    assert result is not None
    assert result["format"] == "pixel"

def test_detect_regular_jpeg_returns_none():
    data = JPEG_HEADER + b'\x00' * 100 + b'\xff\xd9'
    result = detect_motion_photo(data)
    assert result is None

def test_extract_samsung_video():
    data = _make_samsung_motion_photo()
    video = extract_motion_video(data)
    assert video is not None
    assert video == FAKE_VIDEO

def test_extract_pixel_video():
    data = _make_pixel_motion_photo_xmp()
    video = extract_motion_video(data)
    assert video is not None
    assert video == FAKE_VIDEO
```

**Step 2: Run tests to verify they fail**

Run: `docker compose exec backend python -m pytest tests/unit/test_motion_photo.py -v`
Expected: FAIL (module doesn't exist yet)

**Step 3: Implement the Motion Photo service**

```python
# backend/app/services/motion_photo.py
"""Detect and extract video from Android Motion Photos.

Supports:
- Google Pixel: XMP GCamera:MicroVideoOffset (older) and Container:Directory (newer)
- Samsung: MotionPhoto_Data ASCII marker (older) and SEF trailer (newer)
"""
import re
import struct
import logging

logger = logging.getLogger(__name__)

# Samsung marker
_SAMSUNG_MARKER = b"MotionPhoto_Data"

# XMP patterns for Google Pixel
_MICRO_VIDEO_RE = re.compile(rb'GCamera:MicroVideo="1"')
_MICRO_VIDEO_OFFSET_RE = re.compile(rb'GCamera:MicroVideoOffset="(\d+)"')
_MOTION_PHOTO_RE = re.compile(rb'GCamera:MotionPhoto="1"')
_ITEM_LENGTH_RE = re.compile(rb'Item:Length="(\d+)"')


def detect_motion_photo(data: bytes) -> dict | None:
    """Check if JPEG/HEIC data contains an embedded Motion Photo video.

    Returns {"format": "samsung"|"pixel", "video_offset": int} or None.
    """
    # Samsung: look for MotionPhoto_Data marker
    samsung_idx = data.find(_SAMSUNG_MARKER)
    if samsung_idx != -1:
        video_offset = samsung_idx + len(_SAMSUNG_MARKER)
        if video_offset < len(data):
            return {"format": "samsung", "video_offset": video_offset}

    # Google Pixel older format: MicroVideoOffset
    if _MICRO_VIDEO_RE.search(data):
        m = _MICRO_VIDEO_OFFSET_RE.search(data)
        if m:
            offset_from_end = int(m.group(1))
            video_offset = len(data) - offset_from_end
            if 0 < video_offset < len(data):
                return {"format": "pixel", "video_offset": video_offset}

    # Google Pixel newer format: MotionPhoto + Item:Length
    if _MOTION_PHOTO_RE.search(data):
        m = _ITEM_LENGTH_RE.search(data)
        if m:
            video_length = int(m.group(1))
            video_offset = len(data) - video_length
            if 0 < video_offset < len(data):
                return {"format": "pixel", "video_offset": video_offset}

    return None


def extract_motion_video(data: bytes) -> bytes | None:
    """Extract the embedded video from a Motion Photo.

    Returns the video bytes, or None if not a Motion Photo.
    """
    info = detect_motion_photo(data)
    if info is None:
        return None

    video_bytes = data[info["video_offset"]:]
    if len(video_bytes) < 8:
        logger.warning("Motion photo video too small (%d bytes), skipping", len(video_bytes))
        return None

    return video_bytes
```

**Step 4: Run tests to verify they pass**

Run: `docker compose exec backend python -m pytest tests/unit/test_motion_photo.py -v`
Expected: PASS

**Step 5: Commit**

```
feat: add Motion Photo detection and video extraction service
```

---

### Task 5: Integrate Motion Photo extraction into upload pipeline

When an image is uploaded, check if it's a Motion Photo. If so, extract the video and create an additional video media record.

**Files:**
- Modify: `backend/app/routers/media.py` (add Motion Photo check after image processing)
- Test: `backend/tests/integration/test_motion_photo_upload.py`

**Step 1: Write failing integration test**

```python
# backend/tests/integration/test_motion_photo_upload.py
"""Test that uploading a Motion Photo JPEG creates both an image and a video record."""
import struct
from io import BytesIO
from PIL import Image

def _make_valid_samsung_motion_photo() -> bytes:
    """Create a valid JPEG with Samsung Motion Photo marker + embedded MP4-like data."""
    # Create a real JPEG image
    img = Image.new("RGB", (100, 100), "red")
    buf = BytesIO()
    img.save(buf, "JPEG")
    jpeg_bytes = buf.getvalue()
    # Create a minimal MP4 (ftyp box) — ffprobe may reject this,
    # so in real tests use a real small video file
    fake_video = b'\x00\x00\x00\x1c\x66\x74\x79\x70\x69\x73\x6f\x6d'
    return jpeg_bytes + b'MotionPhoto_Data' + fake_video

def test_motion_photo_upload_creates_video(client, tmp_path):
    """Uploading a Motion Photo should create the image AND extract+create a video."""
    data = _make_valid_samsung_motion_photo()
    response = client.post(
        "/api/media",
        files=[("files", ("motion.jpg", data, "image/jpeg"))],
    )
    assert response.status_code == 200
    results = response.json()
    # Should have at least the image; video extraction may produce a second record
    # (if the embedded video is valid enough for ffprobe)
    assert len(results) >= 1
    assert results[0]["media_type"] == "photo"
```

**Step 2: Modify upload handler to check for Motion Photos**

In `backend/app/routers/media.py`, after the image processing block (line ~196), add:

```python
# After image is saved and committed, check for Motion Photo
from app.services.motion_photo import extract_motion_video

# ... inside the image branch, after db.commit() + db.refresh():

video_bytes = extract_motion_video(content)
if video_bytes:
    # Save extracted video and process it through the normal video pipeline
    try:
        video_name = f"{Path(original_name).stem}_motionvideo.mp4"
        video_hash = hashlib.sha256(video_bytes).hexdigest()
        # Skip if this video was already uploaded
        existing_video = db.query(Media).filter(Media.content_hash == video_hash).first()
        if not existing_video:
            info_v = save_video_original(video_bytes, video_name)
            require_transcode = needs_transcode(info_v["codec"])
            needs_scale = (
                not require_transcode
                and (info_v["width"] > config.DISPLAY_MAX_WIDTH or info_v["height"] > config.DISPLAY_MAX_HEIGHT)
            )
            video_media = Media(
                filename=info_v["filename"],
                original_name=video_name,
                media_type="video",
                width=info_v["width"],
                height=info_v["height"],
                file_size=info_v["file_size"],
                duration=info_v["duration"],
                codec=info_v["codec"],
                thumb_filename=info_v["thumb_filename"],
                processing_status="processing" if (require_transcode or needs_scale) else "ready",
                content_hash=video_hash,
            )
            db.add(video_media)
            db.commit()
            db.refresh(video_media)
            results.append(video_media)

            asyncio.create_task(
                manager.broadcast({"type": "media_added", "payload": MediaOut.model_validate(video_media).model_dump(mode="json")})
            )

            if require_transcode:
                original_path = config.ORIGINALS_DIR / info_v["filename"]
                thread = threading.Thread(
                    target=_transcode_in_background,
                    args=(video_media.id, original_path, info_v["duration"], loop),
                    daemon=True,
                )
                thread.start()
            elif needs_scale:
                original_path = config.ORIGINALS_DIR / info_v["filename"]
                thread = threading.Thread(
                    target=_scale_display_in_background,
                    args=(video_media.id, original_path, info_v["duration"], loop),
                    daemon=True,
                )
                thread.start()
    except Exception:
        logger.warning("Failed to extract Motion Photo video from %s", original_name, exc_info=True)
        # Non-fatal: the image was already saved successfully
```

**Step 3: Run tests**

Run: `docker compose exec backend python -m pytest tests/integration/test_motion_photo_upload.py -v`
Expected: PASS

**Step 4: Run full backend test suite to verify no regressions**

Run: `./scripts/test-backend.sh`
Expected: All pass

**Step 5: Commit**

```
feat: extract video from Motion Photos during upload

When a JPEG/HEIC is uploaded and contains an embedded Motion Photo
video (Google Pixel or Samsung format), the video is automatically
extracted and saved as a separate video media item. Works from both
the web UI and the mobile app — no client-side changes needed.
```

---

## Phase 4: Native Photo Picker with Live Photo Support (iOS)

### Task 6: Create custom iOS plugin for Live Photo video extraction

No existing Capacitor plugin extracts the MOV component from Live Photos. We need a small custom Swift plugin.

**Files:**
- Create: `frontend/ios/App/App/LivePhotoPlugin.swift`
- Create: `frontend/ios/App/App/LivePhotoPlugin.m` (Objective-C bridge)

**Step 1: Write the Swift plugin**

```swift
// frontend/ios/App/App/LivePhotoPlugin.swift
import Foundation
import Capacitor
import Photos
import PhotosUI

@objc(LivePhotoPlugin)
public class LivePhotoPlugin: CAPPlugin, PHPickerViewControllerDelegate {
    private var currentCall: CAPPluginCall?

    // Pick media from photo library, extracting Live Photo video components
    @objc func pickMedia(_ call: CAPPluginCall) {
        currentCall = call
        let maxItems = call.getInt("maxItems") ?? 10

        DispatchQueue.main.async {
            var config = PHPickerConfiguration(photoLibrary: .shared())
            config.selectionLimit = maxItems
            config.filter = .any(of: [.images, .videos, .livePhotos])
            // Request current representation to get original assets
            config.preferredAssetRepresentationMode = .current

            let picker = PHPickerViewController(configuration: config)
            picker.delegate = self
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let call = currentCall else { return }

        if results.isEmpty {
            call.resolve(["files": []])
            return
        }

        let group = DispatchGroup()
        var files: [[String: Any]] = []
        let tempDir = FileManager.default.temporaryDirectory

        for result in results {
            let provider = result.itemProvider

            // Check if it's a Live Photo — extract video component
            if provider.canLoadObject(ofClass: PHLivePhoto.self),
               let assetId = result.assetIdentifier {
                group.enter()
                extractLivePhotoVideo(assetIdentifier: assetId, tempDir: tempDir) { videoPath in
                    if let path = videoPath {
                        files.append([
                            "path": path,
                            "name": UUID().uuidString + ".mov",
                            "mimeType": "video/quicktime",
                            "isLivePhoto": true
                        ])
                    }
                    group.leave()
                }
            }
            // Video
            else if provider.hasItemConformingToTypeIdentifier("public.movie") {
                group.enter()
                provider.loadFileRepresentation(forTypeIdentifier: "public.movie") { url, error in
                    if let url = url {
                        let dest = tempDir.appendingPathComponent(UUID().uuidString + "." + url.pathExtension)
                        try? FileManager.default.copyItem(at: url, to: dest)
                        files.append([
                            "path": dest.path,
                            "name": url.lastPathComponent,
                            "mimeType": "video/" + url.pathExtension,
                            "isLivePhoto": false
                        ])
                    }
                    group.leave()
                }
            }
            // Regular image
            else if provider.hasItemConformingToTypeIdentifier("public.image") {
                group.enter()
                provider.loadFileRepresentation(forTypeIdentifier: "public.image") { url, error in
                    if let url = url {
                        let dest = tempDir.appendingPathComponent(UUID().uuidString + "." + url.pathExtension)
                        try? FileManager.default.copyItem(at: url, to: dest)
                        files.append([
                            "path": dest.path,
                            "name": url.lastPathComponent,
                            "mimeType": "image/" + url.pathExtension,
                            "isLivePhoto": false
                        ])
                    }
                    group.leave()
                }
            }
        }

        group.notify(queue: .main) {
            call.resolve(["files": files])
        }
    }

    private func extractLivePhotoVideo(assetIdentifier: String, tempDir: URL, completion: @escaping (String?) -> Void) {
        let fetchResult = PHAsset.fetchAssets(withLocalIdentifiers: [assetIdentifier], options: nil)
        guard let asset = fetchResult.firstObject else {
            completion(nil)
            return
        }

        let resources = PHAssetResource.assetResources(for: asset)
        guard let videoResource = resources.first(where: {
            $0.type == .pairedVideo || $0.uniformTypeIdentifier == "com.apple.quicktime-movie"
        }) else {
            completion(nil)
            return
        }

        let dest = tempDir.appendingPathComponent(UUID().uuidString + ".mov")
        let options = PHAssetResourceRequestOptions()
        options.isNetworkAccessAllowed = true

        PHAssetResourceManager.default().writeData(for: videoResource, toFile: dest, options: options) { error in
            completion(error == nil ? dest.path : nil)
        }
    }
}
```

**Step 2: Create Objective-C bridge**

```objc
// frontend/ios/App/App/LivePhotoPlugin.m
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(LivePhotoPlugin, "LivePhotoPlugin",
    CAP_PLUGIN_METHOD(pickMedia, CAPPluginReturnPromise);
)
```

**Step 3: Add photo library usage description to Info.plist**

Add to `frontend/ios/App/App/Info.plist`:
```xml
<key>NSPhotoLibraryUsageDescription</key>
<string>Photo Frame needs access to your photos to upload them to the slideshow.</string>
```

**Step 4: Commit**

```
feat: add custom iOS plugin for Live Photo video extraction
```

---

### Task 7: Create TypeScript wrapper for the native plugin

**Files:**
- Create: `frontend/src/native/livePhotoPlugin.ts`
- Create: `frontend/src/native/platform.ts`

**Step 1: Create platform detection utility**

```typescript
// frontend/src/native/platform.ts
import { Capacitor } from "@capacitor/core";

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function isIOS(): boolean {
  return Capacitor.getPlatform() === "ios";
}

export function isAndroid(): boolean {
  return Capacitor.getPlatform() === "android";
}
```

**Step 2: Create TypeScript wrapper for Live Photo plugin**

```typescript
// frontend/src/native/livePhotoPlugin.ts
import { registerPlugin } from "@capacitor/core";

export interface PickedFile {
  path: string;
  name: string;
  mimeType: string;
  isLivePhoto: boolean;
}

interface LivePhotoPluginInterface {
  pickMedia(options?: { maxItems?: number }): Promise<{ files: PickedFile[] }>;
}

const LivePhotoPlugin = registerPlugin<LivePhotoPluginInterface>("LivePhotoPlugin");

export default LivePhotoPlugin;
```

**Step 3: Commit**

```
feat: add TypeScript wrapper for Live Photo native plugin
```

---

### Task 8: Integrate native picker into Upload page

When running in Capacitor, the "Choose Files" button uses the native photo picker instead of the HTML file input.

**Files:**
- Modify: `frontend/src/pages/UploadPage.tsx`
- Modify: `frontend/src/api/client.ts` (add upload-from-path method)

**Step 1: Add a native file upload method to the API client**

The native picker returns file paths, not `File` objects. We need a method that reads native file paths and uploads them.

```typescript
// Add to frontend/src/api/client.ts

// Upload files from native file paths (Capacitor only)
export async function uploadNativeFiles(
  files: Array<{ path: string; name: string; mimeType: string }>,
  onProgress?: (percent: number) => void,
): Promise<Media[]> {
  // Read each file path into a Blob, then upload via FormData
  const form = new FormData();
  for (const f of files) {
    const response = await fetch(f.path);
    const blob = await response.blob();
    form.append("files", blob, f.name);
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/media`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new ApiError(xhr.status, xhr.responseText || "Upload failed"));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(form);
  });
}
```

Note: On iOS, Capacitor file paths (e.g., `/tmp/...`) are accessible via the WebView's `fetch()`. If this doesn't work, use `@capacitor/filesystem` to read the file as base64 instead.

**Step 2: Update UploadPage to use native picker when available**

```tsx
// frontend/src/pages/UploadPage.tsx — add import and modify choose button
import { isNative } from "../native/platform";
import LivePhotoPlugin from "../native/livePhotoPlugin";
import { uploadNativeFiles } from "../api/client";

// Add to UploadPage component body:
const handleNativePick = useCallback(async () => {
  try {
    const result = await LivePhotoPlugin.pickMedia({ maxItems: 20 });
    if (result.files.length === 0) return;

    setStatus("uploading");
    setErrorMsg("");
    try {
      const uploaded = await uploadNativeFiles(result.files, (p) => {
        // We need direct progress callback — hook into usePhotos or set state directly
      });
      setUploadedCount(uploaded.length);
      setStatus("done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Upload failed");
      setStatus("error");
    }
  } catch (e) {
    setErrorMsg(e instanceof Error ? e.message : "Failed to pick files");
    setStatus("error");
  }
}, []);

// In the JSX — replace the choose button:
<button
  onClick={() => {
    if (isNative()) {
      handleNativePick();
    } else {
      fileInputRef.current?.click();
    }
  }}
  className="inline-flex items-center rounded-xl bg-copper px-6 py-3 text-sm font-semibold text-ink hover:bg-copper-light transition-colors"
>
  Choose Files
</button>
```

**Step 3: Hide drag-and-drop zone on native (not useful on mobile)**

Wrap the drag event handlers so they only apply on web:

```tsx
onDragOver={isNative() ? undefined : (e) => { e.preventDefault(); setDragOver(true); }}
onDragLeave={isNative() ? undefined : () => setDragOver(false)}
onDrop={isNative() ? undefined : onDrop}
```

Update the description text:
```tsx
<p className="text-sm text-warm-gray mb-6">
  {isNative() ? "Photos, Videos, and Live Photos" : "JPG, PNG, WEBP, MP4, MOV — up to 200MB"}
</p>
```

**Step 4: Build and test on iOS simulator**

```bash
cd frontend
VITE_SERVER_BASE=http://home-pc npm run build
npx cap sync
npx cap open ios
# Run on simulator in Xcode
```

**Step 5: Commit**

```
feat: integrate native photo picker with Live Photo support into upload page
```

---

## Phase 5: Android Support

### Task 9: Android photo/video picker

Android Motion Photos are handled server-side (Task 4-5), so no native plugin is needed. The HTML file input works fine in Android's Capacitor WebView — when a user uploads a Motion Photo JPEG, the backend detects and extracts the embedded video automatically.

**Files:**
- Modify: `frontend/src/pages/UploadPage.tsx` (platform-specific picker)

**Step 1: Use HTML file input on Android**

On Android, the HTML `<input type="file">` works well in the Capacitor WebView. When a user selects a Motion Photo JPEG, it uploads as-is, and the backend's `extract_motion_video()` handles the rest.

```typescript
// In UploadPage.tsx choose button handler:
onClick={() => {
  if (isIOS()) {
    handleNativePick();  // iOS: use native picker for Live Photos
  } else {
    fileInputRef.current?.click();  // Android + Web: HTML file input
  }
}}
```

**Step 2: Commit**

```
feat: use HTML file input on Android (Motion Photos extracted server-side)
```

---

## Phase 6: Share Extension

### Task 10: iOS Share Extension

Allow "Share to Photo Frame" from the iOS share sheet. This is the most complex native piece.

**Files:**
- Create: `frontend/ios/ShareExtension/` (new Xcode target)
- Modify: `frontend/ios/App/App.entitlements` (App Groups)

**Note:** This task requires manual Xcode work that can't be fully scripted. High-level steps:

**Step 1: Add Share Extension target in Xcode**

1. Open `frontend/ios/App.xcworkspace` in Xcode
2. File > New > Target > Share Extension
3. Name: "ShareExtension", language: Swift
4. Configure App Group: `group.com.flexoptix.photoframe` on both main app and extension
5. Set extension's activation rule to accept images and videos

**Step 2: Implement Share Extension**

The share extension receives shared media, saves files to the App Group shared container, then opens the main app via URL scheme (`photoframe://shared`).

```swift
// frontend/ios/ShareExtension/ShareViewController.swift
import UIKit
import Social
import MobileCoreServices
import UniformTypeIdentifiers

class ShareViewController: SLComposeServiceViewController {
    override func didSelectPost() {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            extensionContext?.completeRequest(returningItems: nil)
            return
        }

        let group = DispatchGroup()
        let sharedDir = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: "group.com.flexoptix.photoframe")!
            .appendingPathComponent("shared")

        try? FileManager.default.createDirectory(at: sharedDir, withIntermediateDirectories: true)

        for item in items {
            guard let attachments = item.attachments else { continue }
            for provider in attachments {
                if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
                    group.enter()
                    provider.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { url, _ in
                        if let url = url {
                            let dest = sharedDir.appendingPathComponent(UUID().uuidString + ".mov")
                            try? FileManager.default.copyItem(at: url, to: dest)
                        }
                        group.leave()
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    group.enter()
                    provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, _ in
                        if let url = url {
                            let dest = sharedDir.appendingPathComponent(UUID().uuidString + "." + url.pathExtension)
                            try? FileManager.default.copyItem(at: url, to: dest)
                        }
                        group.leave()
                    }
                }
            }
        }

        group.notify(queue: .main) {
            // Open main app to handle upload
            if let url = URL(string: "photoframe://shared") {
                _ = self.openURL(url)
            }
            self.extensionContext?.completeRequest(returningItems: nil)
        }
    }

    @objc func openURL(_ url: URL) -> Bool {
        var responder: UIResponder? = self
        while responder != nil {
            if let application = responder as? UIApplication {
                return application.perform(#selector(openURL(_:)), with: url) != nil
            }
            responder = responder?.next
        }
        return false
    }
}
```

**Step 3: Handle URL scheme in main app**

Register `photoframe://` URL scheme in Info.plist, then handle in `AppDelegate.swift`:

```swift
// In AppDelegate.swift — handle incoming URL
func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    if url.scheme == "photoframe" && url.host == "shared" {
        // Notify the WebView to check shared container
        NotificationCenter.default.post(name: .init("SharedMediaReceived"), object: nil)
    }
    return true
}
```

**Step 4: Create Capacitor plugin to read shared files**

```swift
// frontend/ios/App/App/SharedMediaPlugin.swift
@objc(SharedMediaPlugin)
public class SharedMediaPlugin: CAPPlugin {
    @objc func getSharedFiles(_ call: CAPPluginCall) {
        let sharedDir = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: "group.com.flexoptix.photoframe")!
            .appendingPathComponent("shared")

        guard let files = try? FileManager.default.contentsOfDirectory(at: sharedDir, includingPropertiesForKeys: nil) else {
            call.resolve(["files": []])
            return
        }

        var result: [[String: String]] = []
        for file in files {
            result.append([
                "path": file.path,
                "name": file.lastPathComponent,
                "mimeType": file.pathExtension == "mov" ? "video/quicktime" : "image/\(file.pathExtension)"
            ])
        }
        call.resolve(["files": result])
    }

    @objc func clearSharedFiles(_ call: CAPPluginCall) {
        let sharedDir = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: "group.com.flexoptix.photoframe")!
            .appendingPathComponent("shared")

        if let files = try? FileManager.default.contentsOfDirectory(at: sharedDir, includingPropertiesForKeys: nil) {
            for file in files {
                try? FileManager.default.removeItem(at: file)
            }
        }
        call.resolve()
    }
}
```

**Step 5: Handle shared files in the React app**

Listen for the `appUrlOpen` event in the app and auto-upload shared files:

```typescript
// frontend/src/native/sharedMedia.ts
import { registerPlugin } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";

interface SharedMediaPluginInterface {
  getSharedFiles(): Promise<{ files: Array<{ path: string; name: string; mimeType: string }> }>;
  clearSharedFiles(): Promise<void>;
}

const SharedMediaPlugin = registerPlugin<SharedMediaPluginInterface>("SharedMediaPlugin");

export async function checkAndUploadSharedFiles(
  uploadFn: (files: Array<{ path: string; name: string; mimeType: string }>) => Promise<void>
) {
  const result = await SharedMediaPlugin.getSharedFiles();
  if (result.files.length > 0) {
    await uploadFn(result.files);
    await SharedMediaPlugin.clearSharedFiles();
  }
}

export function listenForSharedMedia(
  uploadFn: (files: Array<{ path: string; name: string; mimeType: string }>) => Promise<void>
) {
  CapApp.addListener("appUrlOpen", async (data) => {
    if (data.url.startsWith("photoframe://shared")) {
      await checkAndUploadSharedFiles(uploadFn);
    }
  });
}
```

**Step 6: Commit**

```
feat: add iOS share extension for receiving photos/videos
```

---

### Task 11: Android Share Target

Android share targets are simpler — just intent filters in the manifest.

**Files:**
- Modify: `frontend/android/app/src/main/AndroidManifest.xml`
- Create: `frontend/android/app/src/main/java/.../ShareReceiverActivity.java`

**Step 1: Add intent filter to AndroidManifest.xml**

```xml
<!-- Inside the main <activity> tag -->
<intent-filter>
    <action android:name="android.intent.action.SEND" />
    <action android:name="android.intent.action.SEND_MULTIPLE" />
    <category android:name="android.intent.category.DEFAULT" />
    <data android:mimeType="image/*" />
    <data android:mimeType="video/*" />
</intent-filter>
```

**Step 2: Handle received intent in the Capacitor activity**

Use `@capacitor/app`'s `appUrlOpen` event or a custom plugin to read the intent extras and extract file URIs.

**Step 3: Commit**

```
feat: add Android share target for receiving photos/videos
```

---

## Phase 7: Build & Distribution

### Task 12: Create build scripts

**Files:**
- Create: `scripts/build-mobile.sh`
- Modify: `frontend/.env.production` (or create)

**Step 1: Create production env file**

```bash
# frontend/.env.mobile
VITE_SERVER_BASE=http://home-pc
```

**Step 2: Create build script**

```bash
#!/usr/bin/env bash
# scripts/build-mobile.sh — Build mobile app
set -euo pipefail

cd "$(dirname "$0")/../frontend"

echo "Building web assets for mobile..."
VITE_SERVER_BASE=http://home-pc npx vite build

echo "Syncing with native projects..."
npx cap sync

echo "Done. Open in Xcode/Android Studio:"
echo "  npx cap open ios"
echo "  npx cap open android"
```

**Step 3: Commit**

```
feat: add mobile build script
```

---

## Implementation Order & Dependencies

```
Task 1 (base URL)           ← no deps, do first
Task 2 (Capacitor init)     ← depends on Task 1
Task 3 (connectivity guard) ← depends on Task 1
Task 4 (Motion Photo svc)   ← no deps (backend only), can parallel with 1-3
Task 5 (Motion Photo upload)← depends on Task 4
Task 6 (iOS Swift plugin)   ← depends on Task 2
Task 7 (TS wrapper)         ← depends on Task 6
Task 8 (upload integration) ← depends on Task 7
Task 9 (Android picker)     ← depends on Task 2 (trivial — HTML input works)
Task 10 (iOS share ext)     ← depends on Task 6, complex, can defer
Task 11 (Android share)     ← depends on Task 2, can defer
Task 12 (build scripts)     ← depends on Task 2
```

**Recommended order:** 4 → 5 → 1 → 2 → 3 → 6 → 7 → 8 → 9 → 12 → 10 → 11

Start with the backend Motion Photo service (Tasks 4-5) since it can be developed and tested entirely in Docker with the existing test infrastructure. Then move to frontend/Capacitor work.

Tasks 10-11 (share extensions) are the most complex and can be done as a follow-up phase.

---

## Key Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Live Photo extraction plugin doesn't work | Test with real Live Photos on physical device early (simulator may not have Live Photos) |
| `fetch()` can't read Capacitor temp file paths | Fallback: use `@capacitor/filesystem` to read as base64, convert to Blob |
| iOS share extension sandbox is restrictive | Use App Groups for shared file access, tested early |
| CORS issues with absolute URLs to home-pc | Backend already allows all origins (CORS not configured = no restriction). If needed, add CORS middleware. |
| WebSocket won't connect from Capacitor | The WS URL change in Task 1 handles this. Test early. |
| Motion Photo XMP formats vary across manufacturers | Support Google Pixel (2 formats) + Samsung (2 formats). Log unrecognized formats for future support. Non-fatal: image is still saved even if video extraction fails. |
| Embedded video too small/corrupt for ffprobe | Wrap in try/except, log warning, skip video creation. Image upload still succeeds. |
