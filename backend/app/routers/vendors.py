from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..database import get_session
from ..models import Vendor, User
from ..security import require_auth, require_admin

router = APIRouter(prefix="/api/vendors", tags=["vendors"])


class VendorCreate(BaseModel):
    name: str


class VendorUpdate(BaseModel):
    name: str


def _to_dict(v: Vendor) -> dict:
    return {
        "id": v.id,
        "name": v.name,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


@router.get("")
def list_vendors(session: Session = Depends(get_session), _user: User = Depends(require_auth)):
    vendors = session.exec(select(Vendor).order_by(Vendor.name)).all()
    return [_to_dict(v) for v in vendors]


@router.post("")
def create_vendor(data: VendorCreate, session: Session = Depends(get_session),
                  _user: User = Depends(require_admin)):
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Vendor name is required")
    existing = session.exec(select(Vendor).where(Vendor.name == name)).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Vendor '{name}' already exists")
    vendor = Vendor(name=name)
    session.add(vendor)
    try:
        session.commit()
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=409, detail=f"Vendor already exists: {e}")
    session.refresh(vendor)
    return _to_dict(vendor)


@router.put("/{vendor_id}")
def update_vendor(vendor_id: int, data: VendorUpdate, session: Session = Depends(get_session),
                  _user: User = Depends(require_admin)):
    vendor = session.get(Vendor, vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Vendor name is required")
    dup = session.exec(select(Vendor).where(Vendor.name == name)).first()
    if dup and dup.id != vendor_id:
        raise HTTPException(status_code=409, detail=f"Vendor '{name}' already exists")
    vendor.name = name
    session.commit()
    session.refresh(vendor)
    return _to_dict(vendor)


@router.delete("/{vendor_id}")
def delete_vendor(vendor_id: int, session: Session = Depends(get_session),
                  _user: User = Depends(require_admin)):
    vendor = session.get(Vendor, vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    session.delete(vendor)
    session.commit()
    return {"ok": True}