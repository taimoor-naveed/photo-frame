import pytest


def _upload_photo(client, sample_jpeg):
    """Upload a photo and return the media dict."""
    resp = client.post(
        "/api/media",
        files=[("files", ("test.jpg", sample_jpeg, "image/jpeg"))],
    )
    assert resp.status_code == 200
    return resp.json()[0]


def _upload_video(client, sample_video):
    """Upload a video and return the media dict."""
    resp = client.post(
        "/api/media",
        files=[("files", ("test.mp4", sample_video, "video/mp4"))],
    )
    assert resp.status_code == 200
    return resp.json()[0]


class TestSetCrop:
    def test_set_crop_on_photo(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.3, "crop_y": 0.2, "crop_scale": 1.5},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["crop_x"] == pytest.approx(0.3)
        assert data["crop_y"] == pytest.approx(0.2)
        assert data["crop_scale"] == pytest.approx(1.5)

    def test_update_existing_crop(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.3, "crop_y": 0.2, "crop_scale": 1.5},
        )
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.6, "crop_y": 0.8, "crop_scale": 2.0},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["crop_x"] == pytest.approx(0.6)
        assert data["crop_scale"] == pytest.approx(2.0)

    def test_set_crop_on_video_rejected(self, client, sample_video):
        media = _upload_video(client, sample_video)
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.5, "crop_y": 0.5, "crop_scale": 1.0},
        )
        assert resp.status_code == 400
        assert "photo" in resp.text.lower() or "video" in resp.text.lower()

    def test_set_crop_not_found(self, client):
        resp = client.put(
            "/api/media/99999/crop",
            json={"crop_x": 0.5, "crop_y": 0.5, "crop_scale": 1.0},
        )
        assert resp.status_code == 404

    def test_set_crop_invalid_values(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        # crop_x out of range
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 1.5, "crop_y": 0.5, "crop_scale": 1.0},
        )
        assert resp.status_code == 422

        # crop_scale below 1
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.5, "crop_y": 0.5, "crop_scale": 0.5},
        )
        assert resp.status_code == 422

        # missing field
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.5, "crop_y": 0.5},
        )
        assert resp.status_code == 422

    def test_crop_persists_in_get(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.3, "crop_y": 0.2, "crop_scale": 1.5},
        )
        resp = client.get(f"/api/media/{media['id']}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["crop_x"] == pytest.approx(0.3)
        assert data["crop_y"] == pytest.approx(0.2)
        assert data["crop_scale"] == pytest.approx(1.5)

    def test_crop_appears_in_list(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.4, "crop_y": 0.5, "crop_scale": 1.8},
        )
        resp = client.get("/api/media")
        assert resp.status_code == 200
        items = resp.json()["items"]
        item = next(i for i in items if i["id"] == media["id"])
        assert item["crop_x"] == pytest.approx(0.4)


class TestRemoveCrop:
    def test_remove_crop(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.3, "crop_y": 0.2, "crop_scale": 1.5},
        )
        resp = client.delete(f"/api/media/{media['id']}/crop")
        assert resp.status_code == 200
        data = resp.json()
        assert data["crop_x"] is None
        assert data["crop_y"] is None
        assert data["crop_scale"] is None

    def test_remove_crop_when_none_exists(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        resp = client.delete(f"/api/media/{media['id']}/crop")
        assert resp.status_code == 200
        data = resp.json()
        assert data["crop_x"] is None

    def test_remove_crop_not_found(self, client):
        resp = client.delete("/api/media/99999/crop")
        assert resp.status_code == 404

    def test_remove_crop_persists(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.3, "crop_y": 0.2, "crop_scale": 1.5},
        )
        client.delete(f"/api/media/{media['id']}/crop")
        resp = client.get(f"/api/media/{media['id']}")
        data = resp.json()
        assert data["crop_x"] is None
        assert data["crop_y"] is None
        assert data["crop_scale"] is None


