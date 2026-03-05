"""Tests for security vulnerabilities, input validation, and error handling edge cases.

These tests are intentionally strict — they catch real bugs that could ship.
"""
import io

import pytest

from PIL import Image


# ─── Path Traversal Attack ────────────────────────────────────────


def test_path_traversal_originals(client, sample_jpeg):
    """Serving a filename with ../ must NOT escape the uploads directory."""
    # Upload a real file so the uploads dir isn't empty
    client.post("/api/media", files=[("files", ("photo.jpg", io.BytesIO(sample_jpeg), "image/jpeg"))])

    response = client.get("/uploads/originals/../../../etc/passwd")
    # Must be 404 (blocked), NOT 200 (file served)
    assert response.status_code in (400, 404, 422), (
        f"Path traversal succeeded! Got status {response.status_code} for ../../../etc/passwd"
    )


def test_path_traversal_thumbnails(client, sample_jpeg):
    """Same traversal attack on the thumbnails endpoint."""
    client.post("/api/media", files=[("files", ("photo.jpg", io.BytesIO(sample_jpeg), "image/jpeg"))])

    response = client.get("/uploads/thumbnails/../../../etc/passwd")
    assert response.status_code in (400, 404, 422), (
        f"Path traversal succeeded! Got status {response.status_code}"
    )


def test_path_traversal_transcoded(client):
    """Same traversal attack on the transcoded endpoint."""
    response = client.get("/uploads/transcoded/../../../etc/passwd")
    assert response.status_code in (400, 404, 422), (
        f"Path traversal succeeded! Got status {response.status_code}"
    )


def test_path_traversal_display(client):
    """Path traversal attack on the display endpoint must be blocked."""
    response = client.get("/uploads/display/../../../etc/passwd")
    assert response.status_code in (400, 404, 422), (
        f"Path traversal succeeded! Got status {response.status_code}"
    )


def test_path_traversal_encoded_dots(client):
    """URL-encoded path traversal: %2e%2e%2f should also be blocked."""
    response = client.get("/uploads/originals/%2e%2e/%2e%2e/%2e%2e/etc/passwd")
    assert response.status_code in (400, 404, 422), (
        f"Encoded path traversal succeeded! Got status {response.status_code}"
    )


def test_null_byte_in_filename_originals(client):
    """Null byte in filename must raise HTTPException(400), not unhandled ValueError."""
    from fastapi import HTTPException
    from app.routers.uploads import _serve_file
    from app import config

    with pytest.raises(HTTPException) as exc_info:
        _serve_file(config.ORIGINALS_DIR, "test\x00.jpg")
    assert exc_info.value.status_code == 400


def test_null_byte_in_filename_thumbnails(client):
    """Null byte in thumbnail filename must raise HTTPException(400)."""
    from fastapi import HTTPException
    from app.routers.uploads import _serve_file
    from app import config

    with pytest.raises(HTTPException) as exc_info:
        _serve_file(config.THUMBNAILS_DIR, "test\x00.jpg")
    assert exc_info.value.status_code == 400


def test_null_byte_in_filename_transcoded(client):
    """Null byte in transcoded filename must raise HTTPException(400)."""
    from fastapi import HTTPException
    from app.routers.uploads import _serve_file
    from app import config

    with pytest.raises(HTTPException) as exc_info:
        _serve_file(config.TRANSCODED_DIR, "test\x00.mp4")
    assert exc_info.value.status_code == 400


def test_null_byte_in_filename_display(client):
    """Null byte in display filename must raise HTTPException(400)."""
    from fastapi import HTTPException
    from app.routers.uploads import _serve_file
    from app import config

    with pytest.raises(HTTPException) as exc_info:
        _serve_file(config.DISPLAY_DIR, "test\x00.jpg")
    assert exc_info.value.status_code == 400


# ─── Corrupt File Upload Handling ─────────────────────────────────


