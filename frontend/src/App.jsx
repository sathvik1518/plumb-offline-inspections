import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import * as api from "./api";
import { openDb } from "./db";
import { createStore } from "./store";
import { createEngine, describeStatus } from "./sync";
import { uid } from "./ops";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Home from "./pages/Home";
import NewInspection from "./pages/NewInspection";
import Inspection from "./pages/Inspection";
import Issues from "./pages/Issues";
import Sync from "./pages/Sync";
import NotFound from "./pages/NotFound";

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

/** The inspections, queue and counts, live. */
export function useSnap() {
  const { store } = useApp();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** The sync status in plain words. Re-reads every second so "retry in 8s" counts down. */
export function useStatus() {
  const { store, engine } = useApp();
  const snap = useSnap();
  const state = useSyncExternalStore(engine.subscribe, engine.getState);
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    if (state.phase !== "retrying" && state.phase !== "idle") return undefined;
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state.phase]);
  return { state, status: describeStatus(state, snap.counts, tick), counts: snap.counts, store, engine };
}

function clientId() {
  try {
    let id = localStorage.getItem("plumb.client");
    if (!id) {
      id = uid();
      localStorage.setItem("plumb.client", id);
    }
    return id;
  } catch {
    return uid();
  }
}

export default function App() {
  const [session, setSession] = useState(() => api.getSession());
  const [runtime, setRuntime] = useState(null); // { store, engine, user }
  const [booting, setBooting] = useState(Boolean(api.getSession()));
  const [toasts, setToasts] = useState([]);
  const [expired, setExpired] = useState(false);
  const runtimeRef = useRef(null);

  const toast = useCallback((text, tone = "info") => {
    const id = uid();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const teardown = useCallback(() => {
    runtimeRef.current?.engine.stop();
    runtimeRef.current?.store.close();
    runtimeRef.current = null;
    setRuntime(null);
  }, []);

  const start = useCallback(
    async (user) => {
      teardown();
      const db = await openDb(`plumb-u${user.id}`);
      const store = await createStore({ db, user });
      const engine = createEngine({
        store,
        api,
        clientId: clientId(),
        isOnline: () => navigator.onLine,
        onEvents: (events) => {
          const conflicts = events.filter((e) => e.type === "conflict").length;
          const rejected = events.filter((e) => e.type === "rejected").length;
          const merged = events.filter((e) => e.type === "merged").length;
          if (conflicts) toast(`${conflicts === 1 ? "A change was" : `${conflicts} changes were`} not saved because someone else edited the same item. Open Sync to decide.`, "warn");
          if (rejected) toast(`${rejected === 1 ? "A change was" : `${rejected} changes were`} refused by the server. Open Sync to see why.`, "warn");
          if (merged) toast("Your change was combined with someone else's edit to a different part.", "info");
        },
      });
      const runtime = { store, engine, user };
      runtimeRef.current = runtime;
      setRuntime(runtime);
      // Sites and checklists are kept so a new inspection can be started with no signal.
      api.bootstrap().then((ref) => store.setReference(ref)).catch(() => {});
      engine.start();
      return runtime;
    },
    [teardown, toast]
  );

  // Open the app with the saved sign-in, even offline.
  useEffect(() => {
    const saved = api.getSession();
    if (!saved) return undefined;
    start(saved.user).finally(() => setBooting(false));
    return () => runtimeRef.current?.engine.stop();
  }, [start]);

  // If the server says the sign-in has expired, keep the data and ask for the password again.
  useEffect(() => {
    if (!runtime) return undefined;
    return runtime.engine.subscribe(() => {
      setExpired(runtime.engine.getState().phase === "auth");
    });
  }, [runtime]);

  const onLogin = useCallback(
    async ({ token, user }) => {
      api.saveSession({ token, user });
      setSession({ token, user });
      setExpired(false);
      if (runtimeRef.current?.user.id === user.id) {
        runtimeRef.current.engine.kick();
        api.bootstrap().then((ref) => runtimeRef.current?.store.setReference(ref)).catch(() => {});
      } else {
        await start(user);
      }
    },
    [start]
  );

  const logout = useCallback(() => {
    api.clearSession();
    teardown();
    setSession(null);
    setExpired(false);
  }, [teardown]);

  const value = useMemo(
    () => (runtime ? { ...runtime, toast, logout, toasts } : null),
    [runtime, toast, logout, toasts]
  );

  if (booting) return <div className="boot" aria-busy="true">Opening your inspections…</div>;
  if (!session || !runtime) return <Login onLogin={onLogin} />;

  return (
    <AppContext.Provider value={value}>
      <HashRouter>
        <Routes>
          <Route element={<Layout expired={expired} onSignIn={() => setExpired("login")} />}>
            <Route index element={<Home />} />
            <Route path="new" element={<NewInspection />} />
            <Route path="inspection/:id" element={<Inspection />} />
            <Route path="issues" element={<Issues />} />
            <Route path="sync" element={<Sync />} />
            <Route path="home" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </HashRouter>
      {expired === "login" && (
        <div className="scrim">
          <Login onLogin={onLogin} compact email={session.user.email} />
        </div>
      )}
    </AppContext.Provider>
  );
}
