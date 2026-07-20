# Deploying StackUp

Three pieces, three homes:

```
  Web  (apps/web, static)  →  GitHub Pages   →  https://stackup.github.io
  API  (apps/api, Node)    →  Fly.io / any container host
  DB   (PostgreSQL 16)     →  Neon (managed, free tier)
```

The web app talks to the API over HTTPS; the API talks to Neon. Only the API
host costs anything (a few dollars, or free on Oracle Always Free). Pages and
Neon are free.

---

## 1 · Database — Neon

1. Create a project at **neon.tech** → name it `stackup`, Postgres 16, a region
   near where the API will run. Copy the **owner** connection string, e.g.
   `postgresql://neondb_owner:PW@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`.

2. In Neon's **SQL editor**, create the runtime role. It is `NOBYPASSRLS` — the
   whole point of the security model. **Do not** grant `BYPASSRLS` (Neon can't,
   and migration `0017` means you don't need it):

   ```sql
   CREATE ROLE stackup_app LOGIN PASSWORD 'a-strong-password' NOBYPASSRLS;
   ```

   > You do **not** run `db/bootstrap.sql` on Neon — it's for self-hosted
   > clusters (it creates roles + databases you already have here). You only
   > need the `stackup_app` role above; the Neon owner role plays the
   > schema-owner/migrator part.

3. Run the migrations as the **owner** connection string (creates every table,
   policy and function, and grants DML to `stackup_app`):

   ```bash
   ADMIN_DB_URL='postgresql://neondb_owner:PW@ep-xxx…/neondb?sslmode=require' \
     pnpm tsx db/migrate.ts
   ```

That's the database. Isolation is enforced by RLS, not by the role having any
special power — verified by the test suite running green with **every** role
set to `NOBYPASSRLS`.

---

## 2 · API — a container host (Fly shown)

The API is a long-running process with Server-Sent-Events, so it needs a host
that **stays on** (not a serverless/function platform). Fly is the easy button;
Oracle Cloud Always Free is the $0 option.

Set these environment variables / secrets on the host:

| Var | Value |
|---|---|
| `APP_DB_URL` | `postgresql://stackup_app:PW@ep-xxx…/neondb?sslmode=require` |
| `JWT_SECRET` | a random 32+ char string |
| `WEB_ORIGINS` | `https://stackup.github.io` (comma-separate if more) |
| `PORT` | `3000` (or what the platform expects) |
| `ANTHROPIC_API_KEY` | *(optional)* real AI Brain; omit to use the offline heuristic |
| `STACKUP_AI_MODEL` | *(optional)* defaults to `claude-opus-4-8` |

Deploy the `apps/api` build (`pnpm --filter @stackup/api build` → run
`node dist/main.js`). Point the host at the Neon URL above and it's live.

---

## 3 · Web — GitHub Pages at stackup.github.io

1. Create a free GitHub **organization** named `stackup`, then a repository
   named exactly **`stackup.github.io`** inside it. Push this codebase there
   (or transfer the repo). A repo named `<org>.github.io` serves its Pages at
   the **root** URL — so the PWA, service worker and `/manifest.webmanifest`
   all work with no `basePath` changes.

2. In that repo: **Settings → Pages → Build and deployment → Source:
   GitHub Actions**.

3. In **Settings → Secrets and variables → Actions → Variables**, add:

   ```
   NEXT_PUBLIC_API_URL = https://<your-api-host>
   ```

   (the URL from step 2 — this is baked into the client bundle at build time).

4. Push to `main`. The included workflow (`.github/workflows/deploy-pages.yml`)
   builds the static export and publishes it. Your app is live at
   **https://stackup.github.io**.

---

## Wiring checklist

- [ ] `WEB_ORIGINS` on the API includes `https://stackup.github.io` (CORS).
- [ ] `NEXT_PUBLIC_API_URL` variable set in the Pages repo (points at the API).
- [ ] `APP_DB_URL` on the API points at the Neon `stackup_app` role.
- [ ] Both API and web are HTTPS (no mixed content).

## Later (when you sign client #1)

None of the app code changes — you add managed pieces:

- Externalize the realtime bus (Redis / `LISTEN-NOTIFY`) to run >1 API instance.
- Move file bytes out of Postgres into S3-compatible storage (e.g. Cloudflare R2).
- Put a transaction-mode pooler (PgBouncer / Neon's pooled endpoint) in front of PG.
