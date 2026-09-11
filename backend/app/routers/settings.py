from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from ..database import get_session
from ..models import Setting, User
from ..security import require_auth, require_admin

router = APIRouter(prefix="/api/settings", tags=["settings"])

DEFAULT_SETTINGS = {
    "brand_eyebrow": "RECRUITING / SECURITY / DEVOPS / DEVSECOPS",
    "brand_title": "Hiring Tracker",
    "brand_subtitle": "Track candidates and open roles in one place. Click a stat to filter, click a candidate name to drill down.",
}


class SettingsUpdate(BaseModel):
    brand_eyebrow: Optional[str] = None
    brand_title: Optional[str] = None
    brand_subtitle: Optional[str] = None


def _all_settings(session: Session) -> dict:
    rows = session.exec(select(Setting)).all()
    data = {r.key: r.value for r in rows}
    for key, default in DEFAULT_SETTINGS.items():
        data.setdefault(key, default)
    return data


@router.get("")
def get_settings(session: Session = Depends(get_session), _user: User = Depends(require_auth)):
    return _all_settings(session)


@router.put("")
def update_settings(data: SettingsUpdate, session: Session = Depends(get_session),
                    _user: User = Depends(require_admin)):
    for key, value in data.model_dump(exclude_unset=True).items():
        row = session.exec(select(Setting).where(Setting.key == key)).first()
        if not row:
            row = Setting(key=key, value="")
            session.add(row)
        row.value = value or ""
    session.commit()
    return _all_settings(session)