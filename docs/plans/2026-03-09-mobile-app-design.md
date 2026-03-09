# Live Photo & Motion Photo Support — Design

**Date:** 2026-03-09
**Goal:** Enable uploading Live Photos (iOS) and Motion Photos (Android) to the photo frame, with the video component playing in the slideshow.

## Motivation

- **iOS Live Photos**: Safari strips the video component in the file picker — only the still JPEG is accessible from the browser.
- **Android Motion Photos**: The video is embedded inside the JPEG file. The browser uploads the whole file, but the backend currently ignores the embedded video.

## Solution

### Android Motion Photos — Server-Side Extraction
No app needed. The user uploads the Motion Photo JPEG from the browser as usual. The backend detects the embedded video (via XMP metadata or Samsung markers), extracts it, and creates a separate video media record. The video plays in the slideshow using existing video behavior (play, hold first frame until next slide). Works from any browser, any platform.

### iOS Live Photos — iOS Shortcut
No app needed. An iOS Shortcut extracts the MOV from Live Photos and uploads it to the backend API. Can be triggered from the home screen or the share sheet. The web UI handles everything else (gallery, settings, deletion).

## What's NOT Included
- No native mobile app (Capacitor, React Native, etc.)
- No App Store / Play Store distribution
- No push notifications
- No offline support

## Why Not a Native App?
Originally explored Capacitor (wrapping the web UI in a native shell). Eliminated because:
- Android: Motion Photo extraction works server-side, no native code needed
- iOS: Live Photo extraction needs native APIs, but an iOS Shortcut provides this without building/signing/maintaining an app
- No developer accounts needed, no 7-day signing limits, no sideloading
