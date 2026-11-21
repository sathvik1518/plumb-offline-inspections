import { useState } from "react";
import * as api from "../api";

export default function Login({ onLogin, compact = false, email: knownEmail = "" }) {
  const [email, setEmail] = useState(knownEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // One-click demo accounts, so a reviewer can look around without typing.
  const DEMOS = [
    { label: "Supervisor", note: "sees everything", email: "saisathvik@gmail.com", password: "Admin@123" },
    { label: "Field inspector", note: "Kavya Reddy", email: "kavya.reddy@gmail.com", password: "Field@1234" },
  ];

  async function signIn(mail, pass) {
    setError("");
    setBusy(true);
    try {
      await onLogin(await api.login(mail, pass));
    } catch (err) {
      setError(
        err.network
          ? "Cannot reach the server. Sign-in needs a connection the first time."
          : err.message
      );
    } finally {
      setBusy(false);
    }
  }

  const submit = (e) => {
    e.preventDefault();
    return signIn(email, password);
  };

  return (
    <div className={compact ? "login login-compact" : "login"}>
      <form className="login-card" onSubmit={submit}>
        <div className="login-head">
          <span className="login-kicker">{compact ? "Session expired" : "Site safety inspections"}</span>
          <h1>{compact ? "Sign in again" : "Plumb"}</h1>
          <p>
            {compact
              ? "Your work on this device is safe. Sign in to send it."
              : "Walk the site, tick the checklist, and keep going when the signal drops. Everything syncs when you are back."}
          </p>
        </div>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus={!compact} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required autoFocus={compact} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        {!compact && (
          <div className="demo">
            <span className="demo-title">Demo accounts, one click</span>
            <div className="demo-row">
              {DEMOS.map((d) => (
                <button key={d.label} type="button" className="demo-btn" disabled={busy} onClick={() => signIn(d.email, d.password)}>
                  <strong>{d.label}</strong>
                  <small>{d.note}</small>
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
