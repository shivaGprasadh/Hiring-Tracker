import os
import uuid
import csv
import io
import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlmodel import Session, select, delete

from ..database import get_session, DATA_DIR
from ..models import Role, Candidate, CandidateEvent, User
from ..schemas import CandidateUpdate
from ..security import require_auth, require_edit, require_admin

router = APIRouter(prefix="/api/candidates", tags=["candidates"])

RESUME_DIR = os.path.join(DATA_DIR, "resumes")

STATUS_EVENT_LABELS = {
    "Screening": "Screening started",
    "Interview Scheduled": "Interview scheduled",
    "Interview Completed": "Interview completed",
    "Offer Extended": "Offer extended",
    "Hired": "Hired",
    "On Hold": "On hold",
    "Rejected": "Rejected",
}

RESUME_CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".log": "text/plain",
    ".rtf": "application/rtf",
    ".html": "text/html",
    ".htm": "text/html",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".avif": "image/avif",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".odt": "application/vnd.oasis.opendocument.text",
}


def resume_content_type(filename: str) -> str:
    ext = os.path.splitext(filename or "")[1].lower()
    return RESUME_CONTENT_TYPES.get(ext, "application/octet-stream")


def _log_event(session: Session, candidate_id: int, event_type: str, label: str, occurred_at: Optional[datetime] = None) -> None:
    session.add(
        CandidateEvent(
            candidate_id=candidate_id,
            event_type=event_type,
            label=label,
            occurred_at=occurred_at or datetime.utcnow(),
        )
    )


def _log_changes(
    session: Session,
    c: Candidate,
    fields: dict,
    old_name: str,
    old_role_id: Optional[int],
    old_vendor: Optional[str],
    old_notes: Optional[str],
    old_status: str,
) -> None:
    if "name" in fields and (fields.get("name") or "").strip() != (old_name or "").strip():
        _log_event(session, c.id, "meta", f"Name updated - {c.name}")
    if "role_id" in fields and fields["role_id"] != old_role_id:
        role = session.get(Role, c.role_id) if c.role_id else None
        _log_event(session, c.id, "meta", f"Role updated - {role.name if role else 'Removed'}")
    if "vendor" in fields and fields["vendor"] != old_vendor:
        _log_event(session, c.id, "meta", f"Vendor updated - {c.vendor or 'removed'}")
    if "notes" in fields:
        old_n = (old_notes or "").strip()
        new_n = (c.notes or "").strip()
        if old_n != new_n:
            _log_event(session, c.id, "note", "Comment added" if new_n else "Comment removed")
    if "status" in fields and fields["status"] != old_status:
        _log_event(session, c.id, "status", STATUS_EVENT_LABELS.get(fields["status"], fields["status"]))


def _to_dict(c: Candidate, session: Session) -> dict:
    role = session.get(Role, c.role_id) if c.role_id else None
    return {
        "id": c.id,
        "name": c.name,
        "role_id": c.role_id,
        "role_name": role.name if role else None,
        "vendor": c.vendor,
        "status": c.status,
        "notes": c.notes,
        "resume_filename": c.resume_filename,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        "has_resume": bool(c.resume_path),
    }


class CandidateCreate(BaseModel):
    name: str
    role_id: Optional[int] = None
    vendor: Optional[str] = None
    status: str = "Sourcing"
    notes: Optional[str] = None


@router.get("")
def list_candidates(
    session: Session = Depends(get_session),
    role_id: int = Query(default=None),
    status: str = Query(default=None),
    vendor: str = Query(default=None),
    search: str = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=500),
    _user: User = Depends(require_auth),
):
    query = select(Candidate)
    if role_id:
        query = query.where(Candidate.role_id == role_id)
    if status:
        query = query.where(Candidate.status == status)
    if vendor:
        query = query.where(Candidate.vendor == vendor)
    if search:
        q = f"%{search}%"
        query = query.where(
            Candidate.name.contains(q) | (Candidate.notes.contains(q))
        )
    ordered = query.order_by(Candidate.created_at.desc())
    total = len(session.exec(ordered).all())
    offset = (page - 1) * page_size
    candidates = session.exec(ordered.offset(offset).limit(page_size)).all()
    return {"items": [_to_dict(c, session) for c in candidates], "total": total, "page": page, "page_size": page_size}


