# UplyFox v2 — Comprehensive Product & Engineering Plan

Status: proposal · Owner: Hritik · Created 2026-09-09

This document combines (a) competitor research, (b) evidence-based root-cause analysis of
every reported defect, and (c) a phased plan to rebuild the profile, resume, suggestion,
match-score and application-tracking subsystems on a substantially more advanced
architecture.

Every "why it breaks" claim below is traced to a real file and line in this repository.

---

## 1. Competitive landscape

| Product | What they do well | Their technical approach | Where we can beat them |
|---|---|---|---|
| **Simplify Copilot** | Highest-quality autofill across Workday/Greenhouse/Lever/Ashby. Auto-detects when you apply and files it in a tracker. | Per-ATS adapters + a strong generic fallback. Detects submit/apply events and job-board URL patterns to auto-create tracker entries. | We ground every answer in verified facts and *say when we don't know*. Simplify will happily fill weak generic text. |
| **Teal** | Best-in-class tracker + resume tailoring + match score vs. job description. | Bookmarklet/extension saves the JD text, then keyword-matches JD vs. resume and shows a % match with missing keywords. | Our match score is already deterministic and explainable — we just never show it on the live page. |
| **Huntr** | Clean kanban tracker, auto-scrapes job metadata on save. | Content-script scraping with site-specific selectors + JSON-LD `JobPosting`. | We already parse JSON-LD; we need their "save = one click, from anywhere" reliability. |
| **Jobscan** | ATS keyword scoring, resume optimization. | Static resume vs JD keyword/n-gram analysis. | We can do live, in-form scoring instead of a separate upload step. |
| **LazyApply / Sonara / AIHawk** | Volume auto-apply. | Blind bulk submission. | Explicitly *not* our model. Our differentiator is never auto-submitting and never inventing facts. |

### The three technical lessons that matter most

1. **Never trust `placeholder` as the question.** Every serious autofill product resolves the
   field's *accessible name* using the W3C `accname` algorithm ordering
   (`aria-labelledby` → `aria-label` → `<label for>` → … → `placeholder` **last**, and
   `title` after that). Our current code puts `placeholder` *third*, above raw `aria-label`,
   which is why Google Forms yields `"Your answer"`.
2. **Applications must be detected, not typed in by hand.** Simplify/Huntr win because the
   tracker fills itself. That requires observing the actual apply action (button click,
   form submit, network POST, URL/DOM confirmation state) — none of which we do today.
3. **Resume must be a stored artifact, not a one-shot parse.** Every competitor keeps the
   original file so it can be re-attached to file inputs and re-parsed later. We currently
   throw the binary away.

---

## 2. Root-cause analysis of reported defects

### 2.1 Resume PDF is never stored (blocks extension attach)

The upload path reads the file into memory, parses it, and drops the binary.

`apps/web/app/api/resume/analyze/route.ts` converts the upload to a Buffer for `pdf-parse`
and **never calls Supabase Storage**:

```ts
if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
  const parsed = await pdfParse(Buffer.from(await file.arrayBuffer()));
  text = parsed.text;
}
```

Meanwhile the extension's `fetchResumeFile()` in `apps/extension/src/lib/supabase.ts`
requires a row in `public.resumes` **with a `storage_path`**:

```ts
const resume = resumes?.[0];
if (!resume?.storage_path) {
  return { error: "Upload a resume on the profile page first." };
}
```

Onboarding writes to `profiles.resume_text` / `profiles.resume_profile` /
`profile_signals` — never to `public.resumes`, and never to the `resumes` bucket.

**That is the exact bug**: the user uploads in onboarding, the extension looks in a
different place, finds nothing, and prints a message pointing at a page that also doesn't
store the file. The `resumes` table and the private `resumes` bucket already exist
(`supabase/migrations/202609080002_resume_and_job_tracker.sql`) — they are simply unused.

Additionally, the profile page's `commitProfile()` call omits `resumeText`/`resumeProfile`,
so re-importing on the profile page doesn't persist the extraction either.

### 2.2 Resume extraction quality

`apps/web/app/api/resume/analyze/route.ts` is a line-oriented heuristic parser over
`pdf-parse` plain text. It has no access to glyph coordinates, so:

- **Multi-column resumes interleave.** A right-column skills heading lands in the middle of
  a job entry, corrupting role boundaries.
