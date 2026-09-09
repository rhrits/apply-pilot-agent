# UplyFox Auto-Apply Agent — Plan

**Status:** Phases A–D shipped; Phase E pending
**Date:** 2026-09-09
**Supersedes:** the "explicitly out of scope" line on auto-submission in [UPLYFOX-V2-PLAN.md](UPLYFOX-V2-PLAN.md) — see §2.

---

## 1. The requested behaviour

Restated as a specification:

1. Extract everything available from the page (and console/network) for the open application.
2. Scan every field across the whole form, including fields not yet visible.
3. Fill what the profile already knows.
4. Identify the fields the profile does **not** know.
5. Find truthful answers for those unknowns.
6. Fill everything.
7. If the form has further steps, advance through them.
8. **Before submitting, draft the complete application, save it, and ask the user to confirm.**
9. On confirmation, submit.

Step 8 is the load-bearing requirement, and it is what makes this buildable. The rest of this
document treats it as an architectural constraint rather than a UI step.

---

## 2. The scope conflict, and how it resolves

[UPLYFOX-V2-PLAN.md](UPLYFOX-V2-PLAN.md) §7 currently says:

> Auto-submission of applications, LinkedIn scraping, and bulk/blind apply. These conflict
> with the product's core promise that the user reviews and confirms every submission.

The request does **not** actually conflict with that promise, because it keeps the human
confirmation gate. What changes is the amount of work done *before* the gate — currently the
user fills and reviews; afterwards the agent fills and the user reviews.

So the scope line should be amended, not deleted:

| Was out of scope | Now | Reason |
|---|---|---|
| Auto-submission | **In scope, behind a mandatory confirmation gate** | The user still approves every submission. |
| Bulk / blind apply | **Still out of scope** | Removes the review gate by definition. |
| LinkedIn automation | **Still out of scope** | Explicitly prohibited by contract — see §8.1. |

The distinguishing property is not "does a machine click submit" but "did a human see the exact
thing being submitted, and approve it". That property must be enforced by structure, not by
policy — see §5.4.

---

## 3. What the research actually found

Full digest gathered 2026-09-09. Sources inline.

### 3.1 The market splits cleanly in two

| Product | Submits automatically? |
|---|---|
| Simplify Copilot, Huntr, Careerflow, Teal | **No** — autofill, user submits |
| Jobscan Auto Apply | Hybrid — *"You review every one before it's sent."* |
| JobCopilot | Both modes; extension mode stops before submit |
| AIApply | Both modes |
| LazyApply, Sonara | **Yes** — full auto-submit |

The tools with the strongest reputations sit on the left. Jobscan's public copy is the clearest
statement of the pattern this plan adopts.

### 3.2 The hard parts are not the standard fields

From reading Skyvern, Browser Use, and four open-source LinkedIn bots, the difficulty is
concentrated in:

- React/Angular controlled inputs that ignore naive DOM assignment
- Custom comboboxes and typeaheads that are not `<select>`
- Conditional fields that appear only after an earlier answer
- Multi-page forms where the DOM is replaced between steps
- Cross-origin iframes and closed Shadow DOM
- CAPTCHA and bot challenges
- **Determining whether a submit click actually succeeded**

### 3.3 The most valuable technique found: Skyvern's field/execution split

