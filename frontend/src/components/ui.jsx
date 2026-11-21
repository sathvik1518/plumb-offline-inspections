import { RESULT_LABEL } from "../format";

/** The little rubber-stamp label used for results and statuses. */
export function Stamp({ tone = "plain", children }) {
  return <span className={`stamp stamp-${tone}`}>{children}</span>;
}

export function ResultStamp({ result }) {
  const tone = { pass: "pass", fail: "fail", na: "plain", pending: "ghost" }[result];
  return <Stamp tone={tone}>{RESULT_LABEL[result]}</Stamp>;
}

const SYNC_LABEL = {
  synced: ["ok", "Synced"],
  local: ["warn", "On this device"],
  waiting: ["busy", "Waiting to sync"],
  conflict: ["warn", "Needs a decision"],
  problem: ["warn", "Not saved"],
};
export function SyncStamp({ state }) {
  const [tone, label] = SYNC_LABEL[state] ?? SYNC_LABEL.synced;
  return <Stamp tone={tone}>{label}</Stamp>;
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function Progress({ answered, total }) {
  const pct = total ? Math.round((answered / total) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={answered} aria-valuemin={0} aria-valuemax={total} aria-label="Items answered">
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
