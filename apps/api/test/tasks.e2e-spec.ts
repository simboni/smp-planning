import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 3 (Tasks Core) against the migrated
 * stackup_test database. Mirrors the M2 harness (unique emails, supertest,
 * setup.ts): sign up an owner, create a workspace + access token, and build a
 * Space -> List to hang tasks off of.
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

async function createWorkspaceWithToken(identityToken: string, name: string) {
  const created = await http
    .post("/workspaces")
    .set(auth(identityToken))
    .send({ name })
    .expect(201);
  const workspaceId = created.body.workspace.id as string;
  const tokenRes = await http
    .post(`/workspaces/${workspaceId}/token`)
    .set(auth(identityToken))
    .expect(200);
  return { workspaceId, accessToken: tokenRes.body.accessToken as string };
}

async function ownerWorkspace(name = "M3 WS") {
  const owner = await signup();
  const ws = await createWorkspaceWithToken(owner.identityToken, name);
  return { ...owner, ...ws };
}

async function memberOf(
  ownerToken: string,
  workspaceId: string,
  role: "member" | "admin" | "guest",
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

async function makeSpaceAndList(token: string, opts: { isPrivate?: boolean } = {}) {
  const space = (
    await http
      .post("/spaces")
      .set(auth(token))
      .send({ name: "Space", isPrivate: opts.isPrivate === true })
      .expect(201)
  ).body.space;
  const list = (
    await http
      .post(`/spaces/${space.id}/lists`)
      .set(auth(token))
      .send({ name: "List" })
      .expect(201)
  ).body.list;
  return { space, list };
}

describe("statuses", () => {
  it("auto-provisions the three defaults on first read", async () => {
    const owner = await ownerWorkspace();
    const { space } = await makeSpaceAndList(owner.accessToken);
    const res = await http
      .get(`/spaces/${space.id}/statuses`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(res.body.statuses.map((s: { name: string }) => s.name)).toEqual([
      "To Do",
      "In Progress",
      "Complete",
    ]);
    expect(res.body.statuses[0].type).toBe("not_started");
    expect(res.body.statuses[2].type).toBe("done");
    expect(res.body.statuses[0].position).toBe(0);
  });

  it("cannot delete a space's only status; reassigns tasks otherwise", async () => {
    const owner = await ownerWorkspace();
    const { space, list } = await makeSpaceAndList(owner.accessToken);
    const statuses = (
      await http.get(`/spaces/${space.id}/statuses`).set(auth(owner.accessToken))
    ).body.statuses;
    // Put a task in the first status, then delete that status.
    const task = (
      await http
        .post(`/lists/${list.id}/tasks`)
        .set(auth(owner.accessToken))
        .send({ name: "T", statusId: statuses[0].id })
        .expect(201)
    ).body.task;
    await http
      .delete(`/statuses/${statuses[0].id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    // Task moved to the new first status.
    const moved = (
      await http.get(`/tasks/${task.id}`).set(auth(owner.accessToken))
    ).body.task;
    expect(moved.statusId).toBe(statuses[1].id);
    // Delete down to one, then the last delete is blocked.
    await http
      .delete(`/statuses/${statuses[1].id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    await http
      .delete(`/statuses/${statuses[2].id}`)
      .set(auth(owner.accessToken))
      .expect(400);
  });
});

describe("tasks", () => {
  it("create -> appears in the list with the default status", async () => {
    const owner = await ownerWorkspace();
    const { list } = await makeSpaceAndList(owner.accessToken);
    const task = (
      await http
        .post(`/lists/${list.id}/tasks`)
        .set(auth(owner.accessToken))
        .send({ name: "First task" })
        .expect(201)
    ).body.task;
    expect(task.name).toBe("First task");
    expect(task.status.name).toBe("To Do");
    expect(task.status.type).toBe("not_started");

    const tasks = (
      await http.get(`/lists/${list.id}/tasks`).set(auth(owner.accessToken)).expect(200)
    ).body.tasks;
    expect(tasks.map((t: { id: string }) => t.id)).toContain(task.id);
    expect(tasks[0].subtaskCount).toBe(0);
  });

  it("subtasks increment subtaskCount and are hidden from the top-level list", async () => {
    const owner = await ownerWorkspace();
    const { list } = await makeSpaceAndList(owner.accessToken);
    const parent = (
      await http
        .post(`/lists/${list.id}/tasks`)
        .set(auth(owner.accessToken))
        .send({ name: "Parent" })
        .expect(201)
    ).body.task;
    await http
      .post(`/tasks/${parent.id}/subtasks`)
      .set(auth(owner.accessToken))
      .send({ name: "Child" })
      .expect(201);

    const top = (
      await http.get(`/lists/${list.id}/tasks`).set(auth(owner.accessToken))
    ).body.tasks;
    // Only the parent is top-level.
    expect(top).toHaveLength(1);
    expect(top[0].subtaskCount).toBe(1);

    const detail = (
      await http.get(`/tasks/${parent.id}`).set(auth(owner.accessToken))
    ).body.task;
    expect(detail.subtasks).toHaveLength(1);
    expect(detail.subtasks[0].name).toBe("Child");
    expect(detail.breadcrumb.list.name).toBe("List");
  });

  it("assignees can be added and removed", async () => {
    const owner = await ownerWorkspace();
    const userB = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const { list } = await makeSpaceAndList(owner.accessToken);
    const task = (
      await http
        .post(`/lists/${list.id}/tasks`)
        .set(auth(owner.accessToken))
        .send({ name: "T" })
        .expect(201)
    ).body.task;
    await http
      .post(`/tasks/${task.id}/assignees`)
      .set(auth(owner.accessToken))
      .send({ userId: userB.userId })
      .expect(201);
    let detail = (
      await http.get(`/tasks/${task.id}`).set(auth(owner.accessToken))
    ).body.task;
    expect(detail.assignees.map((a: { id: string }) => a.id)).toContain(
      userB.userId,
    );
    await http
      .delete(`/tasks/${task.id}/assignees/${userB.userId}`)
      .set(auth(owner.accessToken))
      .expect(204);
    detail = (await http.get(`/tasks/${task.id}`).set(auth(owner.accessToken)))
      .body.task;
    expect(detail.assignees).toHaveLength(0);
  });

  it("tags can be created and applied, and appear on the card", async () => {
    const owner = await ownerWorkspace();
    const { space, list } = await makeSpaceAndList(owner.accessToken);
    const tag = (
      await http
        .post(`/spaces/${space.id}/tags`)
        .set(auth(owner.accessToken))
        .send({ name: "urgent", color: "#FF0000" })
        .expect(201)
    ).body.tag;
    // Duplicate name -> 409.
    await http
      .post(`/spaces/${space.id}/tags`)
      .set(auth(owner.accessToken))
      .send({ name: "urgent" })
      .expect(409);

    const task = (
      await http
        .post(`/lists/${list.id}/tasks`)
        .set(auth(owner.accessToken))
        .send({ name: "T", tagIds: [tag.id] })
        .expect(201)
    ).body.task;
    expect(task.tags.map((t: { id: string }) => t.id)).toContain(tag.id);

    // Apply a brand-new tag inline.
    const applied = (
      await http
        .post(`/tasks/${task.id}/tags`)
        .set(auth(owner.accessToken))
        .send({ name: "backend", color: "#00FF00" })
        .expect(201)
    ).body.tag;
    expect(applied.name).toBe("backend");
    const detail = (
      await http.get(`/tasks/${task.id}`).set(auth(owner.accessToken))
    ).body.task;
    expect(detail.tags.map((t: { name: string }) => t.name).sort()).toEqual([
      "backend",
      "urgent",
    ]);
  });

  it("checklists and items track total/done as items resolve", async () => {
    const owner = await ownerWorkspace();
    const { list } = await makeSpaceAndList(owner.accessToken);
    const task = (
      await http
        .post(`/lists/${list.id}/tasks`)
        .set(auth(owner.accessToken))
        .send({ name: "T" })
        .expect(201)
    ).body.task;
    const checklist = (
      await http
        .post(`/tasks/${task.id}/checklists`)
        .set(auth(owner.accessToken))
        .send({ name: "Steps" })
        .expect(201)
    ).body.checklist;
    const item1 = (
      await http
        .post(`/checklists/${checklist.id}/items`)
        .set(auth(owner.accessToken))
        .send({ name: "Step 1" })
        .expect(201)
    ).body.item;
    await http
      .post(`/checklists/${checklist.id}/items`)
      .set(auth(owner.accessToken))
      .send({ name: "Step 2" })
      .expect(201);

    await http
      .patch(`/checklist-items/${item1.id}`)
      .set(auth(owner.accessToken))
      .send({ resolved: true })
      .expect(200);

    const detail = (
      await http.get(`/tasks/${task.id}`).set(auth(owner.accessToken))
    ).body.task;
    expect(detail.checklistTotal).toBe(2);
    expect(detail.checklistDone).toBe(1);
    expect(detail.checklists[0].items).toHaveLength(2);
  });

  it("moving to a 'done' status sets completedAt; leaving clears it", async () => {
    const owner = await ownerWorkspace();
    const { space, list } = await makeSpaceAndList(owner.accessToken);
    const statuses = (
      await http.get(`/spaces/${space.id}/statuses`).set(auth(owner.accessToken))
    ).body.statuses;
    const done = statuses.find((s: { type: string }) => s.type === "done");
    const todo = statuses.find((s: { type: string }) => s.type === "not_started");
    const task = (
      await http
        .post(`/lists/${list.id}/tasks`)
        .set(auth(owner.accessToken))
        .send({ name: "T" })
        .expect(201)
    ).body.task;
    expect(task.completedAt).toBeNull();

    const doneTask = (
      await http
        .patch(`/tasks/${task.id}`)
        .set(auth(owner.accessToken))
        .send({ statusId: done.id })
        .expect(200)
    ).body.task;
    expect(doneTask.completedAt).not.toBeNull();

    const reopened = (
      await http
        .patch(`/tasks/${task.id}`)
        .set(auth(owner.accessToken))
        .send({ statusId: todo.id })
        .expect(200)
    ).body.task;
    expect(reopened.completedAt).toBeNull();
  });

  it("reorder sets positions and can move a task between statuses", async () => {
    const owner = await ownerWorkspace();
    const { space, list } = await makeSpaceAndList(owner.accessToken);
    const statuses = (
      await http.get(`/spaces/${space.id}/statuses`).set(auth(owner.accessToken))
    ).body.statuses;
    const todo = statuses[0].id;
    const t1 = (
      await http
        .post(`/lists/${list.id}/tasks`)
        .set(auth(owner.accessToken))
        .send({ name: "A" })
        .expect(201)
    ).body.task;
    const t2 = (
      await http
        .post(`/lists/${list.id}/tasks`)
        .set(auth(owner.accessToken))
        .send({ name: "B" })
        .expect(201)
    ).body.task;
    await http
      .post(`/lists/${list.id}/tasks/reorder`)
      .set(auth(owner.accessToken))
      .send({ statusId: todo, ids: [t2.id, t1.id] })
      .expect(200);
    const tasks = (
      await http.get(`/lists/${list.id}/tasks`).set(auth(owner.accessToken))
    ).body.tasks;
    expect(tasks.map((t: { id: string }) => t.id)).toEqual([t2.id, t1.id]);
  });
});

describe("tasks permissions & isolation", () => {
  it("a view-only member can read but not create tasks (403)", async () => {
    const owner = await ownerWorkspace();
    const userB = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const { space, list } = await makeSpaceAndList(owner.accessToken, {
      isPrivate: true,
    });
    // Share the private space read-only with B.
    await http
      .put(`/spaces/${space.id}/shares`)
      .set(auth(owner.accessToken))
      .send({ principalType: "user", principalId: userB.userId, permission: "view" })
      .expect(200);

    // B can GET the list's tasks...
    await http
      .get(`/lists/${list.id}/tasks`)
      .set(auth(userB.accessToken))
      .expect(200);
    // ...but not create one.
    await http
      .post(`/lists/${list.id}/tasks`)
      .set(auth(userB.accessToken))
      .send({ name: "Nope" })
      .expect(403);
  });

  it("workspace B cannot see workspace A's tasks (404)", async () => {
    const ownerA = await ownerWorkspace("A");
    const { list } = await makeSpaceAndList(ownerA.accessToken);
    const task = (
      await http
        .post(`/lists/${list.id}/tasks`)
        .set(auth(ownerA.accessToken))
        .send({ name: "Secret" })
        .expect(201)
    ).body.task;

    const ownerB = await ownerWorkspace("B");
    await http.get(`/tasks/${task.id}`).set(auth(ownerB.accessToken)).expect(404);
    await http
      .get(`/lists/${list.id}/tasks`)
      .set(auth(ownerB.accessToken))
      .expect(404);
  });
});

describe("toggle-done (My Work quick action)", () => {
  it("completes then reopens a task without the caller passing a status id", async () => {
    const owner = await ownerWorkspace("Toggle WS");
    const { list } = await makeSpaceAndList(owner.accessToken);
    const task = (
      await http
        .post(`/lists/${list.id}/tasks`)
        .set(auth(owner.accessToken))
        .send({ name: "Do the thing" })
        .expect(201)
    ).body.task;
    expect(task.status.type).not.toBe("done");
    expect(task.completedAt ?? null).toBeNull();

    // Complete it.
    const done = (
      await http.post(`/tasks/${task.id}/toggle-done`).set(auth(owner.accessToken)).expect(200)
    ).body.task;
    expect(done.status.type).toBe("done");
    expect(done.completedAt).not.toBeNull();

    // Reopen it.
    const reopened = (
      await http.post(`/tasks/${task.id}/toggle-done`).set(auth(owner.accessToken)).expect(200)
    ).body.task;
    expect(reopened.status.type).not.toBe("done");
    expect(reopened.completedAt ?? null).toBeNull();
  });

  it("space-level task list spans every list in the space", async () => {
    const owner = await ownerWorkspace();
    const { space, list } = await makeSpaceAndList(owner.accessToken);
    const listB = (
      await http
        .post(`/spaces/${space.id}/lists`)
        .set(auth(owner.accessToken))
        .send({ name: "Second list" })
        .expect(201)
    ).body.list;

    for (const [listId, name] of [
      [list.id, "In list A"],
      [listB.id, "In list B"],
    ] as const) {
      await http
        .post(`/lists/${listId}/tasks`)
        .set(auth(owner.accessToken))
        .send({ name })
        .expect(201);
    }

    const spaceTasks = (
      await http
        .get(`/spaces/${space.id}/tasks`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body.tasks as { name: string; listId: string }[];
    expect(spaceTasks.map((t) => t.name)).toEqual(
      expect.arrayContaining(["In list A", "In list B"]),
    );
    // Each card still carries its own list, so the UI can group by list.
    expect(new Set(spaceTasks.map((t) => t.listId)).size).toBeGreaterThan(1);

    // A guest with no share can't see the space — 404, no task names leaked.
    const outsider = await memberOf(owner.accessToken, owner.workspaceId, "guest");
    await http
      .get(`/spaces/${space.id}/tasks`)
      .set(auth(outsider.accessToken))
      .expect(404);
  });
  });

