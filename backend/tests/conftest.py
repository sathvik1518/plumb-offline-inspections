"""Test setup.

The tests EMPTY every table before each test, so they only ever run against a separate
database (plumb_test), never the one you use for development.
"""
import os
import uuid
from datetime import datetime, timezone

import pytest

if os.getenv("DATABASE_URL"):
    pytest.exit(
        "Tests empty the tables, so they will not run while DATABASE_URL is set. "
        "Clear it first (PowerShell: $env:DATABASE_URL='').",
        returncode=2,
    )

os.environ["DB_NAME"] = os.getenv("TEST_DB_NAME", "plumb_test")
os.environ["BCRYPT_ROUNDS"] = "4"
os.environ["JWT_SECRET"] = "test-secret-that-is-long-enough-for-hs256-checks"

from fastapi.testclient import TestClient  # noqa: E402

import auth  # noqa: E402
import db  # noqa: E402
import migrate  # noqa: E402
import security  # noqa: E402
import seed  # noqa: E402
from templates import TEMPLATES  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def database():
    seed.create_local_database_if_missing()
    migrate.run_migrations()


@pytest.fixture(autouse=True)
def clean_database(database):
    auth.FAILED_LOGINS.clear()
    with db.transaction() as cur:
        cur.execute("TRUNCATE sync_ops, inspection_items, inspections, sites, users RESTART IDENTITY CASCADE")
        cur.execute("ALTER SEQUENCE change_seq RESTART WITH 1")
        seed.ensure_sites(cur)


@pytest.fixture
def client():
    import main

    return TestClient(main.app)


def make_user(name, email, role="inspector", password="Passw0rd1"):
    with db.transaction() as cur:
        uid = seed._insert_user(cur, name, email, password, role)
    return {"id": uid, "email": email, "password": password}


def headers_for(user, role="inspector"):
    return {"Authorization": f"Bearer {security.create_token(user['id'], role)}"}


@pytest.fixture
def kavya():
    u = make_user("Kavya Reddy", "kavya@example.com")
    return {**u, "h": headers_for(u)}


@pytest.fixture
def ramesh():
    u = make_user("Ramesh Yadav", "ramesh@example.com")
    return {**u, "h": headers_for(u)}


@pytest.fixture
def boss():
    u = make_user("Sai Sathvik", "boss@example.com", role="supervisor")
    return {**u, "h": headers_for(u, "supervisor")}


@pytest.fixture
def site_id():
    return db.fetch_one("SELECT id FROM sites ORDER BY id LIMIT 1")["id"]


def new_id():
    return str(uuid.uuid4())


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def create_op(site_id, n_items=3, inspection_id=None, op_id=None, title="Fire safety round"):
    inspection_id = inspection_id or new_id()
    return {
        "op_id": op_id or new_id(),
        "type": "create_inspection",
        "payload": {
            "id": inspection_id,
            "site_id": site_id,
            "title": title,
            "kind": "fire_safety",
            "created_at": now_iso(),
            "items": [
                {"id": new_id(), "label": TEMPLATES[0]["items"][i], "position": i} for i in range(n_items)
            ],
        },
    }


def item_op(inspection_id, item_id, base_version, op_id=None, **changes):
    return {
        "op_id": op_id or new_id(),
        "type": "update_item",
        "payload": {"inspection_id": inspection_id, "item_id": item_id, "base_version": base_version, "changes": changes},
    }


def send(client, headers, ops, client_id, since=0):
    r = client.post("/sync", json={"client_id": client_id, "since": since, "ops": ops}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()
