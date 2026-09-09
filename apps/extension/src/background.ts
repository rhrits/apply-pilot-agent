import { approvalMatches, classifyNavAction, computeSnapshotHash, createApprovalGrant, evaluateSubmissionAttempt, fieldSignature, sha256, snapshotStep, SUBMISSION_CONFIRMATION_WINDOW_MS, type ActiveFieldPayload, type ApprovalGrant, type ButtonDescriptor, type ExtensionAuthStatus, type ExtensionMessage, type ExtensionSettings, type FormBlocker, type FormStepSnapshot, type FormValidationError, type InspectedField, type PreSubmitSnapshot, type SnapshotFrame, type SubmissionAttempt, type SubmissionSignal } from "@uplyfox/shared";
import { extensionConfig, isExtensionConfigured } from "./lib/config";
import { checkConnection, postJson } from "./lib/api-client";
import { approveApplicationDraft, clearExtensionSession, consumeApplicationApproval, fetchAuthenticatedProfile, fetchResumeFile, fetchTracker, finalizeSubmissionAttempt, getExtensionAuthStatus, getExtensionSupabase, markApplicationApplied, saveApplicationDraft, saveJobToSupabase, undoApplicationApplied } from "./lib/supabase";
import type { ApplicationSession } from "./lib/application-session";
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

async function inspectTabNow(tabId: number): Promise<FormStepSnapshot> {
  const frameRecords = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null);
  const frames = frameRecords?.length ? frameRecords : [{ frameId: 0, parentFrameId: -1, url: "" }];
  const scans = await Promise.all(frames.map(async (frame) => {
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: "INSPECT_FORM_FRAME", frameId: frame.frameId } satisfies ExtensionMessage, { frameId: frame.frameId });
      return { frame, result, error: "" };
    } catch (error) { return { frame, result: null, error: error instanceof Error ? error.message : String(error) }; }
  }));
  const fields = scans.flatMap(({ result }) => (result?.fields ?? []) as InspectedField[]);
  const validationErrors = scans.flatMap(({ result }) => (result?.validationErrors ?? []) as FormValidationError[]);
  const buttons = scans.flatMap(({ result }) => (result?.buttons ?? []) as ButtonDescriptor[]);
  const blockers: FormBlocker[] = [
    ...scans.flatMap(({ result }) => (result?.blockers ?? []) as FormBlocker[]),
    ...scans.filter(({ result }) => !result).map(({ frame, error }) => ({ kind: "unavailable_frame" as const, detail: `Could not inspect embedded frame: ${frame.url || "unknown frame"}${error ? ` (${error})` : ""}`, frameId: frame.frameId })),
  ];
  const top = scans.find(({ frame }) => frame.frameId === 0)?.result;
  const signature = fieldSignature(fields);
  return {
    stepIndex: 0, stepKey: `${tabId}:${signature}`, heading: top?.heading || scans.map(({ result }) => result?.heading).find(Boolean) || undefined,
    url: top?.url || frames.find((frame) => frame.frameId === 0)?.url || "",
    frames: scans.map(({ frame, result, error }) => {
      let origin = ""; try { origin = frame.url ? new URL(frame.url).origin : ""; } catch { /* no origin */ }
      return { frameId: frame.frameId, parentFrameId: frame.parentFrameId, url: frame.url, origin, status: result ? "scanned" as const : "unavailable" as const, fieldCount: result?.fields?.length ?? 0, error: error || undefined, documentToken: result?.documentToken };
    }),
    fields, fieldSignature: signature, validationErrors, navAction: classifyNavAction(buttons), blockers, capturedAt: Date.now(),
  };
}

