import io

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
