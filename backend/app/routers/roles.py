from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..database import get_session
from ..models import Role, Candidate, User
from ..schemas import RoleCreate, RoleUpdate
from ..security import require_auth, require_admin

router = APIRouter(prefix="/api/roles", tags=["roles"])


@router.get("")
def list_roles(session: Session = Depends(get_session), _user: User = Depends(require_auth)):
    roles = session.exec(select(Role)).all()
    result = []
    for r in roles:
        count = len(session.exec(select(Candidate).where(Candidate.role_id == r.id)).all())
        result.append({
            "id": r.id,
            "name": r.name,
            "department": r.department,
            "target_headcount": r.target_headcount,
            "status": r.status,
            "job_description": r.job_description,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "candidate_count": count,
        })
    return result


@router.post("")
def create_role(role: RoleCreate, session: Session = Depends(get_session),
                _user: User = Depends(require_admin)):
    existing = session.exec(select(Role).where(Role.name == role.name)).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Role '{role.name}' already exists")
    db_role = Role(**role.model_dump())
    session.add(db_role)
    try:
        session.commit()
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=409, detail=f"Role already exists: {e}")
    session.refresh(db_role)
    return db_role


@router.put("/{role_id}")
def update_role(role_id: int, data: RoleUpdate, session: Session = Depends(get_session),
                _user: User = Depends(require_admin)):
    role = session.get(Role, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    fields = data.model_dump(exclude_unset=True)
    for key, value in fields.items():
        setattr(role, key, value)
    try:
        session.commit()
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=409, detail=f"Could not update role: {e}")
    session.refresh(role)
    return role


@router.delete("/{role_id}")
def delete_role(role_id: int, session: Session = Depends(get_session),
                _user: User = Depends(require_admin)):
    role = session.get(Role, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    count = len(session.exec(select(Candidate).where(Candidate.role_id == role_id)).all())
    if count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete role '{role.name}': {count} candidate(s) assigned. Reassign them first."
        )
    session.delete(role)
    session.commit()
    return {"ok": True}