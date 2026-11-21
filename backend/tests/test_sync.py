"""The heart of the project: safe syncing after being offline."""
import db
from conftest import create_op, headers_for, item_op, new_id, now_iso, send

DEVICE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
DEVICE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


def start(client, user, site_id, n_items=3):
    """Create an inspection from device A and return (inspection_id, item_ids)."""
    op = create_op(site_id, n_items)
    res = send(client, user["h"], [op], DEVICE_A)["results"][0]
    assert res["status"] == "applied"
    doc = res["doc"]
    return doc["id"], [i["id"] for i in doc["items"]]


def doc_of(client, user, inspection_id):
    changes = send(client, user["h"], [], DEVICE_A)["changes"]["inspections"]
    return next(d for d in changes if d["id"] == inspection_id)


def result_of(client, ops, user, device=DEVICE_A):
    return send(client, user["h"], ops, device)["results"]


# ------------------------------------------------------------------ create
def test_create_inspection_is_applied_and_returned(client, kavya, site_id):
    op = create_op(site_id, n_items=4)
    body = send(client, kavya["h"], [op], DEVICE_A)
    res = body["results"][0]
    assert res["status"] == "applied" and res["op_id"] == op["op_id"]
    assert res["doc"]["inspector_name"] == "Kavya Reddy"
    assert [i["result"] for i in res["doc"]["items"]] == ["pending"] * 4
    assert res["doc"]["status"] == "draft"
    assert len(body["changes"]["inspections"]) == 1


def test_sending_the_same_op_twice_changes_nothing_the_second_time(client, kavya, site_id):
    op = create_op(site_id)
    first = send(client, kavya["h"], [op], DEVICE_A)["results"][0]
    second = send(client, kavya["h"], [op], DEVICE_A)["results"][0]
    assert first["status"] == "applied" and not first.get("replayed")
    assert second["status"] == "applied" and second["replayed"] is True
    assert db.fetch_one("SELECT count(*) AS n FROM inspections")["n"] == 1
    assert db.fetch_one("SELECT count(*) AS n FROM inspection_items")["n"] == 3


def test_same_inspection_under_a_new_op_id_is_not_duplicated(client, kavya, site_id):
    inspection_id = new_id()
    a = create_op(site_id, inspection_id=inspection_id)
    b = create_op(site_id, inspection_id=inspection_id)
    send(client, kavya["h"], [a], DEVICE_A)
    res = send(client, kavya["h"], [b], DEVICE_A)["results"][0]
    assert res["status"] == "applied" and res["noop"] is True
    assert db.fetch_one("SELECT count(*) AS n FROM inspections")["n"] == 1


def test_another_user_cannot_take_over_an_inspection_id(client, kavya, ramesh, site_id):
    inspection_id = new_id()
    send(client, kavya["h"], [create_op(site_id, inspection_id=inspection_id)], DEVICE_A)
    res = send(client, ramesh["h"], [create_op(site_id, inspection_id=inspection_id)], DEVICE_B)["results"][0]
    assert res["status"] == "rejected" and res["code"] == "forbidden"


def test_the_same_op_id_from_another_user_is_refused(client, kavya, ramesh, site_id):
    op = create_op(site_id)
    send(client, kavya["h"], [op], DEVICE_A)
    res = send(client, ramesh["h"], [op], DEVICE_B)["results"][0]
    assert res["status"] == "rejected" and res["code"] == "forbidden"


def test_create_validation_reasons(client, kavya, site_id):
    no_items = create_op(site_id)
    no_items["payload"]["items"] = []
    bad_kind = create_op(site_id)
    bad_kind["payload"]["kind"] = "plumbing"
    short_title = create_op(site_id, title="ab")
    unknown_site = create_op(99999)
    res = send(client, kavya["h"], [no_items, bad_kind, short_title, unknown_site], DEVICE_A)["results"]
    assert [r["status"] for r in res] == ["rejected"] * 4
    assert all(r["code"] == "invalid" for r in res)
    assert "no longer exists" in res[3]["message"]
    assert db.fetch_one("SELECT count(*) AS n FROM inspections")["n"] == 0


def test_unknown_op_type_is_rejected_not_a_crash(client, kavya):
    res = send(client, kavya["h"], [{"op_id": new_id(), "type": "delete_everything", "payload": {}}], DEVICE_A)["results"][0]
    assert res["status"] == "rejected" and res["code"] == "unknown_op"


