from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import DATABASE_URL, DATA_DIR, ORIGINALS_DIR, THUMBNAILS_DIR, TRANSCODED_DIR


class Base(DeclarativeBase):
    pass


engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)


def init_db():
    """Create all tables and ensure data directories exist."""
    for d in [DATA_DIR, ORIGINALS_DIR, THUMBNAILS_DIR, TRANSCODED_DIR]:
        d.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)


def get_db():
    """Dependency that provides a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
