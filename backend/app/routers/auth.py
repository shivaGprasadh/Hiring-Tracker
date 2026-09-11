from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlmodel import Session, select, delete

from ..database import get_session
from ..models import AuthSession, User
from ..security import (
    ROLES,
    SECURITY_QUESTIONS,
    create_session,
    clear_session_cookie,
    email_issues,
    get_current_user,
    hash_password,
    hash_security_answer,
    password_issues,
    require_admin,
    security_question_issues,
    set_session_cookie,
    user_dict,
    verify_password,
    verify_security_answer,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


class SignupIn(BaseModel):
    name: str
    email: str
    password: str


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class UserAdminUpdate(BaseModel):
    role: Optional[str] = None
    active: Optional[bool] = None


class CreateUserIn(BaseModel):
    name: str
    email: str
    password: str
    role: str = "view"


class ResetPasswordIn(BaseModel):
    new_password: str


class SecurityQuestionIn(BaseModel):
    question: str
    answer: str


class ForgotPasswordIn(BaseModel):
    email: str
    question: str
    answer: str
    new_password: str


class ForgotQuestionIn(BaseModel):
    email: str


def find_by_email(session: Session, email: str):
    return session.exec(select(User).where(User.email == email.strip().lower())).first()


@router.post("/signup")
def signup(data: SignupIn, response: Response, session: Session = Depends(get_session)):
    email = data.email.strip().lower()
    err = email_issues(email)
    if err:
        raise HTTPException(status_code=422, detail=err)
    err = password_issues(data.password)
    if err:
        raise HTTPException(status_code=422, detail=err)
    if find_by_email(session, email):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    is_first = session.exec(select(User)).first() is None
    user = User(
        email=email,
        name=data.name.strip() or email.split("@")[0],
        password_hash=hash_password(data.password),
        role="admin" if is_first else "view",
        active=True,
    )
    session.add(user)
    session.flush()
    token = create_session(user.id, session)
    set_session_cookie(response, token)
    return user_dict(user)


@router.post("/login")
def login(data: LoginIn, response: Response, session: Session = Depends(get_session)):
    email = data.email.strip().lower()
    user = find_by_email(session, email)
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    if not user.active:
        raise HTTPException(status_code=403, detail="This account is disabled. Contact an admin.")
    token = create_session(user.id, session)
    set_session_cookie(response, token)
    return user_dict(user)


@router.post("/logout")
def logout(request: Request, response: Response, session: Session = Depends(get_session)):
    token = request.cookies.get("session")
    if token:
        session.exec(delete(AuthSession).where(AuthSession.token == token))
        session.commit()
    clear_session_cookie(response)
    return {"ok": True}


@router.get("/me/security-question")
def get_my_security_question(user: User = Depends(get_current_user)):
    return {"has_security_question": bool(user.security_question), "question": user.security_question}


@router.put("/me/security-question")
def set_my_security_question(data: SecurityQuestionIn, session: Session = Depends(get_session),
                             user: User = Depends(get_current_user)):
    err = security_question_issues(data.question, data.answer)
    if err:
        raise HTTPException(status_code=422, detail=err)
    user.security_question = data.question
    user.security_answer_hash = hash_security_answer(data.answer)
    session.add(user)
    session.commit()
    return {"ok": True, "question": user.security_question}


@router.post("/forgot-question")
def forgot_question(data: ForgotQuestionIn, session: Session = Depends(get_session)):
    email = data.email.strip().lower()
    user = find_by_email(session, email)
    if not user:
        raise HTTPException(status_code=404, detail="No account found for that email.")
    if not user.active:
        raise HTTPException(status_code=403, detail="This account is disabled. Contact an admin.")
    return {"has_security_question": bool(user.security_question), "question": user.security_question}


@router.post("/forgot-password")
def forgot_password(data: ForgotPasswordIn, session: Session = Depends(get_session)):
    email = data.email.strip().lower()
    user = find_by_email(session, email)
    if not user:
        raise HTTPException(status_code=404, detail="No account found for that email.")
    if not user.active:
        raise HTTPException(status_code=403, detail="This account is disabled. Contact an admin.")
    if not user.security_answer_hash:
        raise HTTPException(status_code=400, detail="This account has no security question set. Contact an admin to reset your password.")
    if user.security_question != data.question:
        raise HTTPException(status_code=400, detail="Security question does not match.")
    if not verify_security_answer(data.answer, user.security_answer_hash):
        raise HTTPException(status_code=400, detail="Security answer is incorrect.")
    err = password_issues(data.new_password)
    if err:
        raise HTTPException(status_code=422, detail=err)
    user.password_hash = hash_password(data.new_password)
    session.exec(delete(AuthSession).where(AuthSession.user_id == user.id))
    session.add(user)
    session.commit()
    return {"ok": True}


@router.get("/security-questions")
def list_security_questions():
    return SECURITY_QUESTIONS


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return user_dict(user)


def _set_me_or_422(db_value, new_value, make_error):
    if new_value is None:
        return db_value
    err = make_error(new_value)
    if err:
        raise HTTPException(status_code=422, detail=err)
    return new_value


@router.put("/me/profile")
def update_profile(data: ProfileUpdate, response: Response, session: Session = Depends(get_session),
                   user: User = Depends(get_current_user)):
    if data.name is not None:
        user.name = data.name.strip() or user.name
    if data.email is not None:
        email = data.email.strip().lower()
        err = email_issues(email)
        if err:
            raise HTTPException(status_code=422, detail=err)
        other = find_by_email(session, email)
        if other and other.id != user.id:
            raise HTTPException(status_code=409, detail="An account with this email already exists.")
        user.email = email
    session.add(user)
    session.commit()
    session.refresh(user)
    return user_dict(user)


@router.put("/me/password")
def change_password(data: PasswordChange, session: Session = Depends(get_session),
                    user: User = Depends(get_current_user)):
    if data.current_password == data.new_password:
        raise HTTPException(status_code=422, detail="New password must be different from the current one.")
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    err = password_issues(data.new_password)
    if err:
        raise HTTPException(status_code=422, detail=err)
    user.password_hash = hash_password(data.new_password)
    session.add(user)
    session.commit()
    return {"ok": True}


@router.get("/users")
def list_users(session: Session = Depends(get_session), _: User = Depends(require_admin)):
    users = session.exec(select(User).order_by(User.id)).all()
    return [user_dict(u) for u in users]


@router.post("/users")
def create_user(data: CreateUserIn, session: Session = Depends(get_session), _: User = Depends(require_admin)):
    if data.role not in ROLES:
        raise HTTPException(status_code=422, detail="Invalid role. Choose admin, manager or view.")
    email = data.email.strip().lower()
    err = email_issues(email)
    if err:
        raise HTTPException(status_code=422, detail=err)
    if find_by_email(session, email):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    err = password_issues(data.password)
    if err:
        raise HTTPException(status_code=422, detail=err)
    user = User(
        email=email,
        name=data.name.strip() or email.split("@")[0],
        password_hash=hash_password(data.password),
        role=data.role,
        active=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user_dict(user)


@router.patch("/users/{user_id}")
def update_user(user_id: int, data: UserAdminUpdate, session: Session = Depends(get_session),
                _: User = Depends(require_admin)):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if data.role is not None:
        if data.role not in ROLES:
            raise HTTPException(status_code=422, detail="Invalid role. Choose admin, manager or view.")
        user.role = data.role
    if data.active is not None:
        user.active = data.active
        if not data.active:
            session.exec(delete(AuthSession).where(AuthSession.user_id == user.id))
    session.add(user)
    session.commit()
    session.refresh(user)
    return user_dict(user)


@router.post("/users/{user_id}/reset-password")
def reset_password(user_id: int, data: ResetPasswordIn, session: Session = Depends(get_session),
                   _: User = Depends(require_admin)):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    err = password_issues(data.new_password)
    if err:
        raise HTTPException(status_code=422, detail=err)
    user.password_hash = hash_password(data.new_password)
    session.exec(delete(AuthSession).where(AuthSession.user_id == user.id))
    session.add(user)
    session.commit()
    return {"ok": True}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, session: Session = Depends(get_session), current: User = Depends(require_admin)):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")
    session.exec(delete(AuthSession).where(AuthSession.user_id == user.id))
    session.delete(user)
    session.commit()
    return {"ok": True}