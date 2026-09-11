# Hiring Tracker

Production-ready, containerized (or bare-metal) candidate tracking application (L1 hiring pipeline).
Track open roles, candidates, interview stages and resumes in one dashboard — with
role-based access control and an admin portal.

## Features

- **Dashboard** — pipeline stats (total, by status, by vendor, by role), search, filters, bulk delete
- **Pagination** — 20 candidates per page by default; choose 10 / 20 / 50 / 100 per page; prev/next + page numbers
- **Candidates** — add/edit/delete, inline stage ratings with **half-stars** (1, 1.5, 2, ... 5), feedback, resume upload/preview/download
- **Roles, Vendors, Statuses** — fully managed in the Admin portal (statuses drive the pipeline colors)
- **Branding** — customizable site title/subtitle/eyebrow from the Admin portal
- **Authentication** — sign in / sign up, session cookies (expire when the browser closes)
- **Forgot password** — self-service reset via a security question (set it in Profile → Security Question)
- **Role-based access** — `admin` (full access incl. user management), `manager` (edits dashboard data), `view` (read-only)
- **Admin → Users** — create users, change roles, enable/disable, reset passwords, delete users, copy/share credentials
- **Responsive UI** — works on desktop, tablet and phone (no mobile zoom, tap-friendly controls)

## Quick Start

| Method | Command (from project root) | Open in browser |
|--------|------------------------------|-----------------|
| **With Docker** (recommended) | `docker compose up -d --build` | **http://localhost:8800** |
| **Without Docker** (Python) | `cd backend` → `pip install -r requirements.txt` → `uvicorn app.main:app --host 0.0.0.0 --port 8000` | **http://localhost:8000** |

The default admin account is `admin@scholastic.local` / `Adm1n!123` (only when
`ADMIN_EMAIL` is set in `docker-compose.yml` — change these in the Profile page after first login).

