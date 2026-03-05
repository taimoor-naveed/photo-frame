def test_slideshow_jump_valid_media(client, sample_jpeg):
    """POST /api/media/slideshow/jump with valid media_id broadcasts WS event."""
    # Upload a photo first to get a valid media_id
    resp = client.post("/api/media", files=[("files", ("test.jpg", sample_jpeg, "image/jpeg"))])
    assert resp.status_code == 200
    media_id = resp.json()[0]["id"]

    resp = client.post("/api/media/slideshow/jump", json={"media_id": media_id})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_slideshow_jump_nonexistent_media(client):
    """POST /api/media/slideshow/jump with nonexistent media_id returns 404."""
    resp = client.post("/api/media/slideshow/jump", json={"media_id": 999999})
    assert resp.status_code == 404


def test_slideshow_jump_invalid_id_zero(client):
    """POST /api/media/slideshow/jump with media_id=0 returns 422."""
    resp = client.post("/api/media/slideshow/jump", json={"media_id": 0})
    assert resp.status_code == 422


def test_slideshow_jump_invalid_id_negative(client):
    """POST /api/media/slideshow/jump with negative media_id returns 422."""
    resp = client.post("/api/media/slideshow/jump", json={"media_id": -1})
    assert resp.status_code == 422


def test_slideshow_jump_missing_field(client):
    """POST /api/media/slideshow/jump with no body returns 422."""
    resp = client.post("/api/media/slideshow/jump", json={})
    assert resp.status_code == 422
