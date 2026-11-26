# CRUD sweep — findings and fixes

A pass over create / read / update / delete on every entity in StackUp:
the work hierarchy, content, the org/HR module, and configuration. Each entry
below is a real defect a user would hit, with the symptom it produced and
what was done about it.

**Status of this sweep:** 36 defects found, 30 fixed, 6 left open (listed at
the end with a reason). API suite: 237 tests across 35 suites, all passing.

Two new migrations ship with this work:

| Migration | What it does |
| --- | --- |
| `0043_repair_governance.sql` | Re-asserts the whole governance schema idempotently. On a drifted database `0019` could be recorded as applied while `memberships.custom_role_id` never landed — which 500s every members read. |
| `0044_form_responses.sql` | Stores form submissions by field id, and cleans up custom-field values pointing at deleted options. |

If `ADMIN_DB_URL` is not set on the API host, apply
`deploy/neon-catchup-0043-0044.sql` by hand. Setting `ADMIN_DB_URL` makes this
unnecessary, permanently.

---

## The four reported problems

### 1. Notes were impossible to find — FIXED

There were **two different notepads** writing to different places:

- the 🗒 button (bottom-right) wrote to the `notes` table on the server;
- the "Notepad" card on Home wrote to `localStorage["stackup.home.notepad"]`,
  which never left that one browser.

Anything typed into the Home card was invisible from the panel, absent from
search, and lost on another device or after clearing site data. Neither
notepad had a nav entry, and note content wasn't searchable, so once the panel
was closed there was no route back to a note.

Now: one store (the server) behind all surfaces. The Home card reads and
writes the same notes and migrates anything still in the old local key into a
real note on first load. There's a **Notes** page (`/notes`) with a filter,
listed in the left menu under Create & Share. Note content is searchable from
⌘K, and a hit deep-links to the note. The 🗒 button carries a count so notes
aren't invisible while it's shut. Save failures are shown on the note instead
of being swallowed.

### 2. The note→task picker hid Spaces and couldn't create anything — FIXED

The picker built its list with
`tree.filter(s => permissionAtLeast(s.myPermission, "edit")).filter(s => s.lists.length > 0)`.
The second filter dropped **every Space that had no Lists yet** — so a new
Space was simply missing, with no way to add a List from there, and archived
Spaces were offered while live empty ones were not.

Now a shared `ListDestinationPicker` offers every Space you can edit, empty or
not, shows how many Lists each has, and can create a **List** (or a whole
**Space**) inline. The same picker is used in three places: note → task, the
space-view quick-add, and the new task **Move** action.

### 3. The doc editor wiped what you typed — FIXED (root cause found)

This is a **React 19 regression**, which is why the earlier round of fixes
(remount keys, refetch guards, save sequencing, blur/pagehide saves) didn't
help — none of them were on the failing path.

`react-dom@19` changed how `dangerouslySetInnerHTML` is diffed.
`updateProperties` gates the write on `nextProp !== lastProp` — a **reference**
compare of the `{__html}` object — and then assigns `domElement.innerHTML`
with no comparison of the string. React 18 compared the html strings, so a
re-render was free. The editor passed a fresh `{__html: page.content}` literal
on every render, so **every re-render wiped the live editable DOM** and
reseeded it with the content from the last GET.

The sequence the user saw:

1. type;
2. ~800 ms later autosave resolves and calls `setSaveState("saved")`;
3. that re-render reverts the editor to the text the page loaded with;
4. the next keystroke saves that reverted DOM — making the loss **permanent
   on the server**.

Typing in the title, a collaborator's event, or opening a menu did the same.

Fixed by taking `innerHTML` out of React's hands: the writing surface is now a
`DocEditable` component that seeds the DOM **imperatively** once per
page/version and is thereafter owned by the browser. Verified in a real
browser both ways — with the old rendering the editor empties itself and the
server keeps only the later sentence; with the fix all text survives autosave,
further typing, and title edits, and both sentences reach the server.

Also fixed in the editor:

- the dirty flag, html mirror and retry timer were component-wide while the
  selected page was not, so a retry after a network blip could PATCH page B's
  row with page A's text (or mark page A clean without saving it). Every save
  is now bound to the page it was typed into.
- a `visibilitychange` listener was never removed, leaking one handler per
  mount that fired `setState` on dead components.
- page creation swallowed its errors, so the "+" button looked dead on a 403
  or plan limit.
- an uploaded document opened at `/doc?id=` sat on the loading skeleton
  forever (uploads have no pages) — it now offers the file.

### 4. No way to move a task — FIXED

`PATCH /tasks/:id { listId }` has always worked, including across Spaces (it
re-homes status, type, tags and field values). Nothing in the app ever sent
it: there was no Move control anywhere, so a task in the wrong list had to be
deleted and retyped. The task panel now has a **Move** action using the shared
picker.

---

## Hierarchy: Spaces, Folders, Lists, Tasks

