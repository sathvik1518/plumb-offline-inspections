"""Tiny SQL migration runner.

Applies every file in migrations/ (sorted by name) exactly once and records it
in the schema_migrations table. An advisory lock makes it safe when several
serverless instances start at the same moment.
"""
import os
import sys

import db

MIGRATIONS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "migrations")
LOCK_KEY = 727301


def run_migrations(verbose=False):
    files = sorted(f for f in os.listdir(MIGRATIONS_DIR) if f.endswith(".sql"))
    applied_now = []
    with db.connect() as conn:
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute("SELECT pg_advisory_lock(%s)", (LOCK_KEY,))
        try:
            cur.execute(
                """CREATE TABLE IF NOT EXISTS schema_migrations (
                       version    TEXT PRIMARY KEY,
                       applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"""
            )
            cur.execute("SELECT version FROM schema_migrations")
            done = {row[0] for row in cur.fetchall()}
            for name in files:
                if name in done:
                    continue
                with open(os.path.join(MIGRATIONS_DIR, name), encoding="utf-8") as fh:
                    sql = fh.read()
                cur.execute("BEGIN")
                try:
                    cur.execute(sql)
                    cur.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (name,))
                    cur.execute("COMMIT")
                except Exception:
                    cur.execute("ROLLBACK")
                    raise
                applied_now.append(name)
                if verbose:
                    print(f"applied {name}")
        finally:
            cur.execute("SELECT pg_advisory_unlock(%s)", (LOCK_KEY,))
    return applied_now


if __name__ == "__main__":
    applied = run_migrations(verbose=True)
    print("Up to date." if not applied else f"Applied {len(applied)} migration(s).")
    sys.exit(0)
