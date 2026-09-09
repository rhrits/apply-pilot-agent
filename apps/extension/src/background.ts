import type { ActiveFieldPayload, ExtensionAuthStatus, ExtensionMessage, ExtensionSettings } from "@uplyfox/shared";
import { extensionConfig, isExtensionConfigured } from "./lib/config";
import { checkConnection, postJson } from "./lib/api-client";
import { clearExtensionSession, fetchAuthenticatedProfile, fetchResumeFile, fetchTracker, getExtensionAuthStatus, getExtensionSupabase, markApplicationApplied, saveJobToSupabase, undoApplicationApplied } from "./lib/supabase";
import { findLocalMemory, saveAnswerMemory } from "./lib/memory";
import { saveUnknownQuestion } from "./lib/unknown-questions";

const panelPorts = new Set<chrome.runtime.Port>();

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ extensionInstalledAt: new Date().toISOString(), settings: { autoSuggest: current.settings?.autoSuggest !== false, liveAI: current.settings?.liveAI !== false, autoTrackJobs: current.settings?.autoTrackJobs !== false } });
});

async function authStatus() {
  return getExtensionAuthStatus();
}

async function readyStatus(): Promise<ExtensionAuthStatus> {
  const status = await authStatus();
  if (status.accessState !== "ready") throw new Error(status.accessState === "profile_required" ? "Complete your profile before using the extension." : status.accessState === "access_required" ? "Redeem a UplyFox access code before using the extension." : "Sign in from the extension popup first.");
  return status;
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (message.type === "ACTIVE_FIELD") {
    readyStatus().then(async () => {
      await chrome.storage.session.set({ activeField: message.payload, activeTabId: tabId, activeFrameId: sender.frameId ?? 0 });
      for (const port of panelPorts) port.postMessage({ type: "ACTIVE_FIELD", payload: message.payload });
      sendResponse({ ok: true });
    }).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "GET_ACTIVE_FIELD") {
    readyStatus().then(() => chrome.storage.session.get(["activeField", "activeTabId", "activeFrameId"])).then(sendResponse).catch((error) => sendResponse({ error: String(error) }));
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
    clearExtensionSession(message.clearLocalData === true).then(async () => {
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
    chrome.storage.local.get("settings").then((result) => sendResponse({ autoSuggest: result.settings?.autoSuggest !== false, liveAI: result.settings?.liveAI !== false, autoTrackJobs: result.settings?.autoTrackJobs !== false } satisfies ExtensionSettings));
    return true;
  }

  if (message.type === "UPDATE_SETTINGS") {
    readyStatus().then(() => chrome.storage.local.get("settings")).then(async (result) => {
      const settings = { autoSuggest: result.settings?.autoSuggest !== false, liveAI: result.settings?.liveAI !== false, autoTrackJobs: result.settings?.autoTrackJobs !== false, ...message.settings } satisfies ExtensionSettings;
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
        if (!accessToken) { sendResponse({ answer: "", error: "Sign in from the UplyFox popup to get suggestions." }); return; }
        const result = await postJson<{ answer?: string; source?: string; notice?: string }>(extensionConfig.aiApiUrl, {
          question: message.question, page: message.page, field: message.field, selectedText: message.selectedText,
        }, accessToken);
        // Transport and account failures are reported as a notice rather than a raw
        // exception string, so the overlay always explains what to do next.
        if (!result.ok) { sendResponse({ answer: "", error: result.message, kind: result.kind }); return; }
        sendResponse({ answer: result.data.answer ?? "", source: result.data.source, notice: result.data.notice });
      } catch (error) { sendResponse({ answer: "", error: String(error) }); }
    })();
    return true;
  }

  if (message.type === "CHECK_CONNECTION") {
    (async () => {
      try {
        await readyStatus();
        const supabase = getExtensionSupabase();
        const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
        sendResponse(await checkConnection(data.session?.access_token));
      } catch (error) { sendResponse({ ok: false, message: String(error), host: "", localhostBuild: false }); }
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

  if (message.type === "JOB_PAGE_DETECTED") {
    (async () => {
      try {
        await readyStatus();
        const settings = await chrome.storage.local.get("settings");
        if (settings.settings?.autoTrackJobs === false) { sendResponse({ ok: false, ignored: true }); return; }
        const result = await saveJobToSupabase(message.job);
        for (const port of panelPorts) port.postMessage({ type: "JOB_SAVED", job: message.job, result });
        sendResponse(result);
      } catch (error) { sendResponse({ ok: false, error: String(error) }); }
    })();
    return true;
  }

  if (message.type === "APPLICATION_SUBMITTED") {
    (async () => {
      try {
        await readyStatus();
        const settings = await chrome.storage.local.get("settings");
        if (settings.settings?.autoTrackJobs === false) { sendResponse({ ok: false, ignored: true }); return; }
        const result = await markApplicationApplied(message.job, message.verdict);
        // Surfaced in the side panel with an Undo action: an automatic status change is
        // only trustworthy if the user can see it and reverse it.
        if (result.ok && result.changed) {
          for (const port of panelPorts) {
            port.postMessage({ type: "APPLICATION_APPLIED", job: message.job, verdict: message.verdict });
          }
        }
        sendResponse(result);
      } catch (error) { sendResponse({ ok: false, error: String(error) }); }
    })();
    return true;
  }

  if (message.type === "UNDO_APPLICATION") {
    readyStatus().then(() => undoApplicationApplied(message.url)).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "GET_TRACKER") {
    readyStatus().then(() => fetchTracker()).then(sendResponse).catch((error) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "SCAN_PAGE_ALL_FRAMES") {
    // Fans a scan/fill request out to every frame of the tab, not just the top document.
    // Some ATS integrations (iCIMS, embedded Greenhouse/Lever widgets) render the actual
    // application form inside an <iframe>, which a plain chrome.tabs.sendMessage without
    // a frameId cannot reliably target — with `all_frames` content scripts it either
    // reaches every frame at once with only one unpredictable response, or misses the
    // frame entirely. Enumerating frames explicitly and merging their results fixes both.
    (async () => {
      const requestType = message.fill ? "FILL_ALL" as const : "SCAN_PAGE" as const;
      let frameIds = [0];
      try {
        const frames = await chrome.webNavigation.getAllFrames({ tabId: message.tabId });
        if (frames?.length) frameIds = frames.map((frame) => frame.frameId);
      } catch { /* Fall back to the top frame only if frame enumeration is unavailable. */ }

      const responses = await Promise.all(frameIds.map((frameId) =>
        chrome.tabs.sendMessage(message.tabId, { type: requestType } satisfies ExtensionMessage, { frameId }).catch(() => null),
      ));

      const authenticated = responses.some((response) => response?.authenticated === true);
      const fields = responses
        .flatMap((response, position) => (response?.fields ?? []).map((field: Record<string, unknown>) => ({ ...field, frameId: frameIds[position] })))
        // Reassign sequential indices once merged, since each frame numbered its own
        // fields starting at 0 and those would otherwise collide in the fields list.
        .map((field, index) => ({ ...field, index }));

      sendResponse({ authenticated, fields });
    })();
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
    const targetTabId = message.tabId ?? tabId ?? messageTabId(sender);
    if (targetTabId === undefined) { sendResponse({ ok: false, error: "No active tab" }); return; }

    // Chrome requires sidePanel.open() to run directly from the user gesture.
    // Do not wait for the asynchronous auth check before opening; the panel
    // performs the same readiness check before exposing any profile data or actions.
    chrome.sidePanel.open({ tabId: targetTabId }).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: String(error) }));
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
const SYNC_ALARM = "uplyfox-profile-sync";

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
  if (port.name !== "uplyfox-panel") return;
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