async function freshReviewSnapshot(tabId: number, storedSnapshot: PreSubmitSnapshot): Promise<PreSubmitSnapshot> {
  const liveStep = await inspectTabNow(tabId);
  liveStep.stepIndex = storedSnapshot.stepIndex;
  const frameRecords = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null);
  const frameList = frameRecords?.length ? frameRecords : [{ frameId: 0, parentFrameId: -1, url: liveStep.url }];
  const captures = await Promise.all(frameList.map(async (frame) => {
    try { return { frame, capture: await chrome.tabs.sendMessage(tabId, { type: "CAPTURE_FORM_FRAME", frameId: frame.frameId } satisfies ExtensionMessage, { frameId: frame.frameId }) }; }
    catch { return { frame, capture: { html: null, redactions: [], screenshotSafe: false } }; }
  }));
  const frames: SnapshotFrame[] = captures.map(({ frame, capture }) => {
    let origin = ""; try { origin = frame.url ? new URL(frame.url).origin : ""; } catch { /* no origin */ }
    return { frameId: frame.frameId, parentFrameId: frame.parentFrameId, origin, html: null, status: capture.html ? "captured" : "unavailable", redactions: capture.redactions ?? [] };
  });
  const steps = storedSnapshot.steps.map((step, index) => index === storedSnapshot.steps.length - 1 ? snapshotStep(liveStep) : step);
  const nav = liveStep.navAction;
  const submitTarget = nav.kind === "submit" && nav.label && nav.selector && nav.frameId !== undefined && nav.documentToken && nav.tagName && nav.type === "submit" && nav.formFingerprint && !nav.disabled && !nav.ariaDisabled
    ? { label: nav.label, selector: nav.selector, frameId: nav.frameId, shadowPath: nav.shadowPath ?? [], documentToken: nav.documentToken, tagName: nav.tagName, type: "submit" as const, role: nav.role, disabled: false, ariaDisabled: false, formFingerprint: nav.formFingerprint }
    : undefined;
  const base = { ...storedSnapshot, steps, frames, submitTarget, blankFields: steps.flatMap((step) => step.answers.filter((answer) => answer.value == null || answer.value === "")), capturedAt: new Date().toISOString(), snapshotHash: "" };
  return { ...base, snapshotHash: await computeSnapshotHash(base) };
}

