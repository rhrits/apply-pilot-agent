# ApplyPilot

ApplyPilot is a Chrome MV3 job-application copilot. It uses a confidence-aware universal field detector, safe deterministic profile suggestions, a Side Panel for questions that cannot be filled reliably, and a server-side Mistral adapter.

## What is built now

- Chrome extension with content script, popup, background service worker, and Side Panel.
- Focus detection with `focusin`, label/ARIA/placeholder/name/nearby-text extraction, and `MutationObserver` support.
- Safe suggestions for name, email, phone, location, social links, and portfolio.
- Framework-friendly insertion using native value setters plus `input`/`change` events.
- Copy fallback and manual question mode for pages where autofill is not reliable.
- Next.js dashboard and editable demo profile.
- Resume Studio: upload PDF/TXT/Markdown or paste resume text, extract structured profile data (contact, links, location, experience with company/title/dates, education, projects, skills), categorize sections, and produce an ATS-friendly formatted version. Extraction merges into the verified profile without erasing fields you already filled in.
- Supabase email + one-time-code (OTP) sign-in with a two-step UI (request code → verify code), an in-app setup guide, private resume Storage upload, profile upsert, and resume metadata persistence.
- Job tracker with saved/applying/applied/interview/offer lanes, search, priority, salary, work mode, contact, next step, notes, and detail drawer.
- Answer library for reviewed reusable answers.
- Mistral API route that gracefully returns a demo answer until `MISTRAL_API_KEY` is configured.
- Supabase migration for the profile, resume, answer memory, job, application, and RLS foundation.
- Unit tests for detection and insertion.

## Research decisions

1. **Manifest V3**: the extension uses a service worker, a content script, minimal functional permissions, and `chrome.sidePanel`. Content scripts run in an isolated world and can observe arbitrary DOM forms, but cross-origin frames, browser-owned pages, CAPTCHAs, and closed Shadow DOM are hard boundaries.
2. **Fallback-first UX**: autofill is never the only product path. Every detected question can be copied, and the Side Panel has a manual prompt.
3. **Server-side AI**: the Mistral key belongs only to the Next.js server. It is never bundled into the extension.
4. **Supabase-ready, not Supabase-required**: the initial UI runs in demo mode. Add Supabase URL/key later, then wire Auth and replace demo repositories behind the same domain types.
5. **Deterministic before AI**: known profile fields do not spend an AI request. Mistral is reserved for open-ended or ambiguous prompts and structured resume improvement.

## Run locally

```text
npm install
npm run dev:web
```

Open `http://localhost:3000`. The app works without Supabase or Mistral variables.

To build the extension:

```text
npm run build:extension
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `apps/extension/dist`.

The extension’s Side Panel calls `http://localhost:3000/api/ai/answer`. Run the web app while testing it. Without a Mistral key it uses a safe demo response; with a key, set `MISTRAL_API_KEY` in `apps/web/.env.local`.

## How the extension connects to the web app

The extension and web app use the same Supabase project and the same user email. They do not share a browser cookie:

1. Sign in to the extension from its popup using the same email as the web app.
2. The extension requests an email OTP from Supabase and verifies it in the extension popup.
3. The background service worker stores the Supabase session in `chrome.storage.local`.
4. It queries `profiles`, `experiences`, `skills`, `education`, and `projects` with the user's access token.
5. Supabase RLS limits every query to the signed-in user's rows.
6. The content script reads only the synchronized profile cache and uses it for safe autofill.
7. The Side Panel sends the same short-lived access token to `/api/ai/answer`; the server validates the token and retrieves the user's profile context again before calling Mistral.

For the extension OTP flow, add `{{ .Token }}` to the same Supabase email template while keeping the `{{ .ConfirmationURL }}` link. This lets the web app support clicking the magic link and lets the extension enter the numeric code with the same email. A magic link clicked in a browser does not automatically transfer the session into the extension's isolated storage. Never put a Supabase service-role key or Mistral key in the extension.

