# Solid implementation plan

## Non-negotiable product contract

> ApplyPilot works across the web as an assistant. Autofill is best-effort; copy, manual question mode, and the Side Panel are the guaranteed fallback.

## Milestone 1 — Vertical slice (done in this scaffold)

- Detect the focused editable field.
- Derive a question from label, ARIA, placeholder, name/id, and nearby text.
- Fill only deterministic low-risk profile fields.
- Dispatch events compatible with common controlled inputs.
- Store the last field per tab and open the Side Panel.
- Copy or manually generate an answer when detection/autofill is uncertain.

**Acceptance:** On a local HTML form, name/email/phone/LinkedIn can be suggested and inserted; an open question can be copied or answered from the Side Panel.

## Milestone 2 — Identity and profile source of truth (in progress)

- Add Supabase Auth using a hosted web callback first; avoid putting a Mistral key in the extension.
- Add a Supabase client with a browser-safe storage adapter for extension sessions.
- Replace `demoProfile` with a repository interface and RLS-backed profile queries.
- Add profile review UI and explicit save states.
- Current implementation includes a resume import/review flow, local fallback, Supabase magic-link entry point, profile upsert, and private resume Storage upload when authenticated.

## Milestone 3 — Resumes and knowledge (partially implemented)

- Upload PDFs to a private Supabase Storage bucket.
- Parse text server-side; extract structured data into a review screen.
- Add `answer_library`, `answer_history`, and embeddings only after keyword retrieval works.
- Add citations/source snippets to generated answers so unsupported claims are visible.
- Current implementation includes PDF/TXT/Markdown extraction, heuristic fallback, Mistral structured formatting, categorized sections, profile suggestions, and a local answer library UI.

## Milestone 3A — Job tracker (implemented locally, sync next)

- Track saved, applying, applied, assessment, interview, offer, rejected, and withdrawn states.
- Capture location, work mode, employment type, salary, priority, contact, next step/date, notes, source, URL, and tags.
- Add search, status filters, board view, detail drawer, local persistence, and optional authenticated Supabase insert.

## Milestone 4 — AI orchestration

`question -> classify -> deterministic lookup -> retrieve relevant context -> generate -> validate -> user approval`

- Use a provider interface so Mistral can be swapped.
- Enforce a small context budget and no-invention system prompt.
- Treat work authorization, salary, demographics, legal, consent, and submission as review-required.
- Add rate limiting and usage events on the server before production.

## Milestone 5 — Compatibility and quality

- Add fixtures for real DOM patterns and platform adapters only when a generic strategy fails.
- Test React/Vue controlled inputs, selects, radio groups, contenteditable, iframes, and SPA route changes.
- Add Playwright/Puppeteer extension smoke tests.
- Add Sentry only after reproducible local diagnostics exist.

## Milestone 6 — Authenticated extension sync (implemented)

- Authenticate the extension with Supabase email OTP using the same user identity as the web app.
- Persist the extension session in `chrome.storage.local`, never in page storage.
- Fetch profile, experience, skills, education, and projects under Supabase RLS.
- Send the access token to the server AI route, which validates it before retrieving context.
- Remove demo autofill data from production behavior; signed-out users get no profile autofill.
- Build local extensions from the web app's public Supabase configuration; use `VITE_WEB_APP_URL=https://ap.coderscookies.com` for production builds.

## Security and privacy gates

- Never ship `MISTRAL_API_KEY` to the extension.
- Keep Supabase RLS enabled for every user-owned table.
- Do not auto-submit applications.
- Do not silently answer sensitive questions.
- Send only the minimum retrieved context to an AI provider.
- Provide delete/export controls before public release.
