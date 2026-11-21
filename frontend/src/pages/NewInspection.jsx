import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp, useSnap } from "../App";
import { fmtDay } from "../format";
import { Empty } from "../components/ui";

export default function NewInspection() {
  const { store } = useApp();
  const { meta } = useSnap();
  const navigate = useNavigate();
  const { sites, templates } = meta;
  const [siteId, setSiteId] = useState("");
  const [kind, setKind] = useState("");
  const [title, setTitle] = useState("");
  const [touched, setTouched] = useState(false);

  const site = sites.find((s) => String(s.id) === siteId);
  const template = templates.find((t) => t.kind === kind);

  // Suggest a title like "Fire safety round · Madhapur Tower · 21 Nov" until the person types their own.
  useEffect(() => {
    if (!touched && site && template) setTitle(`${template.name} · ${site.name} · ${fmtDay(new Date().toISOString())}`);
  }, [site, template, touched]);

  if (!sites.length || !templates.length) {
    return (
      <Empty title="Sites and checklists are not on this device yet">
        Connect once so the app can download them. After that, you can start inspections with no signal.
      </Empty>
    );
  }

  const ready = site && template && title.trim().length >= 3;
  function start(e) {
    e.preventDefault();
    if (!ready) return;
    const id = store.startInspection({ site, template, title: title.trim() });
    navigate(`/inspection/${id}`, { replace: true });
  }

  return (
    <form onSubmit={start} className="narrow">
      <div className="page-head"><h1>New inspection</h1></div>

      <label className="field">
        <span>Site</span>
        <select value={siteId} onChange={(e) => setSiteId(e.target.value)} required>
          <option value="">Choose a site…</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>{s.name} — {s.area}</option>
          ))}
        </select>
      </label>

      <fieldset className="field">
        <legend>Checklist</legend>
        <div className="kinds">
          {templates.map((t) => (
            <label key={t.kind} className={kind === t.kind ? "kind on" : "kind"}>
              <input type="radio" name="kind" value={t.kind} checked={kind === t.kind} onChange={() => setKind(t.kind)} />
              <strong>{t.name}</strong>
              <span>{t.items.length} items</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(e) => { setTitle(e.target.value); setTouched(true); }} maxLength={120} placeholder="Pick a site and checklist first" />
      </label>

      <div className="actions">
        <button className="btn btn-primary" disabled={!ready}>Start inspection</button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
      </div>
    </form>
  );
}
