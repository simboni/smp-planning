# App audit (27 Nov 2026) — high-priority fixes

| # | Problem | Fix |
|---|---|---|
| H1 | Calendar: long titles pushed Wed–Sun off-screen | Day columns are `minmax(0, 1fr)` and cells clip, so titles shorten with "…"; on phones all 7 days fit with no sideways scroll |
| H2 | Unknown addresses showed raw `{"message":"Cannot GET …"}` | Branded `not-found.tsx` page; the API sends it (status 404) to any browser navigation that matches no page and no API route. API calls and real API 404s still get JSON. API not moved under `/api` (would change every endpoint, including the installed app's) |
| H3 | Owner told "no permission" for the audit log | Owner always had the capability; the refusal was the Business-plan gate. The page now says "available on the Business plan" with a link to Plans |
| H4 | Any owner could switch to Business for free; branding looked editable on Free | In production, paid plans can't be self-selected until billing exists (`PLAN_SELF_SERVE=true` turns it back on); Plans shows "Coming soon". Branding controls are locked on Free (the server already refused them) |
| H5 | Refresh token in localStorage; access token in the live-updates URL | Web sign-in puts the refresh token in an httpOnly, SameSite=Strict cookie (Path=/auth); localStorage keeps only a marker. Existing sessions move over automatically on next open. Live updates trade the access token for a one-time 60-second ticket. The installed app keeps body tokens (no shared cookie jar) |
| H6 | "Overdue" disagreed between Copilot and My Work; done tasks showed red dates | One rule everywhere (`apps/api/src/common/dates.ts`, mirrored in `apps/web/lib/format.ts`): calendar days in Africa/Nairobi (`APP_TIMEZONE`), due today is never overdue, done is never overdue. Applied to Copilot, My Work, goals, dashboards, the overdue automation trigger, and the List/Board/Table/My Work chips |
| H7 | Opening /login while signed in dropped the workspace | /login sends a signed-in user back to their workspace; the picker only replaces the workspace when another is chosen |

Tests: `apps/api/test/audit-high.e2e-spec.ts` (11). Full API suite 38 suites / 282 tests.

Setting a paid plan by hand (until billing): on the server,
`docker compose exec db psql -U stackup_migrator stackup -c "UPDATE workspaces SET plan='business' WHERE slug='<slug>';"`

## Medium and low fixes

| # | Problem | Fix |
|---|---|---|
| M1 | Home's "Needs your attention" kept finished tasks until a reload | Home refetches (debounced) on live task/time events and when you return to the tab |
| M2 | Long task titles clipped in the drawer | Title box grows with the text |
| M3 | Generated titles cut mid-word | Built-in planner trims on word boundaries ("…" only when cut); the subtask fallback no longer pastes a sliced task name into every step |
| M4 | Copilot added 3–4 generic top-level tasks every time | Built-in planner makes ONE task named after the brief, with the steps as its subtasks (plans can carry subtasks; the preview shows them) |
| M5 | Active sessions card looked empty | Loads up front, shows the device count and a "Show devices" label while collapsed; clearer empty text |
| M6 | Timeline bars with overlapping dates collided | Each lane stacks overlapping bars into rows |
| M7 | 7-second timer showed "0:00"; timer start added a sideways scrollbar | Durations under a minute show seconds ("7s"); the top-bar timer chip shrinks instead of widening the page |
| M8 | Workspace picker ran name and slug together | Slug on its own line |
| L1 | Gantt opened on an old date with no visible today line | Opens scrolled to today; stronger bars, readable labels |
| L2 | Lists, Sprints and Automations stacked under every Space view | Space page tabs: Tasks / Lists / Sprints / Automations |
| L3 | "Updated the dates" for no-op saves; subtasks and checklists not logged | Only real date changes are logged; "added subtask …" and "added checklist …" entries |
| L4 | First checklist item typed right after creating the checklist was lost | Drawer edits queue instead of being dropped while another save is in flight |
| L5 | Comment name, text and actions on one line | Name/time line, then the comment, then Reply / Edit / Delete |
| L6 | Scrolling past the drawer scrolled the page behind | `overscroll-behavior: contain` |
| L7 | Attachments / Email headings indented | Icons removed from those headings so all line up |
| L8 | "or" half hidden behind "Build with Copilot" | "—— or ——" divider on its own line |
| L9 | Floating notes button covered the last row on phones | Pages get bottom room on narrow screens |
| L10 | Two near-identical purples; workspace name shown twice | Second purple replaced (lime); admins see name/colour only in Branding |
| L11 | "7 lists" but 4 chips; every Space the same colour/icon | "+N more" chip; new Spaces cycle through 10 colours (first stays purple); cards show the Space's initial |
| L12 | Every tab titled "StackUp" | Per-page titles ("Coding · StackUp", "Home · StackUp") |
| L13 | UI named server variables | Plain wording; the variables stay in the deploy docs |
| L14 | Copilot answer one run-on paragraph with "task(s)" | Bulleted sections, real plurals, and "Basic mode — no AI model connected" label |

Existing Spaces keep their colours (change them from the Space menu). Tests: `apps/api/test/audit-medium-low.e2e-spec.ts` (5). Full API suite 39 suites / 287 tests.
