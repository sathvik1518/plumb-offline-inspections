"""Start-up work and demo data.

  python seed.py            create tables, and add demo data if the database is empty
  python seed.py --reset    DELETE everything and add fresh demo data (asks you to type YES)

Set SEED_DEMO=0 to start with only the supervisor account and the site list.
"""
import os
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone

import psycopg2

import db
import migrate
import security
from templates import TEMPLATES

SEED_LOCK = 727303
SUPERVISOR = ("Sai Sathvik", "saisathvik@gmail.com", os.getenv("ADMIN_PASSWORD", "Admin@123"))
INSPECTORS = [
    ("Kavya Reddy", "kavya.reddy@gmail.com"),
    ("Ramesh Yadav", "ramesh.yadav@gmail.com"),
    ("Farhan Ali", "farhan.ali@gmail.com"),
    ("Lakshmi Prasad", "lakshmi.prasad@gmail.com"),
]
INSPECTOR_PASSWORD = "Field@1234"

SITES = [
    ("Kokapet Heights, Tower B", "Kokapet", "Survey No. 12, Kokapet, Hyderabad"),
    ("Gachibowli Logistics Park, Shed 4", "Gachibowli", "Outer Ring Road service lane, Gachibowli"),
    ("Patancheru Plant 2, Press Shop", "Patancheru", "IDA Patancheru, Sangareddy district"),
    ("HITEC City Annexe, Block C", "HITEC City", "Madhapur main road, HITEC City"),
    ("Shamshabad Warehouse, Bay 7", "Shamshabad", "Near airport cargo road, Shamshabad"),
    ("Medchal Cold Store", "Medchal", "Kandlakoya, Medchal-Malkajgiri"),
]

FAIL_NOTES = {
    "fire_safety": [
        ("Extinguisher near gate 2 expired in September. Replace today.", "high"),
        ("Exit sign on the third floor staircase is not lit.", "medium"),
        ("Hose reel cabinet blocked by pallets.", "medium"),
    ],
    "electrical": [
        ("Taped joint on the extension board near the batching plant.", "high"),
        ("RCCB did not trip on test at panel P3.", "high"),
        ("Cable running through a puddle behind the DG set.", "medium"),
    ],
    "scaffolding": [
        ("Two boards missing on the level 5 platform.", "high"),
        ("No toe board on the east face.", "medium"),
        ("Scaffold tag last signed 12 days ago.", "low"),
    ],
    "housekeeping": [
        ("Rebar offcuts blocking the west walkway.", "medium"),
        ("Drinking water tank not cleaned this month.", "low"),
        ("Bins overflowing near the labour camp gate.", "low"),
    ],
}
GOOD_NOTES = ["", "", "", "", "Checked with site engineer.", "Photo taken on phone.", "All good."]


def _insert_user(cur, name, email, password, role):
    cur.execute(
        "INSERT INTO users (name, email, password_hash, role) VALUES (%s, %s, %s, %s) RETURNING id",
        (name, email, security.hash_password(password), role),
    )
    return cur.fetchone()["id"]


def ensure_sites(cur):
    for name, area, address in SITES:
        cur.execute(
            "INSERT INTO sites (name, area, address) VALUES (%s, %s, %s) ON CONFLICT (name) DO NOTHING",
            (name, area, address),
        )


