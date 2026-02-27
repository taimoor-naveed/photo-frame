import { test as base, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

// ─── API Helpers ─────────────────────────────────────────────
// Use backend directly for server-side API calls (Vite proxy is browser-only)
const BACKEND_URL = process.env.BACKEND_URL || "http://backend:8000";

export interface MediaItem {
  id: number;
  filename: string;
  original_name: string;
  media_type: "photo" | "video";
  thumb_filename: string;
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

export async function apiGetSettings() {
  const resp = await fetch(`${BACKEND_URL}/api/settings`);
  return resp.json();
}

export async function apiUploadTestImage(imagePath: string): Promise<void> {
  const buf = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).slice(1);
  const mime = ext === "png" ? "image/png" : "image/jpeg";
  const form = new FormData();
  form.append("files", new Blob([buf], { type: mime }), `test.${ext}`);
  const resp = await fetch(`${BACKEND_URL}/api/media`, {
    method: "POST",
    body: form,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Upload failed: ${resp.status} ${text}`);
  }
}

// ─── Test Image Generation ───────────────────────────────────

function generateTestPng(): Buffer {
  // Valid 2x2 red PNG - generated from specification
  // PNG signature + IHDR + IDAT + IEND
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk: 2x2, 8-bit RGB
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(2, 0); // width
  ihdrData.writeUInt32BE(2, 4); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = createPngChunk("IHDR", ihdrData);

  // IDAT: raw image data (filter byte 0 + 3 bytes per pixel * 2 pixels per row * 2 rows)
  // Row 1: filter=0, R G B, R G B
  // Row 2: filter=0, R G B, R G B
  const rawData = Buffer.from([
    0, 255, 0, 0, 255, 0, 0, // row 1: red, red
    0, 255, 0, 0, 255, 0, 0, // row 2: red, red
  ]);

  // Deflate the raw data
  const zlib = require("zlib");
  const compressed = zlib.deflateSync(rawData);
  const idat = createPngChunk("IDAT", compressed);

  // IEND
  const iend = createPngChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeBuffer, data]);

  // CRC32
  let crc = 0xffffffff;
  for (let i = 0; i < crcData.length; i++) {
    crc ^= crcData[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// ─── Custom Test Fixture ─────────────────────────────────────

type TestFixtures = {
  testImagePath: string;
  cleanState: void;
};

export const test = base.extend<TestFixtures>({
  testImagePath: async ({}, use) => {
    const dir = path.join(__dirname, "test-images");
    const imgPath = path.join(dir, "test-photo.png");
    if (!fs.existsSync(imgPath)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(imgPath, generateTestPng());
    }
    await use(imgPath);
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

export { expect };
