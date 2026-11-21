// Pure helpers for the offline model. No React and no storage in here, so they are easy to test.
//
// The device keeps two things per inspection:
//   1. the last copy the server confirmed, and
//   2. a queue of changes made since ("ops").
// What the person sees is the server copy with the waiting changes applied on top.

export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const nowIso = () => new Date().toISOString();

/** Same rules as the server: a failed item has a severity, any other result has none. */
export function normalizeItemChanges(item, changes) {
  const out = { ...changes };
  if ("result" in changes) {
    if (changes.result === "fail") {
      if (!("severity" in changes)) out.severity = item.severity ?? "medium";
    } else {
      out.severity = null;
    }
  }
  return out;
}

/** A brand new inspection made on the device: the local copy and the op that will create it on the server. */
export function makeInspection({ site, template, title, user }) {
  const id = uid();
  const createdAt = nowIso();
  const items = template.items.map((label, position) => ({
    id: uid(), position, label, result: "pending", severity: null, note: "", version: 1,
  }));
  const doc = {
    id, site_id: site.id, site_name: site.name, inspector_id: user.id, inspector_name: user.name,
    title, kind: template.kind, status: "draft", notes: "", version: 1, seq: null,
    created_at: createdAt, updated_at: createdAt, submitted_at: null, items, _local: true,
  };
  const op = {
    op_id: uid(), type: "create_inspection", inspection_id: id, created_at: createdAt, status: "pending", attempts: 0,
    payload: {
      id, site_id: site.id, title, kind: template.kind, notes: "", created_at: createdAt,
      items: items.map(({ id: itemId, label, position }) => ({ id: itemId, label, position })),
    },
  };
  return { doc, op };
}

/** Apply one waiting change to a copy of the inspection. */
export function applyOp(doc, op) {
  switch (op.type) {
    case "update_item": {
      const { item_id: itemId, changes } = op.payload;
      return { ...doc, items: doc.items.map((i) => (i.id === itemId ? { ...i, ...changes, _pending: true } : i)) };
    }
    case "update_inspection":
      return { ...doc, ...op.payload.changes, _pending: true };
    case "submit_inspection":
      return { ...doc, status: "submitted", submitted_at: op.created_at, _pending: true };
    default:
      return doc;
  }
}

/** What the screen shows: the server copy plus every waiting change, with a sync state attached. */
export function deriveView(doc, ops) {
  const waiting = ops.filter((o) => o.status === "pending");
  const view = waiting.reduce(applyOp, doc);
  const conflicts = ops.filter((o) => o.status === "conflict");
  const rejected = ops.filter((o) => o.status === "rejected");
  let syncState = "synced";
  if (conflicts.length) syncState = "conflict";
  else if (rejected.length) syncState = "problem";
  else if (doc._local) syncState = "local";
  else if (waiting.length) syncState = "waiting";
  return { ...view, waitingOps: waiting.length, conflicts, rejected, syncState };
}

export function summarize(view) {
  const count = (r) => view.items.filter((i) => i.result === r).length;
  const total = view.items.length;
  const pending = count("pending");
  return {
    total,
    pending,
    answered: total - pending,
    pass: count("pass"),
    fail: count("fail"),
    na: count("na"),
    high: view.items.filter((i) => i.result === "fail" && i.severity === "high").length,
    missingNotes: view.items.filter((i) => i.result === "fail" && !i.note.trim()).length,
  };
}

/** Can this inspection be submitted? Same two rules the server enforces. */
export function submitCheck(view) {
  const s = summarize(view);
  return { ok: s.pending === 0 && s.missingNotes === 0 && view.status === "draft", unanswered: s.pending, missingNotes: s.missingNotes };
}

/** A short sentence for the Sync page. */
export function describeOp(op, doc) {
  const title = doc?.title ?? "an inspection";
  switch (op.type) {
    case "create_inspection":
      return `Started “${op.payload.title}”`;
    case "submit_inspection":
      return `Submitted “${title}”`;
    case "update_inspection": {
      const fields = Object.keys(op.payload.changes).map((f) => (f === "notes" ? "notes" : f));
      return `Edited ${fields.join(" and ")} of “${title}”`;
    }
    case "update_item": {
      const item = doc?.items.find((i) => i.id === op.payload.item_id);
      const c = op.payload.changes;
      const bits = [];
      if (c.result) bits.push(`marked ${{ pass: "Pass", fail: "Fail", na: "N/A", pending: "Not answered" }[c.result]}`);
      else if (c.severity) bits.push(`severity ${c.severity}`);
      if ("note" in c && c.note !== undefined) bits.push(c.note ? "added a note" : "cleared the note");
      return `${item?.label ?? "An item"}: ${bits.join(", ") || "changed"}`;
    }
    default:
      return "A change";
  }
}

export const wire = (op) => ({ op_id: op.op_id, type: op.type, payload: op.payload });