def seed_demo_inspections(cur, inspector_ids):
    rng = random.Random(2611)
    cur.execute("SELECT id, name FROM sites ORDER BY id")
    sites = cur.fetchall()
    now = datetime.now(timezone.utc)
    plan = [  # (days ago, complete?, number of failures)
        (19, True, 1), (17, True, 0), (15, True, 2), (13, True, 1), (11, True, 0), (10, True, 3),
        (8, True, 1), (6, True, 0), (5, True, 2), (3, True, 1), (2, False, 1), (1, False, 0), (0, False, 0),
    ]
    for n, (days_ago, complete, fails) in enumerate(plan):
        template = TEMPLATES[n % len(TEMPLATES)]
        site = sites[(n * 2 + 1) % len(sites)]
        inspector = inspector_ids[n % len(inspector_ids)]
        started = now - timedelta(days=days_ago, hours=rng.randint(0, 5), minutes=rng.randint(0, 50))
        insp_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO inspections (id, site_id, inspector_id, title, kind, status, notes, created_at,
                                         submitted_at, updated_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                insp_id, site["id"], inspector, f"{template['name']}, {site['name'].split(',')[0]}",
                template["kind"], "submitted" if complete else "draft",
                "Follow up on failed items before the next round." if fails else "",
                started, started + timedelta(minutes=rng.randint(35, 80)) if complete else None, started,
            ),
        )
        labels = template["items"]
        fail_positions = set(rng.sample(range(len(labels)), fails))
        answered = len(labels) if complete else rng.randint(0, len(labels) - 2)
        notes = list(FAIL_NOTES[template["kind"]])
        rng.shuffle(notes)
        for pos, label in enumerate(labels):
            result, severity, note = "pending", None, ""
            if pos < answered or pos in fail_positions:
                if pos in fail_positions and notes:
                    result = "fail"
                    note, severity = notes.pop()
                else:
                    result = "na" if rng.random() < 0.08 else "pass"
                    note = rng.choice(GOOD_NOTES)
            cur.execute(
                """INSERT INTO inspection_items (id, inspection_id, position, label, result, severity, note)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                (str(uuid.uuid4()), insp_id, pos, label, result, severity, note),
            )


def seed_all(cur):
    ensure_sites(cur)
    _insert_user(cur, *SUPERVISOR, "supervisor")
    ids = [_insert_user(cur, n, e, INSPECTOR_PASSWORD, "inspector") for n, e in INSPECTORS]
    seed_demo_inspections(cur, ids)
    return "demo data added"


def create_local_database_if_missing():
    """Local PostgreSQL only. A cloud database (Neon) already exists."""
    if os.getenv("DATABASE_URL", "").strip():
        return
    name = os.getenv("DB_NAME", "plumb_dev")
    conn = psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"), port=int(os.getenv("DB_PORT", "5432")),
        user=os.getenv("DB_USER", "postgres"), password=os.getenv("DB_PASSWORD", ""), dbname="postgres",
        connect_timeout=10,
    )
    conn.autocommit = True
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,))
        if not cur.fetchone():
            cur.execute(f'CREATE DATABASE "{name}"')
            print(f"Created database {name}")
    finally:
        conn.close()


def bootstrap():
    """Create or upgrade tables, then add demo data if the database is brand new."""
    create_local_database_if_missing()
    migrate.run_migrations()
    with db.transaction() as cur:
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (SEED_LOCK,))
        cur.execute("SELECT COUNT(*) AS n FROM users")
        if cur.fetchone()["n"] > 0:
            return "existing"
        if os.getenv("SEED_DEMO", "1") == "0":
            ensure_sites(cur)
            _insert_user(cur, *SUPERVISOR, "supervisor")
            return "supervisor-only"
        return seed_all(cur)


def reset():
    create_local_database_if_missing()
    migrate.run_migrations()
    with db.transaction() as cur:
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (SEED_LOCK,))
        cur.execute("TRUNCATE sync_ops, inspection_items, inspections, sites, users RESTART IDENTITY CASCADE")
        cur.execute("ALTER SEQUENCE change_seq RESTART WITH 1")
        return seed_all(cur)


if __name__ == "__main__":
    if "--reset" in sys.argv:
        target = "the DATABASE_URL database" if os.getenv("DATABASE_URL") else os.getenv("DB_NAME", "plumb_dev")
        if "--yes" not in sys.argv:
            if input(f"This deletes ALL data in {target} and loads fresh demo data. Type YES to continue: ").strip() != "YES":
                print("Cancelled.")
                sys.exit(1)
        print("Reset complete:", reset())
    else:
        print("Database status:", bootstrap())