- **Headers/footers are never stripped.** Page numbers and emails become "skills" or
  "achievements".
- **Bullet detection is narrow**: `/^[-*•–—]\s+/` misses `◦ ▪ ▸ →` and glyphs emitted
  without trailing whitespace.
- **Date regex is narrow**: it requires a 4-digit year or `present|current`, so
  `01/2020 - 06/2024` and single-year entries are missed. Missed dates break role
  splitting *and* `totalExperience`.
- **Headings must be ≤48 chars and match a fixed list**, so unusual headings silently
  merge into the previous section and cascade into wrong categorization.
- **AI cannot repair mistakes.** `improveWithAi()` merges *under* the heuristic result —
  non-empty heuristic values always win, so a wrong heuristic value is permanent.

### 2.3 "Rebuild from the wizard" bounces to /access → /dashboard

`apps/web/app/onboarding/page.tsx` correctly opts out of the onboarding gate:

```tsx
<AuthGate requireOnboarding={false} requireAccess={false}>
```

But `apps/web/components/auth-gate.tsx` has an **unconditional special case** that ignores
that prop:

```tsx
const profileResult = requireOnboarding || pathname === "/onboarding" ? await supabase… : { data: null };
…
if (pathname === "/onboarding" && profileComplete) {
  router.replace(`/access?next=${encodeURIComponent("/dashboard")}`);
  return;
}
```

Any user who has completed onboarding is redirected out of `/onboarding` before the wizard
mounts. `/access` then sees `hasAccess === true` and forwards to `next` = `/dashboard`.
The `alreadyOnboarded` banner and its "Rebuild profile" button are unreachable dead code.

### 2.4 Wrong question extracted (Google Forms "Your answer")

`apps/extension/src/lib/field-detector.ts` builds candidates in this order:

```ts
const questionCandidate = [
  ...(nearby && isQuestionLike(nearby) ? [{ value: nearby, source: "nearby_text" }] : []),
  ...(label && !isGenericPrompt(label) ? [{ value: label, source: "label" }] : []),
  ...(placeholder && !isGenericPrompt(placeholder) ? [{ value: placeholder, source: "placeholder" }] : []),
  ...(ariaLabel && !isGenericPrompt(ariaLabel) ? [{ value: ariaLabel, source: "aria_label" }] : []),
  ...(label ? [{ value: label, source: "label" }] : []),
  ...(placeholder ? [{ value: placeholder, source: "placeholder" }] : []),   // ← generic leaks back in
  …
];
```

Three compounding defects:

1. **`placeholder` outranks `aria-label`** — the reverse of the accname spec.
2. **The generic filter is a tiny closed list.** `isGenericPrompt` doesn't include
   `"your answer"`, so Google Forms' placeholder is treated as a *real* question.
3. **The fallback tier re-adds the generic values it just filtered out**, so filtering
   only changes ordering, never exclusion.

Meanwhile the real question is often rejected because `isQuestionLike()` demands a `?`,
a trailing `:`, a leading question word, or ≥45 chars — so a legitimate label like
`"Current company"` is discarded.

`nearbyText()` also only reads `element.closest(...)`, never previous siblings or
`aria-describedby`, and never traverses Shadow DOM.

### 2.5 "Insufficient" answers

The failure chain is fully deterministic:

```
AI returns "" or INSUFFICIENT_CONTEXT
  → isUsableSuggestion() rejects        (packages/shared/src/suggestion-agent.ts)
  → runSuggestionAgent() returns { error }   (apps/web/lib/suggestion-agent.ts)
  → API route returns { answer: "" }         (apps/web/app/api/ai/answer/route.ts)
  → content.ts renders the "none" overlay    (apps/extension/src/content.ts)
```

Two design faults amplify it:

- **Rule 6 of the system prompt is a hair trigger.** `If the candidate facts do not
  support a truthful answer, output exactly INSUFFICIENT_CONTEXT.` Combined with a *wrong*
  extracted question (2.4), the model is asked an unanswerable question and correctly
  refuses. **Bad question in → INSUFFICIENT_CONTEXT out.**
- **The notice is thrown away.** The route returns a genuinely useful `notice`
  (e.g. *"Your profile does not have a value for this question yet (work authorization)"*),
  but `content.ts` only checks `result?.answer` and discards `notice` entirely. The user
  sees a blank box with no explanation.

