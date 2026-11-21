// The sync engine: sends waiting changes, pulls what others changed, and copes with a bad network.
import { plural, timeAgo } from "./format";
import { wire } from "./ops";

export const MAX_OPS = 50;
const IDLE_CHECK_MS = 30000;

/** Wait 2s, 4s, 8s ... up to a minute, with a little randomness so many phones do not retry in step. */
export function backoffDelay(attempt, random = Math.random) {
  const base = Math.min(60000, 2000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.75 + random() * 0.25));
}

export function createEngine({
  store,
  api,
  clientId,
  isOnline = () => true,
  timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) },
  now = () => Date.now(),
  random = Math.random,
  onEvents = () => {},
}) {
  let state = {
    phase: "idle", // idle | syncing | retrying | offline | auth | paused | error
    attempt: 0,
    nextRetryAt: null,
    message: "",
    paused: false,
    lastSyncAt: store.meta().lastSyncAt,
  };
  const listeners = new Set();
  let timer = null;
  let running = false;
  let again = false;
  let interval = null;

  const set = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const clearTimer = () => {
    if (timer) timers.clear(timer);
    timer = null;
  };

  async function cycle() {
    if (state.paused) return set({ phase: "paused", nextRetryAt: null });
    if (!isOnline()) return set({ phase: "offline", nextRetryAt: null });
    set({ phase: "syncing", nextRetryAt: null });
    try {
      for (;;) {
        const batch = store.nextBatch(MAX_OPS);
        store.setInflight(batch.map((o) => o.op_id));
        let response;
        try {
          response = await api.sync({ client_id: clientId, since: store.meta().cursor, ops: batch.map(wire) });
        } finally {
          store.setInflight([]);
        }
        const { events, progressed } = await store.applySync(batch, response);
        if (events.length) onEvents(events);
        const moreToSend = store.nextBatch(1).length > 0;
        if (batch.length && !progressed) throw Object.assign(new Error("The server did not answer every change."), { retry: true });
        if (!moreToSend && !response.changes.more) break;
      }
      const stamp = now();
      await store.setLastSync(stamp);
      set({ phase: "idle", attempt: 0, nextRetryAt: null, message: "", lastSyncAt: stamp });
    } catch (err) {
      handleFailure(err);
    }
  }

  function handleFailure(err) {
    if (err.status === 401) return set({ phase: "auth", nextRetryAt: null, message: err.message });
    const transient = err.network || err.retry || err.status >= 500 || err.status === 429 || err.status === 408;
    if (!transient) return set({ phase: "error", nextRetryAt: null, message: err.message || "Something went wrong." });
    if (!isOnline()) return set({ phase: "offline", nextRetryAt: null });
    const attempt = state.attempt + 1;
    const delay = backoffDelay(attempt, random);
    set({ phase: "retrying", attempt, nextRetryAt: now() + delay, message: err.message });
    clearTimer();
    timer = timers.set(() => {
      timer = null;
      kick();
    }, delay);
  }

  /** Start a sync now, or right after the current one finishes. */
  async function kick() {
    clearTimer();
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await cycle();
      } while (again);
    } finally {
      running = false;
    }
  }

  const onOnline = () => {
    set({ attempt: 0 });
    kick();
  };
  const onOffline = () => {
    if (!state.paused) set({ phase: "offline", nextRetryAt: null });
  };
  const onVisible = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") kick();
  };

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    kick,
    /** The "work offline" switch. */
    setPaused(paused) {
      set({ paused });
      if (paused) {
        clearTimer();
        set({ phase: "paused", nextRetryAt: null });
      } else {
        set({ attempt: 0 });
        kick();
      }
    },
    start() {
      if (typeof window !== "undefined") {
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
        document.addEventListener("visibilitychange", onVisible);
      }
      interval = setInterval(() => {
        if (state.phase === "idle") kick();
      }, IDLE_CHECK_MS);
      store.onEnqueue(() => {
        // A short pause lets several quick taps travel together.
        clearTimer();
        timer = timers.set(() => {
          timer = null;
          kick();
        }, 600);
      });
      kick();
    },
    stop() {
      clearTimer();
      clearInterval(interval);
      store.onEnqueue(null);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
        document.removeEventListener("visibilitychange", onVisible);
      }
    },
  };
}

/** Turns the engine state into plain words for the person using the app. */
export function describeStatus(state, counts, now = Date.now()) {
  const waiting = counts.waiting;
  const safe = waiting ? `${plural(waiting, "change")} saved on this device.` : "";

  if (state.phase === "paused")
    return { tone: "offline", short: waiting ? `Offline · ${waiting}` : "Offline", title: "Offline mode is on", detail: `${safe} Turn offline mode off to sync.`.trim() };
  if (state.phase === "offline")
    return {
      tone: "offline",
      short: waiting ? `Offline · ${waiting}` : "Offline",
      title: "You are offline",
      detail: waiting
        ? `${safe} They will send automatically when you are back online.`
        : "Keep working. Everything is saved on this device and will sync when you are back online.",
    };
  if (state.phase === "auth")
    return { tone: "error", short: "Sign in", title: "Sign in again to sync", detail: `Your sign-in has expired. ${waiting ? safe : "Nothing is lost."}`.trim() };
  if (state.phase === "retrying") {
    const secs = Math.max(1, Math.ceil(((state.nextRetryAt ?? now) - now) / 1000));
    return { tone: "warn", short: `Retry in ${secs}s`, title: "Cannot reach the server", detail: `Trying again in ${secs} s. ${safe || "Nothing is lost."}`.trim() };
  }
  if (state.phase === "error")
    return { tone: "error", short: "Sync problem", title: "Sync hit a problem", detail: state.message || "Something went wrong. Your work is safe on this device." };
  if (state.phase === "syncing")
    return { tone: "busy", short: "Syncing", title: "Syncing", detail: waiting ? `Sending ${plural(waiting, "change")}…` : "Checking for updates…" };

  if (counts.conflicts)
    return { tone: "warn", short: `${counts.conflicts} to review`, title: `${plural(counts.conflicts, "change")} need${counts.conflicts === 1 ? "s" : ""} your decision`, detail: "Someone else changed the same item. Open Sync to choose which one to keep." };
  if (counts.rejected)
    return { tone: "warn", short: `${counts.rejected} not saved`, title: `${plural(counts.rejected, "change")} could not be saved`, detail: "The server refused them. Open Sync to see why." };
  if (waiting)
    return { tone: "busy", short: `${waiting} waiting`, title: `${plural(waiting, "change")} waiting to sync`, detail: "They will send in a moment." };
  return { tone: "ok", short: "Synced", title: "All changes saved", detail: `Last synced ${timeAgo(state.lastSyncAt, now)}.` };
}
