// Everything that talks to the server lives here. Pages never call fetch() themselves.
const BASE = import.meta.env.VITE_API_URL ?? "/api";
const SESSION_KEY = "plumb.session";
const TIMEOUT_MS = 20000;

export class ApiError extends Error {
  constructor(message, { status = 0, code = null, network = false } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.network = network; // true when the server could not be reached at all
  }
}

// ---- the saved sign-in (so the app opens even with no signal)
export function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
}
export function saveSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* storage can be blocked; the app still works until the tab closes */
  }
}
export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

async function request(path, { method = "GET", body, signal } = {}) {
  const session = getSession();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  signal?.addEventListener?.("abort", () => controller.abort());

  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError("Cannot reach the server.", { network: true });
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    /* some replies have no body */
  }
  if (!response.ok) {
    throw new ApiError((data && typeof data.detail === "string" && data.detail) || `Something went wrong (${response.status}).`, {
      status: response.status,
      code: data?.code ?? null,
    });
  }
  return data;
}

export const login = (email, password) => request("/auth/login", { method: "POST", body: { email, password } });
export const bootstrap = () => request("/bootstrap");
export const sync = (body) => request("/sync", { method: "POST", body });
