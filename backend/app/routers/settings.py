import asyncio

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Settings
from app.schemas import SettingsOut, SettingsUpdate
from app.websocket import manager

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _get_or_create_settings(db: Session) -> Settings:
    settings = db.query(Settings).filter(Settings.id == 1).first()
    if not settings:
        settings = Settings(id=1)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


@router.get("", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db)):
    return _get_or_create_settings(db)


@router.put("", response_model=SettingsOut)
async def update_settings(update: SettingsUpdate, db: Session = Depends(get_db)):
    settings = _get_or_create_settings(db)
    update_data = update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(settings, key, value)
    db.commit()
    db.refresh(settings)

    asyncio.create_task(
        manager.broadcast({
            "event": "settings_changed",
            "data": SettingsOut.model_validate(settings).model_dump(),
        })
    )

    return settings
