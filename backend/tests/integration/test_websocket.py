import io
import json


def test_websocket_connect(client):
    with client.websocket_connect("/ws") as ws:
        # Connection should succeed — just close cleanly
        pass


def test_websocket_media_added(client, sample_jpeg):
    with client.websocket_connect("/ws") as ws:
        # Upload a photo — should trigger broadcast
        client.post(
            "/api/media",
            files=[("files", ("photo.jpg", io.BytesIO(sample_jpeg), "image/jpeg"))],
        )

        msg = ws.receive_json()
        assert msg["event"] == "media_added"
        assert msg["data"]["original_name"] == "photo.jpg"
        assert msg["data"]["media_type"] == "photo"


def test_websocket_media_deleted(client, sample_jpeg):
    # Upload first
    upload = client.post(
        "/api/media",
        files=[("files", ("photo.jpg", io.BytesIO(sample_jpeg), "image/jpeg"))],
    )
    media_id = upload.json()[0]["id"]

    with client.websocket_connect("/ws") as ws:
        client.delete(f"/api/media/{media_id}")

        msg = ws.receive_json()
        assert msg["event"] == "media_deleted"
        assert msg["data"]["id"] == media_id


def test_websocket_settings_changed(client):
    with client.websocket_connect("/ws") as ws:
        # Ensure settings exist first
        client.get("/api/settings")

        client.put("/api/settings", json={"slideshow_interval": 25})

        msg = ws.receive_json()
        assert msg["event"] == "settings_changed"
        assert msg["data"]["slideshow_interval"] == 25
