"use client";

import { useEffect, useState } from "react";
import { signOutUplyFox } from "../lib/session-cleanup";

const CLEAR_ON_LOGOUT_KEY = "uplyfox:clear-on-logout";

export function AccountSecurity() {
  const [clearOnLogout, setClearOnLogout] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setClearOnLogout(window.localStorage.getItem(CLEAR_ON_LOGOUT_KEY) === "true");
  }, []);

  function toggleClearOnLogout() {
    setClearOnLogout((current) => {
      const next = !current;
      window.localStorage.setItem(CLEAR_ON_LOGOUT_KEY, String(next));
      return next;
    });
  }

  async function logout() {
    if (!window.confirm(clearOnLogout
      ? "Sign out and clear UplyFox browser data and the paired extension session?"
      : "Sign out of UplyFox?")) return;
    setBusy(true); setNotice("");
    try {
      await signOutUplyFox(clearOnLogout);
      if (clearOnLogout) window.localStorage.removeItem(CLEAR_ON_LOGOUT_KEY);
      window.location.assign("/login");
    } catch (error) {
      setBusy(false);
      setNotice(error instanceof Error ? error.message : "Could not sign out.");
    }
  }

  return <section className="account-security card">
    <div className="section-head"><div><h3>Security and logout</h3><p className="card-hint">Logout is limited to UplyFox data on this app origin and the paired extension.</p></div></div>
    <label className="security-toggle"><span><strong>Clear local data on logout</strong><small>Remove UplyFox local storage, session storage, accessible app cookies, and extension storage.</small></span><input type="checkbox" checked={clearOnLogout} onChange={toggleClearOnLogout} /></label>
    <button className="logout-button" onClick={() => void logout()} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button>
    {notice && <p className="profile-notice">{notice}</p>}
  </section>;
}
