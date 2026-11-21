import { Link } from "react-router-dom";
import { useApp, useSnap, useStatus } from "../App";
import { describeOp } from "../ops";
import { fmtClock, plural, RESULT_LABEL, SEVERITY_LABEL } from "../format";
import Icon from "../components/Icon";
import { Empty, Stamp } from "../components/ui";

const REASONS = {
  locked: "This inspection was already submitted, so it can no longer change.",
  incomplete: "Some items were still unanswered when it reached the server.",
  needs_note: "A failed item needs a note before the inspection can be submitted.",
  not_found: "The server no longer has this inspection.",
  forbidden: "You are not allowed to change this inspection.",
  invalid: "The server could not accept this change.",
  unknown_op: "The server did not understand this change.",
};

/** One field's value in words, for the yours-versus-theirs comparison. */
function show(field, value) {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "result") return RESULT_LABEL[value] ?? value;
  if (field === "severity") return SEVERITY_LABEL[value] ?? value;
  return String(value);
}
const FIELD_NAME = { result: "Result", severity: "Severity", note: "Note", title: "Title", notes: "Overall notes" };

function Conflict({ op, view, store }) {
  const server = op.conflict?.server;
  const theirs = op.type === "update_item" ? server?.items.find((i) => i.id === op.payload.item_id) : server;
  const fields = op.conflict?.fields?.length ? op.conflict.fields : Object.keys(op.payload.changes);
  return (
    <li className="op op-conflict">
      <div className="op-title">{describeOp(op, view)}</div>
      <p className="muted">Someone else changed this while you were away. Pick the version to keep.</p>
      <table className="compare">
        <thead><tr><th /><th>Yours</th><th>Theirs</th></tr></thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f}>
              <th scope="row">{FIELD_NAME[f] ?? f}</th>
              <td>{show(f, op.payload.changes[f])}</td>
              <td>{show(f, theirs?.[f])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions">
        <button className="btn btn-primary" onClick={() => store.keepMine(op.op_id)}>Keep mine</button>
        <button className="btn" onClick={() => store.dropOp(op.op_id)}>Use theirs</button>
      </div>
    </li>
  );
}

export default function Sync() {
  const { store, engine } = useApp();
  const { views, queue } = useSnap();
  const { state, status, counts } = useStatus();
  const docFor = (op) => views.get(op.inspection_id);
  const conflicts = queue.filter((o) => o.status === "conflict");
  const rejected = queue.filter((o) => o.status === "rejected");
  const waiting = queue.filter((o) => o.status === "pending");
  const busy = state.phase === "syncing";

  return (
    <>
      <div className="page-head"><h1>Sync</h1></div>

      <section className={`status status-${status.tone}`}>
        <div>
          <h2>{status.title}</h2>
          <p>{status.detail}</p>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => engine.kick()} disabled={busy || state.paused}>
            <Icon name="sync" size={18} /> {busy ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </section>

      <label className="switch">
        <input type="checkbox" checked={state.paused} onChange={(e) => engine.setPaused(e.target.checked)} />
        <span className="switch-ui" aria-hidden="true" />
        <span>
          <strong>Work offline</strong>
          <small>Pause syncing, for example to save data on a weak connection. Nothing is lost.</small>
        </span>
      </label>

      {conflicts.length > 0 && (
        <section>
          <h2 className="section">Needs your decision <span>{conflicts.length}</span></h2>
          <ul className="ops">{conflicts.map((op) => <Conflict key={op.op_id} op={op} view={docFor(op)} store={store} />)}</ul>
        </section>
      )}

      {rejected.length > 0 && (
        <section>
          <h2 className="section">Could not be saved <span>{rejected.length}</span></h2>
          <ul className="ops">
            {rejected.map((op) => (
              <li key={op.op_id} className="op op-rejected">
                <div className="op-title">{describeOp(op, docFor(op))}</div>
                <p className="muted">{REASONS[op.error?.code] ?? op.error?.message ?? "The server refused this change."}</p>
                <div className="actions">
                  {docFor(op) && op.type !== "create_inspection" && <Link className="btn btn-small" to={`/inspection/${op.inspection_id}`}>Open inspection</Link>}
                  <button className="btn btn-small" onClick={() => store.dropOp(op.op_id)}>Dismiss</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="section">Waiting to send <span>{waiting.length}</span></h2>
        {waiting.length === 0 ? (
          <Empty title="Nothing waiting">{counts.conflicts || counts.rejected ? "The items above need you." : "Every change you made has reached the server."}</Empty>
        ) : (
          <ul className="ops">
            {waiting.map((op) => (
              <li key={op.op_id} className="op">
                <div className="op-title">{describeOp(op, docFor(op))}</div>
                <span className="op-time">{fmtClock(op.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
        {waiting.length > 0 && <p className="muted foot">{plural(waiting.length, "change")} saved on this device.</p>}
      </section>

      {store.getSnapshot().saveError && (
        <div className="banner banner-error inline">
          <div>
            <strong>This browser is not saving data</strong>
            <span>Private mode or a full disk can cause this. Keep this tab open and sync before closing it.</span>
          </div>
        </div>
      )}
    </>
  );
}
