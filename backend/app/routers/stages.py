from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..database import get_session
from ..models import Candidate, InterviewStage, CandidateEvent, User
from ..schemas import InterviewStageCreate, InterviewStageUpdate
from ..security import require_auth, require_edit

router = APIRouter(tags=["stages"])


def _log_event(session: Session, candidate_id: int, event_type: str, label: str, occurred_at=None) -> None:
    session.add(
        CandidateEvent(
            candidate_id=candidate_id,
            event_type=event_type,
            label=label,
            occurred_at=occurred_at,
        )
    )


@router.get("/api/candidates/{candidate_id}/stages")
def list_stages(candidate_id: int, session: Session = Depends(get_session),
                _user: User = Depends(require_auth)):
    if not session.get(Candidate, candidate_id):
        raise HTTPException(status_code=404, detail="Candidate not found")
    stages = session.exec(
        select(InterviewStage)
        .where(InterviewStage.candidate_id == candidate_id)
        .order_by(InterviewStage.created_at)
    ).all()
    return [
        {
            "id": s.id,
            "candidate_id": s.candidate_id,
            "stage_name": s.stage_name,
            "interviewer": s.interviewer,
            "rating": s.rating,
            "feedback": s.feedback,
            "scheduled_at": s.scheduled_at.isoformat() if s.scheduled_at else None,
            "completed": s.completed,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in stages
    ]


@router.post("/api/candidates/{candidate_id}/stages")
def create_stage(
    candidate_id: int,
    data: InterviewStageCreate,
    session: Session = Depends(get_session),
    _user: User = Depends(require_edit),
):
    if not session.get(Candidate, candidate_id):
        raise HTTPException(status_code=404, detail="Candidate not found")
    stage = InterviewStage(candidate_id=candidate_id, **data.model_dump())
    session.add(stage)
    session.commit()
    session.refresh(stage)
    _log_event(
        session,
        candidate_id,
        "stage_scheduled",
        f"Interview scheduled - {stage.stage_name}",
        stage.scheduled_at or stage.created_at,
    )
    session.commit()
    return {
        "id": stage.id,
        "candidate_id": stage.candidate_id,
        "stage_name": stage.stage_name,
        "interviewer": stage.interviewer,
        "rating": stage.rating,
        "feedback": stage.feedback,
        "scheduled_at": stage.scheduled_at.isoformat() if stage.scheduled_at else None,
        "completed": stage.completed,
        "created_at": stage.created_at.isoformat() if stage.created_at else None,
    }


@router.put("/api/stages/{stage_id}")
def update_stage(stage_id: int, data: InterviewStageUpdate, session: Session = Depends(get_session),
                 _user: User = Depends(require_edit)):
    stage = session.get(InterviewStage, stage_id)
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    fields = data.model_dump(exclude_unset=True)
    was_completed = stage.completed
    for key, value in fields.items():
        setattr(stage, key, value)
    session.commit()
    session.refresh(stage)
    if fields.get("completed") and not was_completed:
        _log_event(
            session,
            stage.candidate_id,
            "stage_completed",
            f"Interview completed - {stage.stage_name}",
        )
        session.commit()
    return {
        "id": stage.id,
        "candidate_id": stage.candidate_id,
        "stage_name": stage.stage_name,
        "interviewer": stage.interviewer,
        "rating": stage.rating,
        "feedback": stage.feedback,
        "scheduled_at": stage.scheduled_at.isoformat() if stage.scheduled_at else None,
        "completed": stage.completed,
        "created_at": stage.created_at.isoformat() if stage.created_at else None,
    }


@router.delete("/api/stages/{stage_id}")
def delete_stage(stage_id: int, session: Session = Depends(get_session),
                 _user: User = Depends(require_edit)):
    stage = session.get(InterviewStage, stage_id)
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    session.delete(stage)
    session.commit()
    return {"ok": True}