def test_one_bad_op_does_not_block_the_good_ones_after_it(client, kavya, site_id):
    bad = create_op(site_id)
    bad["payload"]["items"] = []
    good = create_op(site_id)
    res = send(client, kavya["h"], [bad, good], DEVICE_A)["results"]
    assert [r["status"] for r in res] == ["rejected", "applied"]


def test_a_database_level_failure_becomes_a_rejection_not_an_endless_retry(client, kavya, site_id):
    poison = create_op(site_id, n_items=2)
    poison["payload"]["items"][1]["id"] = poison["payload"]["items"][0]["id"]  # same id twice
    good = create_op(site_id)
    res = send(client, kavya["h"], [poison, good], DEVICE_A)["results"]
    assert res[0]["status"] == "rejected" and res[0]["code"] == "invalid"
    assert res[1]["status"] == "applied"
    assert db.fetch_one("SELECT count(*) AS n FROM inspections")["n"] == 1  # poison rolled back


def test_a_wrong_phone_clock_cannot_date_an_inspection_in_the_future(client, kavya, site_id):
    op = create_op(site_id)
    op["payload"]["created_at"] = "2031-01-01T00:00:00Z"
    doc = send(client, kavya["h"], [op], DEVICE_A)["results"][0]["doc"]
    assert doc["created_at"] < "2027"


def test_more_than_fifty_ops_in_one_request_is_refused(client, kavya, site_id):
    ops = [create_op(site_id) for _ in range(51)]
    r = client.post("/sync", json={"client_id": DEVICE_A, "since": 0, "ops": ops}, headers=kavya["h"])
    assert r.status_code == 422


# ------------------------------------------------------------------ update item
def test_update_item_bumps_the_version(client, kavya, site_id):
    iid, items = start(client, kavya, site_id)
    res = result_of(client, [item_op(iid, items[0], 1, result="pass")], kavya)[0]
    assert res["status"] == "applied"
    item = res["doc"]["items"][0]
    assert item["result"] == "pass" and item["version"] == 2


def test_failing_an_item_gets_a_default_severity_and_passing_clears_it(client, kavya, site_id):
    iid, items = start(client, kavya, site_id)
    failed = result_of(client, [item_op(iid, items[0], 1, result="fail")], kavya)[0]["doc"]["items"][0]
    assert failed["severity"] == "medium"
    passed = result_of(client, [item_op(iid, items[0], 2, result="pass")], kavya)[0]["doc"]["items"][0]
    assert passed["severity"] is None


def test_severity_on_a_passed_item_is_rejected(client, kavya, site_id):
    iid, items = start(client, kavya, site_id)
    res = result_of(client, [item_op(iid, items[0], 1, result="pass", severity="high")], kavya)[0]
    assert res["status"] == "rejected" and res["code"] == "invalid"


def test_replaying_an_update_does_not_bump_the_version_twice(client, kavya, site_id):
    iid, items = start(client, kavya, site_id)
    op = item_op(iid, items[0], 1, result="pass")
    result_of(client, [op], kavya)
    again = result_of(client, [op], kavya)[0]
    assert again["replayed"] is True
    assert db.fetch_one("SELECT version FROM inspection_items WHERE id = %s", (items[0],))["version"] == 2


def test_two_devices_changing_the_same_field_is_a_conflict_and_nothing_is_overwritten(client, kavya, boss, site_id):
    iid, items = start(client, kavya, site_id)
    # The supervisor, online, fails the item first.
    result_of(client, [item_op(iid, items[0], 1, result="fail", severity="high")], boss, DEVICE_B)
    # Kavya's phone was offline and still thinks the item is at version 1.
    res = result_of(client, [item_op(iid, items[0], 1, result="pass")], kavya, DEVICE_A)[0]
    assert res["status"] == "conflict"
    assert res["fields"] == ["result"]
    assert res["doc"]["items"][0]["result"] == "fail"  # the server copy is sent back for her to compare
    row = db.fetch_one("SELECT result, severity FROM inspection_items WHERE id = %s", (items[0],))
    assert (row["result"], row["severity"]) == ("fail", "high")


def test_different_fields_of_the_same_item_are_merged(client, kavya, boss, site_id):
    iid, items = start(client, kavya, site_id)
    result_of(client, [item_op(iid, items[0], 1, note="Checked at 10am")], boss, DEVICE_B)
    res = result_of(client, [item_op(iid, items[0], 1, result="pass")], kavya, DEVICE_A)[0]
    assert res["status"] == "applied" and res["merged"] is True
    item = res["doc"]["items"][0]
    assert item["result"] == "pass" and item["note"] == "Checked at 10am"


