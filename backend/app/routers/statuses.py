from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..database import get_session
from ..models import Status, Candidate, User
from ..schemas import StatusCreate, StatusUpdate
from ..security import require_auth, require_admin

router = APIRouter(prefix="/api/statuses", tags=["statuses"])


def _to_dict(s: Status, count: int = 0) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "color": s.color,
        "bg": s.bg,
        "sort_order": s.sort_order,
        "candidate_count": count,
    }


@router.get("")
def list_statuses(session: Session = Depends(get_session), _user: User = Depends(require_auth)):
    statuses = session.exec(select(Status).order_by(Status.sort_order, Status.id)).all()
    result = []
    for s in statuses:
        count = len(session.exec(select(Candidate).where(Candidate.status == s.name)).all())
        result.append(_to_dict(s, count))
    return result


@router.post("")
def create_status(data: StatusCreate, session: Session = Depends(get_session),
                  _user: User = Depends(require_admin)):
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Status name is required")
    existing = session.exec(select(Status).where(Status.name == name)).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Status '{name}' already exists")
    top = session.exec(select(Status).order_by(Status.sort_order.desc())).first()
    status = Status(name=name, color=data.color or "#8B98A5", bg=data.bg or "#1C2A36", sort_order=(top.sort_order + 1 if top else 0))
    session.add(status)
    try:
        session.commit()
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=409, detail=f"Status already exists: {e}")
    session.refresh(status)
    return _to_dict(status, 0)


@router.put("/{status_id}")
def update_status(status_id: int, data: StatusUpdate, session: Session = Depends(get_session),
                  _user: User = Depends(require_admin)):
    status = session.get(Status, status_id)
    if not status:
        raise HTTPException(status_code=404, detail="Status not found")
    fields = data.model_dump(exclude_unset=True)
    if data.name is not None:
        new_name = data.name.strip()
        if not new_name:
            raise HTTPException(status_code=422, detail="Status name is required")
        dup = session.exec(select(Status).where(Status.name == new_name)).first()
        if dup and dup.id != status_id:
            raise HTTPException(status_code=409, detail=f"Status '{new_name}' already exists")
        if new_name != status.name:
            cands = session.exec(select(Candidate).where(Candidate.status == status.name)).all()
            for c in cands:
                c.status = new_name
        fields["name"] = new_name
    for key, value in fields.items():
        setattr(status, key, value)
    try:
        session.commit()
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=409, detail=f"Could not update status: {e}")
    session.refresh(status)
    return _to_dict(status)


@router.delete("/{status_id}")
def delete_status(status_id: int, session: Session = Depends(get_session),
                  _user: User = Depends(require_admin)):
    status = session.get(Status, status_id)
    if not status:
        raise HTTPException(status_code=404, detail="Status not found")
    count = len(session.exec(select(Candidate).where(Candidate.status == status.name)).all())
    if count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete status '{status.name}': {count} candidate(s) are in this status."
        )
    session.delete(status)
    session.commit()
    return {"ok": True}