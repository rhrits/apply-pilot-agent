# Contributing to ApplyPilot

Thanks for helping build a job-application copilot that people can actually trust.

## Ground rules

1. **Never invent candidate data.** If the profile does not support an answer, the
   correct behavior is to say so. Fixes that make the AI "sound better" by guessing
   will be rejected.
2. **Never commit real personal data.** No real resumes, emails, phone numbers, or
   API keys — including in test fixtures.
3. **No autonomous submission.** Anything that could submit an application without
   explicit user confirmation is out of scope.
4. **Respect other sites' terms.** We do not add scrapers for platforms that
   prohibit automated access.

## Setup

```bash
git clone https://github.com/rhrits/apply-pilot-agent
cd apply-pilot-agent
npm install

cp apps/web/.env.example apps/web/.env.local   # then fill in your values
npm run dev:web
```

Run the SQL files in `supabase/migrations/` in filename order against your Supabase
project.

Build and load the extension:

```bash
npm run build:extension
# chrome://extensions → Developer mode → Load unpacked → apps/extension/dist
```

## Before opening a pull request

```bash
npm run typecheck
npm test
npm run build
npm run build:extension
```

All four must pass.

## Project layout

```text
apps/web          Next.js app: onboarding, profile, tracker, answer library, API routes
apps/extension    Chrome MV3 extension: content script, background worker, side panel, popup
packages/shared   Types + the deterministic answer engine shared by both
supabase/         SQL migrations, applied in filename order
docs/             Architecture and product documentation
brand/            Logo and icon sources
```

## Where changes usually belong

| Change | Location |
|---|---|
| A question is answered wrongly | `packages/shared/src/answer-engine.ts` (+ a test) |
| A field is not detected on a site | `apps/extension/src/lib/field-detector.ts` |
| A value fails to insert into an input | `apps/extension/src/lib/insertion.ts` |
| Resume parsing is wrong | `apps/web/app/api/resume/analyze/route.ts` |
| New profile field | `packages/shared/src/types.ts` + migration + profile UI + extension mapper |

## ATS compatibility reports

These are the most valuable contributions. Please include:

- The ATS or site (Greenhouse, Lever, Workday, and so on)
- Which fields were detected and which were missed
- A **minimal anonymized HTML snippet** of the failing field
- Browser and extension version

Add the snippet as a test fixture so the fix stays fixed.

## Style

- TypeScript everywhere; no `any` in new code.
- Comment *why*, not *what*.
- Add a test for every answer-engine or parser change.
- Keep user-facing copy plain and honest — no marketing language in the UI.

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
