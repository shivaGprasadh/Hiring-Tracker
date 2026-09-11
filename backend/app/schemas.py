from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class RoleCreate(BaseModel):
    name: str
    department: str = "Engineering"
    target_headcount: int = 1
    status: str = "Open"
    job_description: Optional[str] = None


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    department: Optional[str] = None
    target_headcount: Optional[int] = None
    status: Optional[str] = None
    job_description: Optional[str] = None


class CandidateUpdate(BaseModel):
    name: Optional[str] = None
    role_id: Optional[int] = None
    vendor: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class InterviewStageCreate(BaseModel):
    stage_name: str = Field(min_length=1)
    interviewer: Optional[str] = None
    rating: Optional[float] = Field(default=None, ge=1, le=5)
    feedback: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    completed: bool = False


class InterviewStageUpdate(BaseModel):
    stage_name: Optional[str] = None
    interviewer: Optional[str] = None
    rating: Optional[float] = Field(default=None, ge=1, le=5)
    feedback: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    completed: Optional[bool] = None


class StatusCreate(BaseModel):
    name: str
    color: str = "#8B98A5"
    bg: str = "#1C2A36"


class StatusUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    bg: Optional[str] = None
    sort_order: Optional[int] = None