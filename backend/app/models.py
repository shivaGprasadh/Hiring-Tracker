from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field


class Role(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    department: str = Field(default="Engineering")
    target_headcount: int = Field(default=1)
    status: str = Field(default="Open")
    job_description: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Candidate(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    role_id: Optional[int] = Field(default=None, foreign_key="role.id", ondelete="RESTRICT")
    vendor: Optional[str] = Field(default=None)
    status: str = Field(default="Sourcing", index=True)
    notes: Optional[str] = None
    resume_filename: Optional[str] = None
    resume_path: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class InterviewStage(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    candidate_id: int = Field(foreign_key="candidate.id", ondelete="CASCADE", index=True)
    stage_name: str = Field(default="Screening Call")
    interviewer: Optional[str] = None
    rating: Optional[float] = Field(default=None, ge=1, le=5)
    feedback: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    completed: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Vendor(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CandidateEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    candidate_id: int = Field(foreign_key="candidate.id", ondelete="CASCADE", index=True)
    event_type: str = Field(default="status")
    label: str = Field(default="")
    occurred_at: datetime = Field(default_factory=datetime.utcnow)


class Status(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    color: str = Field(default="#8B98A5")
    bg: str = Field(default="#1C2A36")
    sort_order: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Setting(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    key: str = Field(index=True, unique=True)
    value: str = Field(default="")


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    name: str = Field(default="")
    password_hash: str = Field(default="")
    role: str = Field(default="view")
    active: bool = Field(default=True)
    security_question: Optional[str] = None
    security_answer_hash: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AuthSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    token: str = Field(index=True, unique=True)
    user_id: int = Field(foreign_key="user.id", ondelete="CASCADE", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: datetime = Field(default_factory=datetime.utcnow)