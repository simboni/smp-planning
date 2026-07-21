import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 14: universal search (visibility-filtered),
 * Home / My Work (due-date buckets + reminders), Templates (serialize a task /
 * list then re-instantiate), per-space ClickApps and per-user Favorites, plus
 * the members-only guard. Same harness as the other modules.
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
    .send({ email, fullName: "M14 User", password })
    .expect(201);
  return {
    email,
    identityToken: res.body.identityToken as string,
    userId: res.body.user.id as string,
  };
}

/** Owner + workspace + access token + a public space + a folderless list. */
async function fixture() {
  const owner = await signup();
  const ws = await http
    .post("/workspaces")
    .set(auth(owner.identityToken))
    .send({ name: "M14 WS" })
    .expect(201);
  const workspaceId = ws.body.workspace.id as string;
  const tok = await http
    .post(`/workspaces/${workspaceId}/token`)
    .set(auth(owner.identityToken))
    .expect(200);
  const access = tok.body.accessToken as string;
  const space = await http
    .post("/spaces")
    .set(auth(access))
    .send({ name: "Marketing" })
    .expect(201);
  const spaceId = space.body.space.id as string;
  const list = await http
    .post(`/spaces/${spaceId}/lists`)
    .set(auth(access))
    .send({ name: "Backlog" })
    .expect(201);
  return {
    owner,
    workspaceId,
    access,
    spaceId,
    listId: list.body.list.id as string,
  };
}

async function memberOf(
  ownerToken: string,
  workspaceId: string,
  member: { email: string; identityToken: string },
  role: "member" | "admin" | "guest",
) {
  await http
    .post("/workspaces/current/members")
    .set(auth(ownerToken))
    .send({ email: member.email, role })
    .expect(201);
  const tok = await http
    .post(`/workspaces/${workspaceId}/token`)
    .set(auth(member.identityToken))
    .expect(200);
  return tok.body.accessToken as string;
}

function isoDaysFromNow(days: number, hourUtc = 12): string {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, hourUtc),
  );
  return d.toISOString();
}

describe("universal search", () => {
  it("finds a task by name and excludes a private-space task the caller can't see", async () => {
    const f = await fixture();
    await http
      .post(`/lists/${f.listId}/tasks`)
      .set(auth(f.access))
      .send({ name: "Launch the rocket" })
      .expect(201);

    // A member of the same workspace who is NOT shared into a private space.
    const bob = await signup();
    const bobAccess = await memberOf(f.access, f.workspaceId, bob, "member");

    // Owner creates a PRIVATE space + list + task the member cannot see.
    const priv = await http
      .post("/spaces")
      .set(auth(f.access))
      .send({ name: "Secret", isPrivate: true })
      .expect(201);
    const privList = await http
      .post(`/spaces/${priv.body.space.id}/lists`)
      .set(auth(f.access))
      .send({ name: "Hidden" })
      .expect(201);
    await http
      .post(`/lists/${privList.body.list.id}/tasks`)
      .set(auth(f.access))
      .send({ name: "Launch the missile" })
      .expect(201);

    // Bob searches "Launch": sees the public task, never the private one.
    const res = await http
      .get("/search?q=Launch&limit=8")
      .set(auth(bobAccess))
      .expect(200);
    const titles = res.body.results.tasks.map((t: { title: string }) => t.title);
    expect(titles).toContain("Launch the rocket");
    expect(titles).not.toContain("Launch the missile");

    // The owner does see both.
    const ownerRes = await http
      .get("/search?q=Launch")
      .set(auth(f.access))
      .expect(200);
    const ownerTitles = ownerRes.body.results.tasks.map(
      (t: { title: string }) => t.title,
    );
    expect(ownerTitles).toContain("Launch the missile");
  });

  it("returns empty groups for a blank query", async () => {
    const f = await fixture();
    const res = await http.get("/search?q=").set(auth(f.access)).expect(200);
    expect(res.body.results.tasks).toEqual([]);
    expect(res.body.results.spaces).toEqual([]);
  });
});

