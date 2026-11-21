"""Sign in, and the dependency that says who is calling."""
import time
from collections import defaultdict

import jwt
from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, field_validator

import db
import security
from errors import ApiError

router = APIRouter(prefix="/auth", tags=["Auth"])
bearer = HTTPBearer(auto_error=False)

MAX_FAILS = 5
WINDOW_SECONDS = 300
FAILED_LOGINS = defaultdict(list)  # email -> times of recent wrong passwords


class LoginIn(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def clean_email(cls, v):
        return v.strip().lower()


def public_user(row):
    return {"id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"]}


def current_user(creds: HTTPAuthorizationCredentials = Depends(bearer)):
    """Reads the token, then loads the user fresh so a deactivated account stops working at once."""
    if creds is None:
        raise ApiError(401, "Please sign in to continue.", code="unauthenticated")
    try:
        user_id = int(security.decode_token(creds.credentials)["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise ApiError(401, "Your sign-in has expired. Please sign in again.", code="token_invalid")
    user = db.fetch_one("SELECT id, name, email, role, is_active FROM users WHERE id = %s", (user_id,))
    if not user or not user["is_active"]:
        raise ApiError(401, "This account is not active.", code="account_disabled")
    return user


@router.post("/login")
def login(body: LoginIn):
    now = time.time()
    recent = [t for t in FAILED_LOGINS[body.email] if now - t < WINDOW_SECONDS]
    FAILED_LOGINS[body.email] = recent
    if len(recent) >= MAX_FAILS:
        raise ApiError(429, "Too many wrong attempts. Please wait a few minutes and try again.", code="locked")

    user = db.fetch_one("SELECT * FROM users WHERE lower(email) = %s", (body.email,))
    ok = security.verify_password(body.password, user["password_hash"] if user else security.DUMMY_HASH)
    if not user or not ok or not user["is_active"]:
        FAILED_LOGINS[body.email].append(now)
        raise ApiError(401, "Email or password is not correct.", code="bad_credentials")
    FAILED_LOGINS.pop(body.email, None)
    return {"token": security.create_token(user["id"], user["role"]), "user": public_user(user)}


@router.get("/me")
def me(user=Depends(current_user)):
    return public_user(user)