@router.get("/vendors")
def list_vendors(session: Session = Depends(get_session), _user: User = Depends(require_auth)):
    rows = session.exec(select(Candidate.vendor).distinct()).all()
    return [r for r in rows if r]


@router.get("/export")
def export_candidates(session: Session = Depends(get_session), fmt: str = Query(default="json"),
                      _user: User = Depends(require_admin)):
    candidates = session.exec(select(Candidate).order_by(Candidate.created_at.desc())).all()
    if fmt == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["id", "name", "role_id", "vendor", "status", "notes", "resume_filename", "created_at", "updated_at"])
        for c in candidates:
            w.writerow([
                c.id, c.name, c.role_id, c.vendor or "", c.status,
                c.notes or "", c.resume_filename or "",
                c.created_at.isoformat() if c.created_at else "",
                c.updated_at.isoformat() if c.updated_at else "",
            ])
        return Response(content=buf.getvalue(), media_type="text/csv", headers={
            "Content-Disposition": "attachment; filename=candidates.csv"
        })
    rows = []
    for c in candidates:
        rows.append({
            "name": c.name, "role_id": c.role_id, "vendor": c.vendor,
            "status": c.status, "notes": c.notes,
            "resume_filename": c.resume_filename,
        })
    return Response(
        content=json.dumps(rows, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=candidates.json"},
    )


@router.post("")
def create_candidate(data: CandidateCreate, session: Session = Depends(get_session),
                     _user: User = Depends(require_edit)):
    if not data.name.strip():
        raise HTTPException(status_code=422, detail="Candidate name is required")
    if data.role_id:
        if not session.get(Role, data.role_id):
            raise HTTPException(status_code=400, detail="Role not found")
    c = Candidate(
        name=data.name.strip(),
        role_id=data.role_id,
        vendor=data.vendor.strip() if data.vendor else None,
        status=data.status,
        notes=data.notes.strip() if data.notes else None,
    )
    session.add(c)
    session.commit()
    session.refresh(c)
    _log_event(session, c.id, "created", "Profile created in Hiring portal")
    session.commit()
    return _to_dict(c, session)


@router.put("/{candidate_id}")
def update_candidate(
    candidate_id: int,
    data: CandidateUpdate,
    session: Session = Depends(get_session),
    _user: User = Depends(require_edit),
):
    c = session.get(Candidate, candidate_id)
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")
    fields = data.model_dump(exclude_unset=True)
    if "role_id" in fields and fields["role_id"] is not None:
        if not session.get(Role, fields["role_id"]):
            raise HTTPException(status_code=400, detail="Role not found")
    old_name, old_role_id, old_vendor, old_notes, old_status = c.name, c.role_id, c.vendor, c.notes, c.status
    for key, value in fields.items():
        setattr(c, key, value)
    c.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(c)
    _log_changes(session, c, fields, old_name, old_role_id, old_vendor, old_notes, old_status)
    session.commit()
    return _to_dict(c, session)


@router.patch("/{candidate_id}")
def patch_candidate(
    candidate_id: int,
    data: CandidateUpdate,
    session: Session = Depends(get_session),
    _user: User = Depends(require_edit),
):
    c = session.get(Candidate, candidate_id)
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")
    fields = data.model_dump(exclude_unset=True)
    if "role_id" in fields and fields["role_id"] is not None:
        if not session.get(Role, fields["role_id"]):
            raise HTTPException(status_code=400, detail="Role not found")
    old_name, old_role_id, old_vendor, old_notes, old_status = c.name, c.role_id, c.vendor, c.notes, c.status
    for key, value in fields.items():
        setattr(c, key, value)
    c.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(c)
    _log_changes(session, c, fields, old_name, old_role_id, old_vendor, old_notes, old_status)
    session.commit()
    return _to_dict(c, session)


@router.get("/{candidate_id}/events")
def list_events(candidate_id: int, session: Session = Depends(get_session),
                _user: User = Depends(require_auth)):
    if not session.get(Candidate, candidate_id):
        raise HTTPException(status_code=404, detail="Candidate not found")
    events = session.exec(
        select(CandidateEvent)
        .where(CandidateEvent.candidate_id == candidate_id)
        .order_by(CandidateEvent.occurred_at, CandidateEvent.id)
    ).all()
    return [
        {
            "id": e.id,
            "event_type": e.event_type,
            "label": e.label,
            "occurred_at": e.occurred_at.isoformat() if e.occurred_at else None,
        }
        for e in events
    ]


@router.delete("/{candidate_id}")
def delete_candidate(candidate_id: int, session: Session = Depends(get_session),
                     _user: User = Depends(require_edit)):
    c = session.get(Candidate, candidate_id)
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if c.resume_path and os.path.exists(c.resume_path):
        try:
            os.remove(c.resume_path)
        except OSError:
            pass
    session.exec(delete(CandidateEvent).where(CandidateEvent.candidate_id == candidate_id))
    session.delete(c)
    session.commit()
    return {"ok": True}


class BulkDeleteRequest(BaseModel):
    ids: list[int]


@router.post("/bulk-delete")
def bulk_delete_candidates(data: BulkDeleteRequest, session: Session = Depends(get_session),
                           _user: User = Depends(require_edit)):
    deleted = 0
    for candidate_id in data.ids:
        c = session.get(Candidate, candidate_id)
        if not c:
            continue
        if c.resume_path and os.path.exists(c.resume_path):
            try:
                os.remove(c.resume_path)
            except OSError:
                pass
        session.exec(delete(CandidateEvent).where(CandidateEvent.candidate_id == candidate_id))
        session.delete(c)
        deleted += 1
    session.commit()
    return {"deleted": deleted}


@router.post("/{candidate_id}/resume")
async def upload_resume(
    candidate_id: int,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    _user: User = Depends(require_edit),
):
    c = session.get(Candidate, candidate_id)
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")

    os.makedirs(RESUME_DIR, exist_ok=True)
    safe_name = file.filename or "resume.bin"
    safe_name = "_".join(safe_name.split())
    safe_name = "".join(ch for ch in safe_name if ch.isalnum() or ch in "._-")
    if not safe_name:
        safe_name = "resume.bin"

    stored_name = f"{uuid.uuid4().hex}_{safe_name}"
    dest = os.path.join(RESUME_DIR, stored_name)

    try:
        content = await file.read()
        with open(dest, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to store file: {e}")

    if c.resume_path and os.path.exists(c.resume_path):
        try:
            os.remove(c.resume_path)
        except OSError:
            pass

    c.resume_filename = file.filename
    c.resume_path = dest
    c.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(c)
    _log_event(session, c.id, "resume", f"Resume uploaded - {file.filename}")
    session.commit()
    return _to_dict(c, session)


@router.get("/{candidate_id}/resume")
def download_resume(
    candidate_id: int,
    download: bool = Query(default=False),
    session: Session = Depends(get_session),
    _user: User = Depends(require_auth),
):
    c = session.get(Candidate, candidate_id)
    if not c or not c.resume_path or not os.path.exists(c.resume_path):
        raise HTTPException(status_code=404, detail="No resume uploaded")
    return FileResponse(
        c.resume_path,
        filename=c.resume_filename or "resume",
        media_type=resume_content_type(c.resume_filename),
        content_disposition_type="attachment" if download else "inline",
    )


@router.delete("/{candidate_id}/resume")
def delete_resume(candidate_id: int, session: Session = Depends(get_session),
                  _user: User = Depends(require_edit)):
    c = session.get(Candidate, candidate_id)
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if c.resume_path and os.path.exists(c.resume_path):
        try:
            os.remove(c.resume_path)
        except OSError:
            pass
    c.resume_filename = None
    c.resume_path = None
    c.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(c)
    _log_event(session, c.id, "resume", "Resume removed")
    session.commit()
    return _to_dict(c, session)