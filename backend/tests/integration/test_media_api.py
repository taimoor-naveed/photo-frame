import io
import time

from PIL import Image


def _make_jpeg(color: str) -> bytes:
    """Generate a unique JPEG with the given color."""
    img = Image.new("RGB", (100, 100), color=color)
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    return buf.getvalue()


def test_upload_photo(client, sample_jpeg):
    response = client.post(
        "/api/media",
        files=[("files", ("photo.jpg", io.BytesIO(sample_jpeg), "image/jpeg"))],
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["media_type"] == "photo"
    assert data[0]["width"] == 800
    assert data[0]["height"] == 600
    assert data[0]["original_name"] == "photo.jpg"
    assert data[0]["thumb_filename"].endswith(".jpg")
    assert data[0]["processing_status"] == "ready"
    assert data[0]["content_hash"] is not None


def test_upload_png(client, sample_png):
    response = client.post(
        "/api/media",
        files=[("files", ("image.png", io.BytesIO(sample_png), "image/png"))],
    )
    assert response.status_code == 200
    data = response.json()
    assert data[0]["media_type"] == "photo"
    assert data[0]["width"] == 640


def test_upload_video(client, sample_video):
    response = client.post(
        "/api/media",
        files=[("files", ("clip.mp4", io.BytesIO(sample_video), "video/mp4"))],
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["media_type"] == "video"
    assert data[0]["duration"] > 0
    assert data[0]["codec"] == "h264"
    assert data[0]["processing_status"] == "ready"  # h264 is browser-compatible, no transcode


def test_upload_multiple_files(client, sample_jpeg, sample_png):
    response = client.post(
        "/api/media",
        files=[
            ("files", ("a.jpg", io.BytesIO(sample_jpeg), "image/jpeg")),
            ("files", ("b.png", io.BytesIO(sample_png), "image/png")),
        ],
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2


def test_upload_duplicate_detection(client, sample_jpeg):
    """Uploading the same file twice returns the existing media instead of creating a duplicate."""
    r1 = client.post(
        "/api/media",
        files=[("files", ("photo.jpg", io.BytesIO(sample_jpeg), "image/jpeg"))],
    )
    r2 = client.post(
        "/api/media",
        files=[("files", ("photo.jpg", io.BytesIO(sample_jpeg), "image/jpeg"))],
    )
    assert r1.status_code == 200
    assert r2.status_code == 200
    # Same media returned both times
    assert r1.json()[0]["id"] == r2.json()[0]["id"]
    # Only 1 item in DB
    assert client.get("/api/media").json()["total"] == 1


# ─── HEIC Upload Tests ────────────────────────────────────────


def test_upload_corrupt_heic_returns_400(client):
    """Corrupt HEIC file returns 400, not 500."""
    corrupt = b"\x00\x01\x02garbage_heic" * 100
    response = client.post(
        "/api/media",
        files=[("files", ("corrupt.heic", io.BytesIO(corrupt), "image/heic"))],
    )
    assert response.status_code == 400


def test_upload_corrupt_heic_no_orphaned_files(client, tmp_path, monkeypatch):
    """Corrupt HEIC upload leaves no orphaned files on disk."""
    import app.config as cfg

    originals_before = set(cfg.ORIGINALS_DIR.iterdir())
    thumbnails_before = set(cfg.THUMBNAILS_DIR.iterdir())

    corrupt = b"\x00\x01\x02garbage_heic" * 100
    client.post(
        "/api/media",
        files=[("files", ("corrupt.heic", io.BytesIO(corrupt), "image/heic"))],
    )

    assert set(cfg.ORIGINALS_DIR.iterdir()) == originals_before
    assert set(cfg.THUMBNAILS_DIR.iterdir()) == thumbnails_before


def test_upload_empty_heic_returns_400(client):
    """Empty HEIC file returns 400."""
    response = client.post(
        "/api/media",
        files=[("files", ("empty.heic", io.BytesIO(b""), "image/heic"))],
    )
    assert response.status_code == 400


def test_upload_heic_photo(client, sample_heic):
    """Upload a real HEIC file — converted to JPEG, correct metadata."""
    response = client.post(
        "/api/media",
        files=[("files", ("photo.heic", io.BytesIO(sample_heic), "image/heic"))],
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["media_type"] == "photo"
    assert data[0]["width"] == 640
    assert data[0]["height"] == 480
    assert data[0]["original_name"] == "photo.heic"
    assert data[0]["filename"].endswith(".jpg")
    assert data[0]["thumb_filename"].endswith(".jpg")
    assert data[0]["processing_status"] == "ready"


def test_upload_heic_duplicate_detection(client, sample_heic):
    """Uploading the same HEIC file twice returns the existing media."""
    r1 = client.post(
        "/api/media",
        files=[("files", ("photo.heic", io.BytesIO(sample_heic), "image/heic"))],
    )
    r2 = client.post(
        "/api/media",
        files=[("files", ("photo.heic", io.BytesIO(sample_heic), "image/heic"))],
    )
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()[0]["id"] == r2.json()[0]["id"]
    assert client.get("/api/media").json()["total"] == 1


def test_upload_invalid_extension(client):
    response = client.post(
        "/api/media",
        files=[("files", ("file.txt", io.BytesIO(b"hello"), "text/plain"))],
    )
    assert response.status_code == 400


def test_list_media_empty(client):
    response = client.get("/api/media")
    assert response.status_code == 200
    data = response.json()
    assert data["items"] == []
    assert data["total"] == 0
    assert data["page"] == 1


def test_list_media_with_items(client, sample_jpeg, sample_png):
    # Upload two photos
    client.post("/api/media", files=[("files", ("a.jpg", io.BytesIO(sample_jpeg), "image/jpeg"))])
    client.post("/api/media", files=[("files", ("b.png", io.BytesIO(sample_png), "image/png"))])

    response = client.get("/api/media")
    data = response.json()
    assert data["total"] == 2
    assert len(data["items"]) == 2
    # Ordered by uploaded_at desc — most recent first
    assert data["items"][0]["original_name"] == "b.png"


def test_list_media_pagination(client):
    # Upload 3 unique photos (duplicate detection would collapse identical ones)
    colors = ["red", "green", "blue"]
    for i, color in enumerate(colors):
        data = _make_jpeg(color)
        client.post("/api/media", files=[("files", (f"p{i}.jpg", io.BytesIO(data), "image/jpeg"))])

    # Page 1, per_page 2
    response = client.get("/api/media?page=1&per_page=2")
    data = response.json()
    assert data["total"] == 3
    assert len(data["items"]) == 2
    assert data["page"] == 1
    assert data["per_page"] == 2

    # Page 2
    response = client.get("/api/media?page=2&per_page=2")
    data = response.json()
    assert len(data["items"]) == 1


def test_get_media(client, sample_jpeg):
    upload = client.post("/api/media", files=[("files", ("photo.jpg", io.BytesIO(sample_jpeg), "image/jpeg"))])
    media_id = upload.json()[0]["id"]

    response = client.get(f"/api/media/{media_id}")
    assert response.status_code == 200
    assert response.json()["id"] == media_id


def test_get_media_not_found(client):
    response = client.get("/api/media/999")
    assert response.status_code == 404


def test_delete_media(client, sample_jpeg):
    upload = client.post("/api/media", files=[("files", ("photo.jpg", io.BytesIO(sample_jpeg), "image/jpeg"))])
    media_id = upload.json()[0]["id"]

    response = client.delete(f"/api/media/{media_id}")
    assert response.status_code == 200
    assert response.json()["ok"] is True

    # Verify it's gone
    assert client.get(f"/api/media/{media_id}").status_code == 404
    assert client.get("/api/media").json()["total"] == 0


def test_delete_media_not_found(client):
    response = client.delete("/api/media/999")
    assert response.status_code == 404


def test_serve_original_file(client, sample_jpeg):
    upload = client.post("/api/media", files=[("files", ("photo.jpg", io.BytesIO(sample_jpeg), "image/jpeg"))])
    filename = upload.json()[0]["filename"]

    response = client.get(f"/uploads/originals/{filename}")
    assert response.status_code == 200


def test_serve_thumbnail_file(client, sample_jpeg):
    upload = client.post("/api/media", files=[("files", ("photo.jpg", io.BytesIO(sample_jpeg), "image/jpeg"))])
    thumb = upload.json()[0]["thumb_filename"]

    response = client.get(f"/uploads/thumbnails/{thumb}")
    assert response.status_code == 200


# ─── Bulk Delete Tests ──────────────────────────────────────


def _upload_unique_photos(client, count: int) -> list[int]:
    """Upload `count` unique photos and return their IDs."""
    colors = ["red", "green", "blue", "yellow", "cyan", "magenta", "orange", "purple"]
    ids = []
    for i in range(count):
        data = _make_jpeg(colors[i % len(colors)])
        r = client.post("/api/media", files=[("files", (f"p{i}.jpg", io.BytesIO(data), "image/jpeg"))])
        assert r.status_code == 200
        ids.append(r.json()[0]["id"])
    return ids


def test_bulk_delete_multiple(client):
    """Upload 3, bulk delete 2 by ID, verify 1 remains."""
    ids = _upload_unique_photos(client, 3)
    to_delete = ids[:2]
    remaining_id = ids[2]

    r = client.request("DELETE", "/api/media/bulk", json={"ids": to_delete})
    assert r.status_code == 200
    body = r.json()
    assert sorted(body["deleted"]) == sorted(to_delete)
    assert body["not_found"] == []

    # Remaining item still accessible
    assert client.get(f"/api/media/{remaining_id}").status_code == 200
    # Deleted items return 404
    for mid in to_delete:
        assert client.get(f"/api/media/{mid}").status_code == 404
    assert client.get("/api/media").json()["total"] == 1


def test_bulk_delete_all(client):
    """Upload 3, bulk delete all 3, verify gallery empty."""
    ids = _upload_unique_photos(client, 3)

    r = client.request("DELETE", "/api/media/bulk", json={"ids": ids})
    assert r.status_code == 200
    assert sorted(r.json()["deleted"]) == sorted(ids)
    assert client.get("/api/media").json()["total"] == 0


def test_bulk_delete_single(client):
    """Bulk delete with 1 ID — degenerate case."""
    ids = _upload_unique_photos(client, 1)

    r = client.request("DELETE", "/api/media/bulk", json={"ids": ids})
    assert r.status_code == 200
    assert r.json()["deleted"] == ids
    assert client.get("/api/media").json()["total"] == 0


def test_bulk_delete_files_cleaned_up(client, tmp_path, monkeypatch):
    """Bulk delete removes original + thumbnail from disk."""
    import app.config as cfg

    ids = _upload_unique_photos(client, 1)
    media = client.get(f"/api/media/{ids[0]}").json()
    original_path = cfg.ORIGINALS_DIR / media["filename"]
    thumb_path = cfg.THUMBNAILS_DIR / media["thumb_filename"]
    assert original_path.exists()
    assert thumb_path.exists()

    client.request("DELETE", "/api/media/bulk", json={"ids": ids})

    assert not original_path.exists()
    assert not thumb_path.exists()


def test_bulk_delete_empty_list(client):
    """Send empty list — succeeds with empty results."""
    r = client.request("DELETE", "/api/media/bulk", json={"ids": []})
    assert r.status_code == 200
    assert r.json() == {"deleted": [], "not_found": []}


def test_bulk_delete_some_not_found(client):
    """Upload 1, bulk delete [real_id, 99999] — partial success."""
    ids = _upload_unique_photos(client, 1)
    real_id = ids[0]

    r = client.request("DELETE", "/api/media/bulk", json={"ids": [real_id, 99999]})
    assert r.status_code == 200
    body = r.json()
    assert body["deleted"] == [real_id]
    assert body["not_found"] == [99999]


def test_bulk_delete_all_not_found(client):
    """Bulk delete nonexistent IDs — succeeds with all not_found."""
    r = client.request("DELETE", "/api/media/bulk", json={"ids": [99998, 99999]})
    assert r.status_code == 200
    body = r.json()
    assert body["deleted"] == []
    assert sorted(body["not_found"]) == [99998, 99999]


def test_bulk_delete_duplicate_ids(client):
    """Same ID twice — deleted once, second occurrence is not_found."""
    ids = _upload_unique_photos(client, 1)
    mid = ids[0]

    r = client.request("DELETE", "/api/media/bulk", json={"ids": [mid, mid]})
    assert r.status_code == 200
    body = r.json()
    assert body["deleted"] == [mid]
    assert body["not_found"] == [mid]


# ─── Display-Optimized Media Tests ────────────────────────────


def _make_large_jpeg(width: int = 2400, height: int = 1800, color: str = "purple") -> bytes:
    """Generate a JPEG larger than DISPLAY_MAX_SIZE (1920)."""
    img = Image.new("RGB", (width, height), color=color)
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    return buf.getvalue()


def test_upload_large_photo_has_display_filename(client):
    """Uploading a photo > 1920px should set display_filename in the response."""
    data = _make_large_jpeg()
    r = client.post("/api/media", files=[("files", ("big.jpg", io.BytesIO(data), "image/jpeg"))])
    assert r.status_code == 200
    media = r.json()[0]
    assert media["display_filename"] is not None
    assert media["display_filename"].startswith("display_")


def test_upload_small_photo_no_display_filename(client, sample_jpeg):
    """Uploading a photo ≤ 1920px should have display_filename = null."""
    r = client.post("/api/media", files=[("files", ("small.jpg", io.BytesIO(sample_jpeg), "image/jpeg"))])
    assert r.status_code == 200
    media = r.json()[0]
    assert media["display_filename"] is None


def test_upload_large_photo_display_file_on_disk(client):
    """Display file should actually exist on disk after upload."""
    import app.config as cfg

    data = _make_large_jpeg()
    r = client.post("/api/media", files=[("files", ("big.jpg", io.BytesIO(data), "image/jpeg"))])
    media = r.json()[0]

    display_path = cfg.DISPLAY_DIR / media["display_filename"]
    assert display_path.exists()


def test_serve_display_file(client):
    """GET /uploads/display/{filename} should serve the display file."""
    data = _make_large_jpeg()
    r = client.post("/api/media", files=[("files", ("big.jpg", io.BytesIO(data), "image/jpeg"))])
    display_filename = r.json()[0]["display_filename"]

    response = client.get(f"/uploads/display/{display_filename}")
    assert response.status_code == 200


def test_serve_display_file_not_found(client):
    """GET /uploads/display/nonexistent.jpg should return 404."""
    response = client.get("/uploads/display/nonexistent.jpg")
    assert response.status_code == 404


def test_delete_photo_cleans_up_display_file(client):
    """Deleting a photo with a display file should remove the display file from disk."""
    import app.config as cfg

    data = _make_large_jpeg()
    r = client.post("/api/media", files=[("files", ("big.jpg", io.BytesIO(data), "image/jpeg"))])
    media = r.json()[0]
    media_id = media["id"]
    display_path = cfg.DISPLAY_DIR / media["display_filename"]
    assert display_path.exists()

    client.delete(f"/api/media/{media_id}")
    assert not display_path.exists()


def test_bulk_delete_cleans_up_display_files(client):
    """Bulk delete should remove display files from disk."""
    import app.config as cfg

    data = _make_large_jpeg()
    r = client.post("/api/media", files=[("files", ("big.jpg", io.BytesIO(data), "image/jpeg"))])
    media = r.json()[0]
    display_path = cfg.DISPLAY_DIR / media["display_filename"]
    assert display_path.exists()

    client.request("DELETE", "/api/media/bulk", json={"ids": [media["id"]]})
    assert not display_path.exists()


def test_get_media_includes_display_filename(client):
    """GET /api/media/{id} should include display_filename field."""
    data = _make_large_jpeg()
    r = client.post("/api/media", files=[("files", ("big.jpg", io.BytesIO(data), "image/jpeg"))])
    media_id = r.json()[0]["id"]

    response = client.get(f"/api/media/{media_id}")
    assert response.status_code == 200
    assert response.json()["display_filename"] is not None


def test_list_media_includes_display_filename(client):
    """GET /api/media should include display_filename in items."""
    data = _make_large_jpeg()
    client.post("/api/media", files=[("files", ("big.jpg", io.BytesIO(data), "image/jpeg"))])

    response = client.get("/api/media")
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert "display_filename" in items[0]


def test_upload_small_video_no_display_filename(client, sample_video):
    """Uploading a small video (320x240) should have display_filename = null."""
    r = client.post("/api/media", files=[("files", ("clip.mp4", io.BytesIO(sample_video), "video/mp4"))])
    assert r.status_code == 200
    media = r.json()[0]
    assert media["display_filename"] is None
    assert media["processing_status"] == "ready"  # no transcode or scaling needed


def test_upload_video_response_has_display_filename_field(client, sample_video):
    """Video response schema must include display_filename field."""
    r = client.post("/api/media", files=[("files", ("clip.mp4", io.BytesIO(sample_video), "video/mp4"))])
    assert r.status_code == 200
    media = r.json()[0]
    assert "display_filename" in media


# ─── Large Video Display Scaling Tests ────────────────────────


def _wait_for_ready(client, media_id: int, timeout: float = 30.0) -> dict:
    """Poll GET /api/media/{id} until processing_status is no longer 'processing'."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = client.get(f"/api/media/{media_id}")
        media = r.json()
        if media["processing_status"] != "processing":
            return media
        time.sleep(0.3)
    raise TimeoutError(f"Media {media_id} still processing after {timeout}s")


def test_upload_large_video_starts_processing(client, sample_video_large):
    """Uploading a video > 1920px should return processing_status='processing'."""
    r = client.post("/api/media", files=[("files", ("big.mp4", io.BytesIO(sample_video_large), "video/mp4"))])
    assert r.status_code == 200
    media = r.json()[0]
    assert media["processing_status"] == "processing"


def test_upload_large_video_gets_display_filename(client, sample_video_large):
    """After background scaling, large video should have display_filename set."""
    r = client.post("/api/media", files=[("files", ("big.mp4", io.BytesIO(sample_video_large), "video/mp4"))])
    media_id = r.json()[0]["id"]

    media = _wait_for_ready(client, media_id)
    assert media["processing_status"] == "ready"
    assert media["display_filename"] is not None
    assert media["display_filename"].startswith("display_")


def test_upload_large_video_display_file_on_disk(client, sample_video_large):
    """Display file should physically exist on disk after processing completes."""
    import app.config as cfg

    r = client.post("/api/media", files=[("files", ("big.mp4", io.BytesIO(sample_video_large), "video/mp4"))])
    media_id = r.json()[0]["id"]

    media = _wait_for_ready(client, media_id)
    display_path = cfg.DISPLAY_DIR / media["display_filename"]
    assert display_path.exists()
    assert display_path.stat().st_size > 0


def test_upload_large_video_display_dimensions_capped(client, sample_video_large):
    """Display video longest edge must be ≤ 1920px."""
    import app.config as cfg
    from app.services.video import get_video_metadata

    r = client.post("/api/media", files=[("files", ("big.mp4", io.BytesIO(sample_video_large), "video/mp4"))])
    media_id = r.json()[0]["id"]

    media = _wait_for_ready(client, media_id)
    display_path = cfg.DISPLAY_DIR / media["display_filename"]
    meta = get_video_metadata(display_path)
    assert max(meta["width"], meta["height"]) <= 1920


def test_serve_video_display_file(client, sample_video_large):
    """GET /uploads/display/{filename} should serve the video display file."""
    r = client.post("/api/media", files=[("files", ("big.mp4", io.BytesIO(sample_video_large), "video/mp4"))])
    media_id = r.json()[0]["id"]

    media = _wait_for_ready(client, media_id)
    response = client.get(f"/uploads/display/{media['display_filename']}")
    assert response.status_code == 200


def test_delete_video_cleans_up_display_file(client, sample_video_large):
    """Deleting a video with a display file should remove the display file from disk."""
    import app.config as cfg

    r = client.post("/api/media", files=[("files", ("big.mp4", io.BytesIO(sample_video_large), "video/mp4"))])
    media_id = r.json()[0]["id"]

    media = _wait_for_ready(client, media_id)
    display_path = cfg.DISPLAY_DIR / media["display_filename"]
    assert display_path.exists()

    client.delete(f"/api/media/{media_id}")
    assert not display_path.exists()


def test_bulk_delete_video_cleans_up_display_file(client, sample_video_large):
    """Bulk delete should remove video display files from disk."""
    import app.config as cfg

    r = client.post("/api/media", files=[("files", ("big.mp4", io.BytesIO(sample_video_large), "video/mp4"))])
    media_id = r.json()[0]["id"]

    media = _wait_for_ready(client, media_id)
    display_path = cfg.DISPLAY_DIR / media["display_filename"]
    assert display_path.exists()

    client.request("DELETE", "/api/media/bulk", json={"ids": [media_id]})
    assert not display_path.exists()


# ─── Delete During Processing Tests ──────────────────────────


def _make_hevc_video() -> bytes:
    """Generate a short HEVC video that requires transcoding."""
    import subprocess
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
        path = f.name
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "color=c=red:s=320x240:d=1",
            "-c:v", "libx265", "-t", "1",
            path,
        ],
        capture_output=True,
        check=True,
    )
    from pathlib import Path
    data = Path(path).read_bytes()
    Path(path).unlink()
    return data


def test_delete_during_processing_no_orphaned_files(client):
    """Deleting a video mid-transcode must not leave orphaned files on disk."""
    import app.config as cfg

    hevc_data = _make_hevc_video()
    r = client.post("/api/media", files=[("files", ("hevc.mp4", io.BytesIO(hevc_data), "video/mp4"))])
    assert r.status_code == 200
    media = r.json()[0]
    media_id = media["id"]
    assert media["processing_status"] == "processing"

    # Delete immediately while transcode is running
    dr = client.delete(f"/api/media/{media_id}")
    assert dr.status_code == 200

    # Wait for background thread to finish (it should clean up after itself)
    time.sleep(5)

    # No orphaned transcoded files should exist
    transcoded_files = list(cfg.TRANSCODED_DIR.iterdir())
    assert len(transcoded_files) == 0, (
        f"Orphaned transcoded files after delete-during-processing: {[f.name for f in transcoded_files]}"
    )

    # No orphaned display files should exist
    display_files = list(cfg.DISPLAY_DIR.iterdir())
    assert len(display_files) == 0, (
        f"Orphaned display files after delete-during-processing: {[f.name for f in display_files]}"
    )


# ─── Blur Filename Pipeline Tests ────────────────────────────


def test_upload_photo_includes_blur_filename(client, sample_jpeg):
    """Uploaded photo response should include blur_filename."""
    response = client.post(
        "/api/media",
        files=[("files", ("photo.jpg", sample_jpeg, "image/jpeg"))],
    )
    assert response.status_code == 200
    media = response.json()[0]
    assert media["blur_filename"] is not None
    assert media["blur_filename"].startswith("blur_")


def test_upload_video_includes_blur_filename(client, sample_video):
    """Uploaded video response should include blur_filename."""
    response = client.post(
        "/api/media",
        files=[("files", ("clip.mp4", sample_video, "video/mp4"))],
    )
    assert response.status_code == 200
    media = response.json()[0]
    assert media["blur_filename"] is not None
    assert media["blur_filename"].startswith("blur_")


def test_delete_cleans_up_blur_file(client, sample_jpeg):
    """Deleting media should remove the blur file from disk."""
    import app.config as cfg

    response = client.post(
        "/api/media",
        files=[("files", ("photo.jpg", sample_jpeg, "image/jpeg"))],
    )
    media = response.json()[0]
    blur_filename = media["blur_filename"]
    assert blur_filename is not None
    assert (cfg.BLUR_DIR / blur_filename).exists()

    client.delete(f"/api/media/{media['id']}")
    assert not (cfg.BLUR_DIR / blur_filename).exists()


def test_bulk_delete_cleans_up_blur_file(client, sample_jpeg):
    """Bulk delete should remove the blur file from disk."""
    import app.config as cfg

    response = client.post(
        "/api/media",
        files=[("files", ("photo.jpg", sample_jpeg, "image/jpeg"))],
    )
    media = response.json()[0]
    blur_filename = media["blur_filename"]
    assert blur_filename is not None
    assert (cfg.BLUR_DIR / blur_filename).exists()

    client.request("DELETE", "/api/media/bulk", json={"ids": [media["id"]]})
    assert not (cfg.BLUR_DIR / blur_filename).exists()


def test_serve_blur_file(client, sample_jpeg):
    """GET /uploads/blur/{filename} should serve the blur file."""
    response = client.post(
        "/api/media",
        files=[("files", ("photo.jpg", sample_jpeg, "image/jpeg"))],
    )
    blur_filename = response.json()[0]["blur_filename"]

    resp = client.get(f"/uploads/blur/{blur_filename}")
    assert resp.status_code == 200