async function finalizeAttempt(attempt: SubmissionAttempt, outcome: "confirmed" | "unknown" | "failed", reason: string, applicationId?: string) {
  const key = `submissionAttempt:${attempt.attemptId}`;
  const current = await chrome.storage.session.get(key);
  const latest = current[key] as SubmissionAttempt | undefined;
  if (!latest || latest.status === "confirmed" || latest.status === "unknown" || latest.status === "failed") return;
  const finished: SubmissionAttempt = { ...latest, status: outcome, errorReason: outcome === "confirmed" ? undefined : reason, applicationId };
  const persisted = await finalizeSubmissionAttempt({ attemptId: latest.attemptId, outcome, evidence: latest.signals, reason, applicationId });
  if (!persisted.ok) {
    await chrome.storage.session.set({ [key]: { ...latest, errorReason: `Outcome persistence pending: ${persisted.error}` } });
    await chrome.alarms.create(`submission:${latest.attemptId}`, { when: Date.now() + 5_000 });
    return;
  }
  await chrome.storage.session.set({ [key]: finished, [`phaseEGuardTab:${latest.tabId}`]: Date.now() + 120_000 });
  await chrome.storage.session.remove([`approvalGrant:${latest.sessionId}`, `pendingSubmissionTab:${latest.tabId}`]);
  for (const port of panelPorts) port.postMessage({ type: "SUBMISSION_OUTCOME", attempt: finished, reason });
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
        if (tabId !== undefined) {
          const pending = await chrome.storage.session.get([`pendingSubmissionTab:${tabId}`, `phaseEGuardTab:${tabId}`]);
          if (pending[`pendingSubmissionTab:${tabId}`]) { sendResponse({ ok: false, ignored: true, reason: "phase_e_attempt_active" }); return; }
          if (Number(pending[`phaseEGuardTab:${tabId}`] ?? 0) > Date.now()) { sendResponse({ ok: false, ignored: true, reason: "phase_e_outcome_guard" }); return; }
        }
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

  if (message.type === "INSPECT_FORM_ALL_FRAMES") {
    (async () => {
      await readyStatus();
      const frameRecords = await chrome.webNavigation.getAllFrames({ tabId: message.tabId }).catch(() => null);
      const frames = frameRecords?.length ? frameRecords : [{ frameId: 0, parentFrameId: -1, url: "" }];

      const scans = await Promise.all(frames.map(async (frame) => {
        try {
          const result = await chrome.tabs.sendMessage(
            message.tabId,
            { type: "INSPECT_FORM_FRAME", frameId: frame.frameId } satisfies ExtensionMessage,
            { frameId: frame.frameId },
          );
          return { frame, result, error: "" };
        } catch (error) {
          return { frame, result: null, error: error instanceof Error ? error.message : String(error) };
        }
      }));

      const fields = scans.flatMap(({ result }) => (result?.fields ?? []) as InspectedField[]);
      const validationErrors = scans.flatMap(({ result }) => (result?.validationErrors ?? []) as FormValidationError[]);
      const buttons = scans.flatMap(({ result }) => (result?.buttons ?? []) as ButtonDescriptor[]);
      const blockers: FormBlocker[] = [
        ...scans.flatMap(({ result }) => (result?.blockers ?? []) as FormBlocker[]),
        ...scans.filter(({ result }) => !result).map(({ frame, error }) => ({
          kind: "unavailable_frame" as const,
          detail: `Could not inspect embedded frame: ${frame.url || "unknown frame"}${error ? ` (${error})` : ""}`,
          frameId: frame.frameId,
        })),
      ];
      // A field/validation condition can be observed through more than one route; keep
      // the panel readable by deduplicating blockers on their semantic identity.
      const uniqueBlockers = [...new Map(blockers.map((blocker) => [`${blocker.kind}|${blocker.frameId}|${blocker.fieldId}|${blocker.detail}`, blocker])).values()];
      const top = scans.find(({ frame }) => frame.frameId === 0)?.result;
      const signature = fieldSignature(fields);
      const snapshot: FormStepSnapshot = {
        stepIndex: 0,
        stepKey: `${message.tabId}:${signature}`,
        heading: top?.heading || scans.map(({ result }) => result?.heading).find(Boolean) || undefined,
        url: top?.url || frames.find((frame) => frame.frameId === 0)?.url || "",
        frames: scans.map(({ frame, result, error }) => {
          let origin = "";
          try { origin = frame.url ? new URL(frame.url).origin : ""; } catch { /* Non-URL frames have no origin. */ }
          return { frameId: frame.frameId, parentFrameId: frame.parentFrameId, url: frame.url, origin, status: result ? "scanned" as const : "unavailable" as const, fieldCount: result?.fields?.length ?? 0, error: error || undefined, documentToken: result?.documentToken };
        }),
        fields,
        fieldSignature: signature,
        validationErrors,
        navAction: classifyNavAction(buttons),
        blockers: uniqueBlockers,
        capturedAt: Date.now(),
      };
      sendResponse({ authenticated: true, snapshot });
    })().catch((error) => sendResponse({ authenticated: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "ADVANCE_SAFE_STEP_ALL_FRAMES") {
    (async () => {
      await readyStatus();
      const frames = await chrome.webNavigation.getAllFrames({ tabId: message.tabId }).catch(() => null);
      const frameIds = (frames?.length ? frames : [{ frameId: 0 }]).map((frame) => frame.frameId);
      const failures: Array<{ frameId: number; reason?: string; detail?: string }> = [];
      // Sequential by design. Promise.all could click two embedded application frames
      // before either response arrives; Phase C permits exactly one click per step.
      for (const frameId of frameIds) {
        try {
          const response = await chrome.tabs.sendMessage(message.tabId, { type: "ADVANCE_SAFE_STEP_FRAME" } satisfies ExtensionMessage, { frameId });
          if (response?.ok && response?.clicked) { sendResponse({ ...response, frameId }); return; }
          failures.push({ frameId, reason: response?.reason, detail: response?.detail });
        } catch (error) {
          failures.push({ frameId, reason: "unavailable_frame", detail: error instanceof Error ? error.message : String(error) });
        }
      }
      sendResponse({ ok: false, reason: "no_safe_next", detail: "No tested, allowlisted Next control was found in a reachable application frame.", failures });
    })().catch((error) => sendResponse({ ok: false, reason: "navigation_error", detail: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "CAPTURE_APPLICATION_DRAFT") {
    (async () => {
      await readyStatus();
      const sessionKey = `applicationSession:${message.tabId}`;
      const stored = await chrome.storage.session.get(sessionKey);
      const session = stored[sessionKey] as ApplicationSession | undefined;
      if (!session || session.sessionId !== message.sessionId || !session.currentStep) {
        sendResponse({ ok: false, error: "The safe-step session changed. Inspect the final step again." }); return;
      }
      const liveStep = await inspectTabNow(message.tabId);
      liveStep.stepIndex = session.stepIndex;
      if (liveStep.navAction.kind !== "submit" && liveStep.navAction.kind !== "review") {
        sendResponse({ ok: false, error: "Capture is available only on the final Review or Submit step." }); return;
      }

      const frameRecords = await chrome.webNavigation.getAllFrames({ tabId: message.tabId }).catch(() => null);
      const frameList = frameRecords?.length ? frameRecords : [{ frameId: 0, parentFrameId: -1, url: session.currentStep.url }];
      const captures = await Promise.all(frameList.map(async (frame) => {
        try {
          const capture = await chrome.tabs.sendMessage(message.tabId, { type: "CAPTURE_FORM_FRAME", frameId: frame.frameId } satisfies ExtensionMessage, { frameId: frame.frameId });
          return { frame, capture };
        } catch (error) {
          return { frame, capture: { html: null, redactions: [], screenshotSafe: false, error: error instanceof Error ? error.message : String(error) } };
        }
      }));

      const frames: SnapshotFrame[] = await Promise.all(captures.map(async ({ frame, capture }) => {
        let origin = "";
        try { origin = frame.url ? new URL(frame.url).origin : ""; } catch { /* Non-URL frames have no origin. */ }
        return { frameId: frame.frameId, parentFrameId: frame.parentFrameId, origin, html: capture.html ?? null, htmlSha256: capture.html ? await sha256(capture.html) : undefined, status: capture.html ? "captured" as const : "unavailable" as const, redactions: capture.redactions ?? [] };
      }));

      const uniqueSteps = [...session.steps, liveStep].filter((step, index, all) => all.findIndex((candidate) => candidate.stepKey === step.stepKey) === index);
      const steps = uniqueSteps.map(snapshotStep);
      const tab = await chrome.tabs.get(message.tabId);
      const page = await chrome.tabs.sendMessage(message.tabId, { type: "GET_PAGE_SUMMARY" } satisfies ExtensionMessage, { frameId: 0 }).catch(() => null);
      const allScreenshotSafe = captures.every(({ capture }) => capture.screenshotSafe === true);
      let screenshotDataUrl: string | undefined;
      if (allScreenshotSafe && tab.active) screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }).catch(() => undefined);
      const screenshotSha256 = screenshotDataUrl ? await sha256(screenshotDataUrl) : undefined;
      const base: Omit<PreSubmitSnapshot, "snapshotHash"> = {
        version: 1,
        sessionId: session.sessionId,
        stepIndex: session.stepIndex,
        job: { title: page?.title ?? tab.title ?? "Application", company: page?.company ?? "", url: page?.url ?? tab.url ?? session.currentStep.url, hostname: page?.hostname ?? "" },
        steps,
        frames,
        blankFields: steps.flatMap((step) => step.answers.filter((answer) => answer.value == null || answer.value === "")),
        submitTarget: liveStep.navAction.kind === "submit"
          && liveStep.navAction.label
          && liveStep.navAction.selector
          && liveStep.navAction.frameId !== undefined
          && liveStep.navAction.documentToken
          && liveStep.navAction.tagName
          && liveStep.navAction.type === "submit"
          && liveStep.navAction.formFingerprint
          && !liveStep.navAction.disabled
          && !liveStep.navAction.ariaDisabled
          ? { label: liveStep.navAction.label, selector: liveStep.navAction.selector, frameId: liveStep.navAction.frameId, shadowPath: liveStep.navAction.shadowPath ?? [], documentToken: liveStep.navAction.documentToken, tagName: liveStep.navAction.tagName, type: "submit", role: liveStep.navAction.role, disabled: false, ariaDisabled: false, formFingerprint: liveStep.navAction.formFingerprint }
          : undefined,
        screenshotSha256,
        redactionVersion: "v1",
        capturedAt: new Date().toISOString(),
      };
      const snapshot: PreSubmitSnapshot = { ...base, snapshotHash: await computeSnapshotHash(base) };
      const saved = await saveApplicationDraft(snapshot, screenshotDataUrl);
      const draftId = saved.draftId ?? crypto.randomUUID();
      const reviewSnapshot = { ...snapshot, screenshotPath: saved.screenshotPath, frames: snapshot.frames.map((frame) => ({ ...frame, html: null })) };
      await chrome.storage.session.set({ [`applicationDraft:${message.tabId}`]: { draftId, snapshot: reviewSnapshot, persisted: saved.ok } });
      sendResponse({ ok: true, draftId, snapshot: reviewSnapshot, persisted: saved.ok, warning: saved.ok ? undefined : `Draft is available for review locally, but could not be saved remotely: ${saved.error}` });
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "APPROVE_APPLICATION_DRAFT") {
    (async () => {
      await readyStatus();
      const keys = await chrome.storage.session.get(null);
      const storedDraft = Object.values(keys).find((value) => {
        const candidate = value as { draftId?: string; snapshot?: PreSubmitSnapshot } | undefined;
        return candidate?.draftId === message.draftId;
      }) as { draftId: string; snapshot: PreSubmitSnapshot; persisted?: boolean } | undefined;
      if (!storedDraft || storedDraft.snapshot.sessionId !== message.sessionId || storedDraft.snapshot.stepIndex !== message.stepIndex || storedDraft.snapshot.snapshotHash !== message.snapshotHash) {
        sendResponse({ ok: false, error: "The reviewed snapshot changed. Capture a new draft before approving." }); return;
      }
      if (!storedDraft.persisted) { sendResponse({ ok: false, error: "The draft is not safely persisted yet. Apply the Phase D database migration and capture it again." }); return; }
      if (!storedDraft.snapshot.submitTarget) { sendResponse({ ok: false, error: "No exact native Submit control was captured. Continue to the final page manually and capture again." }); return; }
      if (storedDraft.snapshot.steps.some((step) => step.blockers.length || step.validationErrors.length)) { sendResponse({ ok: false, error: "Resolve every blocker and validation error, then capture a new draft." }); return; }
      if (storedDraft.snapshot.steps.some((step) => step.answers.some((answer) => answer.redacted))) { sendResponse({ ok: false, error: "This application contains a redacted secret field and cannot be submitted automatically." }); return; }
      const grant = createApprovalGrant({ draftId: message.draftId, sessionId: message.sessionId, stepIndex: message.stepIndex, snapshotHash: message.snapshotHash });
      const grantKey = `approvalGrant:${message.sessionId}`;
      await chrome.storage.session.set({ [grantKey]: grant });
      const approved = await approveApplicationDraft({ draftId: message.draftId, sessionId: message.sessionId, snapshotHash: message.snapshotHash, expiresAt: new Date(grant.expiresAt).toISOString(), tokenVerifier: await sha256(grant.token) });
      if (!approved.ok) { await chrome.storage.session.remove(grantKey); sendResponse(approved); return; }
      // The one-time token remains extension-local. It is never stored in Supabase,
      // exposed to the page, or returned to a content script. Phase E must consume it.
      sendResponse({ ok: true, approvedAt: new Date(grant.issuedAt).toISOString(), expiresAt: new Date(grant.expiresAt).toISOString() });
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "SUBMIT_APPROVED_DRAFT") {
    (async () => {
      await readyStatus();
      const grantKey = `approvalGrant:${message.sessionId}`;
      const values = await chrome.storage.session.get([grantKey, `applicationDraft:${message.tabId}`]);
      const grant = values[grantKey] as ApprovalGrant | undefined;
      const storedDraft = values[`applicationDraft:${message.tabId}`] as { draftId: string; snapshot: PreSubmitSnapshot; persisted: boolean } | undefined;
      const tuple = { sessionId: message.sessionId, draftId: message.draftId, stepIndex: message.stepIndex, snapshotHash: message.snapshotHash };
      if (!grant || !approvalMatches(grant, tuple) || !storedDraft || storedDraft.draftId !== message.draftId || !storedDraft.persisted) {
        sendResponse({ ok: false, error: "Approval is missing, expired, consumed, or does not match this draft." }); return;
      }

      // Reinspect and recapture stable approval material immediately before consumption.
      // Any changed value, field, frame document, target, validation state, or blocker
      // changes the hash and aborts without consuming or clicking.
      const fresh = await freshReviewSnapshot(message.tabId, storedDraft.snapshot);
      if (fresh.snapshotHash !== grant.snapshotHash || !fresh.submitTarget) {
        await chrome.storage.session.remove(grantKey);
        sendResponse({ ok: false, error: "The application changed after approval. Capture and review a new draft." }); return;
      }
      if (fresh.steps.some((step) => step.blockers.length || step.validationErrors.length || step.answers.some((answer) => answer.redacted))) {
        sendResponse({ ok: false, error: "The live application now has a blocker, validation error, or redacted secret field." }); return;
      }

      const attemptId = crypto.randomUUID();
      const startedAt = Date.now();
      const deadlineAt = startedAt + SUBMISSION_CONFIRMATION_WINDOW_MS;
      const attempt: SubmissionAttempt = { attemptId, sessionId: message.sessionId, draftId: message.draftId, tabId: message.tabId, frameId: fresh.submitTarget.frameId, snapshotHash: fresh.snapshotHash, startedAt, deadlineAt, status: "armed", signals: [] };
      const consumed = await consumeApplicationApproval({ attemptId, draftId: message.draftId, sessionId: message.sessionId, snapshotHash: message.snapshotHash, tokenVerifier: await sha256(grant.token), startedAt: new Date(startedAt).toISOString(), deadlineAt: new Date(deadlineAt).toISOString() });
      if (!consumed.ok) { await chrome.storage.session.remove(grantKey); sendResponse(consumed); return; }
      const attemptKey = `submissionAttempt:${attemptId}`;
      await chrome.storage.session.set({ [attemptKey]: attempt, [`pendingSubmissionTab:${message.tabId}`]: attemptId, [`latestSubmissionTab:${message.tabId}`]: attemptId, [grantKey]: { ...grant, consumedAt: startedAt } });
      await chrome.alarms.create(`submission:${attemptId}`, { when: deadlineAt });

      // Arm all reachable frames before the click so a fast SPA transition cannot race
      // past the observers. Failed observer injection is tolerated only if the exact
      // target frame is still reachable for execution.
      const frames = await chrome.webNavigation.getAllFrames({ tabId: message.tabId }).catch(() => null);
      await Promise.all((frames ?? [{ frameId: 0 }]).map((frame) => chrome.tabs.sendMessage(message.tabId, { type: "OBSERVE_SUBMISSION_ATTEMPT", attemptId, startedAt, deadlineAt } satisfies ExtensionMessage, { frameId: frame.frameId }).catch(() => null)));
      const executed = await chrome.tabs.sendMessage(message.tabId, { type: "EXECUTE_APPROVED_SUBMIT", attemptId, startedAt, deadlineAt, target: fresh.submitTarget } satisfies ExtensionMessage, { frameId: fresh.submitTarget.frameId }).catch((error) => ({ ok: false, reason: "execution_error", detail: String(error) }));
      if (!executed?.ok) {
        await finalizeAttempt(attempt, "failed", executed?.detail || "The exact reviewed Submit control could not be executed.");
        sendResponse({ ok: false, error: executed?.detail || "Submission execution failed.", attemptId }); return;
      }
      const afterExecution = await chrome.storage.session.get(attemptKey);
      const armed = afterExecution[attemptKey] as SubmissionAttempt | undefined;
      if (armed && !armed.signals.some((signal) => signal.kind === "target_click")) {
        await chrome.storage.session.set({ [attemptKey]: { ...armed, status: "clicked", signals: [...armed.signals, { kind: "target_click", at: Date.now(), detail: fresh.submitTarget.label, frameId: fresh.submitTarget.frameId, documentToken: fresh.submitTarget.documentToken }] } });
      }
      sendResponse({ ok: true, attemptId, deadlineAt });
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "SUBMISSION_ATTEMPT_SIGNAL") {
    (async () => {
      const key = `submissionAttempt:${message.attemptId}`;
      const stored = await chrome.storage.session.get(key);
      const attempt = stored[key] as SubmissionAttempt | undefined;
      if (!attempt || attempt.tabId !== tabId || ["confirmed", "unknown", "failed"].includes(attempt.status)) { sendResponse({ ok: false, ignored: true }); return; }
      const duplicate = attempt.signals.some((signal) => signal.kind === message.signal.kind && signal.detail === message.signal.detail && Math.abs(signal.at - message.signal.at) < 500);
      const signals = duplicate ? attempt.signals : [...attempt.signals, { ...message.signal, frameId: sender.frameId ?? message.signal.frameId } as SubmissionSignal];
      const next: SubmissionAttempt = { ...attempt, status: signals.some((signal) => signal.kind === "target_click") ? "clicked" : attempt.status, signals };
      await chrome.storage.session.set({ [key]: next });
      const verdict = evaluateSubmissionAttempt(next);
      if (verdict.outcome === "confirmed" || verdict.outcome === "failed") await finalizeAttempt(next, verdict.outcome, verdict.reason, verdict.applicationId);
      sendResponse({ ok: true, outcome: verdict.outcome });
    })().catch((error) => sendResponse({ ok: false, error: String(error) }));
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

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith("submission:")) return;
  const attemptId = alarm.name.slice("submission:".length);
  void chrome.storage.session.get(`submissionAttempt:${attemptId}`).then(async (stored) => {
    const attempt = stored[`submissionAttempt:${attemptId}`] as SubmissionAttempt | undefined;
    if (!attempt) return;
    const verdict = evaluateSubmissionAttempt(attempt, Math.max(Date.now(), attempt.deadlineAt));
    if (verdict.outcome === "confirmed" || verdict.outcome === "failed" || verdict.outcome === "unknown") await finalizeAttempt(attempt, verdict.outcome, verdict.reason, verdict.applicationId);
  });
});

/** Re-arm initial URL/DOM confirmation scanning after a full document navigation. */
chrome.webNavigation.onDOMContentLoaded.addListener((details) => {
  void chrome.storage.session.get(`pendingSubmissionTab:${details.tabId}`).then(async (stored) => {
    const attemptId = stored[`pendingSubmissionTab:${details.tabId}`] as string | undefined;
    if (!attemptId) return;
    const attemptValues = await chrome.storage.session.get(`submissionAttempt:${attemptId}`);
    const attempt = attemptValues[`submissionAttempt:${attemptId}`] as SubmissionAttempt | undefined;
    if (!attempt || Date.now() > attempt.deadlineAt || ["confirmed", "unknown", "failed"].includes(attempt.status)) return;
    await chrome.tabs.sendMessage(details.tabId, { type: "OBSERVE_SUBMISSION_ATTEMPT", attemptId, startedAt: attempt.startedAt, deadlineAt: attempt.deadlineAt } satisfies ExtensionMessage, { frameId: details.frameId }).catch(() => undefined);
  });
});

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