def test_the_same_device_sending_stale_versions_in_order_is_not_a_conflict(client, kavya, site_id):
    iid, items = start(client, kavya, site_id)
    ops = [
        item_op(iid, items[0], 1, result="fail", severity="low"),
        item_op(iid, items[0], 1, result="fail", severity="high"),  # made offline on top of the first
        item_op(iid, items[0], 1, note="Missing boards"),
    ]
    res = result_of(client, ops, kavya)
    assert [r["status"] for r in res] == ["applied"] * 3
    item = res[-1]["doc"]["items"][0]
    assert (item["result"], item["severity"], item["note"]) == ("fail", "high", "Missing boards")


def test_both_devices_making_the_same_change_agree_without_a_conflict(client, kavya, boss, site_id):
    iid, items = start(client, kavya, site_id)
    result_of(client, [item_op(iid, items[0], 1, result="pass")], boss, DEVICE_B)
    res = result_of(client, [item_op(iid, items[0], 1, result="pass")], kavya, DEVICE_A)[0]
    assert res["status"] == "applied" and res["noop"] is True


def test_an_inspector_cannot_change_someone_elses_inspection(client, kavya, ramesh, site_id):
    iid, items = start(client, kavya, site_id)
    res = result_of(client, [item_op(iid, items[0], 1, result="pass")], ramesh, DEVICE_B)[0]
    assert res["status"] == "rejected" and res["code"] == "not_found"


def test_a_supervisor_can_change_any_inspection(client, kavya, boss, site_id):
    iid, items = start(client, kavya, site_id)
    res = result_of(client, [item_op(iid, items[0], 1, result="na")], boss, DEVICE_B)[0]
    assert res["status"] == "applied"


def test_unknown_item_is_rejected(client, kavya, site_id):
    iid, _ = start(client, kavya, site_id)
    res = result_of(client, [item_op(iid, new_id(), 1, result="pass")], kavya)[0]
    assert res["status"] == "rejected" and res["code"] == "not_found"


def test_empty_changes_are_rejected(client, kavya, site_id):
    iid, items = start(client, kavya, site_id)
    res = result_of(client, [item_op(iid, items[0], 1)], kavya)[0]
    assert res["status"] == "rejected"


# ------------------------------------------------------------------ inspection header
def head_op(iid, base, **changes):
    return {"op_id": new_id(), "type": "update_inspection",
            "payload": {"inspection_id": iid, "base_version": base, "changes": changes}}


def test_title_and_notes_can_be_edited(client, kavya, site_id):
    iid, _ = start(client, kavya, site_id)
    res = result_of(client, [head_op(iid, 1, title="Fire round, Tower B", notes="Re-check tomorrow")], kavya)[0]
    assert res["status"] == "applied"
    assert res["doc"]["title"] == "Fire round, Tower B" and res["doc"]["version"] == 2


def test_two_devices_editing_the_title_is_a_conflict_but_notes_merge(client, kavya, boss, site_id):
    iid, _ = start(client, kavya, site_id)
    result_of(client, [head_op(iid, 1, title="Boss title")], boss, DEVICE_B)
    clash = result_of(client, [head_op(iid, 1, title="Kavya title")], kavya, DEVICE_A)[0]
    assert clash["status"] == "conflict" and clash["fields"] == ["title"]
    merged = result_of(client, [head_op(iid, 1, notes="Kavya notes")], kavya, DEVICE_A)[0]
    assert merged["status"] == "applied" and merged["merged"] is True
    assert merged["doc"]["title"] == "Boss title" and merged["doc"]["notes"] == "Kavya notes"


# ------------------------------------------------------------------ submit
def submit_op(iid):
    return {"op_id": new_id(), "type": "submit_inspection", "payload": {"inspection_id": iid}}


def answer_all(client, user, iid, items, result="pass"):
    ops = [item_op(iid, item, 1, result=result) for item in items]
    return result_of(client, ops, user)


def test_cannot_submit_with_unanswered_items(client, kavya, site_id):
    iid, items = start(client, kavya, site_id)
    answer_all(client, kavya, iid, items[:2])
    res = result_of(client, [submit_op(iid)], kavya)[0]
    assert res["status"] == "rejected" and res["code"] == "incomplete"
    assert "1 checklist item" in res["message"]


def test_a_failed_item_needs_a_note_before_submitting(client, kavya, site_id):
    iid, items = start(client, kavya, site_id)
    answer_all(client, kavya, iid, items[:2])
    result_of(client, [item_op(iid, items[2], 1, result="fail", severity="high")], kavya)
    blocked = result_of(client, [submit_op(iid)], kavya)[0]
    assert blocked["status"] == "rejected" and blocked["code"] == "needs_note"
    result_of(client, [item_op(iid, items[2], 2, note="Exit blocked by pallets")], kavya)
    assert result_of(client, [submit_op(iid)], kavya)[0]["status"] == "applied"


