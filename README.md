# StackUp

> One app to plan, track, and get work done — an open, self-hostable work-management platform in the spirit of ClickUp.

StackUp is being built **module by module**. Each module is a working, testable slice
of the product. This is the foundation; the full roadmap is below.

## What is StackUp?

A multi-tenant, real-time work-management app: **Workspaces → Spaces → Folders → Lists →
Tasks**, with multiple views (List, Board, Calendar, Gantt…), Docs, Goals, Dashboards,
Time Tracking, Automations, and more — the ClickUp feature surface, rebuilt cleanly.

## Architecture

| Layer | Choice |
|---|---|
| **API** | NestJS 11 (Express), raw SQL over `pg` |
| **DB** | PostgreSQL 16 with **fail-closed Row-Level-Security** multi-tenancy (Workspace = tenant) |
| **Web** | Next.js 15 (App Router) + React 19, static export |
| **Shared** | `@stackup/shared` — types shared across clients |
| **Auth** | Argon2id passwords, two-stage JWTs (identity → workspace-scoped access), rotating refresh tokens |

### Security invariants (never regress)
1. The runtime DB role (`stackup_app`) is `NOBYPASSRLS` and owns no tables; every
   workspace-owned table has `FORCE ROW LEVEL SECURITY`.
2. Workspace context is set only via transaction-local `set_config(..., true)` inside
   `DbService.withWorkspace()` — no other write path to `app.current_workspace`.
3. No workspace context ⇒ every policy denies (fail closed).
4. `audit_log` is append-only (no UPDATE/DELETE grant + a blocking trigger).
5. Workspace provisioning goes only through `create_workspace_with_owner()` (SECURITY
   DEFINER); the app role cannot INSERT into `workspaces` directly.

A CI gate asserts cross-workspace isolation on every push.

## Repository layout

| Path | Contents |
|---|---|
| `db/` | bootstrap roles, SQL migrations (RLS policies live here), migration runner |
| `apps/api` | NestJS API: auth, workspaces/members, DB tenancy runtime, audit |
| `apps/web` | Next.js web app: auth, workspace picker, app shell, dashboard |
| `packages/shared` | Types shared with web/mobile clients (roles, token claims) |

## Development

Prerequisites: Node 22+, pnpm 10+, PostgreSQL 16+.

```bash
# 1. One-time: create roles + databases (as a Postgres superuser)
sudo -u postgres psql -v ON_ERROR_STOP=1 -f db/bootstrap.sql

# 2. Install and migrate
pnpm install
pnpm db:migrate        # stackup_dev
pnpm db:migrate:test   # stackup_test (used by the test suites)

# 3. Run the API (http://localhost:3000) and web (http://localhost:3001)
pnpm dev:api
pnpm dev:web

# 4. Tests — includes the cross-workspace RLS isolation gate
pnpm build && pnpm test
```

## Roadmap

- **M0 — Foundation & Platform Core** ✅ (auth, workspaces, members, RLS, app shell) — *this module*
- M1 — Hierarchy: Spaces / Folders / Lists
- M2 — Teams, Guests & Permissions
- M3 — Tasks Core
- M4 — Custom Fields, Dependencies & Recurrence
- M5 — Views Engine (List, Board, Calendar, Table, Gantt)
- M6 — Real-time Collaboration (comments, mentions, activity, presence)
- M7 — Docs, Wikis & Notepad
- M8 — Time Tracking, Timesheets & Workload
- M9 — Goals, OKRs & Portfolios
- M10 — Dashboards, Reporting & Sprints
- M11 — Forms & Automations
- M12 — Whiteboards, Mind Maps, Proofing & Clips
- M13 — Chat, SyncUps & Email
- M14 — Search, Command Center, Home & Templates
- M15 — AI (Brain), Integrations, API & Offline
