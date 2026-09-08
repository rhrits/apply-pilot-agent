<div align="center">

<img src="brand/applypilot-logo.svg" width="88" alt="ApplyPilot" />

# ApplyPilot

**An open-source job-application copilot that never invents your experience.**

Build one verified profile from your resume, GitHub, and project links.
Then let a browser extension answer application questions with your real facts —
and copy or paste when autofill cannot be trusted.

[Onboarding](docs/ONBOARDING.md) · [Strategy](PRODUCT_STRATEGY.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

</div>

---

## Why this exists

Most autofill tools fail in one of two ways: they break on any site they have not
been hard-coded for, or they cheerfully make up experience you do not have.

ApplyPilot takes a different position:

- **Deterministic before AI.** "Notice period" and "Current company" are looked up
  from your verified profile. No model call, no rate limit, no hallucination.
- **Missing beats invented.** If your profile cannot support an answer, it says so
  instead of writing a plausible paragraph.
- **Autofill is a capability, not the promise.** When a page uses closed Shadow DOM
  or a cross-origin iframe, the copy and side-panel fallbacks still work.
- **Nothing submits itself.** The extension prepares; you confirm.

## Features

**Profile intelligence**
- Import a resume (PDF/TXT/MD) and extract contact details, roles with dates,
  education, projects, and skills
- Enrich from your **public GitHub profile** via the official REST API
- Read your **project and portfolio links**
- Describe yourself by **typing or speaking** — speech-to-text included
- Generate **30+ reusable answers** grounded only in your real material
- Review and edit everything before anything is saved

**Browser extension (Chrome MV3)**
- Detects the focused field and derives the real question from labels, ARIA,
  placeholders, and nearby text
- Answers from profile → custom fields → saved memory → AI, in that order
- **Scan page**, **Fill all**, **Attach resume**, **Save job**
- Full copyable profile in the side panel for sites where insertion fails
- Works on dynamic SPAs via `MutationObserver`

**Job tracker**
- Kanban board with saved / applying / applied / interview / offer
- Autosaves locally, syncs to Supabase, and receives jobs saved from the extension

## Architecture

```text
┌──────────────┐        ┌───────────────────┐        ┌──────────────┐
│  Extension   │───────▶│   Next.js web app │───────▶│   Mistral    │
│  MV3 · React │  JWT   │   API routes      │  key   │   (server)   │
└──────┬───────┘        └─────────┬─────────┘        └──────────────┘
       │                          │
       │      same user, RLS      │
       └──────────┬───────────────┘
                  ▼
            ┌───────────┐
            │ Supabase  │  Auth · Postgres (RLS) · Storage
            └───────────┘
```

Provider keys live only on the server. The extension holds a short-lived Supabase
access token and nothing else.

```text
apps/web          Next.js: onboarding, profile, tracker, answer library, API routes
apps/extension    Chrome MV3: content script, background worker, side panel, popup
packages/shared   Types + deterministic answer engine used by both
supabase/         SQL migrations (run in filename order)
docs/             Architecture documentation
```

## Quick start

**Requirements:** Node 20+, a Supabase project, and a Mistral API key (optional but
recommended).

```bash
git clone https://github.com/rhrits/apply-pilot-agent
cd apply-pilot-agent
npm install

cp apps/web/.env.example apps/web/.env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, MISTRAL_API_KEY

npm run dev:web        # http://localhost:3000
```

Run every file in `supabase/migrations/` in filename order in the Supabase SQL editor.

Then build and load the extension:

```bash
npm run build:extension
# chrome://extensions → Developer mode → Load unpacked → apps/extension/dist
```

Sign in to the extension popup with the **same email** as the web app, then press
**Refresh profile data**.

### Production extension build

```bash
VITE_WEB_APP_URL=https://your-domain.com npm run build:extension
```

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public key; safe **only** because RLS is on |
| `MISTRAL_API_KEY` | Recommended | Open-ended answers and resume structuring |
| `MISTRAL_MODEL` | No | Defaults to `mistral-small-latest` |
| `STT_BASE_URL` / `STT_MODEL` / `STT_API_KEY` | No | Override speech-to-text; defaults to Mistral Voxtral |
| `GITHUB_TOKEN` | No | Raises GitHub's public rate limit from 60/hr to 5000/hr |

Never prefix a secret with `NEXT_PUBLIC_`. Never put a Supabase **service role**
key anywhere in this project.

### Email sign-in

ApplyPilot uses Supabase email OTP. Supabase's default template sends a magic
**link**; to also support the extension's numeric code, add `{{ .Token }}` to the
Magic Link template. Add `/onboarding` and `/profile` to your Supabase redirect URLs.
Configure custom SMTP before real use — the built-in sender is rate-limited.

### Speech to text

Defaults to Mistral **Voxtral** (`voxtral-mini-latest`) reusing `MISTRAL_API_KEY`.
The endpoint is OpenAI-compatible, so a self-hosted **faster-whisper** or
**whisper.cpp** server works by changing environment variables only. See
[docs/ONBOARDING.md](docs/ONBOARDING.md#speech-to-text).

## Known limitations

These are real boundaries, not bugs:

- **LinkedIn is not crawled.** Their terms prohibit it and they block it. Use
  LinkedIn's own *Save to PDF* or data export instead.
- **Closed Shadow DOM, cross-origin iframes, CAPTCHA, and canvas-based forms**
  cannot be autofilled. Copy fallback covers these.
- **Drag-and-drop-only upload widgets** cannot receive a programmatic file.
- **PDF text extraction is imperfect.** Multi-column resumes sometimes glue words
  together, which is why the review step exists.
- **No autonomous submission.** By design.

## Development

```bash
npm run typecheck
npm test
npm run build
npm run build:extension
```

The most useful contribution is an **ATS compatibility report** with an anonymized
HTML snippet of a field that was missed. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
