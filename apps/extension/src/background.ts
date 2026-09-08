import type { ActiveFieldPayload, ExtensionMessage, ExtensionSettings } from "@applypilot/shared";
import { isExtensionConfigured } from "./lib/config";
import { clearExtensionSession, fetchAuthenticatedProfile, fetchResumeFile, getExtensionSupabase, getExtensionUser } from "./lib/supabase";
import { findLocalMemory, saveAnswerMemory } from "./lib/memory";

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ extensionInstalledAt: new Date().toISOString(), settings: { autoSuggest: current.settings?.autoSuggest !== false } });
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
    if (!supabase) { sendResponse({ ok: false, error: "Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for the extension build." }); return; }
    supabase.auth.signInWithOtp({ email: message.email.trim(), options: { shouldCreateUser: true } }).then(({ error }) => sendResponse(error ? { ok: false, error: error.message } : { ok: true })).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "AUTH_VERIFY_OTP") {
    const supabase = getExtensionSupabase();
    if (!supabase) { sendResponse({ ok: false, error: "Extension Supabase configuration is missing." }); return; }
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
    if (!supabase) { sendResponse({ accessToken: null, error: "Extension Supabase configuration is missing." }); return; }
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
    chrome.storage.local.get("settings").then((result) => sendResponse({ autoSuggest: result.settings?.autoSuggest !== false } satisfies ExtensionSettings));
    return true;
  }

  if (message.type === "UPDATE_SETTINGS") {
    chrome.storage.local.get("settings").then(async (result) => {
      const settings = { autoSuggest: result.settings?.autoSuggest !== false, ...message.settings } satisfies ExtensionSettings;
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

