import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApp, useSnap } from "../App";
import { fmtDateTime, plural } from "../format";
import { submitCheck, summarize } from "../ops";
import Icon from "../components/Icon";
import Modal from "../components/Modal";
import { Empty, Progress, Stamp, SyncStamp } from "../components/ui";

const RESULTS = [
  ["pass", "Pass", "check"],
  ["fail", "Fail", "x"],
  ["na", "N/A", "minus"],
];
const SEVERITIES = [["low", "Low"], ["medium", "Medium"], ["high", "High"]];

function ItemRow({ inspectionId, item, locked, conflicted }) {
  const { store } = useApp();
  const [note, setNote] = useState(item.note);
  const [noteOpen, setNoteOpen] = useState(Boolean(item.note));
  const focused = useRef(false);

  // Pick up a note changed elsewhere, unless the person is typing in it right now.
  useEffect(() => {
    if (!focused.current) setNote(item.note);
  }, [item.note]);

  const set = (changes) => store.setItem(inspectionId, item.id, changes);
  const failed = item.result === "fail";
  const needsNote = failed && !note.trim();
  const showNote = failed || noteOpen || note;

  return (
    <li className={`item item-${item.result}`}>
      <div className="item-head">
        <span className="item-label">{item.label}</span>
        {conflicted && <Stamp tone="warn">Needs a decision</Stamp>}
        {item._pending && !conflicted && <span className="saving" title="Saved on this device, not sent yet" />}
      </div>

      <div className="seg" role="group" aria-label={`Result for ${item.label}`}>
        {RESULTS.map(([value, label, icon]) => (
          <button
            key={value}
            type="button"
            className={`seg-btn seg-${value}${item.result === value ? " on" : ""}`}
            aria-pressed={item.result === value}
            disabled={locked}
            onClick={() => set({ result: item.result === value ? "pending" : value })}
          >
            <Icon name={icon} size={18} /> {label}
          </button>
        ))}
      </div>

      {failed && (
        <div className="sev" role="group" aria-label="Severity">
          <span>Severity</span>
          {SEVERITIES.map(([value, label]) => (
            <button key={value} type="button" className={`sev-btn sev-${value}${item.severity === value ? " on" : ""}`}
              aria-pressed={item.severity === value} disabled={locked} onClick={() => set({ severity: value })}>
              {label}
            </button>
          ))}
        </div>
      )}

      {showNote ? (
        <label className="note">
          <span>{failed ? "What is wrong? (required)" : "Note"}</span>
          <textarea
            rows={2}
            value={note}
            disabled={locked}
            className={needsNote ? "needs" : ""}
            placeholder={failed ? "Describe the problem and where it is" : "Optional"}
            onFocus={() => (focused.current = true)}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              focused.current = false;
              if (note !== item.note) set({ note });
            }}
          />
        </label>
      ) : (
        !locked && <button type="button" className="link" onClick={() => setNoteOpen(true)}>Add a note</button>
      )}
    </li>
  );
}

