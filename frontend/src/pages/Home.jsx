import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSnap } from "../App";
import { fmtDay, plural } from "../format";
import { summarize } from "../ops";
import Icon from "../components/Icon";
import { Empty, Progress, Stamp, SyncStamp } from "../components/ui";

const FILTERS = [
  ["all", "All"],
  ["draft", "In progress"],
  ["submitted", "Submitted"],
  ["attention", "Needs attention"],
];

export default function Home() {
  const { list } = useSnap();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => list.map((v) => ({ v, s: summarize(v) })), [list]);
  const open = rows.filter((r) => r.v.status === "draft").length;
  const fails = rows.reduce((n, r) => n + r.s.fail, 0);
  const waiting = rows.filter((r) => r.v.syncState !== "synced").length;

  const shown = rows.filter(({ v }) => {
    if (filter === "draft" && v.status !== "draft") return false;
    if (filter === "submitted" && v.status !== "submitted") return false;
    if (filter === "attention" && !["conflict", "problem"].includes(v.syncState)) return false;
    const q = query.trim().toLowerCase();
    return !q || `${v.title} ${v.site_name} ${v.inspector_name}`.toLowerCase().includes(q);
  });

  return (
    <>
      <div className="page-head">
        <h1>Inspections</h1>
        <Link to="/new" className="btn btn-primary hide-mobile"><Icon name="plus" size={18} /> New inspection</Link>
      </div>

      <section className="tiles" aria-label="Summary">
        <div className="tile"><b>{open}</b><span>In progress</span></div>
        <div className="tile tile-fail"><b>{fails}</b><span>Failed items</span></div>
        <div className="tile"><b>{waiting}</b><span>Not yet synced</span></div>
      </section>

      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={18} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search site, title or inspector" aria-label="Search inspections" />
        </div>
        <div className="chips" role="group" aria-label="Filter">
          {FILTERS.map(([key, label]) => (
            <button key={key} className={filter === key ? "chip on" : "chip"} onClick={() => setFilter(key)} aria-pressed={filter === key}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <Empty title={rows.length ? "No match" : "No inspections yet"}>
          {rows.length ? "Try another filter or search." : "Start one with the orange button. It works with no signal."}
        </Empty>
      ) : (
        <ul className="cards">
          {shown.map(({ v, s }) => (
            <li key={v.id}>
              <Link to={`/inspection/${v.id}`} className="card">
                <div className="card-top">
                  <span className="card-site">{v.site_name}</span>
                  <span className="card-stamps">
                    {v.status === "submitted" ? <Stamp tone="pass">Submitted</Stamp> : <Stamp tone="plain">Draft</Stamp>}
                    {v.syncState !== "synced" && <SyncStamp state={v.syncState} />}
                  </span>
                </div>
                <h3>{v.title}</h3>
                <Progress answered={s.answered} total={s.total} />
                <div className="card-meta">
                  <span>{s.answered}/{s.total} answered</span>
                  {s.fail > 0 && <span className="meta-fail">{plural(s.fail, "failed item")}</span>}
                  <span className="grow" />
                  <span>{v.inspector_name} · {fmtDay(v.created_at)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
