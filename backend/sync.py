"""The sync endpoint: how a device that was offline catches up.

A device sends a list of changes ("ops") it made while offline, and the number of the last
change it has seen. The server answers with one result per op, plus every inspection that
changed after that number. The rules that make this safe:

* Idempotent. Every op has an id. The answer is stored, so sending the same op again (the
  connection dropped before the reply arrived) returns the same answer and changes nothing.
* No lost edits. Every item and inspection has a version, and each field remembers which
  version and which device last changed it. If someone else changed the SAME field after
  the version you edited, you get a "conflict" and nothing is applied. If they changed a
  different field (a note while you changed the result), both changes are kept (merged).
* Submitted inspections are locked.
* One bad op never blocks the rest: it comes back "rejected" with a reason.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional
from uuid import UUID

import psycopg2
from fastapi import APIRouter, Depends
from psycopg2.extras import Json
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

import db
from auth import current_user
from errors import friendly_message

log = logging.getLogger("plumb")
router = APIRouter(tags=["Sync"])

WRITE_LOCK = 727302  # one writer at a time, so change numbers are handed out in commit order
PAGE_SIZE = 100
MAX_OPS = 50

ITEM_GROUPS = {"result": "result", "severity": "result", "note": "note"}
HEAD_GROUPS = {"title": "title", "notes": "notes"}


# --------------------------------------------------------------------------- request models
class Envelope(BaseModel):
    op_id: UUID
    type: str = Field(max_length=40)
    payload: dict = Field(default_factory=dict)


class SyncIn(BaseModel):
    client_id: UUID
    since: int = Field(default=0, ge=0)
    ops: list[Envelope] = Field(default_factory=list, max_length=MAX_OPS)


class ItemNew(BaseModel):
    id: UUID
    label: str = Field(min_length=1, max_length=160)
    position: int = Field(ge=0, le=200)


class CreateInspection(BaseModel):
    id: UUID
    site_id: int
    title: str = Field(min_length=3, max_length=120)
    kind: Literal["fire_safety", "electrical", "scaffolding", "housekeeping"]
    notes: str = Field(default="", max_length=1000)
    created_at: datetime
    items: list[ItemNew] = Field(min_length=1, max_length=40)

    @field_validator("title")
    @classmethod
    def trim_title(cls, v):
        v = " ".join(v.split())
        if len(v) < 3:
            raise ValueError("Title must be at least 3 characters.")
        return v


class ItemChanges(BaseModel):
    model_config = ConfigDict(extra="forbid")
    result: Optional[Literal["pending", "pass", "fail", "na"]] = None
    severity: Optional[Literal["low", "medium", "high"]] = None
    note: Optional[str] = Field(default=None, max_length=500)


class UpdateItem(BaseModel):
    inspection_id: UUID
    item_id: UUID
    base_version: int = Field(ge=0)
    changes: ItemChanges

    @model_validator(mode="after")
    def not_empty(self):
        if not self.changes.model_fields_set:
            raise ValueError("Nothing to change.")
        return self


class HeadChanges(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Optional[str] = Field(default=None, min_length=3, max_length=120)
    notes: Optional[str] = Field(default=None, max_length=1000)


class UpdateInspection(BaseModel):
    inspection_id: UUID
    base_version: int = Field(ge=0)
    changes: HeadChanges

    @model_validator(mode="after")
    def not_empty(self):
        if not self.changes.model_fields_set:
            raise ValueError("Nothing to change.")
        return self


class SubmitInspection(BaseModel):
    inspection_id: UUID


PAYLOADS = {
    "create_inspection": CreateInspection,
    "update_item": UpdateItem,
    "update_inspection": UpdateInspection,
    "submit_inspection": SubmitInspection,
}


# --------------------------------------------------------------------------- reading
def load_docs(cur, where, params, limit=None):
    """Inspections (with their items) as the plain dictionaries the app stores."""
    cur.execute(
        f"""SELECT i.id, i.site_id, s.name AS site_name, i.inspector_id, u.name AS inspector_name,
                   i.title, i.kind, i.status, i.notes, i.version, i.seq,
                   i.created_at, i.updated_at, i.submitted_at, ub.name AS updated_by_name
              FROM inspections i
              JOIN sites s ON s.id = i.site_id
              JOIN users u ON u.id = i.inspector_id
              LEFT JOIN users ub ON ub.id = i.updated_by
              {where}
             ORDER BY i.seq {('LIMIT %d' % limit) if limit else ''}""",
        params,
    )
    docs = cur.fetchall()
    if docs:
        cur.execute(
            """SELECT it.id, it.inspection_id, it.position, it.label, it.result, it.severity, it.note,
                      it.version, it.updated_at, ub.name AS updated_by_name
                 FROM inspection_items it LEFT JOIN users ub ON ub.id = it.updated_by
                WHERE it.inspection_id = ANY(%s::uuid[]) ORDER BY it.position""",
            ([d["id"] for d in docs],),
        )
        by_inspection = {}
        for item in cur.fetchall():
            by_inspection.setdefault(item["inspection_id"], []).append(item)
        for d in docs:
            d["items"] = by_inspection.get(d["id"], [])
    return docs


def load_doc(cur, inspection_id):
    docs = load_docs(cur, "WHERE i.id = %s", (str(inspection_id),))
    return docs[0] if docs else None


def pull(user, since):
    """Inspections that changed after `since`, oldest first."""
    with db.transaction() as cur:
        cur.execute("SELECT last_value, is_called FROM change_seq")
        row = cur.fetchone()
        newest = row["last_value"] if row["is_called"] else 0
        reset = since > newest  # the database was wiped since this device last synced
        if reset:
            since = 0
        where, params = "WHERE i.seq > %s", [since]
        if user["role"] != "supervisor":
            where += " AND i.inspector_id = %s"
            params.append(user["id"])
        docs = load_docs(cur, where, params, limit=PAGE_SIZE + 1)
        more = len(docs) > PAGE_SIZE
        docs = docs[:PAGE_SIZE]
        cursor = docs[-1]["seq"] if docs else since
        return {"cursor": cursor, "more": more, "reset": reset, "inspections": docs}


# --------------------------------------------------------------------------- writing
def reject(code, message):
    return {"status": "rejected", "code": code, "message": message}


def can_edit(user, inspection):
    return user["role"] == "supervisor" or inspection["inspector_id"] == user["id"]


def touch(cur, inspection_id, user):
    """Give the inspection a new change number so every device picks it up."""
    cur.execute(
        "UPDATE inspections SET seq = nextval('change_seq'), updated_at = now(), updated_by = %s WHERE id = %s",
        (user["id"], str(inspection_id)),
    )


def find_conflicts(current, field_versions, incoming, base_version, client_id, groups):
    """Which changes can be applied, and which groups of fields were changed by someone else."""
    changed = {f: v for f, v in incoming.items() if current[f] != v}
    conflicts = []
    for field in changed:
        group = groups[field]
        last = field_versions.get(group)
        theirs = bool(last) and last["v"] > base_version and last["c"] != str(client_id)
        if theirs and group not in conflicts:
            conflicts.append(group)
    return changed, conflicts


def changed_by_others(field_versions, base_version, client_id):
    return any(
        fv["v"] > base_version and fv["c"] != str(client_id) for fv in field_versions.values()
    )


def lock_inspection(cur, user, inspection_id):
    cur.execute("SELECT * FROM inspections WHERE id = %s FOR UPDATE", (str(inspection_id),))
    inspection = cur.fetchone()
    if not inspection or not can_edit(user, inspection):
        return None, reject("not_found", "This inspection is not available to you.")
    return inspection, None


def do_create(cur, user, client_id, p: CreateInspection):
    cur.execute("SELECT inspector_id FROM inspections WHERE id = %s", (str(p.id),))
    existing = cur.fetchone()
    if existing:  # the same inspection sent again under a new op id
        if existing["inspector_id"] != user["id"]:
            return reject("forbidden", "This inspection id is already used.")
        return {"status": "applied", "noop": True, "doc": load_doc(cur, p.id)}
    cur.execute("SELECT 1 FROM sites WHERE id = %s", (p.site_id,))
    if not cur.fetchone():
        return reject("invalid", "That site no longer exists.")
    now = datetime.now(timezone.utc)
    created = p.created_at if p.created_at.tzinfo else p.created_at.replace(tzinfo=timezone.utc)
    created = min(created, now + timedelta(minutes=5))  # a wrong phone clock cannot post-date it
    cur.execute(
        """INSERT INTO inspections (id, site_id, inspector_id, title, kind, notes, created_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        (str(p.id), p.site_id, user["id"], p.title, p.kind, p.notes, created),
    )
    for item in p.items:
        cur.execute(
            "INSERT INTO inspection_items (id, inspection_id, position, label) VALUES (%s, %s, %s, %s)",
            (str(item.id), str(p.id), item.position, item.label),
        )
    return {"status": "applied", "doc": load_doc(cur, p.id)}


