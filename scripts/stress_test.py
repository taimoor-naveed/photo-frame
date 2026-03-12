"""
Stress test: generate 600 media items and upload via 3 concurrent streams.

Media mix (600 total):
  - 120 small JPEG (≤1024×600)
  - 120 large PNG (>1024×600, triggers display copy)
  - 100 small WebM/vp8 (no transcode)
  - 60 oversized h264 MP4 (triggers background scaling)
  - 60 MOV/mpeg4 (triggers background transcode)
  - 140 Samsung-style motion photos (JPEG + embedded MP4)

Run inside backend container:
  docker compose exec backend python /scripts/stress_test.py
"""

import asyncio
import hashlib
import io
import json
import os
import random
import struct
import subprocess
import tempfile
import time
from pathlib import Path

import httpx
from PIL import Image, ImageDraw

API_BASE = "http://localhost:8000"
UPLOAD_URL = f"{API_BASE}/api/media"

# ── Generators ──────────────────────────────────────────────────────────

def random_size_factor():
    """Return a multiplier between 0.9 and 1.1 for size variation."""
    return random.uniform(0.9, 1.1)


def gen_jpeg_small(index: int) -> tuple[str, bytes]:
    """Small JPEG, fits within 1024×600."""
    w = int(random.randint(400, 1024) * random_size_factor())
    h = int(random.randint(300, 600) * random_size_factor())
    w, h = min(w, 1024), min(h, 600)
    img = Image.new("RGB", (w, h), _random_color())
    _draw_label(img, f"JPEG-S-{index}")
    buf = io.BytesIO()
    quality = random.randint(70, 95)
    img.save(buf, format="JPEG", quality=quality)
    return f"small_photo_{index}.jpg", buf.getvalue()


def gen_png_large(index: int) -> tuple[str, bytes]:
    """Large PNG, exceeds 1024×600 → triggers display copy."""
    w = int(random.randint(1200, 3000) * random_size_factor())
    h = int(random.randint(800, 2000) * random_size_factor())
    img = Image.new("RGB", (w, h), _random_color())
    # Add some noise for size variation
    pixels = img.load()
    for _ in range(int(w * h * 0.01)):
        px, py = random.randint(0, w - 1), random.randint(0, h - 1)
        pixels[px, py] = _random_color()
    _draw_label(img, f"PNG-L-{index}")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return f"large_photo_{index}.png", buf.getvalue()


def gen_webm_small(index: int) -> tuple[str, bytes]:
    """Small WebM/vp8 video, ≤1024×600. No transcode needed."""
    w = random.choice([640, 800, 960])
    h = random.choice([360, 480])
    duration = round(random.uniform(1.0, 3.0), 1)
    color = f"{random.randint(0,255):02x}{random.randint(0,255):02x}{random.randint(0,255):02x}"
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        tmp = f.name
    try:
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", f"color=c=0x{color}:size={w}x{h}:duration={duration}:rate=24",
            "-c:v", "libvpx", "-b:v", "200k",
            "-an", tmp
        ], capture_output=True, check=True, timeout=30)
        data = Path(tmp).read_bytes()
    finally:
        os.unlink(tmp)
    return f"small_video_{index}.webm", data


def gen_mp4_oversized(index: int) -> tuple[str, bytes]:
    """Oversized h264 MP4, >1024×600 → triggers background display scaling."""
    w = random.choice([1280, 1920])
    h = random.choice([720, 1080])
    duration = round(random.uniform(1.0, 2.0), 1)
    color = f"{random.randint(0,255):02x}{random.randint(0,255):02x}{random.randint(0,255):02x}"
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
        tmp = f.name
    try:
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", f"color=c=0x{color}:size={w}x{h}:duration={duration}:rate=24",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
            "-pix_fmt", "yuv420p", "-an", tmp
        ], capture_output=True, check=True, timeout=30)
        data = Path(tmp).read_bytes()
    finally:
        os.unlink(tmp)
    return f"oversized_video_{index}.mp4", data