| # | Severity | Defect | Status |
| --- | --- | --- | --- |
| 1 | High | Archiving a **folder** made its Lists vanish app-wide. The tree attached lists to folder nodes and dropped any list whose folder wasn't in the `archived = false` set, so the lists disappeared from the sidebar, the space page and every picker — while their tasks still showed in space views with no list to open, and nothing marked the lists archived. | Fixed — a live list under an archived folder surfaces at space level |
| 2 | High | **Archive was a one-way door.** Every read filters `archived = false` and nothing ever sent `archived: false`, so an archived Space (with all its folders, lists and tasks) was invisible and unrecoverable through the product. | Fixed — `GET /hierarchy/archived` plus an **Archived** section with Restore on the Everything page |
| 3 | High | Every quick-add control in the space-page views was wired to a **no-op** while still being rendered. Table's "New task", Calendar's click-a-day and the per-status "Add task" rows accepted a name, cleared the input and created nothing — no task, no error. | Fixed — they create in the space's first List, and say so when the Space has none |
| 4 | High | A member who **created** a Space could never rename, recolor, archive or delete it: the creator only got a `full` self-share when the Space was private, and no UI creates private Spaces, so they resolved to `edit` while every manage action needs `full`. | Fixed — the creator always gets a full self-share |
| 5 | Medium | The sidebar offered six Space actions to anyone with `edit`; four need `full` server-side and reorder is owner/admin only, so they answered with 403 toasts. Space drag-reorder had no permission gate at all. | Fixed — gated to match the server; a rejected reorder now explains itself |
| 6 | Medium | Rename/delete of the open List or Space from the sidebar left the page showing stale data. | Open (see below) |
| 7 | Medium | "Add list"/"Add folder"/"New space" failures were swallowed — a 403 or network error looked identical to the button doing nothing (the Everything page had no `catch` at all, so it was an unhandled rejection). | Fixed |
| 8 | Medium | Space-level Board drag discarded the within-column order: the handler ignored the ordered-ids argument, so moving a card inside a column snapped back. | Fixed — reorders per list, since a space column can span lists |
| 9 | Low | Timeline was never remembered for a List: the restore allowlist omitted `"timeline"` although the tab offers it. | Fixed |
| 10 | Low | The space page gated commenting on `edit`, stricter than the server, which allows `comment`. | Fixed |
| 11 | Low | Changing a task's status didn't recompute `position`, so the card landed at an arbitrary place in the target group. | Open |
| 12 | Low | A second edit issued while one was in flight was dropped with no feedback, then overwritten by the reload. | Open |

## Content: docs, files, forms, whiteboards

| # | Severity | Defect | Status |
| --- | --- | --- | --- |
| 13 | High | **Form answers were keyed by field label text.** Submissions were stored only as `Label: value` lines in the created task's description and read back by matching current labels — so renaming a field orphaned every earlier answer (blank cells, and a response whose only matching label was renamed vanished entirely), two fields sharing a label collided, and a textarea answer containing a line like `Email: a@b.com` was mis-attributed. | Fixed — `0044` stores answers by field id; the description parse remains as a fallback for pre-migration submissions |
| 14 | Medium | A form's `responseCount` counted every task in the list with a description, so manual and automation-created tasks inflated it ("14 responses" over a table of 3). | Fixed |
| 15 | Medium | Adding or deleting a doc page published no event and didn't touch `docs.updated_at`, so a collaborator's change was invisible in other open editors and `/docs` kept a stale page count. | Fixed |
| 16 | Medium | Whiteboard and mindmap events carry no `actorUserId`, so your own autosave echoes back to your own tab; past a 2 s guard it replaces the board wholesale, and in-progress inline text editing isn't protected. | Open |
| 17 | Medium | A whiteboard over 512 KB fails to save with no actionable message and no retry; every later edit re-fails. | Open |

## Organization: members, departments, leave, roles

