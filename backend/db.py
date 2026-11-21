"""Database access helpers (plain SQL through psycopg2).

Connection settings come from DATABASE_URL (Neon / Vercel) or, when that is not
set, from DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME for local work.
"""
import contextlib
import os

import psycopg2
import psycopg2.extras


def _connect_kwargs():
    url = os.getenv("DATABASE_URL", "").strip()
    if url:
        return {"dsn": url, "connect_timeout": 10}
    return {
        "host": os.getenv("DB_HOST", "localhost"),
        "port": int(os.getenv("DB_PORT", "5432")),
        "user": os.getenv("DB_USER", "postgres"),
        "password": os.getenv("DB_PASSWORD", ""),
        "dbname": os.getenv("DB_NAME", "plumb_dev"),
        "connect_timeout": 10,
    }


@contextlib.contextmanager
def connect():
    conn = psycopg2.connect(**_connect_kwargs())
    try:
        yield conn
    finally:
        conn.close()


@contextlib.contextmanager
def transaction():
    """Yield a dict cursor inside one transaction. Commits on success, rolls back on any error."""
    with connect() as conn:
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                yield cur
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def fetch_all(sql, params=None):
    with transaction() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def fetch_one(sql, params=None):
    with transaction() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def execute(sql, params=None):
    with transaction() as cur:
        cur.execute(sql, params)
        return cur.rowcount
