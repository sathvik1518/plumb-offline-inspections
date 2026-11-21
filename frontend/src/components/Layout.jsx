import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, Link } from "react-router-dom";
import { useApp, useSnap, useStatus } from "../App";
import Icon from "./Icon";

function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M12 3v14" />
        <path d="M7 17h10" />
        <circle cx="12" cy="20" r="1.2" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "light");
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("plumb.theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  };
  return [theme, toggle];
}

export function SyncPill() {
  const { status } = useStatus();
  return (
    <Link to="/sync" className={`pill pill-${status.tone}`} aria-label={`${status.title}. Open sync details.`}>
      <span className="dot" />
      {status.short}
    </Link>
  );
}

export default function Layout({ expired, onSignIn }) {
  const { user, logout, toasts } = useApp();
  const { status, counts } = useStatus();
  const saveError = useSnap().saveError;
  const [theme, toggleTheme] = useTheme();
  const { pathname } = useLocation();
  const attention = counts.conflicts + counts.rejected;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const links = [
    { to: "/", label: "Inspections", icon: "list", end: true },
    { to: "/issues", label: "Issues", icon: "alert" },
    { to: "/sync", label: "Sync", icon: "sync", badge: attention || null },
  ];

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <Mark />
          <span>Plumb</span>
        </div>
        <Link to="/new" className="btn btn-primary btn-block">
          <Icon name="plus" size={18} /> New inspection
        </Link>
        <nav aria-label="Main">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className="navlink">
              <Icon name={l.icon} />
              <span>{l.label}</span>
              {l.badge ? <b className="badge">{l.badge}</b> : null}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="who">
            <strong>{user.name}</strong>
            <span>{user.role === "supervisor" ? "Supervisor" : "Inspector"}</span>
          </div>
          <button className="icon-btn" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </button>
          <button className="icon-btn" onClick={logout} aria-label="Sign out">
            <Icon name="out" />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="top">
          <div className="top-brand">
            <Mark />
            <span>Plumb</span>
          </div>
          <SyncPill />
        </header>

        {(status.tone === "offline" || status.tone === "error" || status.tone === "warn") && (
          <div className={`banner banner-${status.tone}`} role="status">
            <div>
              <strong>{status.title}</strong>
              <span>{status.detail}</span>
            </div>
            {expired && <button className="btn btn-small" onClick={onSignIn}>Sign in</button>}
          </div>
        )}

        {saveError && (
          <div className="banner banner-error" role="alert">
            <div>
              <strong>This browser is not saving your work</strong>
              <span>Private mode or a full disk can cause this. Keep this tab open and sync before closing it.</span>
            </div>
          </div>
        )}

        <main className="page">
          <Outlet />
        </main>
      </div>

      <nav className="bottom" aria-label="Main">
        {links.slice(0, 1).map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className="tab">
            <Icon name={l.icon} />
            <span>{l.label}</span>
          </NavLink>
        ))}
        <NavLink to="/new" className="tab tab-new" aria-label="New inspection">
          <span className="fab"><Icon name="plus" size={24} /></span>
        </NavLink>
        {links.slice(1).map((l) => (
          <NavLink key={l.to} to={l.to} className="tab">
            <Icon name={l.icon} />
            <span>{l.label}</span>
            {l.badge ? <b className="badge">{l.badge}</b> : null}
          </NavLink>
        ))}
      </nav>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