export default function Inspection() {
  const { id } = useParams();
  const { store } = useApp();
  const { views } = useSnap();
  const navigate = useNavigate();
  const view = views.get(id);
  const [confirm, setConfirm] = useState(null); // "submit" | "discard"
  const [notes, setNotes] = useState(view?.notes ?? "");
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setNotes(view?.notes ?? "");
  }, [view?.notes]);

  if (!view) {
    return (
      <Empty title="This inspection is not on this device">
        It may have been removed. <Link to="/">Back to inspections</Link>
      </Empty>
    );
  }

  const s = summarize(view);
  const check = submitCheck(view);
  const locked = view.status === "submitted";
  const hints = [
    check.unanswered && `${plural(check.unanswered, "item")} not answered`,
    check.missingNotes && `${plural(check.missingNotes, "failed item")} without a note`,
  ].filter(Boolean);

  return (
    <>
      <Link to="/" className="back"><Icon name="back" size={18} /> Inspections</Link>
      <div className="insp-head">
        <div>
          <span className="eyebrow"><Icon name="pin" size={14} /> {view.site_name}</span>
          <h1>{view.title}</h1>
          <p className="muted">
            {view.inspector_name} · started {fmtDateTime(view.created_at)}
            {locked && view.submitted_at ? ` · submitted ${fmtDateTime(view.submitted_at)}` : ""}
          </p>
        </div>
        <div className="insp-stamps">
          {locked ? <Stamp tone="pass">Submitted</Stamp> : <Stamp tone="plain">Draft</Stamp>}
          {view.syncState !== "synced" && <SyncStamp state={view.syncState} />}
        </div>
      </div>

      {view.conflicts.length > 0 && (
        <div className="banner banner-warn inline">
          <div>
            <strong>{plural(view.conflicts.length, "change")} need your decision</strong>
            <span>Someone else edited the same item while you were offline.</span>
          </div>
          <Link className="btn btn-small" to="/sync">Review</Link>
        </div>
      )}
      {view.rejected.length > 0 && (
        <div className="banner banner-warn inline">
          <div>
            <strong>{plural(view.rejected.length, "change")} could not be saved</strong>
            <span>The server refused them. See why on the Sync page.</span>
          </div>
          <Link className="btn btn-small" to="/sync">See why</Link>
        </div>
      )}

      <div className="summary">
        <div className="summary-top">
          <strong>{s.answered} of {s.total} answered</strong>
          <span className="counts">
            <i className="c-pass">{s.pass} pass</i>
            <i className="c-fail">{s.fail} fail</i>
            <i>{s.na} n/a</i>
          </span>
        </div>
        <Progress answered={s.answered} total={s.total} />
      </div>

      <ul className="items">
        {view.items.map((item) => (
          <ItemRow key={item.id} inspectionId={id} item={item} locked={locked}
            conflicted={view.conflicts.some((o) => o.payload.item_id === item.id)} />
        ))}
      </ul>

      <label className="field notes-field">
        <span>Overall notes</span>
        <textarea rows={3} value={notes} disabled={locked} placeholder="Anything the supervisor should know"
          onFocus={() => (focused.current = true)} onChange={(e) => setNotes(e.target.value)}
          onBlur={() => { focused.current = false; if (notes !== view.notes) store.setHead(id, { notes }); }} />
      </label>

      {!locked && (
        <div className="submit-bar">
          <div className="submit-hint">
            {check.ok ? "Everything is answered. Ready to submit." : hints.join(" · ")}
          </div>
          <div className="actions">
            {view._local && <button className="btn" onClick={() => setConfirm("discard")}>Discard</button>}
            <button className="btn btn-primary" disabled={!check.ok} onClick={() => setConfirm("submit")}>Submit inspection</button>
          </div>
        </div>
      )}

      {confirm === "submit" && (
        <Modal title="Submit this inspection?" onClose={() => setConfirm(null)}
          actions={<>
            <button className="btn" onClick={() => setConfirm(null)}>Not yet</button>
            <button className="btn btn-primary" onClick={() => { store.submit(id); setConfirm(null); }}>Submit</button>
          </>}>
          <p>Once submitted, nobody can change it.{s.fail ? ` ${plural(s.fail, "failed item")} will appear in the issues list.` : ""}</p>
          {view._local && <p className="muted">You are offline or this has not synced yet. It will be submitted as soon as it does.</p>}
        </Modal>
      )}
      {confirm === "discard" && (
        <Modal title="Discard this inspection?" onClose={() => setConfirm(null)}
          actions={<>
            <button className="btn" onClick={() => setConfirm(null)}>Keep it</button>
            <button className="btn btn-danger" onClick={() => { store.discard(id); navigate("/", { replace: true }); }}>Discard</button>
          </>}>
          <p>It has never reached the server, so it will be gone for good.</p>
        </Modal>
      )}
    </>
  );
}
