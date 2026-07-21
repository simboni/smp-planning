# Security

This document records StackUp's security posture and the results of the
codebase security sweep.

## Reporting

Found something? Email the maintainer rather than opening a public issue.

## Architecture guarantees

- **Multi-tenancy** is enforced by PostgreSQL row-level security, not by
  application code. The runtime DB role (`stackup_app`) is `NOBYPASSRLS` and
  owns no tables; every tenant table has `ENABLE` + `FORCE ROW LEVEL SECURITY`
  with `USING` and `WITH CHECK` policies keyed on a transaction-local
  `app.current_workspace`. The workspace id always comes from the verified
  access token, never from a request body — so a token minted for workspace A
  cannot read or write workspace B.
- **Passwords** are hashed with argon2id (`m=65536, t=3, p=4`); login runs a
  constant-work dummy-hash on unknown emails to avoid user enumeration.
- **Tokens**: short-lived access/identity JWTs (15 min) + rotating, single-use
  refresh tokens stored only as SHA-256 hashes. `POST /auth/logout` revokes the
  presented refresh token.

## Sweep results (2026-07)

A four-part audit (auth/tokens, multi-tenancy/IDOR, SQL injection, and
web/input/config) found no cross-tenant IDOR and no SQL injection. The
following issues were found and **fixed**:

| Area | Fix |
| --- | --- |
| Stored XSS in Docs/Notepad (bypassable regex sanitizer) | Replaced with the `xss` allow-list HTML sanitizer (`docs.support.ts`). |
| Weak committed JWT-secret fallback | In production the app never signs with the committed default: if `JWT_SECRET` is unset it generates a strong random ephemeral secret for the run (and warns to set a persistent one) instead of crashing. |
| 2FA challenge token accepted as a credential | `JwtAuthGuard` now only accepts `identity`/`access` tokens and pins HS256. |
| No rate limiting | `@nestjs/throttler`: 300/min global, 10/min on auth endpoints, 20/min on the public form. |
| DB TLS not verified (MITM) | Certificates are verified by default; `DB_SSL_CA` / `DB_SSL_INSECURE` for edge cases. |
| SSRF via outbound webhooks | https-only + private/loopback/link-local host block + no redirect following. |
| Webhooks creatable by any member | Now `@Roles("admin")`. |
| Personal access tokens listable/revocable across users | Scoped to the owning user. |
| Checklist assignee not validated | Must be a workspace member. |
| Health endpoint leaked DB error detail | Detail logged server-side; response is now `{status, db}` only. |
| No CSP / missing headers | Strict CSP (`connect-src 'self'` blocks token exfiltration) + attachments served `attachment` unless a known image type. |
| Android `allowBackup` extractable tokens | `allowBackup="false"`. |
| LIKE-wildcard in search | Metacharacters escaped. |

## Known residual items (recommended follow-ups)

These are lower-severity or need infrastructure that isn't in place yet:

- **Native OAuth deep link** returns tokens via a `com.stackup.app://` custom
  scheme, which a co-installed Android app could register. The robust fix is
  verified **App Links** (an `assetlinks.json` on the live domain) — do this
  once `app.stackup.co.ke` DNS is live. Until then, the web OAuth flow is
  unaffected.
- **Realtime SSE** (`/events/stream`) currently fans workspace-wide event
  *metadata* (ids/timestamps) to all members; a member without access to a
  private space can see that activity exists (but not its contents — the REST
  reads are still RLS-gated). Follow-up: tag events with `spaceId` and filter
  per subscriber.
- **Refresh-token reuse detection**: rotation is single-use, but replaying a
  revoked token isn't yet treated as a compromise signal (family revocation).
- **Email verification / password reset** flows are not implemented.
- **Global `ValidationPipe` + DTOs**: request bodies are validated per-handler;
  a framework-level whitelist would be defense-in-depth against mass-assignment.