### 2.6 Match score never shown for the current page

`analyzeJobMatch()` **is** computed on the live page:

```ts
if (profile && summary.isJobPage) summary.matchAnalysis = analyzeJobMatch(summary, profile);
```

…but the result is only ever persisted with a saved job. The side panel renders
`job.matchScore` **only inside the Tracker tab for already-saved rows**. The Assistant tab
renders only hostname + title. The popup has no match rendering at all. Nothing is
missing from the *algorithm* — only the current-page render path.

### 2.7 Apply-popups / modals are not scanned

The `MutationObserver` fires only two actions:

```ts
const observer = new MutationObserver(() => {
  if (activeElement && !document.contains(activeElement)) { activeElement = null; removeOverlay(); }
  scheduleJobDetection();
});
```

It never extracts fields from added nodes. Field discovery happens exclusively on
`focusin`. So a modal apply form is invisible to "Scan page"/"Fill all" until each field is
manually focused. Shadow DOM is never traversed; `dialog` / `[role=dialog]` are never
specifically targeted.

### 2.8 Application tracking never detects an actual apply

Confirmed absent from the entire extension source:

- No listener for `Apply` / `Submit` button clicks (the only document click listener
  dismisses the overlay and never inspects the target).
- No `submit` event listener.
- No `fetch` / `XMLHttpRequest` monkey-patching.
- No `chrome.webRequest` / `webNavigation` usage.
- No status transition beyond the initial `"saved"`.

`saveJobToSupabase()` always inserts `status: "saved"`. There is no `applied` transition
and no `applied_at`. Auto-tracking on detection creates a *bookmark*, not an application.

### 2.9 Profile is largely read-only, no settings surface

Editable today: name/contact/links, summary, application details, skill add/remove,
custom fields, and the markdown document.

**Read-only:** every experience field, all education, all projects, and skill
`years`/`proficiency`/`category`. There is no reorder mechanism of any kind — the save path
deletes and reinserts children with **no position column**, so order is not even
representable.

`AccountSecurity` (sign out + local clear) is buried at the bottom of the profile page.
There is no settings route, no display-name control, and **no account/data deletion** —
the existing cleanup is browser-local only and deletes nothing server-side.

---

## 3. Target architecture

### 3.1 Resume as a first-class stored artifact

Adopt the already-provisioned `resumes` table + private `resumes` bucket as the single
source of truth.

```
Upload (onboarding OR profile OR extension)
   → POST /api/resume            (new: upload + parse in one call)
       ├─ storage.upload(`${userId}/${uuid}.pdf`)          ← binary preserved
       ├─ insert public.resumes { storage_path, mime_type, file_size, parsing_status }
       ├─ parse → parsed_text, formatted_text, extracted_profile
       └─ mark is_default = true, demote previous default
   → GET  /api/resume            list + signed preview URL (inline, never download)
   → DELETE /api/resume/:id      remove storage object + row
```

Rules:
- **Replace** = upload new → set default → delete previous storage object + row.
- **Preview, don't download**: issue a short-lived signed URL rendered in an inline
  `<iframe>`/`<object>`; no download button.
- The extension's existing `fetchResumeFile()` then works unmodified, because the row and
  `storage_path` it already queries will finally exist.

### 3.2 Layered resume extraction pipeline

Replace the single heuristic pass with a graded pipeline that degrades safely:

| Layer | Purpose |
|---|---|
| **L0 — Layout extraction** | Move from `pdf-parse` to `pdfjs-dist` `getTextContent()` to obtain per-item `transform` (x/y) + `width`. |
| **L1 — Page normalization** | Cluster items into lines by y-band; detect column count via x-gap histogram; emit **column-ordered** text. Strip repeated first/last lines across pages (headers/footers). |
| **L2 — Structural heuristics** | Existing section/role/date logic, but with a widened bullet class `[-*•◦▪▸→–—]` and a date grammar covering `MM/YYYY`, `YYYY–YYYY`, `Mon YYYY`, single years, and `Present/Current/Now`. |
| **L3 — LLM structuring** | Send **normalized text + L2 draft** and let the model *correct* fields, not merely fill blanks. |
| **L4 — Confidence + review** | Every field carries `{ value, confidence, source: 'layout'|'heuristic'|'ai' }`. Anything `< 0.7` is surfaced in a "Review these" queue instead of being silently trusted. |

