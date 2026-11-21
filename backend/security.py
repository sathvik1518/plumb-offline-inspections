"""Password hashing (bcrypt) and signed login tokens (JWT)."""
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

import config


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=config.BCRYPT_ROUNDS)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


# Used to keep login timing similar whether or not the email exists.
DUMMY_HASH = hash_password("not-a-real-password")


def create_token(user_id: int, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "role": role,
        "iat": now,
        "exp": now + timedelta(hours=config.TOKEN_HOURS),
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Raises jwt.PyJWTError when the token is invalid or expired."""
    return jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