def test_upload_zero_byte_image(client):
    """Uploading a 0-byte .jpg must not crash the server with an unhandled exception."""
    response = client.post(
        "/api/media",
        files=[("files", ("empty.jpg", io.BytesIO(b""), "image/jpeg"))],
    )
    # Should be a client-friendly error (400), NOT 500 (unhandled crash)
    assert response.status_code == 400, (
        f"Expected 400 for empty file, got {response.status_code}: {response.text}"
    )


def test_upload_corrupt_jpeg(client):
    """Uploading random bytes with a .jpg extension must return 400, not 500."""
    garbage = b"this is not a jpeg at all, just random text content"
    response = client.post(
        "/api/media",
        files=[("files", ("corrupt.jpg", io.BytesIO(garbage), "image/jpeg"))],
    )
    assert response.status_code == 400, (
        f"Expected 400 for corrupt JPEG, got {response.status_code}: {response.text}"
    )


def test_upload_corrupt_png(client):
    """Uploading random bytes with a .png extension must return 400, not 500."""
    garbage = b"\x00\x01\x02\x03\x04\x05"
    response = client.post(
        "/api/media",
        files=[("files", ("corrupt.png", io.BytesIO(garbage), "image/png"))],
    )
    assert response.status_code == 400, (
        f"Expected 400 for corrupt PNG, got {response.status_code}: {response.text}"
    )


def test_upload_corrupt_video(client):
    """Uploading random bytes with a .mp4 extension must return 400, not 500."""
    garbage = b"not a video file at all"
    response = client.post(
        "/api/media",
        files=[("files", ("corrupt.mp4", io.BytesIO(garbage), "video/mp4"))],
    )
    assert response.status_code == 400, (
        f"Expected 400 for corrupt video, got {response.status_code}: {response.text}"
    )


def test_upload_image_disguised_as_video(client, sample_jpeg):
    """A JPEG renamed to .mp4 must not crash ffprobe.

    ffprobe recognizes JPEG as valid MJPEG video (single-frame), so this returns 200.
    The key assertion is that it doesn't crash with 500.
    """
    response = client.post(
        "/api/media",
        files=[("files", ("trick.mp4", io.BytesIO(sample_jpeg), "video/mp4"))],
    )
    assert response.status_code in (200, 400), (
        f"Expected 200 or 400 for JPEG-as-MP4, got {response.status_code}: {response.text}"
    )


# ─── Settings Validation ──────────────────────────────────────────


def test_settings_negative_interval(client):
    """Negative slideshow_interval should be rejected."""
    response = client.put("/api/settings", json={"slideshow_interval": -5})
    # This should NOT be silently accepted
    assert response.status_code in (400, 422), (
        f"Negative interval was accepted! Got {response.status_code}: {response.json()}"
    )


def test_settings_zero_interval(client):
    """Zero slideshow_interval should be rejected (would cause zero-delay timer)."""
    response = client.put("/api/settings", json={"slideshow_interval": 0})
    assert response.status_code in (400, 422), (
        f"Zero interval was accepted! Got {response.status_code}: {response.json()}"
    )


def test_settings_extremely_large_interval(client):
    """Absurdly large interval (> 1 hour) should be rejected."""
    response = client.put("/api/settings", json={"slideshow_interval": 999999})
    assert response.status_code in (400, 422), (
        f"Interval of 999999s was accepted! Got {response.status_code}: {response.json()}"
    )


def test_settings_invalid_transition_type(client):
    """An invalid transition_type string should be rejected."""
    response = client.put("/api/settings", json={"transition_type": "spinzoom3d"})
    # The backend should only accept known transition types
    assert response.status_code in (400, 422), (
        f"Invalid transition 'spinzoom3d' was accepted! Got {response.status_code}: {response.json()}"
    )


def test_settings_empty_string_transition(client):
    """Empty string transition_type should be rejected."""
    response = client.put("/api/settings", json={"transition_type": ""})
    assert response.status_code in (400, 422), (
        f"Empty transition type was accepted! Got {response.status_code}: {response.json()}"
    )


def test_settings_null_interval(client):
    """Explicit null for slideshow_interval must return 422, not 500."""
    response = client.put("/api/settings", json={"slideshow_interval": None})
    assert response.status_code in (400, 422), (
        f"Null interval caused {response.status_code}, expected 400/422"
    )


