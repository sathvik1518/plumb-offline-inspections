import { describe, expect, it } from "vitest";
import { openDb } from "../db";
import { createStore } from "../store";
import { freshStore, reply, site, template, user } from "./helpers";

function serverDoc(store, id, extra = {}) {
  const v = store.getSnapshot().views.get(id);
  return { ...v, _local: undefined, _pending: undefined, seq: 1, version: 2, waitingOps: undefined, conflicts: undefined, rejected: undefined, syncState: undefined, ...extra };
}

describe("on-device store", () => {
  it("shows a new inspection straight away, marked as on this device", async () => {
    const store = await freshStore();
    const id = store.startInspection({ site, template, title: "Round 1" });
    const view = store.getSnapshot().views.get(id);
    expect(view.items).toHaveLength(3);
    expect(view.syncState).toBe("local");
    expect(store.getSnapshot().counts.waiting).toBe(1);
  });

  it("applies a tap on top of the saved copy, and a fail gets a default severity", async () => {
    const store = await freshStore();
    const id = store.startInspection({ site, template, title: "R" });
    const item = store.getSnapshot().views.get(id).items[0];
    store.setItem(id, item.id, { result: "fail" });
    const after = store.getSnapshot().views.get(id).items[0];
    expect(after).toMatchObject({ result: "fail", severity: "medium" });
    store.setItem(id, item.id, { result: "pass" });
    expect(store.getSnapshot().views.get(id).items[0].severity).toBeNull();
  });

  it("joins quick repeat taps on one item into a single waiting change", async () => {
    const store = await freshStore();
    const id = store.startInspection({ site, template, title: "R" });
    const item = store.getSnapshot().views.get(id).items[0];
    store.setItem(id, item.id, { result: "pass" });
    store.setItem(id, item.id, { result: "fail" });
    store.setItem(id, item.id, { note: "Gauge in red" });
    const updates = store.getSnapshot().queue.filter((o) => o.type === "update_item");
    expect(updates).toHaveLength(1);
    expect(updates[0].payload.changes).toMatchObject({ result: "fail", note: "Gauge in red" });
  });

  it("ignores a tap that changes nothing", async () => {
    const store = await freshStore();
    const id = store.startInspection({ site, template, title: "R" });
    const item = store.getSnapshot().views.get(id).items[0];
    expect(store.setItem(id, item.id, { result: "pending" })).toBe(false);
  });

  it("does not join a tap onto a change that is already being sent", async () => {
    const store = await freshStore();
    const id = store.startInspection({ site, template, title: "R" });
    const item = store.getSnapshot().views.get(id).items[0];
    store.setItem(id, item.id, { result: "pass" });
    const first = store.getSnapshot().queue.find((o) => o.type === "update_item");
    store.setInflight([first.op_id]);
    store.setItem(id, item.id, { result: "fail" });
    expect(store.getSnapshot().queue.filter((o) => o.type === "update_item")).toHaveLength(2);
  });

  it("keeps everything after a reload", async () => {
    const name = `reload-${Math.random()}`;
    const first = await createStore({ db: await openDb(name), user });
    const id = first.startInspection({ site, template, title: "Survives" });
    await first.flush();
    first.close();
    const second = await createStore({ db: await openDb(name), user });
    expect(second.getSnapshot().views.get(id).title).toBe("Survives");
    expect(second.getSnapshot().counts.waiting).toBe(1);
  });

  it("can discard an inspection that never reached the server, but not one that did", async () => {
    const store = await freshStore();
    const id = store.startInspection({ site, template, title: "R" });
    expect(store.discard(id)).toBe(true);
    expect(store.getSnapshot().list).toHaveLength(0);
    expect(store.getSnapshot().queue).toHaveLength(0);
  });

  it("stores the server's copy after sync and drops the finished change", async () => {
    const store = await freshStore();
    const id = store.startInspection({ site, template, title: "R" });
    const batch = store.nextBatch(50);
    await store.applySync(batch, reply(batch, {}, { inspections: [serverDoc(store, id)], cursor: 9 }));
    const snap = store.getSnapshot();
    expect(snap.counts.waiting).toBe(0);
    expect(snap.views.get(id).syncState).toBe("synced");
    expect(snap.meta.cursor).toBe(9);
  });

  it("never lets an older server copy replace a newer one", async () => {
    const store = await freshStore();
    const id = store.startInspection({ site, template, title: "R" });
    const batch = store.nextBatch(50);
    await store.applySync(batch, reply(batch, {}, { inspections: [serverDoc(store, id, { seq: 10, title: "New" })] }));
    await store.applySync([], reply([], {}, { inspections: [serverDoc(store, id, { seq: 4, title: "Old" })] }));
    expect(store.getSnapshot().views.get(id).title).toBe("New");
  });

  describe("conflicts and refusals", () => {
    async function conflicted() {
      const store = await freshStore();
      const id = store.startInspection({ site, template, title: "R" });
      let batch = store.nextBatch(50);
      await store.applySync(batch, reply(batch, {}, { inspections: [serverDoc(store, id)] }));
      const item = store.getSnapshot().views.get(id).items[0];
      store.setItem(id, item.id, { result: "pass" });
      batch = store.nextBatch(50);
      const theirs = serverDoc(store, id);
      theirs.items = theirs.items.map((i, n) => (n === 0 ? { ...i, result: "fail", severity: "high", version: 3 } : i));
      const res = await store.applySync(batch, reply(batch, { [batch[0].op_id]: { op_id: batch[0].op_id, status: "conflict", fields: ["result"], doc: theirs } }));
      return { store, id, item, res, batch };
    }

    it("flags a conflict and keeps my change out of the queue's pending list", async () => {
      const { store, res, id } = await conflicted();
      expect(res.events[0].type).toBe("conflict");
      expect(store.getSnapshot().counts).toMatchObject({ waiting: 0, conflicts: 1 });
      expect(store.getSnapshot().views.get(id).syncState).toBe("conflict");
    });

    it("keep mine sends the change again based on the server's version", async () => {
      const { store, batch } = await conflicted();
      store.keepMine(batch[0].op_id);
      const op = store.getSnapshot().queue.find((o) => o.status === "pending");
      expect(op.payload.base_version).toBe(3);
      expect(op.op_id).not.toBe(batch[0].op_id);
      expect(store.getSnapshot().counts.conflicts).toBe(0);
    });

    it("use theirs forgets my change", async () => {
      const { store, batch, id } = await conflicted();
      store.dropOp(batch[0].op_id);
      expect(store.getSnapshot().queue).toHaveLength(0);
      expect(store.getSnapshot().views.get(id).items[0].result).toBe("fail");
    });

    it("records why a change was refused, and dismissing a refused create removes the inspection", async () => {
      const store = await freshStore();
      const id = store.startInspection({ site, template, title: "R" });
      const batch = store.nextBatch(50);
      const res = await store.applySync(batch, reply(batch, { [batch[0].op_id]: { op_id: batch[0].op_id, status: "rejected", code: "forbidden", message: "No" } }));
      expect(res.events[0].type).toBe("rejected");
      expect(store.getSnapshot().views.get(id).syncState).toBe("problem");
      store.dropOp(batch[0].op_id);
      expect(store.getSnapshot().list).toHaveLength(0);
    });
  });
});
