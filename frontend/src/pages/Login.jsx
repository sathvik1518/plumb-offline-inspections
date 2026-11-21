import { useState } from "react";
import * as api from "../api";

export default function Login({ onLogin, compact = false, email: knownEmail = "" }) {
  const [email, setEmail] = useState(knownEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onLogin(await api.login(email, password));
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
      </form>
    </div>
  );
}