This inverts today's rule that a wrong heuristic value can never be corrected.

### 3.3 Accessible-name-first field resolution

Rewrite `field-detector.ts` question resolution to follow the W3C accname order, and make
generic detection *terminal* rather than merely deprioritizing:

```
1. aria-labelledby (resolved, joined)
2. aria-label
3. <label for=id> / element.labels[0]
4. Wrapping <label>
5. Preceding sibling heading/legend/div text within the field group
6. aria-describedby
7. name / id (de-camelCased, de-snake_cased)
8. placeholder      ← LAST RESORT ONLY
9. title
```

Plus:
- **Expand the generic denylist** to include `your answer`, `answer`, `short answer`,
  `type your answer`, `enter your response`, `—`, `select…`, etc. A generic value must be
  **excluded entirely**, never re-added by a fallback tier.
- **Loosen `isQuestionLike`** — a label is question-like if it is a noun phrase of 2+ words
  or matches a known field taxonomy, not only if it has `?` or ≥45 chars.
- **Add an ATS adapter layer**: `adapters/{greenhouse,lever,workday,ashby,googleforms}.ts`,
  each exporting `matches(location)` and `resolveQuestion(el)`. Google Forms specifically
  exposes the real question in `[role=heading]` inside the enclosing
  `[role=listitem]` — a 10-line adapter fixes the reported bug outright.
- **Traverse Shadow DOM** via a recursive `queryDeep()` that walks `shadowRoot`s.
- **Emit provenance** so the side panel can show *"question read from: aria-label"* and let
  the user correct it — a wrong question becomes a one-click fix instead of a dead end.

### 3.4 Suggestion agent hardening

- **Pass question confidence to the prompt.** When confidence is low, instruct the model to
  answer the *most probable* interpretation and flag it, rather than emitting
  `INSUFFICIENT_CONTEXT`.
- **Add a graceful middle tier.** Replace the binary usable/unusable check with
  `{ answer, confidence, needsReview, missingFacts[] }`. `INSUFFICIENT_CONTEXT` must return
  **which facts are missing**, not a blank.
- **Surface the notice in the overlay.** `content.ts` must render `notice` in the `none`
  state with a deep link — *"Add work authorization to your profile → "* — instead of an
  empty card.
- **Retrieval before generation.** Rank profile facts by embedding/keyword similarity to the
  question and inject only the top-k into `CANDIDATE_FACTS`, so long profiles stop diluting
  the context window.

### 3.5 New subsystem — Application Action Detector

This is the "tool that detects page actions, buttons, API and network" from the brief.
It runs in the content script + a `MAIN`-world injected script and fuses **five**
independent signals into one confidence score:

| Signal | Mechanism | Weight |
|---|---|---|
| **Intent click** | Capture-phase `click` listener; match accessible name against `/^(apply|submit|send application|finish|continue to apply)/i` | 0.30 |
| **Form submit** | Capture-phase `submit` on `document` | 0.20 |
| **Network** | `MAIN`-world patch of `window.fetch` + `XMLHttpRequest.prototype.send`, posting `{method,url,status}` over `window.postMessage` (never bodies — privacy) . Match `POST` to `/apply|application|submit/` with 2xx | 0.30 |
| **URL transition** | `history` patch + `popstate`; match `/confirmation|thank-you|submitted|success/` | 0.10 |
| **DOM confirmation** | `MutationObserver` for inserted text matching `/application (was )?(received|submitted)|thanks for applying/i` | 0.10 |

At `score ≥ 0.6` → emit `APPLICATION_SUBMITTED`. The background worker then transitions the
tracker row `saved → applied`, stamps `applied_at`, and shows a **toast with Undo**.
Nothing is silent, and nothing is auto-submitted — we only *observe*.

Privacy constraints: URLs and status codes only, never request/response bodies; the
injected script is same-origin `postMessage` guarded; the whole detector is behind the
existing `autoTrackJobs` setting.

### 3.6 Live match score in the extension

Wire the already-computed `summary.matchAnalysis` into the UI:

