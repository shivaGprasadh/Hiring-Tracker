import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, Request
from sqlmodel import Session, func, select

from .database import get_session
from .models import AuthSession, User

SESSION_COOKIE = "session"
SESSION_TTL = timedelta(days=1)
ROLES = ("admin", "manager", "view")
PBKDF2_ITER = 120000

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ITER).hex()
    return f"pbkdf2_sha256${PBKDF2_ITER}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt, digest = stored.split("$")
    except (AttributeError, ValueError):
        return False
    if algo != "pbkdf2_sha256":
        return False
    calc = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iters)).hex()
    return hmac.compare_digest(calc, digest)


def password_issues(password: str):
    if not password or len(password) < 8:
        return "Password must be at least 8 characters long."
    if not re.search(r"[a-z]", password):
        return "Password must contain at least one lowercase letter."
    if not re.search(r"[A-Z]", password):
        return "Password must contain at least one uppercase letter."
    if not re.search(r"\d", password):
        return "Password must contain at least one digit."
    return None


POLICY_HINT = "8+ characters with at least one uppercase, one lowercase, and one digit."

SECURITY_QUESTIONS = (
    "What is your mother's maiden name?",
    "What city were you born in?",
    "What is the name of your first pet?",
    "What was the make and model of your first car?",
    "What elementary school did you attend?",
    "What is your favorite food?",
    "What is the name of your best childhood friend?",
)


def normalize_answer(answer: str) -> str:
    return " ".join(str(answer or "").strip().lower().split())


def hash_security_answer(answer: str) -> str:
    return hash_password(normalize_answer(answer))


def verify_security_answer(answer: str, stored: str) -> bool:
    if not stored:
        return False
    return verify_password(normalize_answer(answer), stored)


def security_question_issues(question: str, answer: str):
    if not question or question not in SECURITY_QUESTIONS:
        return "Choose a security question from the list."
    if not normalize_answer(answer):
        return "Provide an answer to your security question."
    return None


def email_issues(email):
    if not email or not EMAIL_RE.match(str(email).strip()):
        return "Enter a valid email address (e.g. name@example.com)."
    return None


def get_current_user(request: Request, session: Session = Depends(get_session)) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    auth_row = session.exec(select(AuthSession).where(AuthSession.token == token)).first()
    if not auth_row or auth_row.expires_at < datetime.utcnow():
        raise HTTPException(status_code=401, detail="Session expired.")
    user = session.get(User, auth_row.user_id)
    if not user or not user.active:
        raise HTTPException(status_code=401, detail="Account unavailable.")
    return user


def require_role(*roles):
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Not allowed for your role.")
        return user

    return dependency


require_auth = get_current_user
require_edit = require_role("admin", "manager")
require_admin = require_role("admin")


def create_session(user_id: int, session: Session) -> str:
    token = secrets.token_urlsafe(32)
    session.add(AuthSession(
        token=token,
        user_id=user_id,
        created_at=datetime.utcnow(),
        expires_at=datetime.utcnow() + SESSION_TTL,
    ))
    session.commit()
    return token


def set_session_cookie(response, token: str):
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response):
    response.delete_cookie(SESSION_COOKIE, path="/")


def user_dict(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "active": user.active,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "has_security_question": bool(user.security_question and user.security_answer_hash),
        "security_question": user.security_question,
    }