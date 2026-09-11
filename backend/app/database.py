import logging
import os
from sqlmodel import SQLModel, Session, select, create_engine
from sqlalchemy import event as sa_event

logger = logging.getLogger("uvicorn.error")

DATA_DIR = os.environ.get("DATA_DIR", "/data")
DB_PATH = os.path.join(DATA_DIR, "tracker.db")

BOOTSTRAP_ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "").strip().lower()
BOOTSTRAP_ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
BOOTSTRAP_ADMIN_NAME = os.environ.get("ADMIN_NAME", "").strip()

try:
    os.makedirs(DATA_DIR, exist_ok=True)
except OSError:
    DATA_DIR = "./data"
    DB_PATH = os.path.join(DATA_DIR, "tracker.db")
    os.makedirs(DATA_DIR, exist_ok=True)

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    echo=False,
    connect_args={"check_same_thread": False},
)


@sa_event.listens_for(engine, "connect")
def _enable_foreign_keys(dbapi_connection, _):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def init_db() -> None:
    """Create all tables and seed default roles."""
    from . import models  # noqa: F401
    from sqlmodel import select

    SQLModel.metadata.create_all(engine)

    _migrate_user_security_columns()

    with Session(engine) as session:
        existing = session.exec(select(models.Role)).first()
        if existing is None:
            defaults = [
                ("L1 Analyst", "Engineering", "First line triage and monitoring analyst.", 2, "Open"),
                ("Data / AI", "Data", "Data engineering and AI/ML platform buildout.", 2, "Open"),
                ("SOC L1 role", "Security", "Level 1 SOC monitoring and incident response.", 2, "Open"),
                ("WAF JD", "Security", "Web Application Firewall engineering role.", 1, "Open"),
                ("VM", "Engineering", "Virtualization management and infrastructure support.", 1, "Open"),
            ]
            for name, dept, jd, headcount, status in defaults:
                session.add(
                    models.Role(
                        name=name,
                        department=dept,
                        job_description=jd,
                        target_headcount=headcount,
                        status=status,
                    )
                )
            session.commit()

    with Session(engine) as session:
        existing = session.exec(select(models.Status)).first()
        if existing is None:
            defaults = [
                ("Sourcing", "#8B98A5", "#1C2A36"),
                ("Screening", "#A78BFA", "#2A2340"),
                ("Interview Scheduled", "#F5A623", "#3F2E0C"),
                ("Interview Completed", "#2DD4BF", "#123B36"),
                ("Offer Extended", "#4ADE80", "#143622"),
                ("Hired", "#4ADE80", "#143622"),
                ("On Hold", "#8B98A5", "#1C2A36"),
                ("Rejected", "#F0645C", "#3A1917"),
            ]
            for i, (name, color, bg) in enumerate(defaults):
                session.add(models.Status(name=name, color=color, bg=bg, sort_order=i))
            session.commit()

    with Session(engine) as session:
        defaults = {
            "brand_eyebrow": "RECRUITING / SECURITY / DEVOPS / DEVSECOPS",
            "brand_title": "Hiring Tracker",
            "brand_subtitle": "Track candidates and open roles in one place. Click a stat to filter, click a candidate name to drill down.",
        }
        for key, value in defaults.items():
            exists = session.exec(select(models.Setting).where(models.Setting.key == key)).first()
            if exists is None:
                session.add(models.Setting(key=key, value=value))
        session.commit()

    with Session(engine) as session:
        cands = session.exec(select(models.Candidate)).all()
        for cand in cands:
            existing = session.exec(
                select(models.CandidateEvent)
                .where(models.CandidateEvent.candidate_id == cand.id)
                .limit(1)
            ).first()
            if existing is None:
                session.add(
                    models.CandidateEvent(
                        candidate_id=cand.id,
                        event_type="created",
                        label="Profile created in Hiring portal",
                        occurred_at=cand.created_at,
                    )
                )
        session.commit()

    with Session(engine) as session:
        events = session.exec(select(models.CandidateEvent)).all()
        for ev in events:
            if ev.label == "Profile added":
                ev.label = "Profile created in Hiring portal"
        session.commit()

    _bootstrap_default_admin()

    with Session(engine) as session:
        existing = session.exec(select(models.User)).first()
        if existing is None and not BOOTSTRAP_ADMIN_EMAIL:
            logger.warning(
                "No users exist yet and ADMIN_EMAIL is not set. "
                "The first account created through the sign-up form becomes an admin."
            )


def _migrate_user_security_columns() -> None:
    """Add security question columns to an existing user table (SQLite)."""
    with engine.connect() as conn:
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(user)").fetchall()}
        if "security_question" not in cols:
            conn.exec_driver_sql("ALTER TABLE user ADD COLUMN security_question VARCHAR")
        if "security_answer_hash" not in cols:
            conn.exec_driver_sql("ALTER TABLE user ADD COLUMN security_answer_hash VARCHAR")
        conn.commit()


def _bootstrap_default_admin() -> None:
    """Create the configured default admin account (once) from environment variables."""
    from .models import User
    from .security import email_issues, hash_password, password_issues

    if not BOOTSTRAP_ADMIN_EMAIL:
        return
    if not BOOTSTRAP_ADMIN_PASSWORD:
        logger.error(
            "ADMIN_EMAIL=%s is set but ADMIN_PASSWORD is missing; default admin was NOT created.",
            BOOTSTRAP_ADMIN_EMAIL,
        )
        return
    with Session(engine) as session:
        existing = session.exec(select(User).where(User.email == BOOTSTRAP_ADMIN_EMAIL)).first()
        if existing:
            return
        err = email_issues(BOOTSTRAP_ADMIN_EMAIL)
        if err:
            logger.error("Bootstrap admin skipped: %s", err)
            return
        err = password_issues(BOOTSTRAP_ADMIN_PASSWORD)
        if err:
            logger.error(
                "Bootstrap admin skipped: ADMIN_PASSWORD does not meet the policy. %s", err
            )
            return
        session.add(
            User(
                email=BOOTSTRAP_ADMIN_EMAIL,
                name=BOOTSTRAP_ADMIN_NAME or BOOTSTRAP_ADMIN_EMAIL.split("@")[0],
                password_hash=hash_password(BOOTSTRAP_ADMIN_PASSWORD),
                role="admin",
                active=True,
            )
        )
        session.commit()
        logger.warning(
            "Default admin account created (%s). Change its name and password after first login.",
            BOOTSTRAP_ADMIN_EMAIL,
        )


def get_session():
    with Session(engine) as session:
        yield session