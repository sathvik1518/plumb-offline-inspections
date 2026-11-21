import { describe, expect, it, vi } from "vitest";
import { backoffDelay, createEngine, describeStatus } from "../sync";
import { fakeTimers, freshStore, reply, site, template } from "./helpers";

async function setup({ online = true, apiImpl } = {}) {
  const store = await freshStore();
  const timers = fakeTimers();
  const api = { sync: vi.fn(apiImpl ?? (async ({ ops }) => reply(ops))) };
  let isOnline = online;
  const engine = createEngine({ store, api, clientId: "c1", isOnline: () => isOnline, timers, random: () => 0.5, now: () => 1000 });
  return { store, timers, api, engine, setOnline: (v) => (isOnline = v) };
}

describe("backoffDelay", () => {
  it("doubles from two seconds and stops at one minute", () => {
    const at = (n) => backoffDelay(n, () => 1);
    expect([at(1), at(2), at(3), at(4)]).toEqual([2000, 4000, 8000, 16000]);
    expect(at(6)).toBe(60000);
    expect(at(20)).toBe(60000);
  });
  it("adds jitter between 75% and 100%", () => {
    expect(backoffDelay(3, () => 0)).toBe(6000);
    expect(backoffDelay(3, () => 1)).toBe(8000);
  });
});

describe("engine", () => {
  it("sends a waiting change and clears it once the server confirms", async () => {
    const { store, engine, api } = await setup();
    store.startInspection({ site, template, title: "Round 1" });
    await engine.kick();
    expect(api.sync).toHaveBeenCalledTimes(1);
    expect(api.sync.mock.calls[0][0].ops[0].type).toBe("create_inspection");
    expect(store.getSnapshot().counts.waiting).toBe(0);
    expect(engine.getState().phase).toBe("idle");
  });

  it("does not call the server while offline and keeps the work", async () => {
    const { store, engine, api } = await setup({ online: false });
    store.startInspection({ site, template, title: "Round 1" });
    await engine.kick();
    expect(api.sync).not.toHaveBeenCalled();
    expect(engine.getState().phase).toBe("offline");
    expect(store.getSnapshot().counts.waiting).toBe(1);
  });

  it("retries with backoff after a network failure, then succeeds", async () => {
    let calls = 0;
    const { store, engine, timers, api } = await setup({
      apiImpl: async ({ ops }) => {
        if (++calls < 3) throw Object.assign(new Error("Cannot reach the server."), { network: true });
        return reply(ops);
      },
    });
    store.startInspection({ site, template, title: "Round 1" });
    await engine.kick();
    expect(engine.getState()).toMatchObject({ phase: "retrying", attempt: 1 });
    expect(timers.pending[0].ms).toBe(backoffDelay(1, () => 0.5));
    timers.fire();
    await vi.waitFor(() => expect(engine.getState().attempt).toBe(2));
    expect(timers.pending[0].ms).toBe(backoffDelay(2, () => 0.5));
    timers.fire();
    await vi.waitFor(() => expect(engine.getState().phase).toBe("idle"));
    expect(api.sync).toHaveBeenCalledTimes(3);
    expect(engine.getState().attempt).toBe(0);
    expect(store.getSnapshot().counts.waiting).toBe(0);
  });

  it.each([[500], [503], [429]])("treats HTTP %i as temporary", async (status) => {
    const { store, engine } = await setup({ apiImpl: async () => { throw Object.assign(new Error("boom"), { status }); } });
    store.startInspection({ site, template, title: "Round 1" });
    await engine.kick();
    expect(engine.getState().phase).toBe("retrying");
    expect(store.getSnapshot().counts.waiting).toBe(1);
  });

  it("stops and asks for sign-in on 401, keeping the queue", async () => {
    const { store, engine, timers } = await setup({ apiImpl: async () => { throw Object.assign(new Error("Please sign in"), { status: 401 }); } });
    store.startInspection({ site, template, title: "Round 1" });
    await engine.kick();
    expect(engine.getState().phase).toBe("auth");
    expect(timers.pending).toHaveLength(0);
    expect(store.getSnapshot().counts.waiting).toBe(1);
  });

  it("does not retry a 400-style error forever", async () => {
    const { store, engine, timers } = await setup({ apiImpl: async () => { throw Object.assign(new Error("Bad request"), { status: 400 }); } });
    store.startInspection({ site, template, title: "Round 1" });
    await engine.kick();
    expect(engine.getState().phase).toBe("error");
    expect(timers.pending).toHaveLength(0);
  });

  it("pauses when work offline is on, and syncs when it is turned off", async () => {
    const { store, engine, api } = await setup();
    engine.setPaused(true);
    store.startInspection({ site, template, title: "Round 1" });
    await engine.kick();
    expect(api.sync).not.toHaveBeenCalled();
    engine.setPaused(false);
    await vi.waitFor(() => expect(api.sync).toHaveBeenCalledTimes(1));
  });

  it("sends at most 50 changes per request", async () => {
    const { store, engine, api } = await setup();
    for (let i = 0; i < 60; i++) store.startInspection({ site, template, title: `Round ${i}` });
    await engine.kick();
    expect(api.sync.mock.calls.every((c) => c[0].ops.length <= 50)).toBe(true);
    expect(api.sync.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("retries when the server skips some answers instead of dropping them", async () => {
    const { store, engine } = await setup({ apiImpl: async () => ({ results: [], changes: { cursor: 1, more: false, reset: false, inspections: [] } }) });
    store.startInspection({ site, template, title: "Round 1" });
    await engine.kick();
    expect(engine.getState().phase).toBe("retrying");
    expect(store.getSnapshot().counts.waiting).toBe(1);
  });
});

describe("describeStatus", () => {
  const counts = (o = {}) => ({ waiting: 0, conflicts: 0, rejected: 0, ...o });
  it("explains offline with the number of saved changes", () => {
    const s = describeStatus({ phase: "offline" }, counts({ waiting: 3 }));
    expect(s.tone).toBe("offline");
    expect(s.detail).toMatch(/3 changes saved on this device/);
  });
  it("counts down to the next retry", () => {
    const s = describeStatus({ phase: "retrying", nextRetryAt: 9000 }, counts(), 1000);
    expect(s.short).toBe("Retry in 8s");
  });
  it("tells the person nothing is lost when sign-in expires", () => {
    expect(describeStatus({ phase: "auth" }, counts()).detail).toMatch(/Nothing is lost/);
  });
  it("shows conflicts and refusals when idle", () => {
    expect(describeStatus({ phase: "idle" }, counts({ conflicts: 1 })).short).toBe("1 to review");
    expect(describeStatus({ phase: "idle" }, counts({ rejected: 2 })).short).toBe("2 not saved");
  });
  it("says synced when all is clear", () => {
    expect(describeStatus({ phase: "idle", lastSyncAt: 1000 }, counts(), 1000).tone).toBe("ok");
  });
});
