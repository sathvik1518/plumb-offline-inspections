"""Plumb API entry point.

Local:   uvicorn main:app --reload
Vercel:  api/index.py mounts this app under /api
"""
import logging
from datetime import datetime, timezone

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

import auth
import config
import db
import sync
from errors import register_error_handlers
from templates import TEMPLATES

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Plumb API",
    version="1.0.0",
    description=(
        "Field inspections that keep working without a signal. Devices save every change locally "
        "and send them to POST /sync when the network returns. Retries are safe, edits are never "
        "silently lost, and conflicts are reported back instead of overwritten."
    ),
)
app.add_middleware(
    CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"]
)
register_error_handlers(app)
app.include_router(auth.router)
app.include_router(sync.router)


@app.get("/bootstrap", tags=["Sync"])
def bootstrap(user=Depends(auth.current_user)):
    """Reference data a device keeps so it can start inspections with no signal."""
    sites = db.fetch_all("SELECT id, name, area, address FROM sites ORDER BY name")
    return {
        "user": auth.public_user(user),
        "sites": sites,
        "templates": TEMPLATES,
        "server_time": datetime.now(timezone.utc),
    }


@app.get("/health", tags=["Health"])
def health():
    row = db.fetch_one("SELECT 1 AS ok")
    return {"status": "ok", "database": "connected" if row else "unknown"}
