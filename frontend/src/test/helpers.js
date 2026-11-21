import { openDb } from "../db";
import { createStore } from "../store";

let n = 0;
export const user = { id: 7, name: "Kavya Reddy", email: "k@x.com", role: "inspector" };
export const site = { id: 1, name: "Madhapur Tower", area: "Madhapur" };
export const template = { kind: "fire_safety", name: "Fire safety round", items: ["Extinguishers", "Exits", "Alarm"] };

export async function freshStore() {
  const db = await openDb(`test-${++n}-${Math.random()}`);
  return createStore({ db, user });
}

/** A server reply with nothing new, answering every op as applied unless told otherwise. */
export function reply(batch, overrides = {}, changes = {}) {
  return {
    results: batch.map((o) => overrides[o.op_id] ?? { op_id: o.op_id, status: "applied" }),
    changes: { cursor: 5, more: false, reset: false, inspections: [], ...changes },
    server_time: new Date().toISOString(),
  };
}

/** A fake clock so retry tests do not wait. */
export function fakeTimers() {
  const pending = [];
  return {
    pending,
    set: (fn, ms) => { const t = { fn, ms }; pending.push(t); return t; },
    clear: (t) => { const i = pending.indexOf(t); if (i >= 0) pending.splice(i, 1); },
    fire() { const t = pending.shift(); t?.fn(); return t; },
  };
}
