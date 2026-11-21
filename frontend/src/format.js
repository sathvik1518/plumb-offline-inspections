const dateTime = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const dayOnly = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" });
const clock = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });

export const fmtDateTime = (iso) => (iso ? dateTime.format(new Date(iso)) : "");
export const fmtDay = (iso) => (iso ? dayOnly.format(new Date(iso)) : "");
export const fmtClock = (iso) => (iso ? clock.format(new Date(iso)) : "");

export function plural(n, one, many = one + "s") {
  return `${n} ${n === 1 ? one : many}`;
}

/** "just now", "3 min ago", "2 h ago", or a date. */
export function timeAgo(ms, now = Date.now()) {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} sec ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDateTime(new Date(ms).toISOString());
}

export const RESULT_LABEL = { pending: "Not answered", pass: "Pass", fail: "Fail", na: "N/A" };
export const SEVERITY_LABEL = { low: "Low", medium: "Medium", high: "High" };
export const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