describe("home / my work", () => {
  it("buckets the caller's assigned tasks by due date and lists reminders", async () => {
    const f = await fixture();
    const me = f.owner.userId;

    const overdue = await http
      .post(`/lists/${f.listId}/tasks`)
      .set(auth(f.access))
      .send({
        name: "Overdue task",
        assigneeIds: [me],
        dueDate: isoDaysFromNow(-2),
      })
      .expect(201);
    const today = await http
      .post(`/lists/${f.listId}/tasks`)
      .set(auth(f.access))
      .send({ name: "Today task", assigneeIds: [me], dueDate: isoDaysFromNow(0) })
      .expect(201);
    // An assigned task with no due date -> unscheduled bucket.
    await http
      .post(`/lists/${f.listId}/tasks`)
      .set(auth(f.access))
      .send({ name: "Someday task", assigneeIds: [me] })
      .expect(201);

    await http
      .post("/reminders")
      .set(auth(f.access))
      .send({ note: "Ping the team", remindAt: isoDaysFromNow(1), taskId: today.body.task.id })
      .expect(201);

    const res = await http.get("/home").set(auth(f.access)).expect(200);
    const overdueIds = res.body.overdue.map((t: { id: string }) => t.id);
    const todayIds = res.body.dueToday.map((t: { id: string }) => t.id);
    expect(overdueIds).toContain(overdue.body.task.id);
    expect(overdueIds).not.toContain(today.body.task.id);
    expect(todayIds).toContain(today.body.task.id);
    expect(res.body.assignedOpen).toBeGreaterThanOrEqual(3);
    expect(res.body.unscheduled.length).toBeGreaterThanOrEqual(1);
    expect(
      res.body.reminders.some((r: { note: string }) => r.note === "Ping the team"),
    ).toBe(true);
  });

  it("returns at-a-glance counts scoped to the caller", async () => {
    const f = await fixture();
    const me = f.owner.userId;
    // three tasks in the fixture's visible list
    for (const n of ["A", "B", "C"]) {
      await http
        .post(`/lists/${f.listId}/tasks`)
        .set(auth(f.access))
        .send({ name: n, assigneeIds: [me] })
        .expect(201);
    }
    const ov = await http.get("/home/overview").set(auth(f.access)).expect(200);
    expect(ov.body.spaces).toBeGreaterThanOrEqual(1);
    expect(ov.body.tasks).toBeGreaterThanOrEqual(3);
    expect(ov.body.members).toBeGreaterThanOrEqual(1);
    expect(typeof ov.body.docs).toBe("number");
    expect(typeof ov.body.goals).toBe("number");
    expect(typeof ov.body.dashboards).toBe("number");
  });
});

describe("templates", () => {
  it("serializes a task then applies it into another list, recreating the checklist", async () => {
    const f = await fixture();
    const task = await http
      .post(`/lists/${f.listId}/tasks`)
      .set(auth(f.access))
      .send({ name: "Onboarding", priority: "high" })
      .expect(201);
    const checklist = await http
      .post(`/tasks/${task.body.task.id}/checklists`)
      .set(auth(f.access))
      .send({ name: "Steps" })
      .expect(201);
    await http
      .post(`/checklists/${checklist.body.checklist.id}/items`)
      .set(auth(f.access))
      .send({ name: "Send welcome email" })
      .expect(201);

    const tpl = await http
      .post(`/templates/from/task/${task.body.task.id}`)
      .set(auth(f.access))
      .send({ name: "Onboarding template" })
      .expect(201);
    expect(tpl.body.template.kind).toBe("task");

    // It shows up in the (optionally filtered) list.
    const listed = await http
      .get("/templates?kind=task")
      .set(auth(f.access))
      .expect(200);
    expect(
      listed.body.templates.some((t: { id: string }) => t.id === tpl.body.template.id),
    ).toBe(true);

    const list2 = await http
      .post(`/spaces/${f.spaceId}/lists`)
      .set(auth(f.access))
      .send({ name: "Q2 Onboarding" })
      .expect(201);
    const applied = await http
      .post(`/templates/${tpl.body.template.id}/apply`)
      .set(auth(f.access))
      .send({ targetListId: list2.body.list.id })
      .expect(201);
    expect(applied.body.kind).toBe("task");

    const detail = await http
      .get(`/tasks/${applied.body.createdId}`)
      .set(auth(f.access))
      .expect(200);
    expect(detail.body.task.name).toBe("Onboarding");
    expect(detail.body.task.priority).toBe("high");
    expect(detail.body.task.checklists).toHaveLength(1);
    expect(detail.body.task.checklists[0].items[0].name).toBe(
      "Send welcome email",
    );
  });

  it("applies a list template into a fresh space, recreating statuses and tasks", async () => {
    const f = await fixture();
    await http
      .post(`/lists/${f.listId}/tasks`)
      .set(auth(f.access))
      .send({ name: "Task one" })
      .expect(201);
    await http
      .post(`/lists/${f.listId}/tasks`)
      .set(auth(f.access))
      .send({ name: "Task two" })
      .expect(201);

    const tpl = await http
      .post(`/templates/from/list/${f.listId}`)
      .set(auth(f.access))
      .send({ name: "Backlog template" })
      .expect(201);
    expect(tpl.body.template.kind).toBe("list");

    const fresh = await http
      .post("/spaces")
      .set(auth(f.access))
      .send({ name: "Fresh space" })
      .expect(201);
    const applied = await http
      .post(`/templates/${tpl.body.template.id}/apply`)
      .set(auth(f.access))
      .send({ targetSpaceId: fresh.body.space.id })
      .expect(201);
    expect(applied.body.kind).toBe("list");

    const statuses = await http
      .get(`/spaces/${fresh.body.space.id}/statuses`)
      .set(auth(f.access))
      .expect(200);
    expect(statuses.body.statuses.length).toBe(3);

    const tasks = await http
      .get(`/lists/${applied.body.createdId}/tasks`)
      .set(auth(f.access))
      .expect(200);
    const names = tasks.body.tasks.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["Task one", "Task two"]);
  });
});

