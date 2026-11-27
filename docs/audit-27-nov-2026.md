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
