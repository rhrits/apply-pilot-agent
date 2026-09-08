import type { ActiveFieldPayload, ExtensionMessage, ExtensionSettings } from "@applypilot/shared";
import { extensionConfig, isExtensionConfigured } from "./lib/config";
import { clearExtensionSession, fetchAuthenticatedProfile, fetchResumeFile, fetchTracker, getExtensionSupabase, getExtensionUser, saveJobToSupabase } from "./lib/supabase";
import { findLocalMemory, saveAnswerMemory } from "./lib/memory";
import { saveUnknownQuestion } from "./lib/unknown-questions";

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ extensionInstalledAt: new Date().toISOString(), settings: { autoSuggest: current.settings?.autoSuggest !== false, liveAI: current.settings?.liveAI === true } });
});

async function authStatus() {
  const configured = isExtensionConfigured();
  if (!configured) return { configured: false, authenticated: false, email: null, profile: null };
  const user = await getExtensionUser();
  const cached = await chrome.storage.local.get("profile");
  const profile = user ? cached.profile ?? await fetchAuthenticatedProfile() : null;
  return { configured: true, authenticated: Boolean(user), email: user?.email ?? null, profile: profile ?? null };
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (message.type === "ACTIVE_FIELD") {
    chrome.storage.session.set({ activeField: message.payload, activeTabId: tabId });
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "GET_ACTIVE_FIELD") {
    chrome.storage.session.get(["activeField", "activeTabId"]).then(sendResponse);
    return true;
  }

  if (message.type === "AUTH_STATUS") {
    authStatus().then(sendResponse).catch((error) => sendResponse({ configured: isExtensionConfigured(), authenticated: false, email: null, profile: null, error: String(error) }));
    return true;
  }

  if (message.type === "AUTH_REQUEST_OTP") {
    const supabase = getExtensionSupabase();
    if (!supabase) { sendResponse({ ok: false, error: "Extension setup is missing. Please contact support." }); return; }
    supabase.auth.signInWithOtp({ email: message.email.trim(), options: { shouldCreateUser: true } }).then(({ error }) => sendResponse(error ? { ok: false, error: error.message } : { ok: true })).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "AUTH_VERIFY_OTP") {
    const supabase = getExtensionSupabase();
    if (!supabase) { sendResponse({ ok: false, error: "Extension setup is missing. Please contact support." }); return; }
    supabase.auth.verifyOtp({ email: message.email.trim(), token: message.token.trim(), type: "email" }).then(async ({ data, error }) => {
      if (error) { sendResponse({ ok: false, error: error.message }); return; }
      const profile = await fetchAuthenticatedProfile();
      sendResponse({ ok: true, email: data.user?.email ?? message.email, profile });
    }).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "AUTH_SIGN_OUT") {
    clearExtensionSession().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "GET_AUTH_TOKEN") {
    const supabase = getExtensionSupabase();
    if (!supabase) { sendResponse({ accessToken: null, error: "Extension setup is missing. Please contact support." }); return; }
    supabase.auth.getSession().then(({ data }) => sendResponse({ accessToken: data.session?.access_token ?? null })).catch((error) => sendResponse({ accessToken: null, error: String(error) }));
    return true;
  }

  if (message.type === "GET_PROFILE" || message.type === "REFRESH_PROFILE") {
    fetchAuthenticatedProfile().then((profile) => sendResponse({ profile })).catch((error) => sendResponse({ profile: null, error: String(error) }));
    return true;
  }

  if (message.type === "GET_RESUME_FILE") {
    fetchResumeFile().then(sendResponse).catch((error) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "GET_SETTINGS") {
    chrome.storage.local.get("settings").then((result) => sendResponse({ autoSuggest: result.settings?.autoSuggest !== false, liveAI: result.settings?.liveAI === true } satisfies ExtensionSettings));
    return true;
  }

  if (message.type === "UPDATE_SETTINGS") {
    chrome.storage.local.get("settings").then(async (result) => {
      const settings = { autoSuggest: result.settings?.autoSuggest !== false, liveAI: result.settings?.liveAI === true, ...message.settings } satisfies ExtensionSettings;
      await chrome.storage.local.set({ settings });
      sendResponse(settings);
    });
    return true;
  }

  if (message.type === "FIND_ANSWER_MEMORY") {
    findLocalMemory(message.question).then((item) => sendResponse({ item })).catch((error) => sendResponse({ item: null, error: String(error) }));
    return true;
  }

  if (message.type === "SAVE_ANSWER_MEMORY") {
    saveAnswerMemory(message.item).then((item) => sendResponse({ item })).catch((error) => sendResponse({ item: null, error: String(error) }));
    return true;
  }

  if (message.type === "SUGGEST_ANSWER") {
    (async () => {
      const supabase = getExtensionSupabase();
      const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
      const accessToken = data.session?.access_token;
      if (!accessToken) { sendResponse({ answer: "", error: "Not signed in" }); return; }
      try {
        const response = await fetch(extensionConfig.aiApiUrl, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ question: message.question, page: message.page }) });
        const payload = await response.json();
        sendResponse(response.ok ? { answer: payload.answer ?? "", source: payload.source, notice: payload.notice } : { answer: "", error: payload.error ?? "Request failed" });
      } catch (error) { sendResponse({ answer: "", error: String(error) }); }
    })();
    return true;
  }

  if (message.type === "SAVE_UNKNOWN_QUESTION") {
    saveUnknownQuestion(message.question, message.page).then((item) => sendResponse({ ok: Boolean(item), item })).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "SAVE_JOB") {
    saveJobToSupabase(message.job).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "GET_TRACKER") {
    fetchTracker().then(sendResponse).catch((error) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "TRANSCRIBE_AUDIO") {
    // Transcription runs on the web app's server so no provider key ships in the extension.
    (async () => {
      try {
        const supabase = getExtensionSupabase();
        const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
        const accessToken = data.session?.access_token;
        if (!accessToken) { sendResponse({ error: "Sign in to use dictation." }); return; }

        const blob = await (await fetch(message.dataUrl)).blob();
        const form = new FormData();
        form.append("audio", blob, "recording.webm");
        const response = await fetch(`${extensionConfig.webAppUrl}/api/transcribe`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: form,
        });
        const payload = await response.json();
        sendResponse(response.ok ? { text: payload.text ?? "" } : { error: payload.error ?? "Transcription failed." });
      } catch (error) { sendResponse({ error: String(error) }); }
    })();
    return true;
  }

  if (message.type === "OPEN_SIDE_PANEL") {
    const targetTabId = tabId ?? messageTabId(sender);
    if (targetTabId !== undefined) {
      chrome.sidePanel.open({ tabId: targetTabId }).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;
    }
    sendResponse({ ok: false, error: "No active tab" });
    return;
  }

  if (message.type === "COPY_TEXT") {
    if (tabId !== undefined) chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
    sendResponse({ ok: true });
  }
});

function messageTabId(sender: chrome.runtime.MessageSender): number | undefined {
  return sender.tab?.id;
}

/**
 * Live profile sync.
 *
 * The web app and the extension share one Supabase user, so a profile edited on the
 * web should reach the extension without the user pressing "Refresh". A periodic
 * alarm keeps the cached profile fresh, and any auth change refreshes it immediately.
 */
const SYNC_ALARM = "applypilot-profile-sync";

chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 15 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== SYNC_ALARM) return;
  const user = await getExtensionUser().catch(() => null);
  if (!user) return;
  const profile = await fetchAuthenticatedProfile().catch(() => null);
  if (profile) await chrome.storage.local.set({ profile, profileSyncedAt: new Date().toISOString() });
});

// Refresh as soon as the side panel or popup opens, so the panel never shows stale data.
chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name !== "applypilot-panel") return;
  const profile = await fetchAuthenticatedProfile().catch(() => null);
  if (profile) {
    await chrome.storage.local.set({ profile, profileSyncedAt: new Date().toISOString() });
    port.postMessage({ type: "PROFILE_SYNCED", profile });
  }
});

