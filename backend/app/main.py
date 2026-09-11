import os
from fastapi import FastAPI, Depends, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlmodel import Session, select, func

from .database import init_db, get_session
from .models import Role, Candidate, User
from .security import require_auth
from .routers import roles, candidates, stages, vendors, statuses, settings, auth

app = FastAPI(title="Hiring Tracker API", version="1.0.0")

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
if not os.path.exists(FRONTEND_DIR):
    FRONTEND_DIR = "/app/frontend"

STATIC_DIR = os.path.join(FRONTEND_DIR, "static")
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/api/stats")
def get_stats(session: Session = Depends(get_session), _user: User = Depends(require_auth)):
    total = len(session.exec(select(Candidate)).all())
    statuses = {}
    rows = session.exec(select(Candidate.status, func.count(Candidate.id)).group_by(Candidate.status)).all()
    for status, count in rows:
        statuses[status] = count
    vendors = []
    vendor_rows = session.exec(select(Candidate.vendor, func.count(Candidate.id)).where(Candidate.vendor.is_not(None)).group_by(Candidate.vendor)).all()
    for v, count in vendor_rows:
        vendors.append({"name": v, "count": count})
    roles = []
    role_rows = session.exec(
        select(Role.id, Role.name, func.count(Candidate.id).label("cnt"))
        .outerjoin(Candidate, Role.id == Candidate.role_id)
        .group_by(Role.id, Role.name)
    ).all()
    for rid, rname, cnt in role_rows:
        roles.append({"id": rid, "name": rname, "count": cnt})
    return {
        "total": total,
        "statuses": statuses,
        "vendors": vendors,
        "roles": roles,
    }


app.include_router(roles.router)
app.include_router(candidates.router)
app.include_router(stages.router)
app.include_router(vendors.router)
app.include_router(statuses.router)
app.include_router(settings.router)
app.include_router(auth.router)


@app.get("/admin")
@app.get("/admin/{rest:path}")
def serve_admin(rest: str = ""):
    index = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index):
        return FileResponse(index)
    raise HTTPException(status_code=404, detail="Frontend not found")


@app.get("/{rest:path}")
def serve_frontend(rest: str = ""):
    if rest.startswith("api/"):
        raise HTTPException(status_code=404, detail="API endpoint not found")
    if rest == "favicon.ico":
        raise HTTPException(status_code=204)
    index = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index):
        return FileResponse(index)
    raise HTTPException(status_code=404, detail="Frontend not found")


@app.get("/")
def serve_index():
    index = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index):
        return FileResponse(index)
    raise HTTPException(status_code=404, detail="Frontend not found")