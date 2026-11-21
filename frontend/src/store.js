// The device's copy of everything: inspections, the queue of changes waiting to be sent, and settings.
// Memory is the fast copy the screens read; every change is also written to IndexedDB.
import { deriveView, makeInspection, normalizeItemChanges, nowIso, uid } from "./ops";

const META_KEY = "state";

export async function createStore({ db, user }) {
  const docs = new Map();
  let queue = [];
  let meta = { cursor: 0, sites: [], templates: [], lastSyncAt: null, referenceAt: null };
  const listeners = new Set();
  let inflight = new Set();
  let enqueueHook = null;
  let writeChain = Promise.resolve();
  let saveError = false;
  let snapshot = null;

  for (const doc of await db.getAll("docs")) docs.set(doc.id, doc);
  queue = (await db.getAll("queue")).sort((a, b) => a.n - b.n);
  meta = { ...meta, ...((await db.get("meta", META_KEY)) ?? {}) };
  let nextN = queue.reduce((max, o) => Math.max(max, o.n), 0) + 1;

  function build() {
    const views = new Map();
    for (const doc of docs.values()) {
      views.set(doc.id, deriveView(doc, queue.filter((o) => o.inspection_id === doc.id)));
    }
    const list = [...views.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return {
      views,
      list,
      queue,
      meta,
      saveError,
      counts: {
        waiting: queue.filter((o) => o.status === "pending").length,
        conflicts: queue.filter((o) => o.status === "conflict").length,
        rejected: queue.filter((o) => o.status === "rejected").length,
      },
    };
  }

  function emit() {
    snapshot = build();
    listeners.forEach((l) => l());
  }

  /** Write to IndexedDB in order. If the browser refuses (private mode, full disk), tell the person. */
  function save(writes) {
    writeChain = writeChain
      .then(() => db.write(writes))
      .catch((err) => {
        console.error("Could not save to this device", err);
        saveError = true;
        emit();
      });
    return writeChain;
  }
  const putDoc = (d) => ({ store: "docs", value: d });
  const putOp = (o) => ({ store: "queue", value: o });
  const delOp = (id) => ({ store: "queue", delete: id });
  const putMeta = () => ({ store: "meta", key: META_KEY, value: meta });

  function replaceOp(op) {
    queue = queue.map((o) => (o.op_id === op.op_id ? op : o));
  }
  function addOp(op) {
    queue = [...queue, { ...op, n: nextN++ }];
    return queue[queue.length - 1];
  }
  const serverItem = (inspectionId, itemId) => docs.get(inspectionId)?.items.find((i) => i.id === itemId);
  const isInflight = (op) => inflight.has(op.op_id);

  emit();

  return {
    // ---- reading
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => snapshot,
    meta: () => meta,
    flush: () => writeChain,
    close: () => db.close(),

    // ---- reference data (sites and checklists), kept so a new inspection can start offline
    async setReference({ sites, templates }) {
      meta = { ...meta, sites, templates, referenceAt: Date.now() };
      emit();
      await save([putMeta()]);
    },
    async setLastSync(ms) {
      meta = { ...meta, lastSyncAt: ms };
      emit();
      await save([putMeta()]);
    },
    onEnqueue: (fn) => {
      enqueueHook = fn;
    },

    // ---- things the person does
    startInspection({ site, template, title }) {
      const { doc, op } = makeInspection({ site, template, title, user });
      docs.set(doc.id, doc);
      const saved = addOp(op);
      emit();
      save([putDoc(doc), putOp(saved)]);
      enqueueHook?.();
      return doc.id;
    },

    /** Change one checklist item. Quick repeat taps on the same item join the change that has not been sent yet. */
    setItem(inspectionId, itemId, changes) {
      const view = snapshot.views.get(inspectionId);
      const base = serverItem(inspectionId, itemId);
      const current = view?.items.find((i) => i.id === itemId);
      if (!view || !base || !current || view.status === "submitted") return false;
      const normalized = normalizeItemChanges(current, changes);
      if (Object.entries(normalized).every(([k, v]) => current[k] === v)) return false;

      const open = queue.find(
        (o) => o.type === "update_item" && o.payload.item_id === itemId && o.status === "pending" && !isInflight(o)
      );
      let op;
      if (open) {
        op = { ...open, payload: { ...open.payload, changes: { ...open.payload.changes, ...normalized } } };
        replaceOp(op);
      } else {
        op = addOp({
          op_id: uid(), type: "update_item", inspection_id: inspectionId, created_at: nowIso(), status: "pending", attempts: 0,
          payload: { inspection_id: inspectionId, item_id: itemId, base_version: base.version, changes: normalized },
        });
      }
      emit();
      save([putOp(op)]);
      enqueueHook?.();
      return true;
    },

    setHead(inspectionId, changes) {
      const view = snapshot.views.get(inspectionId);
      const base = docs.get(inspectionId);
      if (!view || !base || view.status === "submitted") return false;
      if (Object.entries(changes).every(([k, v]) => view[k] === v)) return false;
      const open = queue.find(
        (o) => o.type === "update_inspection" && o.inspection_id === inspectionId && o.status === "pending" && !isInflight(o)
      );
      let op;
      if (open) {
        op = { ...open, payload: { ...open.payload, changes: { ...open.payload.changes, ...changes } } };
        replaceOp(op);
      } else {
        op = addOp({
          op_id: uid(), type: "update_inspection", inspection_id: inspectionId, created_at: nowIso(), status: "pending", attempts: 0,
          payload: { inspection_id: inspectionId, base_version: base.version, changes },
        });
      }
      emit();
      save([putOp(op)]);
      enqueueHook?.();
      return true;
    },

    submit(inspectionId) {
      const view = snapshot.views.get(inspectionId);
      if (!view || view.status === "submitted") return false;
      const op = addOp({
        op_id: uid(), type: "submit_inspection", inspection_id: inspectionId, created_at: nowIso(), status: "pending", attempts: 0,
        payload: { inspection_id: inspectionId },
      });
      emit();
      save([putOp(op)]);
      enqueueHook?.();
      return true;
    },

    /** Throw away an inspection that never reached the server. */
    discard(inspectionId) {
      const doc = docs.get(inspectionId);
      const create = queue.find((o) => o.type === "create_inspection" && o.inspection_id === inspectionId);
      if (!doc?._local || !create || isInflight(create)) return false;
      const gone = queue.filter((o) => o.inspection_id === inspectionId);
      queue = queue.filter((o) => o.inspection_id !== inspectionId);
      docs.delete(inspectionId);
      emit();
      save([{ store: "docs", delete: inspectionId }, ...gone.map((o) => delOp(o.op_id))]);
      return true;
    },

    // ---- deciding about conflicts and refused changes
    /** "Keep mine": send my change again, now based on what the server has. */
    keepMine(opId) {
      const op = queue.find((o) => o.op_id === opId && o.status === "conflict");
      if (!op) return;
      const serverDoc = op.conflict?.server ?? docs.get(op.inspection_id);
      const base =
        op.type === "update_item"
          ? serverDoc?.items.find((i) => i.id === op.payload.item_id)?.version ?? op.payload.base_version
          : serverDoc?.version ?? op.payload.base_version;
      queue = queue.filter((o) => o.op_id !== opId);
      const fresh = addOp({
        ...op, op_id: uid(), status: "pending", attempts: 0, conflict: undefined,
        payload: { ...op.payload, base_version: base },
      });
      emit();
      save([delOp(opId), putOp(fresh)]);
      enqueueHook?.();
    },

    /** "Use theirs", or "dismiss" for a refused change: forget my change. */
    dropOp(opId) {
      const op = queue.find((o) => o.op_id === opId);
      if (!op) return;
      const gone = op.type === "create_inspection" ? queue.filter((o) => o.inspection_id === op.inspection_id) : [op];
      queue = queue.filter((o) => !gone.includes(o));
      const writes = gone.map((o) => delOp(o.op_id));
      if (op.type === "create_inspection") {
        docs.delete(op.inspection_id);
        writes.push({ store: "docs", delete: op.inspection_id });
      }
      emit();
      save(writes);
    },

    // ---- used by the sync engine
    nextBatch: (max) => queue.filter((o) => o.status === "pending").slice(0, max),
    setInflight(ids) {
      inflight = new Set(ids);
    },

    /** Take the server's answers: drop what was saved, flag conflicts and refusals, store the newest copies. */
    async applySync(batch, response) {
      const writes = [];
      const events = [];
      let progressed = false;

      for (const result of response.results) {
        const op = queue.find((o) => o.op_id === result.op_id);
        if (!op) continue;
        progressed = true;
        if (result.status === "applied") {
          queue = queue.filter((o) => o.op_id !== op.op_id);
          writes.push(delOp(op.op_id));
          if (result.doc) {
            docs.set(result.doc.id, result.doc);
            writes.push(putDoc(result.doc));
          }
          if (result.merged) events.push({ type: "merged", op });
        } else if (result.status === "conflict") {
          const updated = { ...op, status: "conflict", conflict: { fields: result.fields, server: result.doc ?? docs.get(op.inspection_id) } };
          replaceOp(updated);
          writes.push(putOp(updated));
          // The server's copy is the truth now, so keep it even though my change did not go through.
          const current = docs.get(op.inspection_id);
          if (result.doc && (!current || current._local || current.seq <= result.doc.seq)) {
            docs.set(result.doc.id, result.doc);
            writes.push(putDoc(result.doc));
          }
          events.push({ type: "conflict", op: updated });
        } else {
          const updated = { ...op, status: "rejected", error: { code: result.code, message: result.message } };
          replaceOp(updated);
          writes.push(putOp(updated));
          events.push({ type: "rejected", op: updated });
        }
      }

      const { changes } = response;
      if (changes.reset) {
        for (const doc of [...docs.values()]) {
          if (!doc._local) {
            docs.delete(doc.id);
            writes.push({ store: "docs", delete: doc.id });
          }
        }
      }
      for (const incoming of changes.inspections) {
        const existing = docs.get(incoming.id);
        if (existing && !existing._local && existing.seq > incoming.seq) continue; // an older copy never replaces a newer one
        docs.set(incoming.id, incoming);
        writes.push(putDoc(incoming));
      }
      meta = { ...meta, cursor: changes.cursor };
      writes.push(putMeta());

      emit();
      await save(writes);
      return { events, progressed: progressed || batch.length === 0 };
    },
  };
}