### Local extension configuration

The Vite extension build automatically reads the public Supabase URL and anon/publishable key from `apps/web/.env.local` when available. The explicit template is [apps/extension/.env.example](apps/extension/.env.example). Build with:

```text
npm run build:extension
```

Then load `apps/extension/dist` from `chrome://extensions` using **Load unpacked**. Open the extension icon, enter the same email used on the web profile page, enter the OTP, and wait for **Profile synced from Supabase**.

### Production deployment

Deploy the web app first, then build the extension against it:

1. Deploy `apps/web` to Vercel or another Next.js host.
2. Set `NEXT_PUBLIC_APP_URL=https://ap.coderscookies.com`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only `MISTRAL_API_KEY` in the host environment.
3. Set Supabase Site URL to `https://ap.coderscookies.com` and add `https://ap.coderscookies.com/profile` to Redirect URLs.
4. Verify `ap.coderscookies.com` in Resend and configure Resend SMTP in Supabase Auth. Do not put the Resend API key in the extension or in a `NEXT_PUBLIC_*` variable.
5. Build the extension in production mode. Its Vite configuration uses `https://ap.coderscookies.com` as the production web API origin; set `VITE_WEB_APP_URL=https://ap.coderscookies.com` explicitly when building the production extension.
6. Run `npm run build:extension`, test the generated `apps/extension/dist`, then upload that directory as a Chrome Web Store package.

When the profile is updated on the web, open the extension popup and refresh/reopen the Side Panel. The background service worker re-fetches the normalized profile tables and replaces its local cache. Sign out removes the cached profile and session.

## Supabase next step

Copy `.env.example` to `apps/web/.env.local`, fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `MISTRAL_API_KEY`, then run both migrations in the Supabase SQL editor. The second migration adds resume metadata, job-tracker fields, indexes, and a private `resumes` Storage bucket. The migrations enable RLS and never store service credentials in the browser.

## Enable email + OTP sign-in

The profile page (`/profile`) has an in-app **"How do I enable email + OTP sign-in?"** guide, but the same steps in full:

1. In the Supabase dashboard, go to **Authentication → Sign In / Providers** and confirm **Email** is enabled (it is on by default for new projects).
2. Go to **Authentication → Email Templates → Magic Link** and confirm the template includes `{{ .Token }}`. Supabase includes the 6-digit `{{ .Token }}` in the default template — this is what lets users type a code instead of only clicking a link. Do not remove it if you customize the template.
3. Go to **Authentication → URL Configuration** and add your site's `/profile` route (e.g. `http://localhost:3000/profile` for local dev, plus your production URL) to **Redirect URLs**. This lets a clicked email link also complete sign-in.
4. Supabase's built-in email sending is rate-limited (a few emails per hour) and meant for development only. For real usage, configure a custom sender under **Authentication → Settings → SMTP**.
5. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to `apps/web/.env.local`, then restart `npm run dev:web`.
6. On `/profile`, enter an email and click **Email me a code**. Supabase calls this an OTP even though it is delivered by email, not SMS — `supabase.auth.signInWithOtp({ email })` sends it, and `supabase.auth.verifyOtp({ email, token, type: "email" })` verifies the 6-digit code the user enters.

Never expose a Supabase **service role** key in the browser or in the extension — only `NEXT_PUBLIC_SUPABASE_ANON_KEY` is safe there, and Row Level Security is what keeps each signed-in user's data private.

## Product roadmap

- **Phase 1 (current):** universal detector, safe profile fields, Side Panel, local demo profile.
- **Phase 2:** Supabase Auth + profile repository + resume upload/parse/review. The first version of this flow is now implemented with local fallback.
- **Phase 3:** answer library retrieval and application question history.
- **Phase 4:** platform adapters only for proven compatibility gaps (Greenhouse, Lever, Ashby, Workday).
- **Phase 5:** job description extraction, tailored resumes, application tracker, analytics.