- Background caches `matchAnalysis` per `tabId` on `JOB_PAGE_DETECTED`.
- Side panel Assistant tab gains a **Match card**: radial score, matched skills (wine
  chips), missing keywords (purple chips), and a "Why this score" expander.
- Popup gains a compact score pill for the active tab.
- Content script shows a floating **match radar pill** on detected job pages.

### 3.7 Profile v2 + Settings

**Profile** becomes fully editable and orderable:

- Inline editors for every experience/education/project field.
- Add / duplicate / delete entries.
- **Manual ordering** via drag handles *and* keyboard-accessible ↑/↓ buttons.
  Requires a schema change — add `position integer not null default 0` to `experiences`,
  `education`, `projects`, and `skills`, and order by it everywhere.
- A **Review queue** listing every low-confidence extracted field.
- A **Resume card**: inline preview, Replace, Delete, and "used by extension" indicator.

**New `/settings` route** (lifting `AccountSecurity` out of the profile page):

- Account: display name, email (read-only), member since.
- Preferences: clear-local-data-on-logout, auto-track jobs, live AI.
- Danger zone: **Delete all my data** — a new `POST /api/account/delete` that removes
  storage objects, `resumes`, `profile_signals`, `experiences`/`skills`/`education`/
  `projects`, `applications`, `jobs`, `answers`, and the `profiles` row, behind a
  type-to-confirm dialog. This is the capability that genuinely does not exist today.

### 3.8 Dashboard v2

Replace static counters with an activity model: funnel (saved → applied → interview →
offer), response-rate, 30-day application velocity sparkline, stale-application nudges
(">14 days, no response"), and next-action queue driven by `tracker_tasks`.

---

## 4. Phased delivery

| Phase | Scope | Unblocks |
|---|---|---|
| **P0 — Unblock (highest value/effort ratio)** | `AuthGate` onboarding-redirect fix (2.3); resume storage + `resumes` row (2.1); accname reorder + generic denylist + Google Forms adapter (2.4); render `notice` in overlay (2.5); current-page match card (2.6). | Rebuild wizard, extension resume attach, correct questions, explained non-answers, visible score. |
| **P1 — Profile & Settings** | Profile v2 editors, `position` migration + reordering, resume preview/replace/delete, `/settings` route, account deletion API. | Full profile control + data rights. |
| **P2 — Extraction quality** | pdfjs layout extraction, column reflow, header/footer strip, widened bullet/date grammars, AI-corrects-heuristics, confidence + review queue. | Materially better parsing. |
| **P3 — Action Detector** | MAIN-world network patch, click/submit/URL/DOM signals, fusion scoring, `saved → applied` transition with Undo, modal/Shadow-DOM field scanning. | Self-filling tracker; apply-popup support. |
| **P4 — Intelligence** | Fact retrieval/ranking, confidence-aware prompting, missing-fact reporting, dashboard v2. | Higher answer quality and insight. |

## 5. Schema changes required

```sql
-- ordering (P1)
alter table public.experiences add column position integer not null default 0;
alter table public.education   add column position integer not null default 0;
alter table public.projects    add column position integer not null default 0;
alter table public.skills      add column position integer not null default 0;

-- application lifecycle (P3)
alter table public.applications add column applied_at timestamptz;
alter table public.applications add column detection_signals jsonb;
alter table public.applications add column detection_confidence numeric;

-- extraction confidence (P2)
alter table public.resumes add column extraction_confidence jsonb;
```

## 6. Risks and guardrails

- **MAIN-world network patching** is the most invasive change. Mitigate: URLs + status only,
  never bodies; feature-flagged; disabled by default on banking/health domains; fully
  covered by the existing `autoTrackJobs` opt-out.
- **False-positive "applied"** damages trust. Mitigate: 0.6 confidence floor requiring ≥2
  independent signals, plus a visible Undo toast.
- **pdfjs migration** may regress currently-working single-column resumes. Mitigate: run
  L1 and legacy in parallel behind a flag; compare field-fill rate on a fixture corpus
  before switching the default.
- **Deletion is irreversible.** Mitigate: type-to-confirm, server-side re-auth, and an
  emailed confirmation.

## 7. Explicitly out of scope

Auto-submission of applications, LinkedIn scraping, and bulk/blind apply. These conflict
with the product's core promise that the user reviews and confirms every submission.
