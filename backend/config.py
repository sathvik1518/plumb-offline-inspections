"""Settings read from environment variables."""
import os

TOKEN_HOURS = 12
BCRYPT_ROUNDS = int(os.getenv("BCRYPT_ROUNDS", "12"))  # tests lower this to run faster
JWT_ALGORITHM = "HS256"

_DEV_SECRET = "dev-only-secret-change-me-before-deploying"
JWT_SECRET = os.getenv("JWT_SECRET", "").strip()

if not JWT_SECRET:
    if os.getenv("VERCEL"):
        # Refuse to run in production with a guessable signing key.
        raise RuntimeError("JWT_SECRET is not set. Add it in Vercel > Settings > Environment Variables.")
    JWT_SECRET = _DEV_SECRET

CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if o.strip()
]
