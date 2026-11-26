import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * Regression tests for the CRUD sweep.
 *
 * Each case here is a defect that shipped and is now fixed; the test exists so
 * it can't come back silently. See the comment on each `it` for the symptom
 * the user would have seen.
 */

let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  http = request(app.getHttpServer());
});

afterAll(async () => {
  await app.close();
});

const uniqueEmail = () =>
  `u${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signup(email = uniqueEmail(), password = "password123") {
  const res = await http
    .post("/auth/signup")
    .send({ email, fullName: "Test User", password })
    .expect(201);
  return {
    email,
    password,
    identityToken: res.body.identityToken as string,
    userId: res.body.user.id as string,
  };
}

async function ownerWorkspace(name = "Sweep WS") {
  const owner = await signup();
  const created = await http
    .post("/workspaces")
    .set(auth(owner.identityToken))
    .send({ name })
    .expect(201);
  const workspaceId = created.body.workspace.id as string;
  const tokenRes = await http
    .post(`/workspaces/${workspaceId}/token`)
    .set(auth(owner.identityToken))
    .expect(200);
  return {
    ...owner,
    workspaceId,
    accessToken: tokenRes.body.accessToken as string,
  };
}

async function memberOf(
  ownerToken: string,
  workspaceId: string,
  role: "admin" | "member" | "guest",
) {
  const user = await signup();
  await http
    .post("/workspaces/current/members")
    .set(auth(ownerToken))
    .send({ email: user.email, role })
    .expect(201);
  const tokenRes = await http
    .post(`/workspaces/${workspaceId}/token`)
    .set(auth(user.identityToken))
    .expect(200);
  return { ...user, accessToken: tokenRes.body.accessToken as string };
}

async function makeSpace(token: string, name = "Space") {
  return (
    await http.post("/spaces").set(auth(token)).send({ name }).expect(201)
  ).body.space;
}

async function makeList(token: string, spaceId: string, body: object = {}) {
  return (
    await http
      .post(`/spaces/${spaceId}/lists`)
      .set(auth(token))
      .send({ name: "List", ...body })
      .expect(201)
  ).body.list;
}

describe("CRUD sweep regressions", () => {
  it("a member who creates a Space can rename, archive and delete it", async () => {
    // Was: the creator only got a 'full' self-share when the space was
    // PRIVATE, and no UI creates private spaces — so a member resolved to
    // 'edit' on their own space while every manage action needs 'full'. They
    // could create a space and then never change or remove it.
    const owner = await ownerWorkspace();
    const member = await memberOf(owner.accessToken, owner.workspaceId, "member");

    const space = (
      await http
        .post("/spaces")
        .set(auth(member.accessToken))
        .send({ name: "Mine" })
        .expect(201)
    ).body.space;
    expect(space.myPermission).toBe("full");

    await http
      .patch(`/spaces/${space.id}`)
      .set(auth(member.accessToken))
      .send({ name: "Mine renamed" })
      .expect(200);
    await http
      .patch(`/spaces/${space.id}`)
      .set(auth(member.accessToken))
      .send({ archived: true })
      .expect(200);
    await http
      .patch(`/spaces/${space.id}`)
      .set(auth(member.accessToken))
      .send({ archived: false })
      .expect(200);
    await http
      .delete(`/spaces/${space.id}`)
      .set(auth(member.accessToken))
      .expect(204);
  });

  it("a live List under an ARCHIVED folder is still reachable", async () => {
    // Was: the tree attached lists to folder nodes and dropped any list whose
    // folder wasn't in the (archived = false) folder set. Archiving a folder
    // therefore made its lists vanish from the sidebar, the space page and
    // every picker — while their tasks still showed in space-level views with
    // no list to open, and nothing marked the lists archived.
    const owner = await ownerWorkspace();
    const space = await makeSpace(owner.accessToken, "Has folder");
    const folder = (
      await http
        .post(`/spaces/${space.id}/folders`)
        .set(auth(owner.accessToken))
        .send({ name: "Folder" })
        .expect(201)
    ).body.folder;
    const list = await makeList(owner.accessToken, space.id, {
      name: "Inside",
      folderId: folder.id,
    });

    await http
      .patch(`/folders/${folder.id}`)
      .set(auth(owner.accessToken))
      .send({ archived: true })
      .expect(200);

    const tree = await http
      .get("/hierarchy")
      .set(auth(owner.accessToken))
      .expect(200);
    const treeSpace = tree.body.spaces.find(
      (s: { id: string }) => s.id === space.id,
    );
    expect(treeSpace.folders).toHaveLength(0);
    // Surfaced at space level rather than lost.
    expect(treeSpace.lists.map((l: { id: string }) => l.id)).toContain(list.id);

    const detail = await http
      .get(`/spaces/${space.id}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(detail.body.lists.map((l: { id: string }) => l.id)).toContain(
      list.id,
    );
  });

  it("archived spaces, folders and lists are listed so they can be restored", async () => {
    // Was: every read filtered archived = false and nothing exposed an
    // archived view, so archiving was a one-way door — the content (and all
    // its tasks) became invisible and unrecoverable through the product.
    const owner = await ownerWorkspace();
    const keep = await makeSpace(owner.accessToken, "Keep");
    const gone = await makeSpace(owner.accessToken, "Gone");
    const list = await makeList(owner.accessToken, keep.id, { name: "Shelved" });

    await http
      .patch(`/spaces/${gone.id}`)
      .set(auth(owner.accessToken))
      .send({ archived: true })
      .expect(200);
    await http
      .patch(`/lists/${list.id}`)
      .set(auth(owner.accessToken))
      .send({ archived: true })
      .expect(200);

    const res = await http
      .get("/hierarchy/archived")
      .set(auth(owner.accessToken))
      .expect(200);
    expect(res.body.spaces.map((s: { id: string }) => s.id)).toContain(gone.id);
    expect(res.body.spaces.map((s: { id: string }) => s.id)).not.toContain(
      keep.id,
    );
    const archivedList = res.body.lists.find(
      (l: { id: string }) => l.id === list.id,
    );
    expect(archivedList).toBeTruthy();
    expect(archivedList.spaceName).toBe("Keep");

    // And restoring works through the ordinary PATCH.
    await http
      .patch(`/lists/${list.id}`)
      .set(auth(owner.accessToken))
      .send({ archived: false })
      .expect(200);
    const after = await http
      .get("/hierarchy/archived")
      .set(auth(owner.accessToken))
      .expect(200);
    expect(after.body.lists.map((l: { id: string }) => l.id)).not.toContain(
      list.id,
    );
  });

  it("notes are searchable, and only your own", async () => {
    // Was: notes had no nav entry and no search coverage, so once the 🗒
    // panel was closed there was no way to find them again.
    const owner = await ownerWorkspace();
    const other = await memberOf(owner.accessToken, owner.workspaceId, "member");

    await http
      .post("/notes")
      .set(auth(owner.accessToken))
      .send({ content: "Zanzibar supplier quote\nsecond line" })
      .expect(201);
    await http
      .post("/notes")
      .set(auth(other.accessToken))
      .send({ content: "Zanzibar private thought" })
      .expect(201);

    const mine = await http
      .get("/search?q=Zanzibar")
      .set(auth(owner.accessToken))
      .expect(200);
    expect(mine.body.results.notes).toHaveLength(1);
    expect(mine.body.results.notes[0].snippet).toBe("Zanzibar supplier quote");

    const theirs = await http
      .get("/search?q=Zanzibar")
      .set(auth(other.accessToken))
      .expect(200);
    expect(theirs.body.results.notes).toHaveLength(1);
    expect(theirs.body.results.notes[0].snippet).toBe(
      "Zanzibar private thought",
    );
  });

  it("the department head is the same person on the roster and in the dropdown", async () => {
    // Was: departments.lead_user_id (the "Department head" dropdown) and
    // department_members.dept_role ("Make head") were written independently
    // and never reconciled. Leave approval reads dept_role, onboarding reads
    // lead_user_id — so setting the head one way left the other stale: the
    // head couldn't approve their team's leave, or the card read "No head".
    const owner = await ownerWorkspace();
    const lead = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const other = await memberOf(owner.accessToken, owner.workspaceId, "member");

    // Naming a head at CREATE puts them on the roster as head.
    const dept = (
      await http
        .post("/departments")
        .set(auth(owner.accessToken))
        .send({ name: "Ops", leadUserId: lead.userId })
        .expect(201)
    ).body.department;

    let detail = await http
      .get(`/departments/${dept.id}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(detail.body.department.members).toHaveLength(1);
    expect(detail.body.department.members[0]).toMatchObject({
      userId: lead.userId,
      deptRole: "head",
    });

    // Promoting someone else via the roster moves the named head too, and
    // demotes the previous one.
    await http
      .post(`/departments/${dept.id}/members`)
      .set(auth(owner.accessToken))
      .send({ userId: other.userId })
      .expect(201);
    await http
      .patch(`/departments/${dept.id}/members/${other.userId}`)
      .set(auth(owner.accessToken))
      .send({ deptRole: "head" })
      .expect(200);

    detail = await http
      .get(`/departments/${dept.id}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(detail.body.department.lead?.id).toBe(other.userId);
    const roles = Object.fromEntries(
      detail.body.department.members.map(
        (m: { userId: string; deptRole: string }) => [m.userId, m.deptRole],
      ),
    );
    expect(roles[other.userId]).toBe("head");
    expect(roles[lead.userId]).toBe("member");

    // Removing the head from the roster clears the named head.
    await http
      .delete(`/departments/${dept.id}/members/${other.userId}`)
      .set(auth(owner.accessToken))
      .expect(204);
    detail = await http
      .get(`/departments/${dept.id}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(detail.body.department.lead).toBeNull();
  });

  it("removing a workspace member leaves no ghost department rows", async () => {
    // Was: only the memberships row was deleted, while department_members
    // keyed off users(id) and survived. The department card counted a roster
    // row the roster list (which joins memberships) wouldn't render — "5
    // people" next to 4 names — and the stale row couldn't be removed.
    const owner = await ownerWorkspace();
    const member = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const dept = (
      await http
        .post("/departments")
        .set(auth(owner.accessToken))
        .send({ name: "Support" })
        .expect(201)
    ).body.department;
    await http
      .post(`/departments/${dept.id}/members`)
      .set(auth(owner.accessToken))
      .send({ userId: member.userId })
      .expect(201);

    await http
      .delete(`/workspaces/current/members/${member.userId}`)
      .set(auth(owner.accessToken))
      .expect(204);

    const list = await http
      .get("/departments")
      .set(auth(owner.accessToken))
      .expect(200);
    const row = list.body.departments.find(
      (d: { id: string }) => d.id === dept.id,
    );
    expect(row.memberCount).toBe(0);
    const detail = await http
      .get(`/departments/${dept.id}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(detail.body.department.members).toHaveLength(0);
  });

  it("guests can't enumerate teams", async () => {
    // Was: the teams controller mounted no RolesGuard on its reads despite
    // documenting them as member-only, so a guest could list every team's
    // full roster with names and emails.
    const owner = await ownerWorkspace();
    const guest = await memberOf(owner.accessToken, owner.workspaceId, "guest");
    const team = (
      await http
        .post("/teams")
        .set(auth(owner.accessToken))
        .send({ name: "Leads" })
        .expect(201)
    ).body.team;

    await http.get("/teams").set(auth(guest.accessToken)).expect(403);
    await http.get(`/teams/${team.id}`).set(auth(guest.accessToken)).expect(403);
    // Still open to members.
    const member = await memberOf(owner.accessToken, owner.workspaceId, "member");
    await http.get("/teams").set(auth(member.accessToken)).expect(200);
  });

  it("moving between two done statuses keeps the original completion date", async () => {
    // Was: completed_at was stamped with now() on every write to a done
    // status, so Done -> Closed (or re-picking the same status) silently
    // reset the completion date and re-counted old work in this week's
    // completion trend and burndown.
    const owner = await ownerWorkspace();
    const space = await makeSpace(owner.accessToken, "Done dates");
    const list = await makeList(owner.accessToken, space.id);
    const statuses = (
      await http
        .get(`/spaces/${space.id}/statuses`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body.statuses as { id: string; type: string; name: string }[];
    const done = statuses.find((s) => s.type === "done")!;
    const second = (
      await http
        .post(`/spaces/${space.id}/statuses`)
        .set(auth(owner.accessToken))
        .send({ name: "Closed", type: "done", color: "#444444" })
        .expect(201)
    ).body.status;

    const task = (
      await http
        .post(`/lists/${list.id}/tasks`)
        .set(auth(owner.accessToken))
        .send({ name: "Ship it" })
        .expect(201)
    ).body.task;

    await http
      .patch(`/tasks/${task.id}`)
      .set(auth(owner.accessToken))
      .send({ statusId: done.id })
      .expect(200);
    const first = (
      await http.get(`/tasks/${task.id}`).set(auth(owner.accessToken)).expect(200)
    ).body.task.completedAt;
    expect(first).toBeTruthy();

    await http
      .patch(`/tasks/${task.id}`)
      .set(auth(owner.accessToken))
      .send({ statusId: second.id })
      .expect(200);
    const after = (
      await http.get(`/tasks/${task.id}`).set(auth(owner.accessToken)).expect(200)
    ).body.task.completedAt;
    expect(after).toBe(first);

    // Leaving done still reopens the task.
    const open = statuses.find((s) => s.type !== "done")!;
    await http
      .patch(`/tasks/${task.id}`)
      .set(auth(owner.accessToken))
      .send({ statusId: open.id })
      .expect(200);
    const reopened = (
      await http.get(`/tasks/${task.id}`).set(auth(owner.accessToken)).expect(200)
    ).body.task.completedAt;
    expect(reopened).toBeNull();
  });

  it("re-sharing after a revoke mints a NEW public token", async () => {
    // Was: the upsert cleared revoked_at but kept the token, so "Stop
    // sharing" followed later by "Create public link" handed back the same
    // URL — every copy of the link the user thought they'd killed started
    // working again.
    const owner = await ownerWorkspace();
    const space = await makeSpace(owner.accessToken, "Shared");
    const list = await makeList(owner.accessToken, space.id);

    const first = (
      await http
        .post("/shares")
        .set(auth(owner.accessToken))
        .send({ entityType: "list", entityId: list.id })
        .expect(201)
    ).body.share;

    // Re-sharing a LIVE link keeps the token (recipients aren't broken).
    const again = (
      await http
        .post("/shares")
        .set(auth(owner.accessToken))
        .send({ entityType: "list", entityId: list.id, permission: "comment" })
        .expect(201)
    ).body.share;
    expect(again.token).toBe(first.token);

    await http
      .delete(`/shares/${first.id}`)
      .set(auth(owner.accessToken))
      .expect(204);

    const reshared = (
      await http
        .post("/shares")
        .set(auth(owner.accessToken))
        .send({ entityType: "list", entityId: list.id })
        .expect(201)
    ).body.share;
    expect(reshared.token).not.toBe(first.token);
  });
});
