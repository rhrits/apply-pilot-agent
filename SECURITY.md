# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's private vulnerability reporting on this repository
(*Security* → *Report a vulnerability*), and include:

- What the issue is and how to reproduce it
- The impact you believe it has
- Any suggested fix

We aim to acknowledge reports within a few days.

## Scope

ApplyPilot handles unusually sensitive data — resumes, contact details, salary
figures, work authorization status, and job search activity. The following are
treated as security issues, not bugs:

- Any path where one user can read another user's data (RLS bypass)
- A secret reaching the browser or the extension bundle
- Prompt injection that causes candidate data to leak or be exfiltrated
- The extension sending profile data to any origin other than the configured app
- An application being submitted without explicit user confirmation

## Key handling

| Secret | Correct location | Never |
|---|---|---|
| `MISTRAL_API_KEY` | Web server env only | Browser, extension, `NEXT_PUBLIC_*` |
| `STT_API_KEY` | Web server env only | Browser, extension |
| `GITHUB_TOKEN` | Web server env only | Browser, extension |
| Resend / SMTP key | Supabase Auth SMTP settings | Vercel env, repo, extension |
| Supabase **service role** key | Nowhere in this project | Anywhere client-side |
| Supabase anon/publishable key | Web + extension (public by design) | — |

The anon key is safe to ship publicly **only because RLS is enabled on every
user-owned table**. Any migration adding a table must enable RLS in the same file.

## Design guarantees

- The extension only ever sends a short-lived Supabase access token to the
  configured web app origin.
- Every AI route validates the bearer token server-side before reading profile data.
- Page content and crawled pages are treated as untrusted data, never instructions.
- `/api/enrich/link` rejects private and loopback addresses to prevent SSRF.
- Sensitive fields (salary, visa, authorization, demographics, consent) are always
  flagged for human review and never auto-submitted.

## If you leaked a key

1. Revoke it at the provider immediately.
2. Generate a replacement.
3. Update the server environment only.
4. Rotate anything that shared the same account.
