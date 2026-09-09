"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "../../lib/supabase";
import { AuthGate } from "../../components/auth-gate";
import { WorkspaceSidebar } from "../../components/workspace-sidebar";
import { AccountSecurity } from "../../components/account-security";
import { clearUplyFoxBrowserData } from "../../lib/session-cleanup";
import "../dashboard.css";
import "./settings.css";

export default function SettingsPage() {
  return <AuthGate><SettingsWorkspace /></AuthGate>;
}

function SettingsWorkspace() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [initialName, setInitialName] = useState("");
  const [memberSince, setMemberSince] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setLoading(false); return; }
    void supabase.auth.getUser().then(async ({ data }) => {
      const user = data.user;
      if (!user) { setLoading(false); return; }
      setEmail(user.email ?? "");
      setMemberSince(user.created_at ? new Date(user.created_at).toLocaleDateString() : "");
      const { data: row, error } = await supabase.from("profiles").select("first_name,last_name").eq("id", user.id).maybeSingle();
      // A failed read must not look like an empty name: saving then would blank it.
      if (error) { setNotice("Could not load your account details. Reload to try again."); setLoading(false); return; }
      const profile = (row ?? {}) as { first_name?: string; last_name?: string };
      const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
      setDisplayName(name);
      setInitialName(name);
      setLoading(false);
    });
  }, []);

  async function saveName() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setBusy(true); setNotice("");
    const { data } = await supabase.auth.getUser();
    if (!data.user) { setBusy(false); return; }
    const [first, ...rest] = displayName.trim().split(/\s+/);
    const { error } = await supabase.from("profiles").upsert({
      id: data.user.id,
      first_name: first ?? "",
      last_name: rest.join(" "),
    });
    setBusy(false);
    if (error) { setNotice(error.message); return; }
    setInitialName(displayName.trim());
    setNotice("Display name saved.");
  }

  async function deleteAccount() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setBusy(true); setNotice("");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Could not delete your data.");
      await clearUplyFoxBrowserData();
      await supabase.auth.signOut();
      window.location.assign("/");
    } catch (error) {
      setBusy(false);
      setNotice(error instanceof Error ? error.message : "Could not delete your data.");
    }
  }

  return <div className="dashboard"><WorkspaceSidebar /><main className="main settings-page">
    <div className="topbar"><div><div className="eyebrow">Account</div><h1>Settings</h1></div></div>

    <section className="card">
      <div className="section-head"><h3>Your account</h3></div>
      <label className="settings-field">
        <span>Display name</span>
        <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={loading ? "Loading…" : "Your name"} disabled={loading} />
      </label>
      <label className="settings-field">
        <span>Email</span>
        <input value={email} readOnly disabled />
      </label>
      <p className="card-hint">{memberSince ? `Member since ${memberSince}.` : "Your display name is used across UplyFox and in generated documents."}</p>
      <button className="save-button" onClick={() => void saveName()} disabled={loading || busy || displayName.trim() === initialName}>
        {busy ? "Saving…" : "Save name"}
      </button>
    </section>

    <AccountSecurity />

    <section className="card danger-zone">
      <div className="section-head"><h3>Delete account and data</h3></div>
      <p className="card-hint">
        Permanently removes your profile, resume file, experiences, skills, education, projects,
        saved answers, tracked jobs, and applications. This cannot be undone.
      </p>
      {!showDelete
        ? <button className="danger-button" onClick={() => setShowDelete(true)}>Delete everything</button>
        : <>
          <label className="settings-field">
            <span>Type DELETE to confirm</span>
            <input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder="DELETE" autoComplete="off" />
          </label>
          <div className="danger-actions">
            <button className="ghost-button" onClick={() => { setShowDelete(false); setConfirmText(""); }}>Cancel</button>
            <button className="danger-button" onClick={() => void deleteAccount()} disabled={busy || confirmText !== "DELETE"}>
              {busy ? "Deleting…" : "Permanently delete"}
            </button>
          </div>
        </>}
    </section>

    {notice && <p className="profile-notice">{notice}</p>}
  </main></div>;
}
