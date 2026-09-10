# UplyFox Rebrand — Implementation Plan

Renaming the product from **ApplyPilot** to **UplyFox**, applying the new Pixel/Crimson fox
mark and purple+wine theme, and cleaning up landing-page copy. Executed in two phases:
**web app first**, then **browser extension**. Internal/DB identifiers that are not
user-visible are deferred (see "Out of scope" at the end) to avoid risky schema churn.

## Final brand facts

- Product name: **UplyFox** (one word, capital U and F).
- Tagline direction: "Outfox the hiring grind with clever precision."
- Primary mark: Pixel/Bold fox squircle, recolored crimson→wine→purple gradient
  (`brand/uplyfox-pixel-crimson-logo.svg`, copied into both apps' `public/`).
- Wordmark lockup: `brand/uplyfox-lockup.svg`.
- Theme colors: keep the existing purple system (`--purple:#5546d9`, `--purple-dark:#24234a`,
  `--lavender:#eeecff`) as primary; add wine/crimson (`#8b1e3f` / `#fdf2f5` tint) as the
  identity/accent color instead of the old orange (`#f09c73`).
- npm workspace scope: `@applypilot/*` → `@uplyfox/*` (root package name `applypilot` → `uplyfox`).

## Phase 0 — Plan and inventory (this doc)

- [x] Grep the full repo for `ApplyPilot`, `applypilot`, `apply-pilot`, `ap.coderscookies`.
- [x] Confirm `sharp` is available at the repo root for regenerating PNG icons from the new SVG.
- [x] Group every match into: web app UI text, web app metadata/SEO/OG, email templates,
      npm package scope, extension UI text, extension manifest/icons, docs/root files,
      and internal/DB identifiers (deferred).

## Phase 1 — Web app (`apps/web`, `packages/shared`)

1. **npm package scope rename**
   - `package.json` (root): `"name": "applypilot"` → `"uplyfox"`.
   - `packages/shared/package.json`: `@applypilot/shared` → `@uplyfox/shared`.
   - `apps/web/package.json`, `apps/extension/package.json`: name + dependency reference.
   - Every `from "@applypilot/shared"` import (~25 files across web/extension/shared) →
     `from "@uplyfox/shared"`, done via batched `multi_replace_string_in_file` calls.
   - Run `npm install` at the repo root afterward to relink workspace symlinks.

2. **Logo/icon assets**
   - Copy `brand/uplyfox-pixel-crimson-logo.svg` and `brand/uplyfox-lockup.svg` into
     `apps/web/public/` (done) and `apps/extension/public/`.
   - Regenerate `apps/web/public/icons/{48,128}.png` and `apps/extension/public/icons/{16,32,48,128}.png`
     from the new SVG using `sharp` (script run once via terminal, output committed as binary PNGs).
   - Remove the old `applypilot-icon.svg` once nothing references it.

3. **Metadata / SEO / Open Graph**
   - `apps/web/app/layout.tsx`: title/description/OG/Twitter/icons → UplyFox (done).
   - `apps/web/app/opengraph-image.tsx`: redraw with the UplyFox logo mark, wine/purple
     gradient background, and the new tagline instead of the ApplyPilot wordmark.
   - Set `metadataBase`/canonical domain to the production app domain (`uply.foxea.xyz`).

4. **User-facing UI text** (every page that currently renders "ApplyPilot")
   - `app/page.tsx` (landing) — already swapped to UplyFox; also **simplify copy** (Phase 1.5).
   - `app/login/page.tsx`, `app/dashboard/page.tsx`, `app/access/page.tsx`,
     `app/admin/page.tsx`, `app/onboarding/page.tsx`, `components/auth-gate.tsx`,
     `components/account-security.tsx`.
   - Replace `/icons/48.png` brand references with the new logo file where the old icon
     is used as a brand mark (keep `/icons/48.png` and `/icons/128.png` as the regenerated
     UplyFox PNGs so existing `<img>` tags keep working without path churn).

5. **Emails and outbound identity**
   - `.env.example`, `apps/web/.env.example`: `RESEND_FROM_NAME=ApplyPilot` → `UplyFox`.
   - `apps/web/app/api/admin/codes/send/route.ts`: subject line, plaintext body, HTML
     template (`APPLYPILOT` header, footer, button copy) → UplyFox, wine/purple accent color.
   - `apps/web/app/api/enrich/link/route.ts`, `apps/web/app/api/enrich/github/route.ts`:
     `User-Agent` header strings → `UplyFox`.

6. **localStorage / postMessage keys**
   - `apps/web/app/answer-library/page.tsx`, `apps/web/app/tracker/page.tsx`: storage keys
     `applypilot-answers`, `applypilot-jobs`, `applypilot-job-draft` → `uplyfox-*` (bump key
     name; old data is sample/demo data only, no migration needed for local-only fallback).
   - `apps/web/lib/session-cleanup.ts`: rename exported helpers
     (`clearApplyPilotBrowserData`→`clearUplyFoxBrowserData`,
     `signOutApplyPilot`→`signOutUplyFox`) and the `postMessage` `source`/`type` strings,
     updating the one call site in `components/account-security.tsx`.

7. **Landing page copy cleanup** (explicit ask: remove unnecessary text, make it clean)
   - Trim the hero lede to one crisp sentence.
   - Cut the "10 specialist agents + orchestrator" swarm-diagram section — it's marketing
     filler that doesn't map to real product surfaces.
   - Shorten feature-card and workflow-step descriptions to a single short sentence each.
   - Keep: hero, trust strip, product surfaces (real UI), workflow (4 steps), trust/boundaries,
     open-source card, footer — but tighten wording throughout.

## Phase 2 — Extension (`apps/extension`)

1. `manifest.ts`: `name: "ApplyPilot"` → `"UplyFox"`, `default_title`, description tagline.
2. `popup.html`, `sidepanel.html`: `<title>` tags.
3. `popup.tsx`: session-checking message, brand header, "Authenticated job copilot" strap.
4. `sidepanel.tsx`: header `<h1>ApplyPilot</h1>`, locked/description copy, sign-in copy.
5. `content.ts`: in-page overlay title (`✦ ApplyPilot`) → `✦ UplyFox`; internal DOM id
   `applypilot-overlay-host` and `postMessage` source string kept in sync with the web app's
   renamed values from Phase 1.6.
6. `background.ts`: user-facing error copy ("Redeem an ApplyPilot access code…") → UplyFox.
   Internal alarm/port names (`applypilot-profile-sync`, `applypilot-panel`) are safe to
   rename for consistency since they're same-process constants with no persisted schema.
7. Icons: point `manifest.ts` and `public/` at the regenerated UplyFox PNGs (same filenames,
   new pixel content, so no path changes needed).
8. `public/applypilot-icon.svg` removed once unreferenced.

## Phase 3 — Docs and repo metadata (light pass)

- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `PRODUCT_STRATEGY.md`, `IMPLEMENTATION_PLAN.md`,
  `LICENSE`, `docs/*.md`: swap the product name and the brand logo reference at the top of
  the README. Do not attempt a full copy rewrite of internal planning docs — only the name.
- `.github/ISSUE_TEMPLATE/*`: placeholder text referencing "ApplyPilot 0.2.0" → "UplyFox 0.2.0".

## Validation

- `npm test`, `npm run typecheck --workspaces --if-present`, `npm run build:web`,
  `npm run build:extension` after each phase.
- Manually grep for residual `ApplyPilot`/`applypilot` occurrences once both phases land,
  confirming only the intentionally-deferred internal identifiers remain.

## Out of scope (explicitly deferred, not silently skipped)

- **Supabase RPC name** `is_applypilot_admin()` and its SQL policy references
  (`supabase/migrations/202609090001_access_requests_and_coupons.sql` and
  `202609090002_access_code_email.sql`). Renaming a deployed Postgres function requires a
  new migration (create `is_uplyfox_admin`, update every policy/RPC call site, drop the old
  one) — a schema change, not a text rebrand. Tracked as a follow-up migration, not done here.
- **Hosting domain** (`uply.foxea.xyz`). The application code now uses the new canonical
  domain; DNS, hosting, and redirect configuration still need to be managed by the deployment
  provider.
- **GitHub repository URL** (`github.com/rhrits/apply-pilot-agent`) — renaming the repo is a
  separate decision from renaming the product in-app; links are left pointing at the real repo.
