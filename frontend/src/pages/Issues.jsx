import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSnap } from "../App";
import { fmtDay, plural, SEVERITY_LABEL, SEVERITY_RANK } from "../format";
import { Empty, Stamp } from "../components/ui";

export default function Issues() {
  const { list } = useSnap();
  const [showSubmitted, setShowSubmitted] = useState(true);

  const groups = useMemo(() => {
    const rows = [];
    for (const v of list) {
      if (!showSubmitted && v.status === "submitted") continue;
      for (const item of v.items) if (item.result === "fail") rows.push({ v, item });
    }
    rows.sort((a, b) => SEVERITY_RANK[a.item.severity] - SEVERITY_RANK[b.item.severity] || (a.v.created_at < b.v.created_at ? 1 : -1));
    return ["high", "medium", "low"].map((sev) => [sev, rows.filter((r) => r.item.severity === sev)]).filter(([, r]) => r.length);
  }, [list, showSubmitted]);

  const total = groups.reduce((n, [, r]) => n + r.length, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Issues</h1>
          <p className="muted">{total ? `${plural(total, "failed item")}, worst first.` : "Every failed checklist item shows up here."}</p>
        </div>
        <label className="check">
          <input type="checkbox" checked={showSubmitted} onChange={(e) => setShowSubmitted(e.target.checked)} />
          Include submitted
        </label>
      </div>

      {groups.length === 0 ? (
        <Empty title="No failed items">Nothing to fix right now.</Empty>
      ) : (
        groups.map(([sev, rows]) => (
          <section key={sev} className="issue-group">
            <h2 className={`sev-title sev-${sev}`}>{SEVERITY_LABEL[sev]} <span>{rows.length}</span></h2>
            <ul className="issues">
              {rows.map(({ v, item }) => (
                <li key={item.id}>
                  <Link to={`/inspection/${v.id}`} className="issue">
                    <span className="issue-label">{item.label}</span>
                    {item.note && <span className="issue-note">{item.note}</span>}
                    <span className="issue-meta">
                      {v.site_name} · {v.inspector_name} · {fmtDay(v.created_at)}
                      {v.status === "submitted" ? <Stamp tone="pass">Submitted</Stamp> : <Stamp tone="plain">Draft</Stamp>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
