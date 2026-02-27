import { test as base, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { execSync } from "child_process";

// ─── API Helpers ─────────────────────────────────────────────
// Use backend directly for server-side API calls (Vite proxy is browser-only)
const BACKEND_URL = process.env.BACKEND_URL || "http://backend:8000";

export interface MediaItem {
  id: number;
  filename: string;
  original_name: string;
  media_type: "photo" | "video";
  thumb_filename: string;
  processing_status: "processing" | "ready" | "error";
  content_hash: string | null;
}

export async function apiDeleteAllMedia(): Promise<void> {
  const resp = await fetch(`${BACKEND_URL}/api/media?per_page=1000`);
  const data = await resp.json();
  for (const item of data.items) {
    await fetch(`${BACKEND_URL}/api/media/${item.id}`, { method: "DELETE" });
  }
}

export async function apiResetSettings(): Promise<void> {
  await fetch(`${BACKEND_URL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slideshow_interval: 10,
      transition_type: "crossfade",
      photo_order: "random",
    }),
  });
}

export async function apiGetMedia(): Promise<{
  items: MediaItem[];
  total: number;
}> {
  const resp = await fetch(`${BACKEND_URL}/api/media?per_page=1000`);
  return resp.json();
}

export async function apiDeleteMedia(id: number): Promise<void> {
  const resp = await fetch(`${BACKEND_URL}/api/media/${id}`, {
    method: "DELETE",
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Delete failed: ${resp.status} ${text}`);
  }
}

export async function apiGetSettings() {
  const resp = await fetch(`${BACKEND_URL}/api/settings`);
  return resp.json();
}

export async function apiUploadTestImage(imagePath: string): Promise<MediaItem[]> {
  const buf = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).slice(1);
  const mime = ext === "png" ? "image/png" : "image/jpeg";
  // Append random bytes to make each upload unique (avoids content_hash dedup)
  const uniqueBuf = Buffer.concat([buf, crypto.randomBytes(8)]);
  const form = new FormData();
  form.append(
    "files",
    new Blob([uniqueBuf], { type: mime }),
    `test-${crypto.randomUUID().slice(0, 8)}.${ext}`,
  );
  const resp = await fetch(`${BACKEND_URL}/api/media`, {
    method: "POST",
    body: form,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Upload failed: ${resp.status} ${text}`);
  }
  return resp.json();
}

export async function apiUploadTestVideo(
  videoPath: string,
): Promise<MediaItem[]> {
  const buf = fs.readFileSync(videoPath);
  const ext = path.extname(videoPath).slice(1);
  const mime = ext === "webm" ? "video/webm" : "video/mp4";
  const form = new FormData();
  form.append(
    "files",
    new Blob([buf], { type: mime }),
    `test-${crypto.randomUUID().slice(0, 8)}.${ext}`,
  );
  const resp = await fetch(`${BACKEND_URL}/api/media`, {
    method: "POST",
    body: form,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Video upload failed: ${resp.status} ${text}`);
  }
  return resp.json();
}

export async function apiWaitForProcessing(
  mediaId: number,
  timeoutMs = 30000,
): Promise<MediaItem> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const resp = await fetch(`${BACKEND_URL}/api/media/${mediaId}`);
    const item: MediaItem = await resp.json();
    if (item.processing_status !== "processing") {
      return item;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Media ${mediaId} still processing after ${timeoutMs}ms`);
}

// ─── Test Data ──────────────────────────────────────────────
// Real sample files mounted from test_data/ via docker-compose volume.
// Fallback: generate synthetic files if test_data is not available.

const TEST_DATA_DIR = "/test_data";
const SAMPLE_IMAGES = ["sample4.jpeg", "sample6.jpeg", "sample7.jpeg", "sample8.jpeg", "sample9.jpeg"];
const SAMPLE_VIDEOS = ["sample1.mp4", "sample2.mp4", "sample3.mp4", "sample5.mp4"];

function getSampleImage(index = 0): string {
  const file = path.join(TEST_DATA_DIR, SAMPLE_IMAGES[index % SAMPLE_IMAGES.length]);
  if (fs.existsSync(file)) return file;
  // Fallback: generate a minimal JPEG
  return generateFallbackImage();
}

function getSampleVideo(index = 0): string {
  const file = path.join(TEST_DATA_DIR, SAMPLE_VIDEOS[index % SAMPLE_VIDEOS.length]);
  if (fs.existsSync(file)) return file;
  // Fallback: generate a minimal WebM
  return generateFallbackVideo();
}

function generateFallbackImage(): string {
  const dir = path.join(__dirname, "test-images");
  const imgPath = path.join(dir, "fallback.jpg");
  if (!fs.existsSync(imgPath)) {
    fs.mkdirSync(dir, { recursive: true });
    // 2x2 red JPEG via ffmpeg
    execSync(
      `ffmpeg -f lavfi -i color=c=red:s=100x100:d=1 -vframes 1 "${imgPath}" -y`,
      { stdio: "pipe" },
    );
  }
  return imgPath;
}

function generateFallbackVideo(): string {
  const dir = path.join(__dirname, "test-videos");
  const videoPath = path.join(dir, "fallback-5s.webm");
  if (!fs.existsSync(videoPath)) {
    fs.mkdirSync(dir, { recursive: true });
    execSync(
      `ffmpeg -f lavfi -i color=c=blue:s=320x240:d=5 -c:v libvpx -b:v 200k -t 5 "${videoPath}" -y`,
      { stdio: "pipe" },
    );
  }
  return videoPath;
}

/**
 * Generate an HEVC (H.265) MP4 video — triggers backend transcoding.
 * Always generated (real samples are H.264 which skip transcoding).
 */
function generateHevcVideo(durationSec: number): string {
  const dir = path.join(__dirname, "test-videos");
  const videoPath = path.join(dir, `test-hevc-${durationSec}s.mp4`);
  if (!fs.existsSync(videoPath)) {
    fs.mkdirSync(dir, { recursive: true });
    execSync(
      `ffmpeg -f lavfi -i testsrc2=s=1280x720:d=${durationSec}:rate=30 -c:v libx265 -preset ultrafast -t ${durationSec} "${videoPath}" -y`,
      { stdio: "pipe" },
    );
  }
  return videoPath;
}

// ─── Custom Test Fixture ─────────────────────────────────────

type TestFixtures = {
  testImagePath: string;
  testVideoPath: string;
  testHevcVideoPath: string;
  cleanState: void;
};

export const test = base.extend<TestFixtures>({
  testImagePath: async ({}, use) => {
    await use(getSampleImage(0));
  },

  testVideoPath: async ({}, use) => {
    // VP8/WebM: H.264 MP4 does NOT play in headless Chromium.
    // Slideshow playback tests need WebM. For real MP4 samples, use getSampleVideo().
    await use(generateFallbackVideo());
  },

  testHevcVideoPath: async ({}, use) => {
    const videoPath = generateHevcVideo(15);
    await use(videoPath);
  },

  cleanState: [
    async ({}, use) => {
      // Clean before each test
      await apiDeleteAllMedia();
      await apiResetSettings();
      await use();
    },
    { auto: true },
  ],
});

export { expect, getSampleImage };
