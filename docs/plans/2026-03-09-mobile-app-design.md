# Mobile App Design — Capacitor Wrapper

**Date:** 2026-03-09
**Goal:** Native iOS/Android app for uploading photos and Live Photos to the photo frame server.

## Motivation

iOS Safari strips the video component from Live Photos in the file picker — only the still JPEG is accessible. A native app can access the full Live Photo (HEIC + MOV pair) via platform photo library APIs. Secondary benefit: Share sheet integration ("Share to Photo Frame").

## Approach: Capacitor

Wrap the existing React web frontend in a Capacitor native shell. All existing UI, API client, components, and bug fixes are reused unchanged. Only two native capabilities are added.

## What's Reused (unchanged)

- Gallery page (browse, select, delete, bulk delete)
- Upload page (pick files, upload with progress)
- Settings page (interval, transition)
- API client (`client.ts`) — all types, error handling, XHR upload
- All components (Navbar, PhotoCard, MediaDetailModal, etc.)
- All styling (Tailwind, dark theme, frosted glass)
- WebSocket connection for real-time updates

## What's New

### 1. Capacitor Native Shell
- iOS and Android builds from the same web codebase
- `@capacitor/core` + `@capacitor/cli` added to the frontend project
- Native project directories: `ios/` and `android/` under frontend

### 2. Live Photo Video Extraction
- Use a Capacitor plugin to access the device photo library with Live Photo support
- Extract the MOV component from Live Photos
- Upload as a regular video through the existing upload API
- Live Photos appear as ~3s videos in the slideshow (play, then hold first frame)

### 3. Share Extension
- "Share to Photo Frame" appears in iOS/Android share sheets
- Receives photos and videos from other apps (e.g., camera roll)
- Sends selected media to the upload API
- Live Photos shared this way also extract the MOV component

### 4. Connectivity Guard
- On launch, pings `GET http://home-pc/api/settings`
- If unreachable: shows a full-screen message — "Connect to your home network to use Photo Frame" with a retry button
- If reachable: proceeds to the app normally
- Server address is hardcoded to `http://home-pc`

### 5. API Base URL Configuration
- Web build: base URL stays `/api` (relative, proxied by Vite/nginx)
- App build: base URL becomes `http://home-pc/api` (absolute)
- Controlled via environment variable at build time (`VITE_API_BASE`)
- `client.ts` changes: `const API_BASE = import.meta.env.VITE_API_BASE || "/api"`
- Same change for asset URLs (thumbnails, originals, display files)

## What's NOT Included

- No slideshow page in the app (slideshow runs on the Pi)
- No push notifications
- No offline queue — uploads require server connectivity
- No authentication (home network only, same as web)

## Pages in the App

The app includes all existing pages except SlideshowPage:
- **Gallery** — browse, select, delete, "show in slideshow"
- **Upload** — pick from gallery (with Live Photo support), upload with progress
- **Settings** — slideshow interval, transition type

## Build & Distribution

- iOS: Xcode build, distribute via TestFlight or direct install
- Android: Android Studio build, distribute via APK sideload
- No App Store / Play Store submission planned (personal use)
