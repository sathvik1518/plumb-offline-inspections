"""One error format for the whole API: {"detail": "...", "code": "...", "errors": {"field": "message"}}."""
import logging

import psycopg2
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

log = logging.getLogger("plumb")


class ApiError(Exception):
    def __init__(self, status_code, detail, code=None, errors=None):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code
        self.errors = errors


def _body(detail, code=None, errors=None):
    body = {"detail": detail}
    if code:
        body["code"] = code
    if errors:
        body["errors"] = errors
    return body


def friendly_message(err):
    """Turn a pydantic error into a short sentence."""
    kind = err.get("type", "")
    ctx = err.get("ctx") or {}
    if kind in ("missing", "string_type", "none_required"):
        return "This field is required."
    if kind == "string_too_short":
        return f"Must be at least {ctx.get('min_length')} characters."
    if kind == "string_too_long":
        return f"Must be at most {ctx.get('max_length')} characters."
    if kind == "literal_error":
        return "Choose one of the allowed values."
    if kind == "too_short":
        return f"Add at least {ctx.get('min_length')} item(s)."
    if kind == "too_long":
        return f"At most {ctx.get('max_length')} item(s) are allowed."
    if kind in ("uuid_parsing", "uuid_type"):
        return "Not a valid id."
    msg = err.get("msg", "Invalid value.")
    return msg[len("Value error, "):] if msg.startswith("Value error, ") else msg


def register_error_handlers(app: FastAPI):
    @app.exception_handler(ApiError)
    async def api_error(_: Request, exc: ApiError):
        return JSONResponse(_body(exc.detail, exc.code, exc.errors), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        fields = {}
        for err in exc.errors():
            path = [str(p) for p in err["loc"] if p not in ("body", "query", "path")]
            fields.setdefault(".".join(path) or "request", friendly_message(err))
        first = next(iter(fields.values()), "Invalid request.")
        return JSONResponse(_body(first, "validation_error", fields), status_code=422)

    @app.exception_handler(psycopg2.OperationalError)
    async def db_unreachable(_: Request, exc):
        log.error("database unreachable: %s", exc)
        return JSONResponse(
            _body("The database is not reachable right now. Please try again in a moment.", "db_unavailable"),
            status_code=503,
        )