| # | Severity | Defect | Status |
| --- | --- | --- | --- |
| 18 | High | **Two unsynchronised sources of "department head."** `departments.lead_user_id` (the dropdown) and `department_members.dept_role` ("Make head") were written independently and never reconciled. Leave approval and the HR badge read `dept_role`; onboarding's "Department head" assignee reads `lead_user_id`. So a head set via the dropdown got an empty approvals queue, wasn't on the roster and showed no badge — and every "Department head" checklist step was assigned to the new hire instead. A head set via the roster left the card reading "No head". | Fixed — both writes reconcile, including at create and on removal |
| 19 | High | Removing a workspace member **orphaned every org row** that referenced them: `department_members`, `team_members` and `leave_requests` key off `users(id)`. The person became an unfixable ghost — the card said "5 people" over 4 names, the stale row couldn't be deleted, and their approved leave still showed in "Who's away". | Fixed — those rows are cleaned up, named-head references cleared, pending leave withdrawn |
| 20 | High | `0019` isn't statement-idempotent and the migrator's tolerant mode records a migration as applied when it fails on a duplicate object. On a drifted database `custom_roles` existing without `memberships.custom_role_id` baselines `0019` with the column never landing — and every members read selects it, so the Members page, People, HR, Roles and the department member picker 500 permanently. | Fixed — repair migration `0043` |
| 21 | Medium | The department roster joined `memberships` with no workspace predicate. The read policy also admits the acting user's rows in other workspaces, so an admin in two workspaces appeared **twice**, one row carrying the other workspace's role and title. | Fixed |
| 22 | Medium | Relinking or deleting a department strands its auto-created private Space: the department share is the only grant, so the Space — including the Onboarding list and its tasks — silently disappears for everyone but owner/admin, with no warning. | Open |
| 23 | Medium | Creating a department with a Space didn't reload the sidebar tree, so the new Space (and its Onboarding list) was missing until a full browser refresh — the option looked like it did nothing. | Fixed |
| 24 | Medium | Saving the onboarding checklist was all-or-nothing and 400'd on a step set to "Specific person" with nobody chosen — which is the picker's default state. One unfinished step discarded every other edit and showed "assigneeUserId must be a uuid". | Fixed — names the step that needs a person |
| 25 | Medium | `cancel` accepted any approved leave with no date bound; the "future-dated only" rule lived in the client alone, so a member could cancel last month's approved leave against the API and win the days back. | Fixed |
| 26 | Medium | Team reads had no role guard despite being documented as member-only, so a **guest could enumerate every team's full roster** with names and emails. | Fixed |
| 27 | Medium | Assigning a custom role failed silently: on a non-Business plan the 403 rejected unhandled and the `<select>` snapped back with no message. Same for deleting a role. | Fixed |
| 28 | Medium | 5 of the 7 capability toggles are never enforced (`deleteItems`, `createDocs`, `manageAutomations`, `exportData`, `manageMembers` have no call sites) yet all seven render as checkboxes. | Open |
| 29 | Low | The leave decision UPDATE had no status guard and no row lock, so two approvers deciding at once both succeeded — the second overwriting the first, with two audit entries for one request. | Fixed |
| 30 | Low | Leave spanning New Year is bucketed wholly into its start year. | Open |
| 31 | Low | The Organization nav section is shown to guests, but those pages 403. | Open |

## Configuration: dashboards, fields, views, shares

| # | Severity | Defect | Status |
| --- | --- | --- | --- |
| 32 | High | **Dashboard card reordering was a no-op.** `moveCard` wrote `position = target` on the moved card and never renumbered siblings, so two cards shared a position and the read's `created_at` tie-break restored the original order — the card visibly moved and snapped straight back, in both directions. | Fixed — siblings renumber to a contiguous run; covered by a new test |
| 33 | High | Deleting one option of a **labels** field bricked that field on every affected task. Removing an option never pruned stored values, the client rebuilds its payload from the stored array, so every click re-sent the dead id and was rejected — no way to add or remove any label again. | Fixed — removing an option prunes stored values, and `0044` cleans up existing rows |
| 34 | Medium | Re-sharing after a revoke **resurrected the old token**: the upsert cleared `revoked_at` but kept the token, so "Stop sharing" then "Create public link" handed back the same URL and every copy the user thought they'd killed started working again. | Fixed — a revoked link gets a new token; a live one keeps its own |
| 35 | Medium | Any write to a done status reset `completed_at` to now, so Done → Closed (or re-picking the same status) rewrote the completion date and re-counted old work in this week's trend and burndown. Deleting or retyping a status left `completed_at` stale the other way. | Fixed |
| 36 | Medium | Webhook and API-token mutations swallowed every error. The client check accepts `http://` but the server rejects non-https and private hosts, so the user clicked "Add", saw nothing, and reasonably concluded the webhook existed. | Fixed |
| 37 | Medium | Saved-view config autosave is optimistic with no rollback and no debounce: a failed PATCH leaves the filters looking saved for the session, then silently reverting on reload. | Open |

---

## Left open, and why

- **#6 stale page after a sidebar rename/delete** — needs the List and Space
  pages to derive their header from the shared tree rather than a one-shot
  fetch. Worth doing, but it's a restructure of both pages rather than a
  contained fix.
- **#11 / #12 task position and in-flight edits** — cosmetic ordering and a
  dropped double-edit; no data loss.
- **#16 / #17 whiteboard echo and oversize saves** — the same class of problem
  the doc editor had. Fixing it properly means adding `actorUserId` to the
  board events and a real "this board is too big" path.
- **#22 stranded department Space** — needs a decision from you: warn before
  unlinking, or convert the Space to workspace-visible.
- **#28 unenforced capabilities** — either wire the five remaining checks into
  the services, or hide the toggles until they do something. The honest
  short-term move is to hide them; tell me which you want.
- **#30 / #31 / #37** — low impact, each a small contained change.

## Clean areas

No defects found in: database integrity on delete (every FK into
spaces/folders/lists/tasks cascades or nulls correctly across all 44
migrations), cross-space move reconciliation, subtasks, the List page's
optimistic paths (all roll back on rejection), the doc sanitizer and
allow-list, upload validation and raw-file serving, comments, saved-views API,
automations (no double-fire, missed-fire or wrong-event), notifications read
state, time tracking, public-link revocation enforcement, API tokens, space
sharing ACL, statuses and tags CRUD, templates, and the command palette.