def gen_mov_mpeg4(index: int) -> tuple[str, bytes]:
    """MOV with mpeg4 codec → triggers full transcode to h264."""
    w = random.choice([640, 800])
    h = random.choice([480, 360])
    duration = round(random.uniform(1.0, 2.0), 1)
    color = f"{random.randint(0,255):02x}{random.randint(0,255):02x}{random.randint(0,255):02x}"
    with tempfile.NamedTemporaryFile(suffix=".mov", delete=False) as f:
        tmp = f.name
    try:
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", f"color=c=0x{color}:size={w}x{h}:duration={duration}:rate=24",
            "-c:v", "mpeg4", "-q:v", "5",
            "-an", tmp
        ], capture_output=True, check=True, timeout=30)
        data = Path(tmp).read_bytes()
    finally:
        os.unlink(tmp)
    return f"transcode_video_{index}.mov", data


def gen_motion_photo(index: int) -> tuple[str, bytes]:
    """Samsung-style motion photo: JPEG with embedded MP4 after marker."""
    # Generate the JPEG part
    w = int(random.randint(600, 1024) * random_size_factor())
    h = int(random.randint(400, 600) * random_size_factor())
    w, h = min(w, 1024), min(h, 600)
    img = Image.new("RGB", (w, h), _random_color())
    _draw_label(img, f"MOTION-{index}")
    jpeg_buf = io.BytesIO()
    img.save(jpeg_buf, format="JPEG", quality=85)
    jpeg_bytes = jpeg_buf.getvalue()

    # Generate a tiny MP4 for the embedded video
    vid_w, vid_h = 320, 240
    duration = round(random.uniform(0.5, 1.5), 1)
    color = f"{random.randint(0,255):02x}{random.randint(0,255):02x}{random.randint(0,255):02x}"
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
        tmp = f.name
    try:
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", f"color=c=0x{color}:size={vid_w}x{vid_h}:duration={duration}:rate=24",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
            "-pix_fmt", "yuv420p", "-an", tmp
        ], capture_output=True, check=True, timeout=30)
        video_bytes = Path(tmp).read_bytes()
    finally:
        os.unlink(tmp)

    # Samsung motion photo format: JPEG + "MotionPhoto_Data" marker + MP4
    marker = b"MotionPhoto_Data"
    combined = jpeg_bytes + marker + video_bytes
    return f"motion_photo_{index}.jpg", combined


# ── Helpers ─────────────────────────────────────────────────────────────

def _random_color():
    return (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255))


def _draw_label(img: Image.Image, text: str):
    draw = ImageDraw.Draw(img)
    draw.text((10, 10), text, fill=(255, 255, 255))
    draw.text((9, 9), text, fill=(0, 0, 0))


# ── Generation ──────────────────────────────────────────────────────────

def generate_all_media() -> list[tuple[str, bytes]]:
    """Generate 600 media items. Returns list of (filename, bytes)."""
    items = []
    generators = [
        ("small JPEG", gen_jpeg_small, 120),
        ("large PNG", gen_png_large, 120),
        ("small WebM/vp8", gen_webm_small, 100),
        ("oversized h264 MP4", gen_mp4_oversized, 60),
        ("MOV/mpeg4 transcode", gen_mov_mpeg4, 60),
        ("Samsung motion photo", gen_motion_photo, 140),
    ]

    for label, gen_fn, count in generators:
        t0 = time.time()
        for i in range(count):
            name, data = gen_fn(i)
            items.append((name, data))
            if (i + 1) % 20 == 0:
                print(f"  [{label}] {i+1}/{count} generated...")
        elapsed = time.time() - t0
        print(f"  ✓ {label}: {count} items in {elapsed:.1f}s")

    random.shuffle(items)
    return items


# ── Upload ──────────────────────────────────────────────────────────────