describe("clickapps", () => {
  it("returns defaults and merges a PUT patch", async () => {
    const f = await fixture();
    const initial = await http
      .get(`/spaces/${f.spaceId}/clickapps`)
      .set(auth(f.access))
      .expect(200);
    expect(initial.body.clickapps.timeTracking).toBe(true);
    expect(initial.body.clickapps.sprints).toBe(true);

    const updated = await http
      .put(`/spaces/${f.spaceId}/clickapps`)
      .set(auth(f.access))
      .send({ clickapps: { sprints: false } })
      .expect(200);
    // Patched key flipped; untouched keys preserved (merge, not replace).
    expect(updated.body.clickapps.sprints).toBe(false);
    expect(updated.body.clickapps.timeTracking).toBe(true);

    // Unknown keys are rejected.
    await http
      .put(`/spaces/${f.spaceId}/clickapps`)
      .set(auth(f.access))
      .send({ clickapps: { bogus: true } })
      .expect(400);
  });
});

describe("favorites", () => {
  it("adds, lists (with resolved name) and removes a favorite", async () => {
    const f = await fixture();
    await http
      .post("/favorites")
      .set(auth(f.access))
      .send({ entityType: "list", entityId: f.listId })
      .expect(201);

    const listed = await http.get("/favorites").set(auth(f.access)).expect(200);
    const fav = listed.body.favorites.find(
      (x: { entityId: string }) => x.entityId === f.listId,
    );
    expect(fav).toBeTruthy();
    expect(fav.entityType).toBe("list");
    expect(fav.name).toBe("Backlog");

    await http
      .delete(`/favorites/list/${f.listId}`)
      .set(auth(f.access))
      .expect(204);
    const after = await http.get("/favorites").set(auth(f.access)).expect(200);
    expect(
      after.body.favorites.some((x: { entityId: string }) => x.entityId === f.listId),
    ).toBe(false);
  });

  it("refuses to favorite an invisible entity", async () => {
    const f = await fixture();
    const bob = await signup();
    const bobAccess = await memberOf(f.access, f.workspaceId, bob, "member");
    const priv = await http
      .post("/spaces")
      .set(auth(f.access))
      .send({ name: "Vault", isPrivate: true })
      .expect(201);
    // Bob cannot see the private space -> favoriting it is a 404.
    await http
      .post("/favorites")
      .set(auth(bobAccess))
      .send({ entityType: "space", entityId: priv.body.space.id })
      .expect(404);
  });
});

describe("members-only guard", () => {
  it("refuses guests on search, home and templates", async () => {
    const f = await fixture();
    const guestUser = await signup();
    const guestAccess = await memberOf(
      f.access,
      f.workspaceId,
      guestUser,
      "guest",
    );
    await http.get("/search?q=x").set(auth(guestAccess)).expect(403);
    await http.get("/home").set(auth(guestAccess)).expect(403);
    await http.get("/templates").set(auth(guestAccess)).expect(403);
  });
});