def test_submit_locks_the_inspection(client, kavya, boss, site_id):
    iid, items = start(client, kavya, site_id)
    answer_all(client, kavya, iid, items)
    done = result_of(client, [submit_op(iid)], kavya)[0]
    assert done["status"] == "applied" and done["doc"]["status"] == "submitted"
    assert done["doc"]["submitted_at"] is not None
    late_item = result_of(client, [item_op(iid, items[0], 2, result="fail", severity="low")], kavya)[0]
    late_head = result_of(client, [head_op(iid, 2, title="New title here")], boss, DEVICE_B)[0]
    assert late_item["code"] == "locked" and late_head["code"] == "locked"


def test_submitting_twice_is_harmless(client, kavya, site_id):
    iid, items = start(client, kavya, site_id)
    answer_all(client, kavya, iid, items)
    result_of(client, [submit_op(iid)], kavya)
    again = result_of(client, [submit_op(iid)], kavya)[0]
    assert again["status"] == "applied" and again["noop"] is True


# ------------------------------------------------------------------ pulling changes
def test_inspectors_only_receive_their_own_inspections_and_supervisors_receive_all(client, kavya, ramesh, boss, site_id):
    start(client, kavya, site_id)
    send(client, ramesh["h"], [create_op(site_id)], DEVICE_B)
    assert len(send(client, kavya["h"], [], DEVICE_A)["changes"]["inspections"]) == 1
    assert len(send(client, ramesh["h"], [], DEVICE_B)["changes"]["inspections"]) == 1
    assert len(send(client, boss["h"], [], DEVICE_B)["changes"]["inspections"]) == 2


def test_the_cursor_returns_only_what_changed_since(client, kavya, site_id):
    iid, items = start(client, kavya, site_id)
    first = send(client, kavya["h"], [], DEVICE_A)["changes"]
    assert send(client, kavya["h"], [], DEVICE_A, since=first["cursor"])["changes"]["inspections"] == []
    result_of(client, [item_op(iid, items[0], 1, result="pass")], kavya)
    later = send(client, kavya["h"], [], DEVICE_A, since=first["cursor"])["changes"]
    assert [d["id"] for d in later["inspections"]] == [iid]
    assert later["cursor"] > first["cursor"]


def test_large_catch_ups_arrive_in_pages(client, kavya, site_id):
    for _ in range(3):
        send(client, kavya["h"], [create_op(site_id) for _ in range(35)], DEVICE_A)
    page1 = send(client, kavya["h"], [], DEVICE_A)["changes"]
    assert len(page1["inspections"]) == 100 and page1["more"] is True
    page2 = send(client, kavya["h"], [], DEVICE_A, since=page1["cursor"])["changes"]
    assert len(page2["inspections"]) == 5 and page2["more"] is False


def test_a_device_that_is_ahead_of_a_wiped_database_is_told_to_start_over(client, kavya, site_id):
    start(client, kavya, site_id)
    changes = send(client, kavya["h"], [], DEVICE_A, since=5000)["changes"]
    assert changes["reset"] is True
    assert len(changes["inspections"]) == 1


def test_the_whole_offline_session_can_be_sent_twice_with_the_same_outcome(client, kavya, site_id):
    create = create_op(site_id, n_items=3)
    iid = create["payload"]["id"]
    items = [i["id"] for i in create["payload"]["items"]]
    ops = [create] + [item_op(iid, items[i], 1, result="pass") for i in range(3)] + [submit_op(iid)]
    first = send(client, kavya["h"], ops, DEVICE_A)
    second = send(client, kavya["h"], ops, DEVICE_A)  # the reply to the first one was lost
    assert [r["status"] for r in first["results"]] == ["applied"] * 5
    assert [r["status"] for r in second["results"]] == ["applied"] * 5
    assert all(r.get("replayed") for r in second["results"])
    row = db.fetch_one("SELECT status, version FROM inspections WHERE id = %s", (iid,))
    assert row["status"] == "submitted" and row["version"] == 2
    assert db.fetch_one("SELECT count(*) AS n FROM sync_ops")["n"] == 5


def test_a_bad_envelope_is_a_clear_422(client, kavya):
    r = client.post("/sync", json={"client_id": "nope", "ops": []}, headers=kavya["h"])
    assert r.status_code == 422 and r.json()["code"] == "validation_error"