> **Ports at a glance:** **Docker = 8800**, **no Docker = 8000**. The FastAPI app always listens on
> port **8000** inside the container; Compose maps that to port **8800** on your machine
> (`"8800:8000"`). Change the port by editing the **left** number — see [Changing the port](#changing-the-port).

## Technology

| Layer | Technology |
|-------|-----------|
| Frontend | HTML + CSS + vanilla JavaScript SPA (no build step), IBM Plex Sans/Mono, dark theme |
| Backend | Python 3.11, **FastAPI** (ASGI), **Uvicorn**, **SQLModel** (SQLAlchemy + Pydantic) |
| Database | SQLite (`/data/tracker.db`) — single file, zero configuration |
| Password hashing | PBKDF2-SHA256 (120 000 iterations, per-user salt) |
| Sessions | DB-backed session cookie (`session`, HttpOnly, SameSite=Lax, 24 h server TTL) |
| File storage | Resumes stored on disk under `/data/resumes/` |
| Runtime | Docker + Docker Compose (multi-stage `python:3.11-slim` image), or bare Python |

### Backend packages (`backend/requirements.txt`)

- `fastapi==0.115.12` — web framework
- `uvicorn[standard]==0.34.2` — ASGI server
- `sqlmodel==0.0.24` — ORM / validation
- `python-multipart==0.0.20` — multipart upload handling (resumes)

## Architecture

```
Browser  ──HTTP/HTTPS──▶  Uvicorn (FastAPI)  ──▶  SQLite (/data/tracker.db)
     ▲                           │                    ▲
     └── static frontend ────────┘    resumes on disk ├── /data/resumes/
```

The FastAPI server both serves the SPA frontend (`/`) and the JSON API
(`/api/*`). All `POST/PUT/PATCH/DELETE` mutations are role-protected on the server
side; the UI also hides actions the current role cannot perform.

## Project Structure

```
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI entry point, static hosting, /api/stats
│   │   ├── database.py        # Engine, session, init_db (seeds + bootstrap admin)
│   │   ├── models.py          # SQLModel tables (User, AuthSession, Candidate, ...)
│   │   ├── security.py        # PBKDF2 hashing, password policy, role dependencies
│   │   └── routers/
│   │       ├── auth.py        # signup/login/logout, forgot-password + user management
│   │       ├── candidates.py  # candidates CRUD (paginated) + resume upload/download
│   │       ├── stages.py      # interview stages per candidate (half-star ratings)
│   │       ├── roles.py       # roles CRUD (admin)
│   │       ├── vendors.py     # vendors CRUD (admin)
│   │       ├── statuses.py    # statuses CRUD (admin)
│   │       └── settings.py    # branding settings (admin)
│   └── requirements.txt
├── frontend/
│   ├── index.html             # SPA shell
│   └── static/
│       ├── styles.css         # theme + responsive CSS
│       └── app.js             # all frontend logic
├── data/                      # SQLite DB + resumes (persisted, volume-mounted)
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## Requirements

- Docker with the Compose plugin (recommended path on all platforms)
- Or Python 3.11 for a bare-metal install
- ~512 MB RAM, a few hundred MB disk (plus resume files)

---

# Installation — Windows

## Option A: Docker (recommended)

1. Install **Docker Desktop** from https://www.docker.com/products/docker-desktop/
   (use the WSL 2 backend when prompted). Start it and wait until the whale icon is steady.
2. Copy the project folder to e.g. `C:\Users\you\Hiring Tracker`.
3. Open **PowerShell** in that folder and run:

   ```powershell
   docker compose up -d --build
   ```

4. Open **http://localhost:8800** in your browser.

Docker container management:

```powershell
docker compose up -d          # start (no rebuild)
docker compose logs -f        # follow logs
docker compose down           # stop (data is kept)
docker compose down -v        # stop AND delete all data (database + resumes)
```

## Option B: Without Docker (Python)

Runs on port **8000**.

1. Install Python 3.11+ from https://www.python.org/ (check "Add python.exe to PATH").
2. From the project root:

   ```powershell
   cd backend
   pip install -r requirements.txt
   uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```

3. Open **http://localhost:8000**.

> **Data folder:** the app first tries `/data` (not writable on Windows) and falls back
> to `./data` **relative to the current working directory** — so running from `backend/`
> creates `backend/data\` (SQLite DB + resumes). To keep data in a known place, set
> `$env:DATA_DIR = "$PWD\data"` (or anywhere you like) before starting.

---

# Installation — Linux

## Option A: Docker (recommended)

```bash
# Ubuntu/Debian/Raspberry Pi — snap:
sudo snap install docker
# or official engine:
#   curl -fsSL https://get.docker.com | sudo sh

sudo systemctl enable --now docker        # start on boot
sudo usermod -aG docker $USER             # run docker without sudo
# log out and back in, then:
```

```bash
cd "<your-project-folder>"
docker compose up -d --build
# open http://localhost:8800
```

## Option B: Without Docker (Python)

Runs on port **8000**.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
mkdir -p ../data
DATA_DIR=../data uvicorn app.main:app --host 0.0.0.0 --port 8000 &
# open http://localhost:8000
```

Running as a background service with systemd:

```ini
# /etc/systemd/system/hiringtracker.service
[Unit]
Description=Hiring Tracker
After=network.target

[Service]
WorkingDirectory=/opt/hiring-tracker/backend
Environment=DATA_DIR=/opt/hiring-tracker/data
ExecStart=/opt/hiring-tracker/backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=unless-stopped

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now hiringtracker
# open http://localhost:8000
```

---

# Installation — AWS EC2 (Docker)

## 1. Launch an EC2 instance

1. AWS Console → EC2 → **Launch instance**.
   - Name: `hiring-tracker`
   - OS image: **Ubuntu 24.04 LTS** (free tier eligible)
   - Instance type: `t3.small` (2 vCPU / 2 GiB) or `t2.micro` to start; 1 GiB RAM works but is tight
   - Storage: **EBS root volume ≥ 10 GB** and enable Delete-on-termination as you prefer
   - Key pair: create or select one (you need the `.pem` to SSH in)
   - **Network settings → Create security group** and open:
     - `SSH` — TCP **22** — your IP (`My IP`)
     - `Custom TCP` — TCP **8800** — 0.0.0.0/0 (the web app; restrict to your IP for private use)
   - Click **Launch instance**.

> To serve the app on plain port 80, change the Security Group to open **80**
> instead of 8800 **and** change the port mapping in `docker-compose.yml` from
> `"8800:8000"` to `"80:8000"`.

## 2. Connect to the instance

```bash
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@<EC2-PUBLIC-IP>
```

## 3. Install Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

**Log out and back in** (or run `newgrp docker`) so `docker` works without `sudo`.

## 4. Get the code onto the instance

Either push this project to a private GitHub repo, then:

```bash
git clone https://github.com/<you>/hiring-tracker.git
cd hiring-tracker
```

Or, if it's not in git, upload it from your local machine:

```bash
# from your local project folder
scp -i your-key.pem -r . ubuntu@<EC2-PUBLIC-IP>:~/hiring-tracker
ssh -i your-key.pem ubuntu@<EC2-PUBLIC-IP>
cd ~/hiring-tracker
```

## 5. Configure the default admin (docker-compose.yml)

Set your own credentials in the `environment:` block before the first start:

```yaml
environment:
  - DATA_DIR=/data
  - ADMIN_EMAIL=admin@yourdomain.com   # your default admin email
  - ADMIN_NAME=Admin                   # display name
  - ADMIN_PASSWORD=ChangeMe123!        # password policy: 8+ chars, upper + lower + digit
```

The account is created automatically on the first start. Leave `ADMIN_EMAIL` empty
to skip this (the very first person to sign up becomes the admin).

## 6. Build and run

```bash
docker compose up -d --build
docker compose ps
```

Check it works locally on the server:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8800/   # → 200
```

Then open **http://<EC2-PUBLIC-IP>:8800** in your browser and sign in with the
admin credentials from step 5.

## 7. (Recommended) Put it behind a reverse proxy + HTTPS

Edit your Security Group to open **80** and **443**, then run:

```bash
docker run -d --name caddy --restart unless-stopped \
  -p 80:80 -p 443:443 \
  -v caddy_data:/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  caddy:2
```

Create `Caddyfile` in your home directory and run with it:

```ini
# Caddyfile — the app listens on 8800 (host side of the compose mapping)
hiringtracker.example.com {
    reverse_proxy 127.0.0.1:8800
}
```

```bash
docker run -d --name caddy --restart unless-stopped \
  -p 80:80 -p 443:443 \
  -v $PWD/Caddyfile:/etc/caddy/Caddyfile \
  -v caddy_data:/data \
  caddy:2
```

Caddy obtains a free Let's Encrypt TLS certificate automatically. Point your
domain's A record at the EC2 public IP first.

Note: `data/` (SQLite + resumes) lives on the EC2 EBS volume in the project folder.
Back it up by copying the `data/` folder; it is NOT part of the container.

---

# Configuration

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `/data` | Folder for the SQLite DB and resumes (volume-mounted in Compose on this value); falls back to `./data` if not writable |
| `ADMIN_EMAIL` | *(empty)* | Email of the auto-created default admin; empty = skip, first sign-up becomes admin |
| `ADMIN_NAME` | `Admin` | Display name of the default admin |
| `ADMIN_PASSWORD` | *(empty)* | Password of the default admin (must meet the policy; invalid values are skipped) |

## Changing the port

The FastAPI app always listens on **port 8000** (the `uvicorn` CMD in the Dockerfile).

- **With Docker:** change only the **left** number in `docker-compose.yml` (the host side);
  the app stays on 8000 inside the container:

  ```yaml
  ports:
    - "8800:8000"   # host 8800 → container 8000 (open http://localhost:8800)
  ```

  ```bash
  docker compose up -d      # recreates the container; no rebuild needed
  ```

- **Without Docker:** pass `--port <N>` to uvicorn, e.g. `uvicorn app.main:app --port 8800`
  (or use port 80 with a reverse proxy).

## Accounts, roles and policy

| Role | Permissions |
|------|-------------|
| `admin` | Everything — dashboard edits, Admin portal (roles/vendors/statuses/branding), user management, reset/delete users |
| `manager` | Edits candidates, stages, resumes; cannot touch admin-only APIs (403) |
| `view` | Read-only dashboard (edit controls and 403 blocked server-side) |

- Password policy: **8+ characters** with at least one uppercase letter, one lowercase letter and one digit.
- Sessions expire when the browser closes (session cookie) and server-side after 24 h; resetting/disabling an account signs that user out everywhere.
- Passwords are stored as **PBKDF2-SHA256 hashes** — they can never be viewed again, only reset.
- **Forgot password:** users set a security question in **Profile → Security Question**; the login page's
  "Forgot your password?" link verifies email → question → answer and resets the password (revokes all sessions).

---

# API Reference

All endpoints except auth-signup/login and the forgot-password flow require the
session cookie. Mutations are role-gated (`admin` or `manager` per resource).

## Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/signup` | Create account (first-ever user becomes admin) |
| POST | `/api/auth/login` | Sign in, sets session cookie |
| POST | `/api/auth/logout` | Sign out, revokes session |
| GET | `/api/auth/me` | Current user (includes `has_security_question`) |
| PUT | `/api/auth/me/profile` | Update own name/email |
| PUT | `/api/auth/me/password` | Change own password (requires current password) |
| GET | `/api/auth/security-questions` | List the preset security questions |
| GET | `/api/auth/me/security-question` | Own security question (auth required) |
| PUT | `/api/auth/me/security-question` | Set/change own security question + answer |
| POST | `/api/auth/forgot-question` | Public: returns a user's security question for their email |
| POST | `/api/auth/forgot-password` | Public: verify question answer, set a new password, revoke sessions |

## User management (admin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/users` | List all users |
| POST | `/api/auth/users` | Create a user (name, email, password, role) |
| PATCH | `/api/auth/users/{id}` | Update role and/or active status (disabling revokes sessions) |
| POST | `/api/auth/users/{id}/reset-password` | Set a new password (revokes all sessions) |
| DELETE | `/api/auth/users/{id}` | Delete a user (cannot delete yourself) |

## Candidates

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/candidates` | Paginated list — returns `{"items": [...], "total": N}`; params: `role_id`, `status`, `vendor`, `search`, `page` (default 1), `page_size` (default 20, max 500) |
| GET | `/api/candidates/vendors` | Distinct vendor names |
| GET | `/api/candidates/export?fmt=json\|csv` | Export (all rows) |
| POST | `/api/candidates` | Create |
| PUT | `/api/candidates/{id}` | Full update |
| PATCH | `/api/candidates/{id}` | Partial update (inline editing) |
| DELETE | `/api/candidates/{id}` | Delete candidate + resume |
| POST | `/api/candidates/bulk-delete` | Bulk delete |
| POST | `/api/candidates/{id}/resume` | Upload resume (multipart, `manager`/`admin`) |
| GET | `/api/candidates/{id}/resume` | Download resume |
| DELETE | `/api/candidates/{id}/resume` | Remove resume |

## Interview Stages

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/candidates/{id}/stages` | List |
| POST | `/api/candidates/{id}/stages` | Add stage |
| PUT | `/api/stages/{id}` | Update (rating 1–5 in 0.5 steps, feedback, completed) |
| DELETE | `/api/stages/{id}` | Delete |

## Roles, Vendors, Statuses (admin mutations)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/roles`, `/api/vendors`, `/api/statuses` | List / create |
| PUT/DELETE | `/api/roles/{id}`, `/api/vendors/{id}`, `/api/statuses/{id}` | Update / delete |
| GET/PUT | `/api/settings` | Read / update branding (PUT is admin-only) |

## Dashboard

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stats` | Pipeline aggregate counts |

---

# Data & Backups

- Everything is stored as files under the Compose volume `./data:/data`:
  - `tracker.db` — SQLite database
  - `resumes/` — uploaded resume files
- **Backup** = copy the `data/` folder (or take an EC2 EBS snapshot).
- **Reset from scratch**: `docker compose down -v` deletes the volume and all data.

# Troubleshooting

| Symptom | Fix |
|---------|-----|
| Site not reachable on a chosen port | With Docker the mapping must be `host-port:8000` (the app listens on 8000); e.g. `"8800:8000"` → http://localhost:8800. Without Docker pass `--port` to uvicorn. |
| Port already in use error | Something is already bound to the host port; stop it or change the host port on the left side of the compose mapping |
| Login page shows stale layout | Hard refresh (Ctrl+F5); cache-busted assets are `app.js?v=27`, `styles.css?v=14` |
| Can't log in after a password reset | Passwords are hashed — use Admin → Users → "Reset pw" and share the new password (shown once) |
| Forgot-password link says "no security question set" | That account never set one — use Admin → Users → Reset pw, or have the user set it in Profile |
| Data volume "not found" | Storage lives in `data/` next to `docker-compose.yml`; mount the same folder across rebuilds |
| EC2 port unreachable | Open TCP 8800 (or 80) in the EC2 Security Group; check `docker compose ps` under `ubuntu` (or `sudo docker compose ps`) |
| First sign-up isn't admin | An account already exists or `ADMIN_EMAIL` is configured; use the configured admin instead |