async def upload_set(
    client: httpx.AsyncClient,
    items: list[tuple[str, bytes]],
    set_id: int,
):
    """Upload a set of media items sequentially."""
    results = {"success": 0, "duplicate": 0, "error": 0, "errors": []}
    t0 = time.time()

    for i, (name, data) in enumerate(items):
        try:
            files = {"files": (name, data)}
            resp = await client.post(UPLOAD_URL, files=files, timeout=60.0)
            if resp.status_code == 201:
                results["success"] += 1
            elif resp.status_code == 200:
                results["duplicate"] += 1
            else:
                results["error"] += 1
                results["errors"].append(
                    f"{name}: HTTP {resp.status_code} - {resp.text[:200]}"
                )
        except Exception as e:
            results["error"] += 1
            results["errors"].append(f"{name}: {type(e).__name__}: {e}")

        if (i + 1) % 25 == 0:
            elapsed = time.time() - t0
            rate = (i + 1) / elapsed
            print(
                f"  [Set {set_id}] {i+1}/{len(items)} uploaded "
                f"({rate:.1f}/s, {results['error']} errors)"
            )

    elapsed = time.time() - t0
    print(
        f"  ✓ Set {set_id} done: {results['success']} ok, "
        f"{results['duplicate']} dup, {results['error']} err in {elapsed:.1f}s"
    )
    return results


async def run_stress_test():
    print("=" * 60)
    print("STRESS TEST: 600 media items, 3 concurrent uploaders")
    print("=" * 60)

    # Phase 1: Generate
    print("\n── Phase 1: Generating media ──")
    t_gen = time.time()
    items = generate_all_media()
    gen_elapsed = time.time() - t_gen
    total_bytes = sum(len(d) for _, d in items)
    print(f"\nGenerated {len(items)} items ({total_bytes / 1024 / 1024:.1f} MB) in {gen_elapsed:.1f}s")

    # Phase 2: Split into 3 sets
    set_size = len(items) // 3
    sets = [
        items[:set_size],
        items[set_size : 2 * set_size],
        items[2 * set_size :],
    ]
    print(f"Split into 3 sets: {[len(s) for s in sets]}")

    # Phase 3: Upload concurrently
    print("\n── Phase 2: Uploading (3 concurrent streams) ──")
    t_upload = time.time()

    async with httpx.AsyncClient() as client:
        tasks = [
            upload_set(client, sets[0], 1),
            upload_set(client, sets[1], 2),
            upload_set(client, sets[2], 3),
        ]
        results = await asyncio.gather(*tasks)

    upload_elapsed = time.time() - t_upload

    # Phase 4: Summary
    print("\n── Results ──")
    total_ok = sum(r["success"] for r in results)
    total_dup = sum(r["duplicate"] for r in results)
    total_err = sum(r["error"] for r in results)
    print(f"  Success:    {total_ok}")
    print(f"  Duplicate:  {total_dup}")
    print(f"  Errors:     {total_err}")
    print(f"  Upload time: {upload_elapsed:.1f}s")
    print(f"  Throughput:  {(total_ok + total_dup) / upload_elapsed:.1f} uploads/s")
    print(f"  Total time:  {gen_elapsed + upload_elapsed:.1f}s (gen + upload)")

    # Print any errors
    all_errors = []
    for r in results:
        all_errors.extend(r["errors"])
    if all_errors:
        print(f"\n── Errors ({len(all_errors)}) ──")
        for e in all_errors[:20]:
            print(f"  • {e}")
        if len(all_errors) > 20:
            print(f"  ... and {len(all_errors) - 20} more")

    # Check final media count
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{API_BASE}/api/media?page=1&per_page=1")
        if resp.status_code == 200:
            data = resp.json()
            total = data.get("total", "?")
            print(f"\n  Media in DB: {total}")

    print("\n" + "=" * 60)


if __name__ == "__main__":
    asyncio.run(run_stress_test())
