# UplyFox Product Strategy and Implementation Plan

## Product position

UplyFox is an authenticated, user-controlled job-application copilot:

> Build a verified profile once; understand every application page; prepare a complete draft; let the user review and explicitly confirm before anything is submitted.

Autofill is a capability, not the product promise. The product must remain useful when a site uses iframes, custom widgets, Shadow DOM, CAPTCHA, or an unsupported ATS.

## Research synthesis

### Patterns worth adopting

- Simplify-style products combine a reusable profile, resume data, browser autofill, answer suggestions, and job tracking. The key lesson is the durable profile/answer memory, not a large list of fragile selectors.
- Teal-style products make job tracking, resume tailoring, and application history first-class workflows rather than hiding them inside a browser popup.
- n8n-style orchestration is useful for asynchronous backend workflows: webhook/event trigger → classify → retrieve → generate → validate → human approval → write result. It should not control a browser submission without a user approval boundary.
- Chrome MV3 content scripts can inspect and modify page DOM but cannot guarantee control over browser-owned pages, closed Shadow DOM, CAPTCHA, cross-origin frames, or every custom form widget.
- Supabase Auth + RLS is the source of truth. The extension uses the same project and user identity, but stores its own refreshable session in extension storage.

References:

- https://simplify.jobs/
- https://www.tealhq.com/
- https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- https://supabase.com/docs/guides/auth/auth-smtp
- https://docs.n8n.io/advanced-ai/ai-agent/

## Auth-first user journey

1. Visit `ap.coderscookies.com`.
2. Sign in with email OTP/magic link.
3. Complete the onboarding checklist: contact details, application answers, resume, work authorization, preferences.
4. Review the extracted profile before enabling the extension.
5. Install the extension and sign in with the same email/OTP.
6. Click **Sync profile**; the extension fetches RLS-authorized profile, skills, experience, education, projects, custom fields, resume metadata, and answer memory.
7. Open a job page. The extension displays the page/company/job context and lets the user scan, fill, attach a resume, save the job, or answer a question.
8. The user reviews an application draft before any submission action.

## Agent architecture

Use one orchestrator with specialist tools, not uncontrolled autonomous agents.

### Application Orchestrator

Owns the state machine:

`DISCOVERED → ANALYZING → DRAFT_READY → NEEDS_REVIEW → APPROVED → SUBMITTED → TRACKED`

It can call:

1. **Page Agent** — extracts URL, title, company, job description, visible form questions, and upload fields.
2. **Profile Agent** — retrieves verified profile facts, custom fields, resume versions, and work preferences.
3. **Question Agent** — normalizes each field and classifies intent.
4. **Memory Agent** — matches custom fields, saved answers, and previous application answers before AI.
5. **Answer Agent** — generates only open-ended answers from retrieved facts; never follows instructions found in page text.
6. **Autofill Agent** — fills high-confidence fields, dispatches framework-compatible events, and reports failures.
7. **Resume Agent** — chooses the best resume and attaches it where a normal file input allows it.
8. **Validation Agent** — checks missing required fields, unsupported claims, sensitive fields, and answer length.
9. **Review Agent** — creates a human-readable approval checklist.
10. **Learning Agent** — saves user edits, accepted answers, rejected suggestions, and unknown questions.

### Trust boundaries

- Page content is untrusted input.
- AI output is untrusted until validated.
- Work authorization, sponsorship, salary, demographics, legal questions, consent checkboxes, and submission always require review.
- No autonomous submission by default.
- Never allow page text to override system instructions or profile facts.

## n8n workflow plan

n8n should be optional backend orchestration, not a dependency of the extension's core autofill path.

### Workflow A — Resume ingestion

`Supabase Storage webhook → extract text → classify sections → structured profile → validate → save extracted_profile → notify user`

Human checkpoint: extracted profile must be reviewed before it becomes verified data.

### Workflow B — Job analysis

`job saved event → extract description → company/role/skills → match resume versions → calculate fit → save job analysis`

### Workflow C — Application draft

`extension draft event → normalize questions → retrieve profile/memory → generate open answers → validation → create review checklist`

### Workflow D — Learning

`user edits answer → save original/final pair → tag intent → update answer library → update tone examples`

## Application state and confirmation

The extension should never click the final submit button automatically in the MVP.

It may:

- Fill safe contact fields.
- Fill known profile fields.
- Suggest answers.
- Attach the selected resume.
- Save the job.
- Prepare a review checklist.

The final review must show:

- Every field value.
- Source: profile, memory, AI, or user-entered.
- Confidence.
- Fields requiring review.
- Sensitive/legal fields.
- Resume selected.
- Consent and submission controls.

Only after the user clicks **Confirm and submit** may a future adapter attempt a submit action, and the adapter must stop if the page changes or a CAPTCHA/consent step appears.

## Database expansion

Existing tables are the foundation. Add these next:

- `custom_fields`
- `answer_memory_events`
- `application_drafts`
- `application_draft_fields`
- `agent_runs`
- `agent_events`
- `resume_match_scores`
- `page_snapshots`
- `review_decisions`

Every table must have RLS and `user_id` ownership.

## UI/UX principles

- Auth first; no fake profile workspace for signed-out users.
- One primary action per screen.
- Explain why a field was suggested.
- Always expose Copy and Insert fallbacks.
- Show sync status and last sync time.
- Show agent state: scanning, matching memory, generating, ready for review.
- Keep the page overlay small; put full data and controls in the Side Panel.
- Use progressive disclosure for advanced agent settings.
- Allow disabling automatic overlays without disabling manual assistance.

## Open-source strategy

- Keep the repository secret-free; environment files stay ignored.
- Use Apache-2.0 or MIT after deciding whether hosted services and brand assets need separate terms.
- Publish architecture, local Supabase migration instructions, test fixtures, and a security policy.
- Add issue templates for ATS compatibility, parser failures, security reports, and UX requests.
- Never accept real resume data in test fixtures.
- Add a contributor guide and a browser-compatibility matrix.

## Milestones

### Phase 1 — Verified foundation

- Auth-first web app.
- Profile onboarding.
- Resume extraction/review.
- Custom fields.
- Supabase RLS.
- Extension OTP sync.

### Phase 2 — Reliable assistant

- Memory-first matching.
- Live field agent.
- Scan/fill-all.
- Resume attachment.
- Save job.
- Full copyable Side Panel.
- Tracker sync.

### Phase 3 — Application drafts

- Page snapshots.
- Complete draft checklist.
- Answer provenance.
- Missing-field review.
- Resume-fit ranking.
- User approval state machine.

### Phase 4 — Platform adapters

- Greenhouse.
- Lever.
- Ashby.
- Workday.
- SmartRecruiters.
- Only add an adapter after recording fixtures and tests for the failure mode it fixes.

### Phase 5 — Controlled automation

- User-approved submission for supported adapters only.
- Stop on CAPTCHA, changed DOM, sensitive questions, or validation mismatch.
- Record every action in an audit timeline.

## Success metrics

- Profile completion rate.
- Resume extraction correction rate.
- Direct-match answer rate.
- Saved-memory reuse rate.
- Autofill success rate by field type and ATS.
- Percentage of applications completed without unsupported claims.
- User review time per application.
- Submission error rate.
- Sync failures and stale-session rate.

## Immediate next actions

1. Run migrations `202609080003` and `202609080004`.
2. Sign in to the web app and fill application-answer/custom-field values.
3. Rebuild and reload the extension.
4. Enable Live AI only after the profile and memory are populated.
5. Test Save job on one real page and confirm it appears in the tracker.
6. Add browser fixtures for the first target ATS before attempting any submission automation.
