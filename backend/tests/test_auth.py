import pytest

import db
import security
from conftest import headers_for


def login(client, email, password):
    return client.post("/auth/login", json={"email": email, "password": password})


def test_login_returns_token_and_user(client, kavya):
    r = login(client, kavya["email"], kavya["password"])
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["role"] == "inspector"
    assert "password_hash" not in body["user"]
    assert security.decode_token(body["token"])["sub"] == str(kavya["id"])


def test_email_is_not_case_sensitive(client, kavya):
    assert login(client, kavya["email"].upper(), kavya["password"]).status_code == 200


def test_wrong_password_and_unknown_email_give_the_same_message(client, kavya):
    wrong = login(client, kavya["email"], "nope")
    unknown = login(client, "nobody@example.com", "nope")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["detail"] == unknown.json()["detail"]


def test_five_wrong_passwords_lock_the_account_for_a_while(client, kavya):
    for _ in range(5):
        assert login(client, kavya["email"], "wrong").status_code == 401
    locked = login(client, kavya["email"], kavya["password"])
    assert locked.status_code == 429
    assert locked.json()["code"] == "locked"


def test_password_is_stored_as_a_hash(kavya):
    row = db.fetch_one("SELECT password_hash FROM users WHERE id = %s", (kavya["id"],))
    assert row["password_hash"].startswith("$2")
    assert kavya["password"] not in row["password_hash"]


def test_protected_routes_need_a_token(client):
    assert client.get("/auth/me").status_code == 401
    assert client.get("/bootstrap").status_code == 401
    assert client.post("/sync", json={"client_id": "11111111-1111-4111-8111-111111111111"}).status_code == 401


def test_garbage_token_is_rejected(client):
    r = client.get("/auth/me", headers={"Authorization": "Bearer not-a-token"})
    assert r.status_code == 401
    assert r.json()["code"] == "token_invalid"


def test_deactivated_user_loses_access_at_once(client, kavya):
    assert client.get("/auth/me", headers=kavya["h"]).status_code == 200
    db.execute("UPDATE users SET is_active = FALSE WHERE id = %s", (kavya["id"],))
    assert client.get("/auth/me", headers=kavya["h"]).status_code == 401
    assert login(client, kavya["email"], kavya["password"]).status_code == 401


def test_bootstrap_gives_sites_and_templates_for_offline_use(client, kavya):
    r = client.get("/bootstrap", headers=kavya["h"])
    assert r.status_code == 200
    body = r.json()
    assert len(body["sites"]) >= 1
    assert {t["kind"] for t in body["templates"]} == {"fire_safety", "electrical", "scaffolding", "housekeeping"}


def test_health(client):
    assert client.get("/health").json()["status"] == "ok"