def do_update_item(cur, user, client_id, p: UpdateItem):
    inspection, error = lock_inspection(cur, user, p.inspection_id)
    if error:
        return error
    if inspection["status"] == "submitted":
        return reject("locked", "This inspection was already submitted, so it can no longer be changed.")
    cur.execute(
        "SELECT * FROM inspection_items WHERE id = %s AND inspection_id = %s FOR UPDATE",
        (str(p.item_id), str(p.inspection_id)),
    )
    item = cur.fetchone()
    if not item:
        return reject("not_found", "That checklist item no longer exists.")

    incoming = {f: getattr(p.changes, f) for f in p.changes.model_fields_set}
    target = incoming.get("result", item["result"])
    if incoming.get("severity") is not None and target != "fail":
        return reject("invalid", "Severity only applies to a failed item.")
    if incoming.get("result") in ("pending", "pass", "na"):
        incoming["severity"] = None
    elif incoming.get("result") == "fail" and "severity" not in incoming and item["severity"] is None:
        incoming["severity"] = "medium"
    if "note" in incoming and incoming["note"] is not None:
        incoming["note"] = incoming["note"].strip()
    if incoming.get("note") is None:
        incoming.pop("note", None)

    fvs = item["field_versions"]
    changed, conflicts = find_conflicts(item, fvs, incoming, p.base_version, client_id, ITEM_GROUPS)
    if conflicts:
        return {"status": "conflict", "fields": conflicts, "doc": load_doc(cur, p.inspection_id)}
    if not changed:
        return {"status": "applied", "noop": True, "doc": load_doc(cur, p.inspection_id)}

    merged = changed_by_others(fvs, p.base_version, client_id)
    version = item["version"] + 1
    final = {**{k: item[k] for k in ("result", "severity", "note")}, **changed}
    if final["result"] != "fail":
        final["severity"] = None
    for field in changed:
        fvs[ITEM_GROUPS[field]] = {"v": version, "c": str(client_id)}
    cur.execute(
        """UPDATE inspection_items
              SET result = %s, severity = %s, note = %s, version = %s, field_versions = %s,
                  updated_at = now(), updated_by = %s
            WHERE id = %s""",
        (final["result"], final["severity"], final["note"], version, Json(fvs), user["id"], str(p.item_id)),
    )
    touch(cur, p.inspection_id, user)
    return {"status": "applied", "merged": merged, "doc": load_doc(cur, p.inspection_id)}


