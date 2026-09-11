FROM python:3.11-slim AS builder

WORKDIR /app

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY backend/ /app/backend/
COPY frontend/ /app/frontend/

RUN mkdir -p /data

# Bootstrap admin account (override in docker-compose.yml "environment").
# Leave ADMIN_EMAIL empty to skip auto-creation (the first sign-up becomes admin).
ENV ADMIN_EMAIL=""
ENV ADMIN_NAME="Admin"
ENV ADMIN_PASSWORD=""

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]