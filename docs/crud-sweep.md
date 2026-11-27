# CRUD sweep — what was wrong, what changed, what is still open

Branch `claude/crud-sweep`, merged into `claude/clickup-recreation-9vk6m2`.
Migrations: `0045_repair_governance.sql`, `0046_crud_sweep.sql`.

## The three things you reported

### 1. "I don't know where my quick notes go"
There were two separate note stores. The **Home card** notepad saved only in that
browser's localStorage (invisible on any other device, lost if the browser was
cleared). The **🗒 button** saved to the server, but nothing in the app listed those
notes.

Now:
- One store: the server. Both the Home card and the 🗒 button write there.
- New **Notes** page (`/notes`), linked in the left menu under *Create & Share*,
  from the 🗒 panel ("All notes") and from the Home card ("All notes (N)").
- The 🗒 button shows how many notes you have.
- ⌘K search finds notes by their text.
- Any old Home-card text left in a browser is moved to the server automatically
  the first time that browser opens StackUp.
- Notes save as you type (and on leaving the field); a failed save says
  "Not saved — retry" instead of silently losing text.
- "→ task" turns a note into a task in any list (first line = task name).

### 2. "Moving a task — I'm not given all Spaces, and can't create a Space or List"
The old picker skipped Spaces that had no lists yet, and had no way to create one.

Now a shared destination picker (used by *Move* on a task and *→ task* on a note):
- shows every Space you can add to, including empty ones;
- search across all lists, grouped by folder;
- **New Space** and **New List in …** right inside the picker — the new list is
  picked straight away.
- The task panel has a **Move** button.

### 3. "The document tool keeps refreshing and my content disappears"
Cause: React 19 re-applies `dangerouslySetInnerHTML` whenever the object changes,
so every autosave re-render overwrote what you were typing.

Now the editor sets its content once and never lets React overwrite it. Unsaved
edits are kept per page, saved together, and retried every 4s if the network fails.
Uploaded files open with an "Open file" button instead of an empty page.

## Sweep fixes (API)
| Area | Problem | Fix |
|---|---|---|
| Hierarchy | Lists inside an archived folder vanished | They show at Space level |
| Hierarchy | No way to see or restore archived items | `GET /hierarchy/archived` + Archived section on Everything |
| Hierarchy | A member who created a Space couldn't manage it | Creator gets full access (also backfilled) |
| Tasks | Moving done→done reset the completed date | Kept |
| Statuses | Retyping/deleting a status left completion dates wrong | Recomputed |
| Fields | Deleted label/dropdown options stayed on tasks | Pruned (also backfilled) |
| Dashboards | Moving a card didn't renumber the others | Full reorder |
| Shares | Re-sharing changed the public link | Link only changes after a revoke |
| Docs | Adding/removing a page didn't update the doc | Bumps `updated_at` + live event |
| Forms | Responses re-parsed from the task description (broke on label edits) | Stored answers in `form_responses`, response count fixed (old ones backfilled) |
| Departments | Lead and "head" roster could disagree | Kept in sync both ways (also reconciled) |
| Workspace | Removing a member left them in teams/departments and their leave pending | Cleaned up |
| Leave | Two approvers could decide the same request | Row lock; second gets "Someone else decided this request first" |
| Leave | Could cancel leave already taken | Blocked |
| Teams | Guests could list teams | Members only |
| Search | Notes not searchable | Added |

## Sweep fixes (web)
- Space page: quick-add was a no-op — now adds to the first list ("Added to …"),
  board reorders save, commenting follows your real permission.
- Sidebar: Space rename/colour/archive/delete only shown to people who can do it;
  reordering failures show a message. Organization section hidden for guests.
- Everything: creating a Space shows errors; Archived section with Restore.
- List page: Timeline view selectable.
- Departments: tree refreshes after create; approval steps set to "specific person"
  must name one.
- Settings → Roles / Integrations: deletes confirm, failures show a message,
  webhooks must be https.
- Move picker now sits above the task panel (found in the browser check).

## Migration 0045
Re-creates the custom-roles objects from 0019 only if they are missing. The
migrator is transactional, so a normal install already has them; this is a safety
net for a database that was restored by hand. It changes nothing otherwise.

## Still open (not changed — need a decision or a bigger change)
- A page open in two tabs can show a stale name after a rename until refresh.
- Task position and an in-flight edit can race when two people drag at once.
- Whiteboard: own edits can echo back; very large boards aren't size-capped.
- Leave spanning New Year counts against one year only.
- Saved-view autosave doesn't roll back on failure.
- On the Space page, *Add task* buttons only appear when grouped by Status (default
  is grouped by List).

## Follow-up: decisions applied
- **Deleting a department archives its Space** (it used to stay in the sidebar).
  The work is kept; an admin restores it from Everything → Archived.
- **Every Settings → Roles switch is enforced by the API**, not just shown:
  | Switch | Now checked on |
  |---|---|
  | Create Spaces | creating a Space (already was) |
  | Delete items | deleting Spaces, Folders, Lists, Tasks |
  | Create Docs | creating a Doc |
  | Create & manage Automations | creating, editing, deleting Automations |
  | Export workspace data | whole-workspace export (list CSV export is unchanged) |
  | View the audit log | audit log (already was) |
  | Invite & manage members | inviting, changing, suspending, removing members |
  - Defaults are unchanged. Owner/admin always have everything. Note one visible
    effect: a plain **member can no longer export the whole workspace** (the role
    table always said members don't; now it's true). Give them a role with
    "Export workspace data" if they need it.
  - "Invite & manage members" on a non-admin covers members and guests only: they
    can't make anyone an admin or touch an admin or the owner. A refused invite
    creates no account.
  - New `GET /governance/me` tells the app the caller's switches; the sidebar
    hides Delete, Settings → Integrations hides Export, and the Members page shows
    the invite form (without Admin) to anyone granted member management.
  - Task deletes that are refused now say why instead of the task silently coming back.

## Checks
- API: 37 suites / 271 tests pass (includes `role-capabilities.e2e-spec.ts`, 7 tests,
  6 of which fail on the old code), including `crud-sweep.e2e-spec.ts` (15 tests;
  14 of them fail on the old code).
- `pnpm -r run lint` and `pnpm -r run build` clean.
- Browser walkthrough (built app): legacy note migrated, Notes page + count + menu,
  note survives reload, ⌘K finds it, picker shows empty Space, list created in it,
  note → task, task Move across Spaces, doc keeps three sentences typed across
  autosaves + title edit, archived list restored. No page errors.