def do_update_inspection(cur, user, client_id, p: UpdateInspection):
    inspection, error = lock_inspection(cur, user, p.inspection_id)
    if error:
        return error
    if inspection["status"] == "submitted":
        return reject("locked", "This inspection was already submitted, so it can no longer be changed.")
    incoming = {f: getattr(p.changes, f) for f in p.changes.model_fields_set}
    if "title" in incoming:
        incoming["title"] = " ".join((incoming["title"] or "").split())
        if len(incoming["title"]) < 3:
            return reject("invalid", "Title must be at least 3 characters.")
    incoming = {k: v for k, v in incoming.items() if v is not None}

    fvs = inspection["field_versions"]
    changed, conflicts = find_conflicts(inspection, fvs, incoming, p.base_version, client_id, HEAD_GROUPS)
    if conflicts:
        return {"status": "conflict", "fields": conflicts, "doc": load_doc(cur, p.inspection_id)}
    if not changed:
        return {"status": "applied", "noop": True, "doc": load_doc(cur, p.inspection_id)}

    merged = changed_by_others(fvs, p.base_version, client_id)
    version = inspection["version"] + 1
    final = {"title": inspection["title"], "notes": inspection["notes"], **changed}
    for field in changed:
        fvs[HEAD_GROUPS[field]] = {"v": version, "c": str(client_id)}
    cur.execute(
        "UPDATE inspections SET title = %s, notes = %s, version = %s, field_versions = %s WHERE id = %s",
        (final["title"], final["notes"], version, Json(fvs), str(p.inspection_id)),
    )
    touch(cur, p.inspection_id, user)
    return {"status": "applied", "merged": merged, "doc": load_doc(cur, p.inspection_id)}


