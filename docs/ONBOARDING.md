# Onboarding and Profile Intelligence

How ApplyPilot turns scattered material into one verified profile that can answer
almost any application question without inventing anything.

## The pipeline

```text
Sign in
   ↓
Resume first           extracted, merged, and SAVED immediately on upload
   ↓
Enrich (gap-fill)      GitHub · links · pasted profiles — cannot overwrite resume facts
   ↓
Your story             typed or dictated narrative, autosaved as you type
   ↓
Ask what is missing    CTC · notice period · visa · location · leadership · achievements
   ↓
Agent                  one structured profile + Markdown document + 30 or more answers
   ↓
Review and edit        nothing is final until the user confirms
   ↓
Save                   Supabase, protected by RLS
   ↓
Sync                   extension pulls the same profile
```

Four ideas make this work:

1. **Signals are separate from the profile.** A `RawSignal` is what the user gave us.
   The `UserProfile` is what the user has verified. Re-running extraction never
   silently overwrites verified data.
2. **Missing beats invented.** Every prompt instructs the model to leave a field
   empty rather than guess, and to return `INSUFFICIENT_CONTEXT` when facts do not
   support an answer. Gaps are surfaced to the user instead of being filled in.
3. **The resume wins.** Precedence is enforced in code, not only in the prompt, so a
   GitHub bio can never rename the job title a resume stated.
4. **Nothing is lost.** Captured data is persisted as it is captured, so a refresh or
   device switch resumes exactly where the candidate left off.

## Source precedence

`packages/shared/src/profile-merge.ts` assigns every source a priority. A source may
only write a field that is still empty, or one filled by a *lower*-priority source:

```text
manual < resume < typed < answers < linkedin_export < project < website < github < voice
```

So the resume can overwrite a GitHub-derived value, but never the reverse. List data
(skills, roles, projects, education) is unioned and de-duplicated rather than replaced,
which lets GitHub contribute *extra* projects without displacing resume ones.

`profiles.profile_sources` records which source produced each field, and the UI shows
that provenance next to the value.

## Instant persistence

`apps/web/lib/onboarding-store.ts` writes to Supabase as data is captured:

| Trigger | Written to |
|---|---|
| Resume extracted | `profiles.resume_profile`, `profiles.resume_text`, `profile_signals` |
| Any source added | `profile_signals`, upserted on source + origin |
| Any field edited | `profiles.draft_profile`, debounced about 700 ms |
| Agent completes | `profiles.profile_markdown`, `profiles.profile_sources` |
| Review confirmed | `profiles` plus `experiences` / `skills` / `education` / `projects` |

## The profile document

`buildProfileMarkdown()` renders the verified profile as Markdown with generated
headings — Summary, Skills, Experience, Projects, Education, Application details.
It is stored in `profiles.profile_markdown` and reused whenever an application asks
for a written background. The profile page renders it with a small React renderer
rather than injecting HTML, because the content originates from untrusted documents.

## Signal sources

| Source | How it is read | Notes |
|---|---|---|
| Resume | `POST /api/resume/analyze` | PDF/TXT/MD, heuristic parser with optional AI structuring |
| GitHub | `POST /api/enrich/github` | Documented public REST API. No scraping |
| Project / portfolio links | `POST /api/enrich/link` | Server-side fetch, HTML stripped to text |
| LinkedIn and similar | Manual paste | See the note below |
| Typed narrative | Onboarding form | The user's own words drive tone |
| Voice | `POST /api/transcribe` | Recorded in browser, transcribed server-side |

### Why LinkedIn is not crawled

LinkedIn's User Agreement prohibits automated scraping, and the site enforces this
with authentication walls, rate limiting, and bot detection. Building a scraper
would be both unreliable and a terms violation, so `/api/enrich/link` explicitly
blocks `linkedin.com` and a few other closed platforms.

The supported path is user-initiated export, which is legitimate and more complete:

1. **Save as PDF** — LinkedIn profile → *More* → *Save to PDF*, then upload it as a resume.
2. **Download your data** — Settings → *Data privacy* → *Get a copy of your data*.
3. **Copy and paste** — select the profile page and paste the text into onboarding.

## Speech to text

Recording happens in the browser with `MediaRecorder`; recognition happens on the
server so no provider key is ever exposed to the client.

### Provider options

| Option | License / cost | Best for |
|---|---|---|
| **Mistral Voxtral** (default) | Hosted, reuses `MISTRAL_API_KEY` | Zero extra setup when Mistral is already configured |
| **faster-whisper** | MIT, self-hosted | Privacy, no per-minute cost, GPU optional |
| **whisper.cpp** | MIT, self-hosted | CPU-only and edge deployments |
| **Voxtral Realtime** | Apache-2.0 open weights | Self-hosting a low-latency streaming model |
| **Browser `SpeechRecognition`** | Free, no key | Quick prototypes; Chrome-only and less accurate |

The default is Voxtral (`voxtral-mini-latest`) via the OpenAI-compatible
`/audio/transcriptions` endpoint. Because the shape is OpenAI-compatible, swapping
in a self-hosted server needs no code change:

```bash
# Self-host faster-whisper behind an OpenAI-compatible server
STT_BASE_URL=http://localhost:8000/v1
STT_MODEL=Systran/faster-whisper-large-v3
STT_API_KEY=local-dev-key
```

Recommendation: start on Voxtral, and move to self-hosted faster-whisper before
handling other people's audio, since voice recordings are personal data.

## Synthesis

`POST /api/profile/synthesize` requires a Supabase bearer token, then:

1. Partitions signals into the **authoritative** resume block and gap-filling supplements.
2. Runs every signal through `sanitizePageContext()` — crawled pages are untrusted
   input and must never act as instructions.
3. Computes a deterministic resume-first baseline with the merge engine before any
   model call. This doubles as the fallback when the provider is unavailable.
4. Asks the model for structured JSON, with explicit precedence rules in the system
   prompt: the resume wins every conflict.
5. Re-merges the model output against that baseline, so a model that dropped or
   reworded a resume fact cannot corrupt the profile.
6. Asks a second time for 30 or more reusable answers grounded only in that profile.
7. Returns the profile, Markdown document, completeness, gaps, and answers for review.
   **The endpoint writes nothing to the database.**

The client saves only after the user presses confirm on the review step.

## Prompt injection defenses

A crawled portfolio page could contain `Ignore previous instructions...`. Defenses:

- All external text is labeled untrusted data in the prompt, never a system message.
- `sanitizePageContext()` strips known injection phrasings.
- Every source is length-capped, so one page cannot dominate the context.
- Output must be valid JSON matching a fixed schema; anything else is rejected.
- The user reviews every field before it is saved.

## Generated answers

Roughly 30 to 40 answers are produced across these categories:

`about` · `motivation` · `behavioral` · `technical` · `project` · `leadership` · `logistics`

They are stored in `answer_library` and become the extension's memory layer, so the
common questions are answered instantly with no AI call and no rate limit.

## Data model

```text
profiles                 verified profile + resume_profile + profile_markdown
                         + profile_sources + draft_profile + application_answers
profile_signals          raw captured material, re-runnable
experiences / skills /
education / projects     normalized structured records
answer_library           generated + user-edited answers, with provenance
```

Every table has row level security keyed to `auth.uid()`.

## Re-running extraction

Onboarding is not one-shot. A user can add a new resume or link later and re-run
synthesis. Because signals are stored separately, the merge helper only fills empty
fields and never erases a value the user has already verified.