class TestSetCropEdgeCases:
    """Additional edge cases: negative values, wrong types, boundary IDs."""

    def test_negative_crop_values(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": -1.0, "crop_y": 0.5, "crop_scale": 1.0},
        )
        assert resp.status_code == 422

        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.5, "crop_y": -0.001, "crop_scale": 1.0},
        )
        assert resp.status_code == 422

        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.5, "crop_y": 0.5, "crop_scale": -5.0},
        )
        assert resp.status_code == 422

    def test_wrong_types_rejected(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": "hello", "crop_y": 0.5, "crop_scale": 1.0},
        )
        assert resp.status_code == 422

        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.5, "crop_y": True, "crop_scale": 1.0},
        )
        # Note: True coerces to 1.0 in Pydantic, which is valid
        assert resp.status_code in (200, 422)

    def test_crop_scale_at_maximum(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.5, "crop_y": 0.5, "crop_scale": 10.0},
        )
        assert resp.status_code == 200
        assert resp.json()["crop_scale"] == pytest.approx(10.0)

    def test_media_id_zero_rejected(self, client):
        resp = client.put(
            "/api/media/0/crop",
            json={"crop_x": 0.5, "crop_y": 0.5, "crop_scale": 1.0},
        )
        assert resp.status_code == 422

    def test_media_id_negative_rejected(self, client):
        resp = client.put(
            "/api/media/-1/crop",
            json={"crop_x": 0.5, "crop_y": 0.5, "crop_scale": 1.0},
        )
        assert resp.status_code == 422

    def test_empty_body_rejected(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={},
        )
        assert resp.status_code == 422


class TestRemoveCropEdgeCases:
    def test_remove_crop_on_video_rejected(self, client, sample_video):
        media = _upload_video(client, sample_video)
        resp = client.delete(f"/api/media/{media['id']}/crop")
        assert resp.status_code == 400

    def test_remove_crop_media_id_zero(self, client):
        resp = client.delete("/api/media/0/crop")
        assert resp.status_code == 422

    def test_remove_crop_media_id_negative(self, client):
        resp = client.delete("/api/media/-1/crop")
        assert resp.status_code == 422


class TestCropExplicitNulls:
    """Lesson from QA Round 2: explicit null in JSON must return 422, not 500."""

    def test_explicit_null_crop_x(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": None, "crop_y": 0.5, "crop_scale": 1.0},
        )
        assert resp.status_code == 422

    def test_explicit_null_crop_y(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.5, "crop_y": None, "crop_scale": 1.0},
        )
        assert resp.status_code == 422

    def test_explicit_null_crop_scale(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.5, "crop_y": 0.5, "crop_scale": None},
        )
        assert resp.status_code == 422


class TestCropIntegerOverflow:
    """Lesson from QA Round 2: huge ints for IDs must not cause 500."""

    def test_set_crop_huge_media_id(self, client):
        huge_id = 2**63
        resp = client.put(
            f"/api/media/{huge_id}/crop",
            json={"crop_x": 0.5, "crop_y": 0.5, "crop_scale": 1.0},
        )
        assert resp.status_code in (404, 422)

    def test_remove_crop_huge_media_id(self, client):
        huge_id = 2**63
        resp = client.delete(f"/api/media/{huge_id}/crop")
        assert resp.status_code in (404, 422)


class TestCropWebSocketBroadcast:
    """Cross-boundary: verify WS broadcast payload has correct field names."""

    def test_set_crop_broadcasts_media_updated(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        with client.websocket_connect("/ws") as ws:
            client.put(
                f"/api/media/{media['id']}/crop",
                json={"crop_x": 0.3, "crop_y": 0.2, "crop_scale": 1.5},
            )
            msg = ws.receive_json()
            assert msg["type"] == "media_updated"
            payload = msg["payload"]
            assert payload["crop_x"] == pytest.approx(0.3)
            assert payload["crop_y"] == pytest.approx(0.2)
            assert payload["crop_scale"] == pytest.approx(1.5)
            assert payload["id"] == media["id"]
            assert payload["filename"] == media["filename"]
            assert payload["media_type"] == "photo"

    def test_remove_crop_broadcasts_media_updated(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.3, "crop_y": 0.2, "crop_scale": 1.5},
        )
        with client.websocket_connect("/ws") as ws:
            client.delete(f"/api/media/{media['id']}/crop")
            msg = ws.receive_json()
            assert msg["type"] == "media_updated"
            payload = msg["payload"]
            assert payload["crop_x"] is None
            assert payload["crop_y"] is None
            assert payload["crop_scale"] is None


class TestUploadedMediaHasNoCrop:
    def test_new_upload_has_no_crop(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        assert media["crop_x"] is None
        assert media["crop_y"] is None
        assert media["crop_scale"] is None
