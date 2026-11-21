"""Vercel entry point.

Serves the FastAPI backend under /api and prepares the database (tables and demo
data) the first time a request arrives. If the database is not reachable yet, the
request gets a clear 503 and the next request tries again.
"""
import logging
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from fastapi import FastAPI  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from starlette.concurrency import run_in_threadpool  # noqa: E402

import main  # noqa: E402
import seed  # noqa: E402

log = logging.getLogger("plumb")
state = {"ready": False}

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def prepare_database(request, call_next):
    if not state["ready"]:
        try:
            result = await run_in_threadpool(seed.bootstrap)
            log.info("database ready (%s)", result)
            state["ready"] = True
        except Exception as exc:
            log.exception("database setup failed")
            hint = " Check the DATABASE_URL setting." if "dsn" in str(exc).lower() else ""
            return JSONResponse(
                {"detail": "The database is not ready yet." + hint, "code": "db_unavailable"},
                status_code=503,
            )
    return await call_next(request)


app.mount("/api", main.app)
