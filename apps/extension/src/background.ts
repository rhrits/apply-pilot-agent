import type { ActiveFieldPayload, ExtensionAuthStatus, ExtensionMessage, ExtensionSettings } from "@applypilot/shared";
import { extensionConfig, isExtensionConfigured } from "./lib/config";
import { clearExtensionSession, fetchAuthenticatedProfile, fetchResumeFile, fetchTracker, getExtensionAuthStatus, getExtensionSupabase, saveJobToSupabase } from "./lib/supabase";
import { findLocalMemory, saveAnswerMemory } from "./lib/memory";
import { saveUnknownQuestion } from "./lib/unknown-questions";

const panelPorts = new Set<chrome.runtime.Port>();

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ extensionInstalledAt: new Date().toISOString(), settings: { autoSuggest: current.settings?.autoSuggest !== false, liveAI: current.settings?.liveAI === true } });
});

async function authStatus() {
  return getExtensionAuthStatus();
}

async function readyStatus(): Promise<ExtensionAuthStatus> {
  const status = await authStatus();
  if (status.accessState !== "ready") throw new Error(status.accessState === "profile_required" ? "Complete your profile before using the extension." : "Sign in from the extension popup first.");
  return status;
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (message.type === "ACTIVE_FIELD") {
    readyStatus().then(async () => {
      await chrome.storage.session.set({ activeField: message.payload, activeTabId: tabId });
      sendResponse({ ok: true });
    }).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "GET_ACTIVE_FIELD") {
    readyStatus().then(() => chrome.storage.session.get(["activeField", "activeTabId"])).then(sendResponse).catch((error) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "AUTH_STATUS") {
    authStatus().then(sendResponse).catch((error) => sendResponse({ configured: isExtensionConfigured(), authenticated: false, accessState: "unauthenticated", userId: null, email: null, profile: null, error: String(error) }));
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
      const status = await authStatus();
      sendResponse({ ok: true, ...status, email: status.email ?? data.user?.email ?? message.email });
    }).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "AUTH_SIGN_OUT") {
    clearExtensionSession().then(async () => {
      const status = await authStatus();
      for (const port of panelPorts) port.postMessage({ type: "AUTH_STATUS", status });
      sendResponse({ ok: true });
    }).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "GET_AUTH_TOKEN") {
    readyStatus().then(async () => {
      const supabase = getExtensionSupabase();
      const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
      sendResponse({ accessToken: data.session?.access_token ?? null });
    }).catch((error) => sendResponse({ accessToken: null, error: String(error) }));
    return true;
  }

  if (message.type === "GET_PROFILE" || message.type === "REFRESH_PROFILE") {
    readyStatus().then(() => fetchAuthenticatedProfile()).then((profile) => sendResponse({ profile })).catch((error) => sendResponse({ profile: null, error: String(error) }));
    return true;
  }

  if (message.type === "GET_RESUME_FILE") {
    readyStatus().then(() => fetchResumeFile()).then(sendResponse).catch((error) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "GET_SETTINGS") {
    chrome.storage.local.get("settings").then((result) => sendResponse({ autoSuggest: result.settings?.autoSuggest !== false, liveAI: result.settings?.liveAI === true } satisfies ExtensionSettings));
    return true;
  }

  if (message.type === "UPDATE_SETTINGS") {
    readyStatus().then(() => chrome.storage.local.get("settings")).then(async (result) => {
      const settings = { autoSuggest: result.settings?.autoSuggest !== false, liveAI: result.settings?.liveAI === true, ...message.settings } satisfies ExtensionSettings;
      await chrome.storage.local.set({ settings });
      sendResponse(settings);
    }).catch((error) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "FIND_ANSWER_MEMORY") {
    readyStatus().then(() => findLocalMemory(message.question)).then((item) => sendResponse({ item })).catch((error) => sendResponse({ item: null, error: String(error) }));
    return true;
  }

  if (message.type === "SAVE_ANSWER_MEMORY") {
    readyStatus().then(() => saveAnswerMemory(message.item)).then((item) => sendResponse({ item })).catch((error) => sendResponse({ item: null, error: String(error) }));
    return true;
  }

  if (message.type === "SUGGEST_ANSWER") {
    (async () => {
      try {
        await readyStatus();
        const supabase = getExtensionSupabase();
        const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
        const accessToken = data.session?.access_token;
        if (!accessToken) { sendResponse({ answer: "", error: "Not signed in" }); return; }
        const response = await fetch(extensionConfig.aiApiUrl, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ question: message.question, page: message.page }) });
        const payload = await response.json();
        sendResponse(response.ok ? { answer: payload.answer ?? "", source: payload.source, notice: payload.notice } : { answer: "", error: payload.error ?? "Request failed" });
      } catch (error) { sendResponse({ answer: "", error: String(error) }); }
    })();
    return true;
  }

  if (message.type === "SAVE_UNKNOWN_QUESTION") {
    readyStatus().then(() => saveUnknownQuestion(message.question, message.page)).then((item) => sendResponse({ ok: Boolean(item), item })).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "SAVE_JOB") {
    readyStatus().then(() => saveJobToSupabase(message.job)).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "GET_TRACKER") {
    readyStatus().then(() => fetchTracker()).then(sendResponse).catch((error) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "TRANSCRIBE_AUDIO") {
    // Transcription runs on the web app's server so no provider key ships in the extension.
    (async () => {
      try {
        await readyStatus();
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
    readyStatus().then(() => {
      const targetTabId = message.tabId ?? tabId ?? messageTabId(sender);
      if (targetTabId === undefined) { sendResponse({ ok: false, error: "No active tab" }); return; }
      chrome.sidePanel.open({ tabId: targetTabId }).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: String(error) }));
    }).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
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
  const status = await authStatus().catch(() => null);
  if (!status || status.accessState !== "ready") return;
  const profile = await fetchAuthenticatedProfile().catch(() => null);
  if (profile) await chrome.storage.local.set({ profile, profileSyncedAt: new Date().toISOString() });
});

// Refresh as soon as the side panel or popup opens, so the panel never shows stale data.
chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name !== "applypilot-panel") return;
  panelPorts.add(port);
  port.onDisconnect.addListener(() => panelPorts.delete(port));
  const status = await authStatus().catch(() => null);
  if (!status || status.accessState !== "ready") {
    port.postMessage({ type: "AUTH_STATUS", status });
    return;
  }
  const profile = await fetchAuthenticatedProfile().catch(() => null);
  if (profile) {
    await chrome.storage.local.set({ profile, profileSyncedAt: new Date().toISOString() });
    port.postMessage({ type: "PROFILE_SYNCED", profile });
  }
});