def do_submit(cur, user, client_id, p: SubmitInspection):
    inspection, error = lock_inspection(cur, user, p.inspection_id)
    if error:
        return error
    if inspection["status"] == "submitted":
        return {"status": "applied", "noop": True, "doc": load_doc(cur, p.inspection_id)}
    cur.execute(
        """SELECT count(*) FILTER (WHERE result = 'pending') AS pending,
                  count(*) FILTER (WHERE result = 'fail' AND btrim(note) = '') AS missing_notes
             FROM inspection_items WHERE inspection_id = %s""",
        (str(p.inspection_id),),
    )
    counts = cur.fetchone()
    if counts["pending"]:
        return reject("incomplete", f"{counts['pending']} checklist item(s) are still unanswered.")
    if counts["missing_notes"]:
        return reject("needs_note", f"{counts['missing_notes']} failed item(s) need a short note.")
    cur.execute(
        """UPDATE inspections SET status = 'submitted', submitted_at = now(), version = version + 1
            WHERE id = %s""",
        (str(p.inspection_id),),
    )
    touch(cur, p.inspection_id, user)
    return {"status": "applied", "doc": load_doc(cur, p.inspection_id)}


HANDLERS = {
    "create_inspection": do_create,
    "update_item": do_update_item,
    "update_inspection": do_update_inspection,
    "submit_inspection": do_submit,
}


def process_op(user, client_id, envelope: Envelope):
    """Apply one op in its own transaction, or replay the stored answer if we have seen it."""
    model = PAYLOADS.get(envelope.type)
    if model is None:
        return {"op_id": str(envelope.op_id), "type": envelope.type,
                **reject("unknown_op", "This kind of change is not supported.")}
    try:
        payload = model.model_validate(envelope.payload)
    except ValidationError as exc:
        err = exc.errors()[0]
        where = ".".join(str(p) for p in err["loc"])
        return {"op_id": str(envelope.op_id), "type": envelope.type,
                **reject("invalid", f"{where}: {friendly_message(err)}" if where else friendly_message(err))}

    with db.transaction() as cur:
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (WRITE_LOCK,))
        cur.execute(
            "INSERT INTO sync_ops (op_id, user_id) VALUES (%s, %s) ON CONFLICT (op_id) DO NOTHING RETURNING op_id",
            (str(envelope.op_id), user["id"]),
        )
        if cur.fetchone() is None:
            cur.execute("SELECT user_id, result FROM sync_ops WHERE op_id = %s", (str(envelope.op_id),))
            seen = cur.fetchone()
            if seen["user_id"] != user["id"] or seen["result"] is None:
                return {"op_id": str(envelope.op_id), "type": envelope.type,
                        **reject("forbidden", "This change id is already used.")}
            return {**seen["result"], "op_id": str(envelope.op_id), "type": envelope.type, "replayed": True}

        cur.execute("SAVEPOINT op")
        try:
            result = HANDLERS[envelope.type](cur, user, client_id, payload)
        except (psycopg2.errors.IntegrityError, psycopg2.errors.DataError) as exc:
            log.warning("op %s refused by the database: %s", envelope.op_id, exc)
            cur.execute("ROLLBACK TO SAVEPOINT op")
            result = reject("invalid", "The server could not accept this change.")
        # Keep the answer without the big document, so a replay stays small.
        stored = {k: v for k, v in result.items() if k != "doc"}
        cur.execute("UPDATE sync_ops SET result = %s WHERE op_id = %s", (Json(stored), str(envelope.op_id)))
        return {**result, "op_id": str(envelope.op_id), "type": envelope.type}


@router.post("/sync")
def sync(body: SyncIn, user=Depends(current_user)):
    results = [process_op(user, body.client_id, op) for op in body.ops]
    return {
        "results": results,
        "changes": pull(user, body.since),
        "server_time": datetime.now(timezone.utc),
    }
