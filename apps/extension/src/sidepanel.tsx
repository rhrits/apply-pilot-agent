import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { describeApplicationSignals, summarizeFormPlan, type ActiveFieldPayload, type AnswerResponse, type ApplicationVerdict, type ExtensionAccessState, type ExtensionMessage, type FormStepSnapshot, type PageSummary, type PreSubmitSnapshot, type ScannedField, type SubmissionAttempt, type UserProfile } from "@uplyfox/shared";
import { extensionConfig } from "./lib/config";
import type { TrackerSnapshot } from "./lib/supabase";
import { CopyButton, DictationControl, ExternalIcon, InsertIcon, SaveIcon, SyncIcon } from "./components/ui";
import { createApplicationSession, didStepTransition, sessionCanContinue, snapshotIdentity, stopReasonForSnapshot, SESSION_LIMITS, type ApplicationSession } from "./lib/application-session";
import "./sidepanel.css";
import "./sidepanel-layout.css";
import "./sidepanel-auth.css";
import "./sidepanel-tabs.css";
import "./brand-overrides.css";
import "./sidepanel-fox.css";
import "./form-plan.css";
import "./draft-review.css";

const API_URL = extensionConfig.aiApiUrl;
type Tab = "assistant" | "profile" | "fields" | "tracker";

const STATUS_LABELS: Record<string, string> = {
  saved: "Saved", applying: "Applying", applied: "Applied", assessment: "Assessment",
  interview: "Interview", offer: "Offer", rejected: "Rejected", withdrawn: "Withdrawn",
};

function CopyRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return <div className="copy-row">
    <div className="copy-row-text"><small>{label}</small><span>{value}</span></div>
    <CopyButton value={value} label={`Copy ${label}`} />
  </div>;
}

function ProfileTab({ profile }: { profile: UserProfile | null }) {
  if (!profile) return <p className="empty">Sign in from the extension popup to load your profile.</p>;
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
  return <div className="tab-body">
    <h2>Contact</h2>
    <CopyRow label="Full name" value={name} />
    <CopyRow label="First name" value={profile.firstName} />
    <CopyRow label="Last name" value={profile.lastName} />
    <CopyRow label="Email" value={profile.email} />
    <CopyRow label="Phone" value={profile.phone} />
    <CopyRow label="Location" value={profile.location} />
    <h2>Links</h2>
    <CopyRow label="LinkedIn" value={profile.linkedin} />
    <CopyRow label="GitHub" value={profile.github} />
    <CopyRow label="Portfolio" value={profile.portfolio} />
    <h2>Application answers</h2>
    <CopyRow label="Current title" value={profile.currentTitle ?? ""} />
    <CopyRow label="Notice period" value={profile.noticePeriod ?? ""} />
    <CopyRow label="Total experience" value={profile.totalExperience ?? ""} />
    <CopyRow label="Current CTC" value={profile.currentSalary ?? ""} />
    <CopyRow label="Expected CTC" value={profile.expectedSalary ?? ""} />
    <CopyRow label="Willing to relocate" value={profile.willingToRelocate ?? ""} />
    <CopyRow label="Work authorization" value={profile.workAuthorization ?? ""} />
    <h2>Summary</h2>
    <CopyRow label="Professional summary" value={profile.summary ?? ""} />
    <h2>Skills</h2>
    <CopyRow label="All skills" value={(profile.skills ?? []).map((skill) => skill.name).join(", ")} />
    <h2>Experience</h2>
    {(profile.experiences ?? []).map((item, index) => <div key={index}>
      <CopyRow label={item.company || "Company"} value={[item.title, item.company, item.period].filter(Boolean).join(" · ")} />
      {item.achievements?.map((achievement, position) => <CopyRow key={position} label="Achievement" value={achievement} />)}
    </div>)}
    <h2>Education</h2>
    {(profile.education ?? []).map((item, index) => <CopyRow key={index} label={item.institution || "Education"} value={[item.degree, item.institution, item.period].filter(Boolean).join(", ")} />)}
    <h2>Projects</h2>
    {(profile.projects ?? []).map((item, index) => <CopyRow key={index} label={item.name} value={[item.name, item.description].filter(Boolean).join(" — ")} />)}
    {(profile.customFields ?? []).length > 0 && <>
      <h2>Custom answers</h2>
      {(profile.customFields ?? []).map((field) => <CopyRow key={field.id} label={field.label} value={field.value} />)}
    </>}
  </div>;
}

function TrackerTab({ tracker, onRefresh }: { tracker: TrackerSnapshot | null; onRefresh: () => void }) {
  if (!tracker) return <p className="empty">Sign in to see your tracked applications.</p>;
  const active = (tracker.counts.applying ?? 0) + (tracker.counts.applied ?? 0) + (tracker.counts.interview ?? 0) + (tracker.counts.assessment ?? 0);
  return <div className="tab-body">
    <div className="stat-grid">
      <div className="stat"><strong>{tracker.total}</strong><span>Tracked</span></div>
      <div className="stat"><strong>{active}</strong><span>Active</span></div>
      <div className="stat"><strong>{tracker.counts.interview ?? 0}</strong><span>Interview</span></div>
      <div className="stat"><strong>{tracker.counts.offer ?? 0}</strong><span>Offers</span></div>
    </div>
    <div className="stat-note"><span>{tracker.answerCount} saved answers ready for instant autofill</span><button className="link-button" onClick={onRefresh}><SyncIcon size={12} />Refresh</button></div>
    <h2>Recent applications</h2>
    {tracker.jobs.length === 0 && <p className="empty">Nothing tracked yet. Use “Save job” on any posting.</p>}
    {tracker.jobs.map((job) => <div className="job-row" key={job.id}>
      <div className="job-row-text">
        <strong>{job.title}</strong>
        <small>{job.company}</small>
      </div>
      {job.matchScore !== undefined && <span className="job-match-score">{job.matchScore}%</span>}
      <span className={`job-status ${job.status}`}>{STATUS_LABELS[job.status] ?? job.status}</span>
      {job.url && <a className="icon-button" href={job.url} target="_blank" rel="noopener noreferrer" title="Open posting" aria-label="Open posting"><ExternalIcon /></a>}
    </div>)}
    <a className="wide-link" href={`${extensionConfig.webAppUrl}/tracker`} target="_blank" rel="noopener noreferrer">Open full tracker<ExternalIcon /></a>
  </div>;
}