[Skyvern](https://github.com/Skyvern-AI/skyvern) separates mapping from execution:

1. Extract every field descriptor **without an LLM**
2. Send all fields + candidate data to the model **once**
3. Receive a field→value mapping
4. Validate the mapping
5. Execute deterministically
6. Use AI fallback only for fields that failed

This is much better than the browser-agent loop of "screenshot → decide one action → repeat",
because it is cheaper, auditable, reproducible, and does not re-discover the form on every field.
**This plan adopts it.**

### 3.4 Skyvern's multi-page loop and page-transition predicate

A wizard cannot be modelled as one DOM snapshot. Skyvern's `fill_multipage_form()` also proves
that "click Next until no Next exists" is insufficient. It stops when:

- there are no fillable fields, or the next button is missing
- a page/time limit is hit
- **the field signature does not change after clicking Next** (silent validation failure)
- validation errors persist across attempts

And the transition predicate must be a disjunction, because many ATS wizards never change URL:

```
transitioned = URL changed
            OR visible heading changed
            OR field signature changed
            OR step marker changed
            OR the prior form subtree was replaced
```

### 3.5 Skyvern's pre-submit capture ring

Skyvern captures the page state *before* the submit action — serialized inert form HTML,
screenshot, filled-field count, iframe count, URL — while masking passwords, file values, and
hidden fields.

This exists because **after submission the form is gone**. It is the right answer to the user's
"draft the page and all fields and save" requirement, and it doubles as the audit record.

### 3.6 The candid failure report

[LuisMIguelFurlanettoSousa/auto-apply-bot](https://github.com/LuisMIguelFurlanettoSousa/auto-apply-bot)
is unusually honest and worth quoting as a design input. It reports that Cloudflare, reCAPTCHA,
Turnstile, and hCaptcha frequently block it *before* the application; that CAPTCHA solving is not
automated and the user is notified to solve it manually; that real end-to-end submissions were
never validated; and that `DRY_RUN=true` is recommended.

Its most important observation: it has a submission checkpoint, but concedes that
**an LLM-controlled browser click is not a physically enforceable barrier.** That directly
motivates §5.4.

### 3.7 What could not be verified

Stated plainly, because it affects planning:

- Reddit and several review sites returned anti-bot responses, so **no reliable data on ban rates
  or product error rates** was obtained. Complaint frequency should not be quoted numerically.
- Greenhouse's candidate-facing terms could not be retrieved. **Do not claim Greenhouse permits or
  prohibits auto-submit.**
- No credible study was found showing employers reject applications *because* they were
  auto-submitted. Vendor claims like "80% more interviews" are not audited.

---

## 4. What UplyFox already has

This is a smaller build than it looks, because much of the substrate exists.

| Capability | Where | Reusable? |
|---|---|---|
| Field extraction with W3C accname ordering | [field-detector.ts](../apps/extension/src/lib/field-detector.ts) | Yes — extend to descriptors |
| ATS adapters (Greenhouse, Lever, Workday, Ashby, Google Forms) | same | Yes — extend per §6.2 |
| React-safe value insertion via native setter | [insertion.ts](../apps/extension/src/lib/insertion.ts) | Yes — extend for widgets |
| Shadow-DOM traversal (`queryDeep`) | [content.ts](../apps/extension/src/content.ts) | Yes |
| Grounded answer engine + fact retrieval | [fact-retrieval.ts](../packages/shared/src/fact-retrieval.ts) | Yes — this is the unknown-field answerer |
| Answer library / memory | [memory.ts](../apps/extension/src/lib/memory.ts) | Yes — becomes the Q&A cache |
| Submission detection (5 fused signals) | [application-detector.ts](../packages/shared/src/application-detector.ts) | **Yes — becomes the confirmation detector** |
| MAIN-world network observer | [network-observer.ts](../apps/extension/src/network-observer.ts) | Yes — extend for validation responses |
| Unknown-question capture | [unknown-questions.ts](../apps/extension/src/lib/unknown-questions.ts) | Yes |

The P3 detector is especially valuable here: it was built to *observe* submissions, and the same
signal fusion answers "did the submit actually work" in step 9.

### 4.1 On extracting from the console

The request mentions reading the console. This should be dropped, for three reasons:

1. Reading page console output requires `chrome.debugger`, which **detaches DevTools and shows a
   persistent "UplyFox started debugging this browser" banner** on every application page.
2. Console output is overwhelmingly framework noise; ATS forms do not log their schema.
3. Everything actually wanted from "the console" — validation failures, submission results — is
   available more reliably from the **network layer** the extension already observes, plus
   `aria-invalid` / `role=alert` in the DOM.

**Recommendation:** extract from DOM + accessibility tree + network. Skip the console. If a
specific portal proves to need it, revisit with evidence.

---

## 5. Architecture

### 5.1 Model the application as a session, not a page

```
ApplicationSession
  id, jobUrl, ats, startedAt
  mode: observe | autofill | step | review_before_submit
  status: scanning | filling | blocked | awaiting_user | ready_for_review | submitting | submitted | failed
  steps: ApplicationStep[]
  blockers: Blocker[]          // captcha, closed shadow DOM, upload failure, unknown required field
  evidence: PreSubmitSnapshot  // §5.3
```

```
ApplicationStep
  index, heading, fieldSignature
  fields: FieldDescriptor[]
  values: Record<fieldId, FilledValue>
  validationErrors: ValidationError[]
  navAction: next | review | submit | none
```

```
FilledValue
  value
  source: profile | answer_library | ai | user
  confidence
  requiresConfirmation: boolean   // §5.5
```

`source` and `confidence` on every value are what make the review screen honest.

### 5.2 The per-step loop

Adapted from Skyvern, with UplyFox's existing pieces:

```
1  wait for settle
2  extract descriptors      (field-detector, extended; no LLM)
3  compute field signature
4  resolve values:
     a. answer library exact/semantic hit
     b. profile fact retrieval
     c. AI generation           → marked source=ai
     d. unresolved              → blocker
5  fill deterministically     (insertion.ts, extended)
6  re-scan for revealed fields; fill those
7  read validation errors
8  if blockers or sensitive answers  → pause, ask user
9  classify nav action
10 click it
11 assert transition (§3.4 predicate)
12 if signature unchanged → treat as validation failure, do not retry blindly
```

### 5.3 The draft — "save before submit"

On reaching the final step, before any submit click, persist a `PreSubmitSnapshot`:

- job identity, URL, detected ATS
- every question and answer, grouped by step, each with `source` + `confidence`
- resume filename and version actually attached
- fields deliberately left blank
- serialized **inert** form HTML + screenshot
- the exact element that would be clicked to submit

Masked before storage: passwords, file blobs, hidden inputs, anything matching secret patterns.

This is the user's "draft the page and all fields and save", and it is also the audit record if an
employer later asks what was submitted.

### 5.4 The confirmation gate must be structural

This is the most important decision in the plan.

A prompt that the agent *chooses* to honour is not a gate — the auto-apply-bot project ran into
exactly this. Enforce it by **capability separation**:

- The content script that fills fields **has no code path that clicks a submit control.**
- Submission is a separate function, callable only by the background worker.
- The background worker requires a **one-time token** minted only by the review UI when the user
  clicks Approve.
- The token is bound to `{sessionId, stepIndex, snapshotHash}` and is single-use.
- If the page changed after approval, `snapshotHash` mismatches and submission is refused.

That last point matters: it prevents approving one thing and submitting another.

No LLM output can produce a valid token. The model cannot talk its way past this, because the
capability simply does not exist in the world it runs in.

### 5.5 Never auto-answer these

Hard stop — require a stored explicit answer or ask the user. Never infer, never default:

work authorization · visa sponsorship · criminal history · disability · veteran status ·
race/ethnicity · gender · salary and compensation · security clearance · citizenship ·
professional licensing · relocation commitment · **any "I certify that…" attestation**

The open-source LinkedIn bots default to "Yes", "No", or the last option when unsure. On these
categories that is not a bug in tuning — it is filling in a legal declaration on someone's behalf.

### 5.6 CAPTCHA policy

Detect → stop → tell the user which portal is blocked → keep the session open → user solves it in
their own browser → re-observe → continue only if the challenge is gone and form state survived.

**Never** automate solving, never route to a solving service, never extract tokens. hCaptcha's
terms prohibit using AI to complete tasks requiring human intelligence, and this is not a place to
be clever.

---

## 6. Delivery phases

### Phase A — Full-form scan and plan (no writes) ✅ shipped

New `packages/shared/src/form-graph.ts`:

- `FieldDescriptor` — label, name, placeholder, role, type, options, required, current value,
  format hints, frame id, shadow path, selector
- `extractDescriptors(root)` — extends existing detection to descriptors, traverses open shadow
  roots and same-origin frames, records a **frame registry**
- `fieldSignature(fields)` — the transition/stall primitive from §3.4
- `classifyNavAction(buttons)` — next / review / submit / none

Deliverable: side panel shows every field, what would fill it, its source, and what is unknown.
**Nothing is written to the page.** This alone is useful and ships independently.

#### Phase A implementation — 2026-09-09

- Added the pure, serializable form graph in `packages/shared/src/form-graph.ts`: field/options,
  resolution source and confidence, validation errors, frames, blockers, navigation classification,
  deterministic field signatures, and summary counters.
- Added a read-only deep inspector in the extension content script. It scans native fields,
  grouped radio/checkbox controls, ARIA choices, open Shadow DOM, mounted hidden fields, field
  constraints, existing values, native/ARIA validation errors, alert banners, navigation controls,
  and CAPTCHA markers. It does not dispatch input/click/change events.
- Added background aggregation across every reachable frame. Inaccessible cross-origin or blocked
  frames are preserved as explicit `unavailable_frame` blockers rather than silently discarded.
- Added **Inspect application** to the side panel. It shows total/ready/unknown/blocked counts,
  required unknowns, current and proposed values, profile source and confidence, options, detected
  next/review/submit action, frame report, validation errors, and blockers.
- Kept **Fill all** as the existing manual deterministic action; it is visually and architecturally
  separate from the read-only inspector. Phase A itself performs no writes.
- Added nine pure form-graph tests. Extension suite: 94 tests green at shipment.

### Phase B — Deterministic fill with confidence ✅ shipped

Extend [insertion.ts](../apps/extension/src/lib/insertion.ts) — the native-setter path is already
correct — to cover:

- radio groups and checkbox groups (including ARIA-role versions)
- comboboxes/typeaheads: focus → type → wait for listbox → match option → keyboard select
- date inputs and their format hints
- `<select>` matching by option text *and* value (already partly present)
- **verified writes**: re-read after filling; a control that did not take the value is a failure,
  not a success

Then `packages/shared/src/field-resolution.ts`: library → profile facts → AI → unresolved, with the
§5.5 hard-stop list applied before anything is written.

#### Phase B implementation — 2026-09-09

- Added `packages/shared/src/field-resolution.ts`, used by both inspection and filling so the plan
  can no longer say “Ready” while Fill all follows a different confidence rule. Resolution order is
  hard stop → unambiguous saved answer → structured profile engine → review-only AI → unknown.
- Preserved real answer confidence from the profile engine instead of substituting question-detection
  confidence. Existing page values are represented as `source=user`; saved answers preserve their
  semantic-match confidence as `source=answer_library`.
- Expanded the hard-stop policy to authorization, sponsorship, citizenship, compensation,
  relocation, licensing, protected demographic data, criminal history, consent, and attestations.
  Neither a saved answer nor an AI answer can bypass this check.
- Added date, datetime-local, month, week, and time field detection. Writers accept only canonical,
  browser-valid values; locale-ambiguous dates are rejected rather than guessed.
- Added verified asynchronous writers for inputs, textareas, contenteditable fields, native selects,
  native/ARIA radio and checkbox controls, and custom ARIA combobox/typeahead widgets. Every write is
  read back after framework event handling; a React rerender that restores the old value is reported
  as `verification_failed`, never “filled”.
- Fixed native checkbox double-toggle (the old setter + events + click sequence could turn it on and
  immediately back off). Disabled choices and ARIA widgets that ignore clicks now fail verification.
- Native selects now match exact values first, then conservative option-label matching, while ignoring
  disabled and placeholder options.
- Custom comboboxes use a bounded sequence: focus → framework-safe input → wait for the controlled
  listbox → match one option → click it → verify selected/value state. The writer never presses Enter,
  because Enter without a proven open listbox can submit the surrounding form.
- Fill all now reports verified, already-filled, skipped-low-confidence, blocked-sensitive,
  unresolved, ambiguous-option, invalid-format, and verification-failed outcomes per field. AI answers
  remain manual until the Phase D review gate exists.
- Added 21 Phase B regression tests. Extension suite: 115 tests green at shipment.

### Phase C — Multi-step navigation ✅ shipped

`apps/extension/src/lib/application-session.ts` implementing §5.2, plus per-ATS adapters extending
the existing ones with: next/review/submit selectors, validation selectors, step markers, success
selectors, known custom widgets, and known-unsupported states.

Bounded by max steps, wall-clock timeout, and a stall detector. A stall is reported, not retried.

#### Phase C implementation — 2026-09-09

- Added `apps/extension/src/lib/application-session.ts`, a persisted bounded session model with a
  12-step maximum, five-minute wall-clock limit, six-second transition window, one click per step,
  explicit blocked/stalled/timed-out/cancelled/complete states, and a transition predicate combining
  URL, heading, field signature, and step marker changes.
- Added a strict static ATS navigation allowlist for Workday, Greenhouse, Ashby, SmartRecruiters, and
  iCIMS. Unknown portals remain inspect/fill-only. Eligibility requires an extension-owned selector,
  a native enabled `button` whose effective type is exactly `button`, and a label with no
  submit/apply/send/finish/complete/review wording.
- Added one narrowly scoped `ADVANCE_SAFE_STEP_FRAME` capability. It accepts no page/LLM-provided
  selector, has no submit variant, rejects current validation errors, and clicks exactly once.
  Frames are tried sequentially so two embedded forms can never both advance.
- Added **Run safe steps** and **Stop safe steps** to the side panel. The loop inspects, resolves,
  verified-fills, reinspects conditional fields, stops on required unknowns/CAPTCHA/validation or
  inaccessible frames, advances one allowlisted Next control, and waits for independent transition
  proof. A stall is never retried automatically.
- Final Review/Submit pages are filled and verified first, then treated as terminal observations.
  Phase C contains no Submit message, handler, selector, requestSubmit call, or form-submit
  capability. Closing the side panel safely pauses foreground orchestration; persisted session state,
  current step, blockers, and terminal reason are restored when it reopens.
- Added ten Phase C state-machine and navigation-policy tests. Extension suite: 125 tests green at
  shipment.

### Phase D — Draft, review, approve ✅ shipped

- `PreSubmitSnapshot` capture and storage (§5.3)
- Review screen: every answer grouped by step, `source` badge, confidence, blanks, AI-generated
  answers highlighted, sensitive answers called out
- Controls: edit · save for this question · save for this question type · exclude · approve
- The capability token (§5.4)

#### Phase D implementation — 2026-09-09

- Added `packages/shared/src/application-snapshot.ts`: immutable answer/step/frame snapshots,
  secret detection, answer redaction, canonical SHA-256 hashing, ten-minute approval grants, and
  exact session/draft/step/hash/expiry/consumption validation.
- Added frame-local inert HTML capture. It chooses the largest visible form root, projects live
  non-secret control state into a clone, removes hidden fields, redacts password/file/token/OTP/
  banking/card/SSN-like values, strips scripts/iframes/media/SVG/MathML/templates, removes event and
  external URL/action/style attributes, disables controls, converts the form to a plain section,
  and enforces a 120 KB bound.
- Visible-tab screenshots are captured only when every frame reports the viewport safe. A password,
  file, hidden-secret, or secret-like field suppresses screenshot capture rather than uploading
  unredacted pixels. Screenshots are viewport-only and stored in the private
  `application-evidence` bucket.
- Added migration `202609090005_application_drafts.sql` with user-owned RLS for sessions/drafts,
  immutable snapshot hashes, approval expiry/consumption fields, indexes, and a private evidence
  bucket policy. Account deletion now removes both evidence objects and draft/session rows.
- Added **Capture review draft** at the final Review/Submit boundary. The side panel groups every
  answer by step and displays value, source, confidence, review/sensitive status, blank/redacted
  count, frame count, persistence state, and the snapshot-hash prefix. Raw HTML is never placed in
  extension session storage or rendered in the panel.
- Approval is enabled only after durable Supabase persistence. The background revalidates the exact
  locally held session/draft/step/hash tuple, updates the matching unapproved database row, then
  mints a random single-use ten-minute grant bound to that same tuple. The grant is extension-local,
  never sent to the page or stored remotely. Phase E must consume it.
- Normal sign-out now clears application sessions, review drafts, active frame identity, and approval
  grants, preventing cross-account review-state leakage.
- Added seven Phase D snapshot/redaction/hash/approval tests. Extension suite: 132 tests green at
  shipment.

### Phase E — Submit and confirm

- Submission executes only with a valid token
- **Reuse the P3 detector** to confirm: URL confirmation, DOM confirmation, network response,
  success heading, application ID
- No confirmation found → record `submission_state = unknown`, **never** `submitted`
- Write the tracker row with the snapshot attached

---

## 7. Schema

```sql
create table public.application_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  url text not null,
  ats text,
  mode text not null,
  status text not null,
  blockers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The draft. Retained after submission because the live form will not be.
create table public.application_drafts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.application_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  step_index integer not null,
  answers jsonb not null,          -- question, value, source, confidence
  form_html text,                  -- inert, sanitized
  screenshot_path text,            -- private bucket
  approved_at timestamptz,
  snapshot_hash text not null,     -- binds approval to exact content (§5.4)
  created_at timestamptz not null default now()
);
```

RLS on both, matching existing tables. Screenshots go to a private bucket with signed URLs, like
[resume-store.ts](../apps/web/lib/resume-store.ts).

---

## 8. Risks

### 8.1 Contractual — the highest risk, and it is not technical

**LinkedIn** ([User Agreement](https://www.linkedin.com/legal/user-agreement)) prohibits:

> "Develop, support or use software, devices, scripts, robots or any other means or processes
> (such as crawlers, browser plugins and add-ons or any other technology) to scrape or copy the
> Services…"

and separately: *"Use bots or other unauthorized automated methods to access the Services."*
LinkedIn may *"restrict, suspend, or terminate your account."*

**Workday** ([Terms](https://www.workday.com/en-us/legal/site-terms.html)) prohibits data-gathering
robots and *"Develop or use any applications that interact with our Sites without our prior
written consent."*

Consequences:

- **LinkedIn Easy Apply automation stays out of scope.** Not "later" — out.
- Workday support carries real risk; it should be opt-in with the risk stated plainly to the user.
- "Human-like delays" and fingerprint tricks do not create permission. They are evidence of intent
  to evade, and this product will not ship them.
- **The user bears the account risk.** They must be told which portals are risky before enabling
  anything, not buried in a settings tooltip.

### 8.2 Technical

| Risk | Mitigation |
|---|---|
| **MV3 cannot set a file input from a local path** | Chrome protects local paths by design. Use the already-working `DataTransfer` path from [content.ts](../apps/extension/src/content.ts) `attachResume`, then **verify** `files.length`, the filename in the UI, and the portal's success state. If unverified → blocker, ask the user. |
| Closed Shadow DOM | Undetectable by design. Detect the host, mark the form partially unsupported, ask for user assistance. Do not guess. |
| Cross-origin iframes | Frame registry; inject where permitted; otherwise blocker. |
| Silent validation failure | Field-signature stall detection (§3.4); never blind-retry. |
| Duplicate submission | Idempotency on `{user, jobUrl}`; single-use token; check tracker before starting. |
| Wrong answer submitted | Hard-stop categories, source/confidence on every value, mandatory review. |
| CAPTCHA | §5.6 — pause and hand to the user. |

### 8.3 Product

Employers are seeing roughly double the applicants per role since 2022
([LinkedIn research, 2026](https://news.linkedin.com/2026/LinkedIn-Research-Talent-2026)), and 93%
of recruiters plan to increase AI use. A tool that makes low-quality applications faster makes the
problem worse for its own users. The differentiator must remain **grounded, truthful, reviewed**
applications — which is why bulk apply stays out of scope even though the machinery would support
it.

---

## 9. Telemetry

No public denominator exists for failure rates (§3.7), so measure our own from day one:
form abandonment · unknown required fields · validation loops · CAPTCHA rate · upload failure ·
submission-confirmation failure · duplicate submissions · user correction rate · answers later
marked wrong.

The correction rate is the quality signal that matters: it says how often the agent was about to
submit something the user disagreed with.

---

## 10. Recommendation

Build **Phase A first and ship it alone.** A complete, accurate, read-only scan showing what would
be filled — and what is unknown — is independently valuable, is zero-risk, and validates the
extraction layer against real ATS forms before any code writes to a page.

The phases most likely to be wrong on first contact with real portals are C (navigation) and the
file upload in B. Both should meet real Greenhouse/Lever/Ashby forms early.

Do not start Phase E until A–D are proven on at least ten real applications in dry-run.
