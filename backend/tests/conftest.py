import io
import subprocess

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app


@pytest.fixture()
def tmp_dirs(tmp_path):
    """Create temporary directories for uploads."""
    originals = tmp_path / "originals"
    thumbnails = tmp_path / "thumbnails"
    transcoded = tmp_path / "transcoded"
    originals.mkdir()
    thumbnails.mkdir()
    transcoded.mkdir()
    return {"originals": originals, "thumbnails": thumbnails, "transcoded": transcoded}


@pytest.fixture()
def db_session(tmp_path):
    """Create a test database session with a temp SQLite file."""
    db_path = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestSession = sessionmaker(bind=engine)
    session = TestSession()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Create a test client with isolated DB and file directories."""
    db_path = tmp_path / "test.db"
    originals = tmp_path / "originals"
    thumbnails = tmp_path / "thumbnails"
    transcoded = tmp_path / "transcoded"
    originals.mkdir()
    thumbnails.mkdir()
    transcoded.mkdir()

    # All services/routers read from app.config at call time,
    # so patching config is sufficient
    import app.config as config
    monkeypatch.setattr(config, "ORIGINALS_DIR", originals)
    monkeypatch.setattr(config, "THUMBNAILS_DIR", thumbnails)
    monkeypatch.setattr(config, "TRANSCODED_DIR", transcoded)

    # Patch database
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestSession = sessionmaker(bind=engine)

    def override_get_db():
        session = TestSession()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db

    # Also patch SessionLocal so background threads use the test DB
    import app.database as database_module
    monkeypatch.setattr(database_module, "SessionLocal", TestSession)
    import app.routers.media as media_module
    monkeypatch.setattr(media_module, "SessionLocal", TestSession)

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


@pytest.fixture()
def sample_jpeg() -> bytes:
    """Create a minimal JPEG image in memory."""
    img = Image.new("RGB", (800, 600), color="red")
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture()
def sample_png() -> bytes:
    """Create a minimal PNG image in memory."""
    img = Image.new("RGB", (640, 480), color="green")
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture()
def sample_video(tmp_path) -> bytes:
    """Create a minimal MP4 video using ffmpeg."""
    video_path = tmp_path / "test_video.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "color=c=red:s=320x240:d=1",
            "-c:v", "libx264", "-t", "1",
            str(video_path),
        ],
        capture_output=True,
        check=True,
    )
    return video_path.read_bytes()
