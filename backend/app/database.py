from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import DATABASE_URL, DATA_DIR, ORIGINALS_DIR, THUMBNAILS_DIR, TRANSCODED_DIR


class Base(DeclarativeBase):
    pass


engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)


def _migrate_columns(conn) -> None:
    """Add missing columns to existing tables (idempotent)."""
    inspector = inspect(conn)
    if "media" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("media")}
    if "processing_status" not in existing:
        conn.execute(
            text("ALTER TABLE media ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'ready'")
        )
    if "content_hash" not in existing:
        conn.execute(text("ALTER TABLE media ADD COLUMN content_hash TEXT"))
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_media_content_hash ON media(content_hash)"))
    conn.commit()


def init_db():
    """Create all tables and ensure data directories exist."""
    for d in [DATA_DIR, ORIGINALS_DIR, THUMBNAILS_DIR, TRANSCODED_DIR]:
        d.mkdir(parents=True, exist_ok=True)
    # Run idempotent migrations before create_all
    with engine.connect() as conn:
        _migrate_columns(conn)
    Base.metadata.create_all(bind=engine)


def get_db():
    """Dependency that provides a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
