import io
import json
import subprocess

import pytest


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
        assert msg["type"] == "media_added"
        assert msg["payload"]["original_name"] == "photo.jpg"
        assert msg["payload"]["media_type"] == "photo"


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
        assert msg["type"] == "media_deleted"
        assert msg["payload"]["id"] == media_id


def test_websocket_video_h264_ready_immediately(client, sample_video):
    """H.264 video is browser-compatible — should be ready immediately, no background processing."""
    with client.websocket_connect("/ws") as ws:
        client.post(
            "/api/media",
            files=[("files", ("clip.mp4", io.BytesIO(sample_video), "video/mp4"))],
        )

        msg = ws.receive_json()
        assert msg["type"] == "media_added"
        assert msg["payload"]["processing_status"] == "ready"
        assert msg["payload"]["media_type"] == "video"


@pytest.fixture()
def sample_hevc_video(tmp_path) -> bytes:
    """Create a minimal HEVC video using ffmpeg for transcode testing."""
    video_path = tmp_path / "test_hevc.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "color=c=blue:s=160x120:d=1",
            "-c:v", "libx265", "-t", "1",
            str(video_path),
        ],
        capture_output=True,
        check=True,
    )
    return video_path.read_bytes()


def test_websocket_video_processing_complete(client, sample_hevc_video):
    """HEVC video needs transcoding — sends media_added (processing), then media_processing_complete (ready)."""
    with client.websocket_connect("/ws") as ws:
        client.post(
            "/api/media",
            files=[("files", ("clip.mp4", io.BytesIO(sample_hevc_video), "video/mp4"))],
        )

        # First event: media_added (with processing status)
        msg = ws.receive_json()
        assert msg["type"] == "media_added"
        assert msg["payload"]["processing_status"] == "processing"

        # Progress events followed by completion
        while True:
            msg2 = ws.receive_json()
            if msg2["type"] == "media_processing_progress":
                assert 0 <= msg2["payload"]["progress"] <= 100
                continue
            assert msg2["type"] == "media_processing_complete"
            assert msg2["payload"]["processing_status"] == "ready"
            assert msg2["payload"]["transcoded_filename"] is not None
            break


def test_websocket_settings_changed(client):
    with client.websocket_connect("/ws") as ws:
        # Ensure settings exist first
        client.get("/api/settings")

        client.put("/api/settings", json={"slideshow_interval": 25})

        msg = ws.receive_json()
        assert msg["type"] == "settings_changed"
        assert msg["payload"]["slideshow_interval"] == 25