function SidePanel() {
  const [tab, setTab] = useState<Tab>("assistant");
  const [active, setActive] = useState<ActiveFieldPayload | null>(null);
  const [question, setQuestion] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [answer, setAnswer] = useState<AnswerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [accessState, setAccessState] = useState<"loading" | ExtensionAccessState>("loading");
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [fields, setFields] = useState<ScannedField[]>([]);
  const [formPlan, setFormPlan] = useState<FormStepSnapshot | null>(null);
  const [applicationSession, setApplicationSession] = useState<ApplicationSession | null>(null);
  const [applicationDraft, setApplicationDraft] = useState<{ draftId: string; snapshot: PreSubmitSnapshot; persisted: boolean; warning?: string } | null>(null);
  const [draftApproved, setDraftApproved] = useState(false);
  const [submissionAttempt, setSubmissionAttempt] = useState<SubmissionAttempt | null>(null);
  const sessionCancelled = useRef(false);
  const [tracker, setTracker] = useState<TrackerSnapshot | null>(null);
  const [pageMatch, setPageMatch] = useState<PageSummary | null>(null);
  const [appliedToast, setAppliedToast] = useState<{ title: string; url: string; reason: string } | null>(null);
  const [panelBusy, setPanelBusy] = useState(false);
  const panelWorkCount = useRef(0);

  function beginPanelWork() {
    panelWorkCount.current += 1;
    setPanelBusy(true);
  }

  function endPanelWork() {
    panelWorkCount.current = Math.max(0, panelWorkCount.current - 1);
    if (panelWorkCount.current === 0) setPanelBusy(false);
  }

  useEffect(() => {
    beginPanelWork();
    void chrome.runtime.sendMessage({ type: "AUTH_STATUS" } satisfies ExtensionMessage).then((result) => {
      setAccessState(result?.accessState ?? "unauthenticated");
      setAuthenticated(result?.accessState === "ready");
      setAccountEmail(result?.email ?? null);
      setProfile(result?.accessState === "ready" ? result.profile ?? null : null);
      if (result?.accessState === "ready") { void loadTracker(); void loadPageMatch(); }
    }).catch(() => undefined).finally(endPanelWork);

    chrome.runtime.sendMessage({ type: "GET_ACTIVE_FIELD" } satisfies ExtensionMessage).then((result) => {
      const payload = result?.activeField as ActiveFieldPayload | undefined;
      if (payload) { setActive(payload); setQuestion(payload.field.question); }
    }).catch(() => undefined);

    // Opening this port asks the worker for a fresh profile, so the panel is never stale.
    const port = chrome.runtime.connect({ name: "uplyfox-panel" });
    port.onMessage.addListener((message: { type: string; profile?: UserProfile; status?: { accessState?: ExtensionAccessState }; payload?: ActiveFieldPayload; job?: PageSummary; verdict?: ApplicationVerdict; attempt?: SubmissionAttempt; reason?: string }) => {
      if (message.type === "PROFILE_SYNCED" && message.profile) setProfile(message.profile);
      if (message.type === "ACTIVE_FIELD" && message.payload) { setActive(message.payload); setQuestion(message.payload.field.question); setSelectedText(""); setAnswer(null); }
      if (message.type === "APPLICATION_APPLIED" && message.job) {
        // Always show why, so an automatic status change is never opaque.
        setAppliedToast({
          title: [message.job.title, message.job.company].filter(Boolean).join(" · ") || "This application",
          url: message.job.url,
          reason: describeApplicationSignals(message.verdict?.signals ?? []),
        });
        void loadTracker();
      }
      if (message.type === "SUBMISSION_OUTCOME" && message.attempt) {
        setSubmissionAttempt(message.attempt);
        setStatus(message.reason || `Submission ${message.attempt.status}.`);
        if (message.attempt.status === "confirmed") void loadTracker();
      }
      if (message.type === "AUTH_STATUS") {
        setAccessState(message.status?.accessState ?? "unauthenticated");
        setAuthenticated(message.status?.accessState === "ready");
      }
    });
    return () => port.disconnect();
  }, []);

  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tabInfo]) => {
      if (!tabInfo?.id) return;
      const key = `applicationSession:${tabInfo.id}`;
      const draftKey = `applicationDraft:${tabInfo.id}`;
      const latestKey = `latestSubmissionTab:${tabInfo.id}`;
      const stored = await chrome.storage.session.get([key, draftKey, latestKey]);
      const session = stored[key] as ApplicationSession | undefined;
      if (session) {
        setApplicationSession(session);
        if (session.currentStep) setFormPlan(session.currentStep);
        if (session.status === "approved") setDraftApproved(true);
      }
      const draft = stored[draftKey] as { draftId: string; snapshot: PreSubmitSnapshot; persisted: boolean; warning?: string } | undefined;
      if (draft) setApplicationDraft(draft);
      const attemptId = stored[latestKey] as string | undefined;
      if (attemptId) {
        const attemptValues = await chrome.storage.session.get(`submissionAttempt:${attemptId}`);
        const attempt = attemptValues[`submissionAttempt:${attemptId}`] as SubmissionAttempt | undefined;
        if (attempt) setSubmissionAttempt(attempt);
      }
    }).catch(() => undefined);
  }, []);

  async function loadTracker() {
    beginPanelWork();
    try {
      const result = await chrome.runtime.sendMessage({ type: "GET_TRACKER" } satisfies ExtensionMessage).catch(() => null);
      if (result && !result.error) setTracker(result as TrackerSnapshot);
    } finally {
      endPanelWork();
    }
  }

  /**
   * The content script already computes a deterministic match analysis for job pages.
   * Pull it into panel state so the score is visible for the page being viewed, not
   * only for opportunities that were already saved to the tracker.
   */
  async function loadPageMatch() {
    beginPanelWork();
    try {
      const [tabInfo] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabInfo?.id) return;
      // Pinned to the top frame: with the content script now injected into every
      // iframe too, an unaddressed sendMessage reaches all of them and only one
      // (unpredictable) response would be returned otherwise.
      const summary = await chrome.tabs.sendMessage(tabInfo.id, { type: "GET_PAGE_SUMMARY" } satisfies ExtensionMessage, { frameId: 0 }).catch(() => null);
      setPageMatch(summary && !summary.error && summary.isJobPage ? summary as PageSummary : null);
    } finally {
      endPanelWork();
    }
  }

  function openProfileMatch() {
    if (!pageMatch) return;
    const params = new URLSearchParams({
      matchTitle: pageMatch.title || `${pageMatch.company} role`,
      matchCompany: pageMatch.company || "",
      matchDescription: pageMatch.description.slice(0, 18_000),
      matchSkills: (pageMatch.skills ?? []).slice(0, 40).join(","),
    });
    void chrome.tabs.create({ url: `${extensionConfig.webAppUrl}/profile?${params.toString()}#overview` });
  }

  async function activeTabId() {
    const [tabInfo] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabInfo?.id;
  }

  async function generate() {
    const prompt = question.trim();
    if (!prompt) return;
    beginPanelWork();
    setLoading(true); setStatus("");
    try {
      // Local memory first, then the server (which checks the saved answer library
      // before it ever calls a model). Most questions never reach the AI provider.
      const remembered = await chrome.runtime.sendMessage({ type: "FIND_ANSWER_MEMORY", question: prompt } satisfies ExtensionMessage);
      if (remembered?.item) {
        setAnswer({ answer: remembered.item.answer, source: "memory", confidence: 0.92, notice: "Matched from your saved answer memory." });
        setStatus("Matched a saved answer. Review it before inserting.");
        return;
      }
      const tokenResult = await chrome.runtime.sendMessage({ type: "GET_AUTH_TOKEN" } satisfies ExtensionMessage);
      if (!tokenResult?.accessToken) throw new Error("Sign in from the extension popup first");
      const response = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenResult.accessToken}` }, body: JSON.stringify({ question: prompt, page: active?.page, field: active?.field, selectedText: selectedText || undefined }) });
      const result = await response.json() as AnswerResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || "Request failed");
      setAnswer(result.answer ? result : null);
      if (result.notice) setStatus(result.notice);
    } catch (error) { setAnswer(null); setStatus(error instanceof Error ? error.message : "Could not generate an answer."); }
    finally { setLoading(false); endPanelWork(); }
  }

  async function useSelectedText() {
    const id = await activeTabId();
    if (!id) return;
    const result = await chrome.tabs.sendMessage(id, { type: "GET_SELECTION_TEXT" } satisfies ExtensionMessage, { frameId: 0 }).catch(() => null);
    if (!result?.text) { setStatus("Select the question or job text on the page first."); return; }
    setSelectedText(result.text);
    setQuestion(result.text);
    setAnswer(null);
    setStatus("Selected text added. Review it, then generate an answer.");
  }

  async function saveMemory() {
    if (!answer || !question.trim()) return;
    const result = await chrome.runtime.sendMessage({ type: "SAVE_ANSWER_MEMORY", item: { question: question.trim(), answer: answer.answer, source: answer.source === "ai" ? "ai" : "user" } } satisfies ExtensionMessage);
    setStatus(result?.item ? "Saved. This question now answers instantly, with no AI call." : result?.error ?? "Could not save answer memory.");
  }

  async function fetchInspection(id: number): Promise<FormStepSnapshot> {
    const result = await chrome.runtime.sendMessage({ type: "INSPECT_FORM_ALL_FRAMES", tabId: id } satisfies ExtensionMessage);
    if (!result?.authenticated || !result.snapshot) throw new Error(result?.error || "Sign in before inspecting this application.");
    return result.snapshot as FormStepSnapshot;
  }

  async function inspectApplication() {
    const id = await activeTabId();
    if (!id) return;
    beginPanelWork();
    setStatus("Inspecting every reachable frame without changing the page…");
    try {
      const snapshot = await fetchInspection(id);
      setFormPlan(snapshot);
      setTab("fields");
      const summary = summarizeFormPlan(snapshot.fields);
      setStatus(`Inspected ${summary.total} fields across ${snapshot.frames.length} frame${snapshot.frames.length === 1 ? "" : "s"}. Nothing was changed.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not inspect this application.");
    } finally {
      endPanelWork();
    }
  }

  function delay(milliseconds: number) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function publishSession(session: ApplicationSession) {
    setApplicationSession({ ...session });
    await chrome.storage.session.set({ [`applicationSession:${session.tabId}`]: session });
  }

  /**
   * Phase C orchestration. There is intentionally no Submit command anywhere in this
   * loop: it can only call the static allowlisted safe-next capability. A review or
   * submit control is a terminal observation and returns control to the user.
   */
  async function runSafeSteps() {
    const tabId = await activeTabId();
    if (!tabId) return;
    sessionCancelled.current = false;
    let session = createApplicationSession(tabId);
    setTab("fields");
    setStatus("Starting safe multi-step mode…");
    await publishSession(session);

    try {
      while (!sessionCancelled.current) {
        const budget = sessionCanContinue(session);
        if (!budget.ok) {
          session = { ...session, status: budget.status, terminalReason: budget.reason };
          await publishSession(session); setStatus(budget.reason); return;
        }

        session = { ...session, status: "observing" };
        await publishSession(session);
        const beforeFill = await fetchInspection(tabId);
        setFormPlan(beforeFill);
        // At the start of a step, only blockers/validation should stop filling. A
        // Review or Submit button means this is the final page, but its fields still
        // need to be filled and verified before control returns to the user.
        const initialStop = stopReasonForSnapshot({ ...beforeFill, navAction: { kind: "next", label: "Next", confidence: 1 } });
        if (initialStop) {
          session = { ...session, status: "awaiting_user", currentStep: beforeFill, steps: [...session.steps, beforeFill], blockers: beforeFill.blockers, terminalReason: initialStop };
          await publishSession(session); setStatus(initialStop); return;
        }
        if (beforeFill.navAction.kind === "none") {
          const reason = "No next step was found. Review the page manually.";
          session = { ...session, status: "awaiting_user", currentStep: beforeFill, blockers: beforeFill.blockers, terminalReason: reason };
          await publishSession(session); setStatus(reason); return;
        }

        session = { ...session, status: "filling", currentStep: beforeFill };
        await publishSession(session);
        const fillResult = await chrome.runtime.sendMessage({ type: "SCAN_PAGE_ALL_FRAMES", tabId, fill: true } satisfies ExtensionMessage);
        if (!fillResult?.authenticated) throw new Error("Could not fill the current step.");

        // Reinspect after writes. Newly revealed conditional fields and validation
        // errors must be handled before navigation is even considered.
        const readyStep = await fetchInspection(tabId);
        setFormPlan(readyStep);
        const stop = stopReasonForSnapshot(readyStep);
        if (stop) {
          session = { ...session, status: readyStep.navAction.kind === "submit" || readyStep.navAction.kind === "review" ? "complete" : "awaiting_user", currentStep: readyStep, steps: [...session.steps, readyStep], blockers: readyStep.blockers, terminalReason: stop };
          await publishSession(session); setStatus(stop); return;
        }

        const beforeIdentity = snapshotIdentity(readyStep);
        session = { ...session, status: "waiting_for_transition", currentStep: readyStep, lastIdentity: beforeIdentity };
        await publishSession(session);
        const advance = await chrome.runtime.sendMessage({ type: "ADVANCE_SAFE_STEP_ALL_FRAMES", tabId } satisfies ExtensionMessage);
        if (!advance?.ok) {
          const reason = advance?.detail || "No tested safe Next control is available on this portal.";
          session = { ...session, status: "blocked", blockers: [...readyStep.blockers, { kind: "unsupported_control", detail: reason }], terminalReason: reason };
          await publishSession(session); setStatus(reason); return;
        }
        session.atsId = advance.adapterId ?? session.atsId;

        const transitionDeadline = Date.now() + SESSION_LIMITS.transitionTimeoutMs;
        let nextStep: FormStepSnapshot | null = null;
        while (Date.now() < transitionDeadline && !sessionCancelled.current) {
          await delay(SESSION_LIMITS.settleIntervalMs);
          try {
            const candidate = await fetchInspection(tabId);
            if (didStepTransition(beforeIdentity, snapshotIdentity(candidate))) { nextStep = candidate; break; }
          } catch {
            // Full document navigation temporarily disconnects the content script. Keep
            // observing within the bounded transition window; never click Next again.
          }
        }
        if (sessionCancelled.current) break;
        if (!nextStep) {
          const reason = "The page did not change after the single Next click. Check validation messages; it was not clicked again.";
          session = { ...session, status: "stalled", terminalReason: reason };
          await publishSession(session); setStatus(reason); return;
        }

        session = { ...session, status: "observing", stepIndex: session.stepIndex + 1, steps: [...session.steps, readyStep], currentStep: nextStep, lastIdentity: snapshotIdentity(nextStep) };
        await publishSession(session);
        setFormPlan(nextStep);
        setStatus(`Step ${session.stepIndex + 1} reached safely. Inspecting it now…`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The application session failed.";
      session = { ...session, status: "blocked", terminalReason: reason };
      await publishSession(session); setStatus(reason);
    } finally { /* Session state remains visible in the panel. */ }
  }

  function cancelSafeSteps() {
    sessionCancelled.current = true;
    if (applicationSession) {
      const cancelled: ApplicationSession = { ...applicationSession, status: "cancelled", terminalReason: "Session cancelled by you." };
      void publishSession(cancelled);
    }
    setStatus("Safe multi-step mode cancelled.");
  }

  async function captureReviewDraft() {
    const tabId = await activeTabId();
    if (!tabId || !applicationSession) return;
    beginPanelWork();
    setStatus("Capturing a redacted review draft…");
    try {
      const result = await chrome.runtime.sendMessage({ type: "CAPTURE_APPLICATION_DRAFT", tabId, sessionId: applicationSession.sessionId } satisfies ExtensionMessage);
      if (!result?.ok || !result.snapshot || !result.draftId) { setStatus(result?.error || "Could not capture the draft."); return; }
      setApplicationDraft({ draftId: result.draftId, snapshot: result.snapshot, persisted: result.persisted === true, warning: result.warning });
      setDraftApproved(false);
      const reviewing: ApplicationSession = { ...applicationSession, status: "ready_for_review", terminalReason: "Review every captured answer before approval." };
      await publishSession(reviewing);
      setStatus(result.warning || "Draft captured. Review every answer before approving.");
    } finally {
      endPanelWork();
    }
  }

  async function approveReviewDraft() {
    if (!applicationDraft) return;
    beginPanelWork();
    setStatus("Binding approval to this exact snapshot…");
    try {
      const { snapshot, draftId } = applicationDraft;
      const result = await chrome.runtime.sendMessage({ type: "APPROVE_APPLICATION_DRAFT", draftId, sessionId: snapshot.sessionId, stepIndex: snapshot.stepIndex, snapshotHash: snapshot.snapshotHash } satisfies ExtensionMessage);
      if (!result?.ok) { setStatus(result?.error || "Could not approve this draft."); return; }
      setDraftApproved(true);
      if (applicationSession) await publishSession({ ...applicationSession, status: "approved", terminalReason: "Exact draft approved; awaiting Phase E submission." });
      setStatus(`Approved until ${new Date(result.expiresAt).toLocaleTimeString()}. Phase E will consume this approval once.`);
    } finally {
      endPanelWork();
    }
  }

  async function submitApprovedDraft() {
    if (!applicationDraft || !applicationSession || !draftApproved) return;
    const tabId = await activeTabId();
    if (!tabId || tabId !== applicationSession.tabId) { setStatus("Return to the approved application tab before submitting."); return; }
    beginPanelWork();
    setStatus("Re-checking the exact approved page before one Submit click…");
    try {
      const { snapshot, draftId } = applicationDraft;
      const response = await chrome.runtime.sendMessage({ type: "SUBMIT_APPROVED_DRAFT", tabId, draftId, sessionId: snapshot.sessionId, stepIndex: snapshot.stepIndex, snapshotHash: snapshot.snapshotHash } satisfies ExtensionMessage);
      if (!response?.ok) { setStatus(response?.error || "The approved application could not be submitted."); return; }
      setSubmissionAttempt({ attemptId: response.attemptId, sessionId: snapshot.sessionId, draftId, tabId, frameId: snapshot.submitTarget?.frameId ?? 0, snapshotHash: snapshot.snapshotHash, startedAt: Date.now(), deadlineAt: response.deadlineAt, status: "clicked", signals: [] });
      setStatus("Submit clicked once. Waiting for independent confirmation signals…");
    } finally {
      endPanelWork();
    }
  }

  /**
   * Scans (or fills) every frame of the tab, not just the top document.
   *
   * Some ATS integrations render the actual application form inside an <iframe> —
   * routing through the background worker lets it enumerate every frame via
   * `chrome.webNavigation` and merge each frame's fields into one list, so those
   * previously invisible forms are now included.
   */
  async function scan(fill: boolean) {
    const id = await activeTabId();
    if (!id) return;
    beginPanelWork();
    setStatus(fill ? "Filling fields…" : "Scanning page…");
    try {
      const result = await chrome.runtime.sendMessage({ type: "SCAN_PAGE_ALL_FRAMES", tabId: id, fill } satisfies ExtensionMessage);
      if (!result?.authenticated) { setStatus("Sign in from the extension popup to scan this page."); return; }
      const scanned: ScannedField[] = result.fields ?? [];
      setFields(scanned);
      setTab("fields");
      const filledCount = scanned.filter((item) => item.fillOutcome === "verified").length;
      const blockedCount = scanned.filter((item) => item.fillOutcome === "blocked_sensitive").length;
      const failedCount = scanned.filter((item) => ["verification_failed", "write_failed", "no_option", "ambiguous_option", "invalid_format", "out_of_range"].includes(item.fillOutcome ?? "")).length;
      setStatus(fill ? `Verified ${filledCount} field${filledCount === 1 ? "" : "s"}; ${blockedCount} sensitive blocked; ${failedCount} failed verification.` : `Detected ${scanned.length} fields on this page.`);
    } catch { setStatus("Reload the page, then scan again."); }
    finally { endPanelWork(); }
  }

  async function attachResume() {
    const id = await activeTabId();
    if (!id) return;
    beginPanelWork();
    setStatus("Fetching your resume…");
    try {
      const file = await chrome.runtime.sendMessage({ type: "GET_RESUME_FILE" } satisfies ExtensionMessage);
      if (!file || file.error) { setStatus(file?.error ?? "Could not load your resume."); return; }
      const result = await chrome.tabs.sendMessage(id, { type: "ATTACH_RESUME", fileName: file.fileName, mimeType: file.mimeType, dataUrl: file.dataUrl } satisfies ExtensionMessage, { frameId: 0 }).catch(() => null);
      setStatus(result?.ok ? `Attached ${file.fileName} to the upload field.` : result?.error ?? "Could not attach the resume.");
    } finally {
      endPanelWork();
    }
  }

  async function saveJob() {
    const id = await activeTabId();
    if (!id) return;
    beginPanelWork();
    setStatus("Saving this job…");
    try {
      const summary = await chrome.tabs.sendMessage(id, { type: "GET_PAGE_SUMMARY" } satisfies ExtensionMessage, { frameId: 0 }).catch(() => null);
      if (!summary || summary.error) { setStatus("Could not read this page. Reload and try again."); return; }
      if (summary.isJobPage !== true) { setStatus("This page does not look like a job posting. Open a job page before saving."); return; }
      const result = await chrome.runtime.sendMessage({ type: "SAVE_JOB", job: summary } satisfies ExtensionMessage);
      setStatus(result?.duplicate ? "Already saved — view it in your job tracker." : result?.ok ? "Saved to your job tracker." : result?.error ?? "Could not save this job.");
      if (result?.ok) void loadTracker();
    } finally {
      endPanelWork();
    }
  }

  async function syncNow() {
    beginPanelWork();
    setStatus("Syncing from your workspace…");
    try {
      const result = await chrome.runtime.sendMessage({ type: "REFRESH_PROFILE" } satisfies ExtensionMessage);
      if (result?.profile) { setProfile(result.profile); await loadTracker(); setStatus("Profile and tracker synced."); }
      else setStatus(result?.error ?? "Sync failed.");
    } finally {
      endPanelWork();
    }
  }

  async function insert() {
    if (!answer) return;
    const result = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_FIELD" } satisfies ExtensionMessage);
    const id = result?.activeTabId;
    // The focused field may live inside an iframe; targeting the frame it was actually
    // found in (rather than assuming the top frame) is what makes Insert work there too.
    const frameId = typeof result?.activeFrameId === "number" ? result.activeFrameId : 0;
    if (id) { await chrome.tabs.sendMessage(id, { type: "INSERT_IN_ACTIVE_FIELD", value: answer.answer } satisfies ExtensionMessage, { frameId }); setStatus("Inserted into the focused field"); }
    else setStatus("Focus a field first");
  }

  function openOnboarding() {
    void chrome.tabs.create({ url: `${extensionConfig.webAppUrl}/login?next=/onboarding` });
  }

  if (accessState !== "ready") {
    const title = accessState === "loading" ? "Checking access…" : accessState === "profile_required" ? "Create your profile first" : accessState === "unconfigured" ? "Extension setup required" : "Sign in to UplyFox";
    const description = accessState === "profile_required" ? "Your account is connected, but the assistant stays locked until you complete your verified profile." : accessState === "unconfigured" ? "This extension build is missing its secure configuration." : "Open the UplyFox extension popup and sign in to use the page assistant.";
    return <main className="panel"><header><img className="brand-mark" src="/uplyfox-pixel-crimson-logo.svg" width={36} height={36} alt="UplyFox fox" /><div><h1>UplyFox</h1><p>Page assistant</p></div><span className="ready off">LOCKED</span></header><section className="auth-banner"><strong>{title}</strong><br />{description}</section>{accessState === "profile_required" && <button className="generate" onClick={openOnboarding}>Create your profile</button>}<footer>UplyFox only reads or fills application data after authentication and profile setup.</footer></main>;
  }

  return <main className="panel">
    {panelBusy && <div className="sidepanel-fox-work" role="status" aria-live="polite"><div className="sidepanel-fox-orbit"><span /><img src="/uplyfox-pixel-crimson-animated-logo.svg" alt="" /></div><strong>UplyFox is working…</strong><small>Fetching and preparing your data</small></div>}
    <header>
      <img className="brand-mark" src="/uplyfox-pixel-crimson-logo.svg" width={36} height={36} alt="UplyFox fox" />
      <div><h1>UplyFox</h1><p>Page assistant</p></div>
      <span className={`ready ${authenticated ? "" : "off"}`}>{authenticated ? "SYNCED" : "SIGN IN"}</span>
    </header>

    {!authenticated && <section className="auth-banner">Sign in from the extension popup to connect your profile.</section>}
    {authenticated && <section className="account-banner">{accountEmail}</section>}

    {appliedToast && <section className="applied-toast">
      <div>
        <strong>Marked as applied</strong>
        <p>{appliedToast.title}</p>
        <small>{appliedToast.reason}</small>
      </div>
      <button onClick={() => {
        chrome.runtime.sendMessage({ type: "UNDO_APPLICATION", url: appliedToast.url } satisfies ExtensionMessage)
          .then(() => { setAppliedToast(null); void loadTracker(); })
          .catch(() => setAppliedToast(null));
      }}>Undo</button>
    </section>}

    <section className="page-card">
      <small>{active?.page.hostname ?? "Current page"}</small>
      <strong>{active?.page.title ?? "Focus a form field to start"}</strong>
    </section>

    {pageMatch?.matchAnalysis && <section className="match-card">
      <div className="match-head">
        <div>
          <small>Match for this role</small>
          <strong>{pageMatch.title || "Detected job posting"}</strong>
        </div>
        <span className="match-score">{pageMatch.matchAnalysis.score}%</span>
      </div>
      {pageMatch.matchAnalysis.matchedSkills.length > 0 && <div className="match-chips">
        {pageMatch.matchAnalysis.matchedSkills.slice(0, 8).map((skill) => <span className="chip matched" key={skill}>{skill}</span>)}
      </div>}
      {pageMatch.matchAnalysis.missingSkills.length > 0 && <div className="match-chips">
        {pageMatch.matchAnalysis.missingSkills.slice(0, 6).map((skill) => <span className="chip missing" key={skill}>{skill}</span>)}
      </div>}
      {pageMatch.matchAnalysis.summary && <p className="match-summary">{pageMatch.matchAnalysis.summary}</p>}
      <button className="match-profile-link" type="button" onClick={openProfileMatch}>Open this match in profile</button>
    </section>}

    <div className="quick-actions">
      <button onClick={inspectApplication}>Inspect application</button>
      <button onClick={() => scan(true)}>Fill all</button>
      {applicationSession && ["observing", "filling", "waiting_for_transition"].includes(applicationSession.status)
        ? <button className="session-cancel" onClick={cancelSafeSteps}>Stop safe steps</button>
        : <button className="session-start" onClick={runSafeSteps}>Run safe steps</button>}
      <button onClick={attachResume}>Attach resume</button>
      <button onClick={saveJob}>Save job</button>
      <button onClick={syncNow}><SyncIcon size={12} />Sync</button>
    </div>

    <nav className="tabs">
      <button className={tab === "assistant" ? "active" : ""} onClick={() => setTab("assistant")}>Assistant</button>
      <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>My data</button>
      <button className={tab === "fields" ? "active" : ""} onClick={() => setTab("fields")}>Fields{formPlan?.fields.length ? ` (${formPlan.fields.length})` : fields.length ? ` (${fields.length})` : ""}</button>
      <button className={tab === "tracker" ? "active" : ""} onClick={() => { setTab("tracker"); void loadTracker(); }}>Tracker{tracker?.total ? ` (${tracker.total})` : ""}</button>
    </nav>

    {tab === "assistant" && <>
      <div className="label-row">
        <label className="label" htmlFor="question">Question or field prompt</label>
        <div className="assistant-tools"><button className="selection-button" onClick={() => void useSelectedText()} type="button">Use selected text</button><DictationControl onText={(text) => setQuestion((current) => `${current} ${text}`.trim())} /></div>
      </div>
      <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Paste a question, focus a field on the page, or dictate…" rows={4} />
      <button className="generate" onClick={generate} disabled={loading}>{loading ? "Generating…" : "Generate answer"}</button>
      {answer && <section className="answer-card">
        <div className="answer-meta"><span>Suggested answer</span><span className={`source-tag ${answer.source}`}>{answer.source}</span></div>
        <p>{answer.answer}</p>
        <div className="actions">
          <CopyButton value={answer.answer} label="Copy answer" />
          <button onClick={insert}><InsertIcon />Insert</button>
          <button onClick={saveMemory}><SaveIcon />Save</button>
        </div>
      </section>}
    </>}

    {tab === "profile" && <ProfileTab profile={profile} />}

    {tab === "fields" && <div className="tab-body form-plan">
      {formPlan ? (() => {
        const summary = summarizeFormPlan(formPlan.fields);
        return <>
          {applicationSession && <div className={`session-status ${applicationSession.status}`}>
            <div><small>Safe multi-step mode</small><strong>{applicationSession.status.replace(/_/g, " ")}</strong></div>
            <span>Step {applicationSession.stepIndex + 1} / {applicationSession.maxSteps}</span>
            {applicationSession.terminalReason && <p>{applicationSession.terminalReason}</p>}
          </div>}
          {applicationSession && (formPlan.navAction.kind === "submit" || formPlan.navAction.kind === "review") && !applicationDraft && <button className="capture-draft-button" type="button" onClick={captureReviewDraft}>Capture review draft</button>}
          {applicationDraft && <section className="draft-review">
            <div className="draft-review-head"><div><small>Pre-submit draft</small><strong>{applicationDraft.snapshot.job.title || "Application"}</strong><span>{applicationDraft.snapshot.job.company}</span></div><b>{applicationDraft.persisted ? "Saved" : "Local only"}</b></div>
            {applicationDraft.warning && <p className="draft-warning">{applicationDraft.warning}</p>}
            {applicationDraft.snapshot.steps.map((step) => <details className="draft-step" open key={step.stepKey}>
              <summary>{step.heading || `Step ${step.index + 1}`} <span>{step.answers.length} fields</span></summary>
              {step.answers.map((answer) => <div className={`draft-answer ${answer.redacted ? "redacted" : answer.needsReview ? "review" : ""}`} key={answer.fieldId}>
                <div><strong>{answer.question}</strong><small>{answer.source} · {Math.round(answer.confidence * 100)}%{answer.sensitive ? " · sensitive" : ""}</small></div>
                <p>{answer.redacted ? "Redacted — never stored" : Array.isArray(answer.value) ? answer.value.join(", ") : answer.value || answer.blankReason || "Blank"}</p>
              </div>)}
            </details>)}
            <div className="draft-audit"><span>{applicationDraft.snapshot.blankFields.length} blank/redacted</span><span>{applicationDraft.snapshot.frames.length} frames</span><code title={applicationDraft.snapshot.snapshotHash}>{applicationDraft.snapshot.snapshotHash.slice(0, 12)}…</code></div>
            <p className="draft-disclaimer">Approval is bound to this exact hash. If the page changes, it cannot be reused.</p>
            {!applicationDraft.snapshot.submitTarget && <p className="draft-warning">No exact native Submit control was captured. Continue to the final submit page manually, then capture again.</p>}
            {draftApproved ? <div className="approved-actions"><div className="draft-approved">✓ Exact draft approved</div><button className="final-submit-button" type="button" disabled={Boolean(submissionAttempt)} onClick={submitApprovedDraft}>Re-check and submit this exact application</button></div> : <button className="approve-draft-button" type="button" disabled={!applicationDraft.persisted || !applicationDraft.snapshot.submitTarget || applicationDraft.snapshot.steps.some((step) => step.blockers.length > 0 || step.validationErrors.length > 0 || step.answers.some((answer) => answer.redacted))} onClick={approveReviewDraft}>I reviewed every answer — approve</button>}
            {submissionAttempt && <div className={`submission-outcome ${submissionAttempt.status}`}><strong>{submissionAttempt.status === "confirmed" ? "Submission confirmed" : submissionAttempt.status === "unknown" ? "Confirmation unknown" : submissionAttempt.status === "failed" ? "Submission failed" : "Waiting for confirmation"}</strong><small>{submissionAttempt.status === "confirmed" ? "The tracker was moved to Applied." : submissionAttempt.status === "unknown" ? "The tracker remains Applying. Check the portal before trying again." : submissionAttempt.status === "failed" ? submissionAttempt.errorReason || "The portal reported a failure." : "UplyFox requires two independent success signals."}</small></div>}
          </section>}
          <div className="plan-summary">
            <div><strong>{summary.total}</strong><span>Total</span></div>
            <div className="resolved"><strong>{summary.resolved}</strong><span>Ready</span></div>
            <div className="unknown"><strong>{summary.unknown}</strong><span>Unknown</span></div>
            <div className="blocked"><strong>{summary.blocked}</strong><span>Blocked</span></div>
          </div>
          <div className="plan-step-meta">
            <div><small>Current step</small><strong>{formPlan.heading || "Application form"}</strong></div>
            <span className={`nav-kind ${formPlan.navAction.kind}`}>{formPlan.navAction.kind === "none" ? "No next action" : `${formPlan.navAction.kind}: ${formPlan.navAction.label}`}</span>
          </div>
          {summary.requiredUnknown > 0 && <p className="plan-warning">{summary.requiredUnknown} required field{summary.requiredUnknown === 1 ? "" : "s"} need an answer before this step can continue.</p>}
          {formPlan.blockers.length > 0 && <details className="plan-blockers" open>
            <summary>Blockers ({formPlan.blockers.length})</summary>
            <ul>{formPlan.blockers.map((blocker, index) => <li key={`${blocker.kind}-${index}`}>{blocker.detail}</li>)}</ul>
          </details>}
          <h2>Field plan</h2>
          {formPlan.fields.length === 0 && <p className="empty">No application fields were found in reachable frames.</p>}
          {formPlan.fields.map(({ descriptor, resolution }) => <article className={`plan-field ${resolution.state}`} key={descriptor.id}>
            <div className="plan-field-head">
              <div><strong>{descriptor.question || descriptor.label || "Field"}{descriptor.required && <em>required</em>}</strong><small>{descriptor.elementType} · {descriptor.questionSource} · frame {descriptor.frameId}</small></div>
              <span className={`resolution-badge ${resolution.state}`}>{resolution.state}</span>
            </div>
            {descriptor.currentValue && <div className="plan-value current"><small>On page</small><span>{Array.isArray(descriptor.currentValue) ? descriptor.currentValue.join(", ") : descriptor.currentValue}</span></div>}
            {resolution.value && <div className="plan-value proposed"><small>Would use · {resolution.source} · {Math.round(resolution.confidence * 100)}%</small><span>{Array.isArray(resolution.value) ? resolution.value.join(", ") : resolution.value}</span></div>}
            {descriptor.options.length > 0 && <div className="plan-options">{descriptor.options.slice(0, 8).map((option) => <span className={option.selected ? "selected" : ""} key={`${descriptor.id}-${option.label}`}>{option.label}</span>)}</div>}
            {resolution.reason && <p>{resolution.reason}</p>}
          </article>)}
          <details className="frame-report"><summary>Frames inspected ({formPlan.frames.length})</summary>{formPlan.frames.map((frame) => <div key={frame.frameId}><span>{frame.status === "scanned" ? "✓" : "!"} Frame {frame.frameId}</span><small>{frame.fieldCount} fields · {frame.origin || frame.url || "embedded frame"}</small></div>)}</details>
          <small className="readonly-note">Read-only inspection · no fields were changed</small>
        </>;
      })() : fields.length === 0 ? <p className="empty">Run “Inspect application” to build a complete read-only field plan.</p> : fields.map((field) => <div className="field-row" key={field.index}>
        <div className="field-row-text"><strong>{field.label || field.question || "Field"}</strong><small>{field.kind} · {(field.fillOutcome ?? (field.filled ? "verified" : field.value ? "ready" : "no value")).replace(/_/g, " ")}</small></div>
        {field.value && <CopyButton value={field.value} label="Copy value" />}
      </div>)}
    </div>}

    {tab === "tracker" && <TrackerTab tracker={tracker} onRefresh={loadTracker} />}

    {status && <p className="status">{status}</p>}
    <footer>Autofill is confidence-aware. Review sensitive answers before submitting.</footer>
  </main>;
}

createRoot(document.getElementById("root")!).render(<SidePanel />);