def test_settings_null_transition(client):
    """Explicit null for transition_type must return 422, not 500."""
    response = client.put("/api/settings", json={"transition_type": None})
    assert response.status_code in (400, 422), (
        f"Null transition caused {response.status_code}, expected 400/422"
    )


def test_settings_both_null(client):
    """Both fields null must return 422, not 500."""
    response = client.put("/api/settings", json={"slideshow_interval": None, "transition_type": None})
    assert response.status_code in (400, 422), (
        f"Both null caused {response.status_code}, expected 400/422"
    )


# ─── Health Endpoint ──────────────────────────────────────────────


def test_health_endpoint(client):
    """GET /api/health should return {status: ok}."""
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


# ─── Upload Edge Cases ────────────────────────────────────────────


def test_upload_no_files(client):
    """POST /api/media with no files should return an error, not crash."""
    response = client.post("/api/media")
    # FastAPI should return 422 for missing required parameter
    assert response.status_code == 422


def test_upload_filename_with_special_chars(client, sample_jpeg):
    """Filenames with spaces, unicode, and special chars should be handled safely."""
    response = client.post(
        "/api/media",
        files=[("files", ("héllo wörld (1).jpg", io.BytesIO(sample_jpeg), "image/jpeg"))],
    )
    assert response.status_code == 200
    data = response.json()
    # Original name preserved, stored filename is a safe UUID
    assert data[0]["original_name"] == "héllo wörld (1).jpg"
    assert "-" in data[0]["filename"]  # UUID format


def test_upload_filename_with_path_separators(client, sample_jpeg):
    """Filenames containing path separators must not create files outside upload dirs."""
    response = client.post(
        "/api/media",
        files=[("files", ("../../etc/evil.jpg", io.BytesIO(sample_jpeg), "image/jpeg"))],
    )
    # Should succeed (the original_name is just metadata), but stored file uses UUID
    assert response.status_code == 200
    data = response.json()
    # Stored filename must be a UUID, NOT the malicious path
    assert "/" not in data[0]["filename"]
    assert ".." not in data[0]["filename"]


def test_upload_very_long_filename(client, sample_jpeg):
    """A filename with 1000+ characters should not crash the server."""
    long_name = "a" * 1000 + ".jpg"
    response = client.post(
        "/api/media",
        files=[("files", (long_name, io.BytesIO(sample_jpeg), "image/jpeg"))],
    )
    # Should either succeed or return a clean error
    assert response.status_code in (200, 400)


# ─── Bulk Delete Edge Cases ───────────────────────────────────────


def test_bulk_delete_negative_ids(client):
    """Negative IDs should be rejected by validation."""
    r = client.request("DELETE", "/api/media/bulk", json={"ids": [-1, -999]})
    assert r.status_code == 422


def test_bulk_delete_very_large_id(client):
    """Extremely large ID should not crash."""
    r = client.request("DELETE", "/api/media/bulk", json={"ids": [2147483647]})
    assert r.status_code == 200
    assert r.json()["not_found"] == [2147483647]


def test_bulk_delete_beyond_int64(client):
    """Integer beyond SQLite int64 range must return 422, not 500."""
    r = client.request("DELETE", "/api/media/bulk", json={"ids": [99999999999999999999]})
    assert r.status_code in (400, 422), (
        f"Huge int caused {r.status_code}, expected 400/422"
    )


# ─── Cache Headers ─────────────────────────────────────────


def test_uploads_have_cache_headers(client, sample_jpeg):
    """All /uploads/* responses should have immutable cache headers."""
    response = client.post(
        "/api/media",
        files=[("files", ("photo.jpg", sample_jpeg, "image/jpeg"))],
    )
    assert response.status_code == 200
    media = response.json()[0]

    resp = client.get(f"/uploads/thumbnails/{media['thumb_filename']}")
    assert resp.status_code == 200
    assert "max-age=31536000" in resp.headers.get("cache-control", "")
    assert "immutable" in resp.headers.get("cache-control", "")
