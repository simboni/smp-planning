import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 4 (Custom Fields, Dependencies & Links, Task
 * Types, Recurrence) against the migrated stackup_test database. Same harness
 * as the M3 suite: unique emails, supertest, setup.ts env.
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

async function ownerWorkspace(name = "M4 WS") {
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

async function makeSpaceAndList(token: string) {
  const space = (
    await http
      .post("/spaces")
      .set(auth(token))
      .send({ name: "Space" })
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

async function makeTask(
  token: string,
  listId: string,
  body: Record<string, unknown> = {},
) {
  const res = await http
    .post(`/lists/${listId}/tasks`)
    .set(auth(token))
    .send({ name: "Task", ...body })
    .expect(201);
  return res.body.task;
}

async function getStatuses(token: string, spaceId: string) {
  const res = await http
    .get(`/spaces/${spaceId}/statuses`)
    .set(auth(token))
    .expect(200);
  return res.body.statuses as {
    id: string;
    name: string;
    type: string;
  }[];
}

async function getDetail(token: string, taskId: string) {
  const res = await http.get(`/tasks/${taskId}`).set(auth(token)).expect(200);
  return res.body.task;
}

describe("custom fields", () => {
  it("field CRUD: create, 409 dup, patch, delete", async () => {
    const owner = await ownerWorkspace();
    const { space } = await makeSpaceAndList(owner.accessToken);

    const field = (
      await http
        .post(`/spaces/${space.id}/fields`)
        .set(auth(owner.accessToken))
        .send({ name: "Effort", type: "number" })
        .expect(201)
    ).body.field;
    expect(field.type).toBe("number");
    expect(field.config).toEqual({});
    expect(field.position).toBe(0);

    // Duplicate name in the same space -> 409.
    await http
      .post(`/spaces/${space.id}/fields`)
      .set(auth(owner.accessToken))
      .send({ name: "Effort", type: "text" })
      .expect(409);
    // Unknown type -> 400.
    await http
      .post(`/spaces/${space.id}/fields`)
      .set(auth(owner.accessToken))
      .send({ name: "Bad", type: "geolocation" })
      .expect(400);

    const renamed = (
      await http
        .patch(`/fields/${field.id}`)
        .set(auth(owner.accessToken))
        .send({ name: "Story Points", position: 3 })
        .expect(200)
    ).body.field;
    expect(renamed.name).toBe("Story Points");
    expect(renamed.position).toBe(3);

    const listed = (
      await http
        .get(`/spaces/${space.id}/fields`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body.fields;
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe("Story Points");

    await http
      .delete(`/fields/${field.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    const after = (
      await http
        .get(`/spaces/${space.id}/fields`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body.fields;
    expect(after).toHaveLength(0);
  });

  it("dropdown: server-generated option ids, value validation, null unsets", async () => {
    const owner = await ownerWorkspace();
    const { space, list } = await makeSpaceAndList(owner.accessToken);
    const field = (
      await http
        .post(`/spaces/${space.id}/fields`)
        .set(auth(owner.accessToken))
        .send({
          name: "Severity",
          type: "dropdown",
          config: {
            options: [{ name: "Low" }, { name: "High", color: "#FF0000" }],
          },
        })
        .expect(201)
    ).body.field;
    expect(field.config.options).toHaveLength(2);
    for (const opt of field.config.options) {
      expect(typeof opt.id).toBe("string");
      expect(opt.id.length).toBeGreaterThan(0);
    }
    const high = field.config.options.find(
      (o: { name: string }) => o.name === "High",
    );
    expect(high.color).toBe("#FF0000");

    const task = await makeTask(owner.accessToken, list.id);

    // Bad option id -> 400.
    await http
      .put(`/tasks/${task.id}/fields/${field.id}`)
      .set(auth(owner.accessToken))
      .send({ value: { optionId: "00000000-0000-0000-0000-000000000000" } })
      .expect(400);

    const set = (
      await http
        .put(`/tasks/${task.id}/fields/${field.id}`)
        .set(auth(owner.accessToken))
        .send({ value: { optionId: high.id } })
        .expect(200)
    ).body;
    expect(set).toEqual({ fieldId: field.id, value: { optionId: high.id } });

    let detail = await getDetail(owner.accessToken, task.id);
    const fv = detail.fields.find(
      (f: { fieldId: string }) => f.fieldId === field.id,
    );
    expect(fv.value).toEqual({ optionId: high.id });

    // null unsets.
    const unset = (
      await http
        .put(`/tasks/${task.id}/fields/${field.id}`)
        .set(auth(owner.accessToken))
        .send({ value: null })
        .expect(200)
    ).body;
    expect(unset).toEqual({ fieldId: field.id, value: null });
    detail = await getDetail(owner.accessToken, task.id);
    expect(
      detail.fields.find((f: { fieldId: string }) => f.fieldId === field.id)
        .value,
    ).toBeNull();
  });

  it("labels hold multiple option ids and reject unknown ones", async () => {
    const owner = await ownerWorkspace();
    const { space, list } = await makeSpaceAndList(owner.accessToken);
    const field = (
      await http
        .post(`/spaces/${space.id}/fields`)
        .set(auth(owner.accessToken))
        .send({
          name: "Areas",
          type: "labels",
          config: {
            options: [{ name: "api" }, { name: "web" }, { name: "infra" }],
          },
        })
        .expect(201)
    ).body.field;
    const ids = field.config.options.map((o: { id: string }) => o.id);
    const task = await makeTask(owner.accessToken, list.id);

    const set = (
      await http
        .put(`/tasks/${task.id}/fields/${field.id}`)
        .set(auth(owner.accessToken))
        .send({ value: { optionIds: [ids[0], ids[2]] } })
        .expect(200)
    ).body;
    expect(set.value.optionIds).toEqual([ids[0], ids[2]]);

    await http
      .put(`/tasks/${task.id}/fields/${field.id}`)
      .set(auth(owner.accessToken))
      .send({ value: { optionIds: [ids[0], "not-an-option"] } })
      .expect(400);

    const detail = await getDetail(owner.accessToken, task.id);
    expect(
      detail.fields.find((f: { fieldId: string }) => f.fieldId === field.id)
        .value.optionIds,
    ).toEqual([ids[0], ids[2]]);
  });

  it("TaskDetail.fields lists ALL space fields, unset ones with value null", async () => {
    const owner = await ownerWorkspace();
    const { space, list } = await makeSpaceAndList(owner.accessToken);
    const textField = (
      await http
        .post(`/spaces/${space.id}/fields`)
        .set(auth(owner.accessToken))
        .send({ name: "Notes", type: "text" })
        .expect(201)
    ).body.field;
    const checkField = (
      await http
        .post(`/spaces/${space.id}/fields`)
        .set(auth(owner.accessToken))
        .send({ name: "Approved", type: "checkbox" })
        .expect(201)
    ).body.field;

    const task = await makeTask(owner.accessToken, list.id);
    await http
      .put(`/tasks/${task.id}/fields/${textField.id}`)
      .set(auth(owner.accessToken))
      .send({ value: { text: "hello" } })
      .expect(200);

    const detail = await getDetail(owner.accessToken, task.id);
    expect(detail.fields).toHaveLength(2);
    // Ordered by position (creation order here).
    expect(detail.fields.map((f: { fieldId: string }) => f.fieldId)).toEqual([
      textField.id,
      checkField.id,
    ]);
    expect(detail.fields[0].value).toEqual({ text: "hello" });
    expect(detail.fields[1].value).toBeNull();
    expect(detail.fields[1].name).toBe("Approved");
    expect(detail.fields[1].type).toBe("checkbox");
  });
});

describe("dependencies & links", () => {
  it("waiting-on adds blockedCount to cards and resolves when the dep completes", async () => {
    const owner = await ownerWorkspace();
    const { space, list } = await makeSpaceAndList(owner.accessToken);
    const a = await makeTask(owner.accessToken, list.id, { name: "A" });
    const b = await makeTask(owner.accessToken, list.id, { name: "B" });

    await http
      .post(`/tasks/${a.id}/dependencies`)
      .set(auth(owner.accessToken))
      .send({ dependsOnTaskId: b.id })
      .expect(201);
    // Self and duplicate edges -> 400.
    await http
      .post(`/tasks/${a.id}/dependencies`)
      .set(auth(owner.accessToken))
      .send({ dependsOnTaskId: a.id })
      .expect(400);
    await http
      .post(`/tasks/${a.id}/dependencies`)
      .set(auth(owner.accessToken))
      .send({ dependsOnTaskId: b.id })
      .expect(400);

    const detailA = await getDetail(owner.accessToken, a.id);
    expect(detailA.waitingOn.map((t: { id: string }) => t.id)).toEqual([b.id]);
    expect(detailA.waitingOn[0].status.type).toBe("not_started");
    expect(detailA.waitingOn[0].listId).toBe(list.id);
    const detailB = await getDetail(owner.accessToken, b.id);
    expect(detailB.blocking.map((t: { id: string }) => t.id)).toEqual([a.id]);

    let cards = (
      await http.get(`/lists/${list.id}/tasks`).set(auth(owner.accessToken))
    ).body.tasks;
    expect(
      cards.find((t: { id: string }) => t.id === a.id).blockedCount,
    ).toBe(1);
    expect(
      cards.find((t: { id: string }) => t.id === b.id).blockedCount,
    ).toBe(0);

    // Completing B (allowed even while A is blocked) unblocks A.
    const statuses = await getStatuses(owner.accessToken, space.id);
    const done = statuses.find((s) => s.type === "done")!;
    await http
      .patch(`/tasks/${b.id}`)
      .set(auth(owner.accessToken))
      .send({ statusId: done.id })
      .expect(200);
    cards = (
      await http.get(`/lists/${list.id}/tasks`).set(auth(owner.accessToken))
    ).body.tasks;
    expect(
      cards.find((t: { id: string }) => t.id === a.id).blockedCount,
    ).toBe(0);

    // A itself can still be completed while waiting on tasks (warn-only).
    await http
      .delete(`/tasks/${b.id}/dependencies/${a.id}`)
      .set(auth(owner.accessToken))
      .expect(204); // no-op edge direction; A->B still present
    await http
      .patch(`/tasks/${a.id}`)
      .set(auth(owner.accessToken))
      .send({ statusId: done.id })
      .expect(200);

    await http
      .delete(`/tasks/${a.id}/dependencies/${b.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    const afterDetail = await getDetail(owner.accessToken, a.id);
    expect(afterDetail.waitingOn).toHaveLength(0);
  });

  it("rejects an edge that would close a dependency cycle", async () => {
    const owner = await ownerWorkspace();
    const { list } = await makeSpaceAndList(owner.accessToken);
    const a = await makeTask(owner.accessToken, list.id, { name: "A" });
    const b = await makeTask(owner.accessToken, list.id, { name: "B" });
    const c = await makeTask(owner.accessToken, list.id, { name: "C" });

    await http
      .post(`/tasks/${a.id}/dependencies`)
      .set(auth(owner.accessToken))
      .send({ dependsOnTaskId: b.id })
      .expect(201);
    await http
      .post(`/tasks/${b.id}/dependencies`)
      .set(auth(owner.accessToken))
      .send({ dependsOnTaskId: c.id })
      .expect(201);

    // C waits-on A would make A -> B -> C -> A.
    const res = await http
      .post(`/tasks/${c.id}/dependencies`)
      .set(auth(owner.accessToken))
      .send({ dependsOnTaskId: a.id })
      .expect(400);
    expect(res.body.message).toContain("circular dependency");
  });

  it("links are symmetric and deduplicated across direction", async () => {
    const owner = await ownerWorkspace();
    const { list } = await makeSpaceAndList(owner.accessToken);
    const t1 = await makeTask(owner.accessToken, list.id, { name: "One" });
    const t2 = await makeTask(owner.accessToken, list.id, { name: "Two" });

    await http
      .post(`/tasks/${t1.id}/links`)
      .set(auth(owner.accessToken))
      .send({ taskId: t2.id })
      .expect(201);
    // Same pair from the OTHER side is a duplicate.
    await http
      .post(`/tasks/${t2.id}/links`)
      .set(auth(owner.accessToken))
      .send({ taskId: t1.id })
      .expect(400);
    // Self link -> 400.
    await http
      .post(`/tasks/${t1.id}/links`)
      .set(auth(owner.accessToken))
      .send({ taskId: t1.id })
      .expect(400);

    const d1 = await getDetail(owner.accessToken, t1.id);
    expect(d1.linked.map((t: { id: string }) => t.id)).toEqual([t2.id]);
    const d2 = await getDetail(owner.accessToken, t2.id);
    expect(d2.linked.map((t: { id: string }) => t.id)).toEqual([t1.id]);

    // Delete from the other side removes the single stored pair.
    await http
      .delete(`/tasks/${t2.id}/links/${t1.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    const after = await getDetail(owner.accessToken, t1.id);
    expect(after.linked).toHaveLength(0);
  });
});

describe("task types & milestones", () => {
  it("lazily provisions Milestone/Bug/Feature and supports CRUD", async () => {
    const owner = await ownerWorkspace();
    const { space } = await makeSpaceAndList(owner.accessToken);

    const types = (
      await http
        .get(`/spaces/${space.id}/task-types`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body.taskTypes;
    expect(types.map((t: { name: string }) => t.name).sort()).toEqual([
      "Bug",
      "Feature",
      "Milestone",
    ]);
    const milestone = types.find(
      (t: { name: string }) => t.name === "Milestone",
    );
    expect(milestone.isMilestone).toBe(true);
    expect(milestone.icon).toBe("🔷");
    expect(
      types.find((t: { name: string }) => t.name === "Bug").isMilestone,
    ).toBe(false);

    // Second read does not duplicate.
    const again = (
      await http
        .get(`/spaces/${space.id}/task-types`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body.taskTypes;
    expect(again).toHaveLength(3);

    const epic = (
      await http
        .post(`/spaces/${space.id}/task-types`)
        .set(auth(owner.accessToken))
        .send({ name: "Epic", icon: "🚀" })
        .expect(201)
    ).body.taskType;
    expect(epic.isMilestone).toBe(false);
    await http
      .post(`/spaces/${space.id}/task-types`)
      .set(auth(owner.accessToken))
      .send({ name: "Epic" })
      .expect(409);

    const patched = (
      await http
        .patch(`/task-types/${epic.id}`)
        .set(auth(owner.accessToken))
        .send({ name: "Initiative", isMilestone: true })
        .expect(200)
    ).body.taskType;
    expect(patched.name).toBe("Initiative");
    expect(patched.isMilestone).toBe(true);

    await http
      .delete(`/task-types/${epic.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
  });

  it("tasks take a taskTypeId and isMilestone flag; deleting the type nulls it", async () => {
    const owner = await ownerWorkspace();
    const { space, list } = await makeSpaceAndList(owner.accessToken);
    const types = (
      await http
        .get(`/spaces/${space.id}/task-types`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body.taskTypes;
    const bug = types.find((t: { name: string }) => t.name === "Bug");

    const task = await makeTask(owner.accessToken, list.id);
    expect(task.taskType).toBeNull();
    expect(task.isMilestone).toBe(false);

    const typed = (
      await http
        .patch(`/tasks/${task.id}`)
        .set(auth(owner.accessToken))
        .send({ taskTypeId: bug.id, isMilestone: true })
        .expect(200)
    ).body.task;
    expect(typed.taskType).toEqual({
      id: bug.id,
      name: "Bug",
      icon: "🐞",
      isMilestone: false,
    });
    expect(typed.isMilestone).toBe(true);

    // Card view carries the type too.
    const cards = (
      await http.get(`/lists/${list.id}/tasks`).set(auth(owner.accessToken))
    ).body.tasks;
    expect(
      cards.find((t: { id: string }) => t.id === task.id).taskType.name,
    ).toBe("Bug");

    // A type from another space is rejected.
    const other = await makeSpaceAndList(owner.accessToken);
    const otherTypes = (
      await http
        .get(`/spaces/${other.space.id}/task-types`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body.taskTypes;
    await http
      .patch(`/tasks/${task.id}`)
      .set(auth(owner.accessToken))
      .send({ taskTypeId: otherTypes[0].id })
      .expect(400);

    // Deleting the type nulls task_type_id via FK.
    await http
      .delete(`/task-types/${bug.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    const after = await getDetail(owner.accessToken, task.id);
    expect(after.taskType).toBeNull();

    // Explicit null clears.
    const cleared = (
      await http
        .patch(`/tasks/${task.id}`)
        .set(auth(owner.accessToken))
        .send({ isMilestone: false, taskTypeId: null })
        .expect(200)
    ).body.task;
    expect(cleared.isMilestone).toBe(false);
    expect(cleared.taskType).toBeNull();
  });
});

describe("recurrence", () => {
  it("validates the rule shape", async () => {
    const owner = await ownerWorkspace();
    const { list } = await makeSpaceAndList(owner.accessToken);
    const task = await makeTask(owner.accessToken, list.id);
    for (const bad of [
      { freq: "yearly", interval: 1, mode: "on_complete" },
      { freq: "daily", interval: 0, mode: "on_complete" },
      { freq: "daily", interval: 1, mode: "on_schedule" },
      { freq: "daily", interval: 1 },
      "daily",
    ]) {
      await http
        .patch(`/tasks/${task.id}`)
        .set(auth(owner.accessToken))
        .send({ recurrence: bad })
        .expect(400);
    }
    const ok = (
      await http
        .patch(`/tasks/${task.id}`)
        .set(auth(owner.accessToken))
        .send({ recurrence: { freq: "weekly", interval: 2, mode: "on_complete" } })
        .expect(200)
    ).body.task;
    expect(ok.recurrence).toEqual({
      freq: "weekly",
      interval: 2,
      mode: "on_complete",
    });
    // null clears.
    const cleared = (
      await http
        .patch(`/tasks/${task.id}`)
        .set(auth(owner.accessToken))
        .send({ recurrence: null })
        .expect(200)
    ).body.task;
    expect(cleared.recurrence).toBeNull();
  });

  it("completing a daily recurring task spawns the next occurrence", async () => {
    const owner = await ownerWorkspace();
    const { space, list } = await makeSpaceAndList(owner.accessToken);
    const statuses = await getStatuses(owner.accessToken, space.id);
    const done = statuses.find((s) => s.type === "done")!;

    const tag = (
      await http
        .post(`/spaces/${space.id}/tags`)
        .set(auth(owner.accessToken))
        .send({ name: "ritual", color: "#00AA00" })
        .expect(201)
    ).body.tag;
    const field = (
      await http
        .post(`/spaces/${space.id}/fields`)
        .set(auth(owner.accessToken))
        .send({ name: "Owner note", type: "text" })
        .expect(201)
    ).body.field;

    const task = await makeTask(owner.accessToken, list.id, {
      name: "Standup notes",
      startDate: "2026-07-08T09:00:00.000Z",
      dueDate: "2026-07-10T09:00:00.000Z",
      assigneeIds: [owner.userId],
      tagIds: [tag.id],
      timeEstimateMinutes: 30,
    });
    await http
      .put(`/tasks/${task.id}/fields/${field.id}`)
      .set(auth(owner.accessToken))
      .send({ value: { text: "bring coffee" } })
      .expect(200);
    await http
      .patch(`/tasks/${task.id}`)
      .set(auth(owner.accessToken))
      .send({ recurrence: { freq: "daily", interval: 2, mode: "on_complete" } })
      .expect(200);

    const completed = (
      await http
        .patch(`/tasks/${task.id}`)
        .set(auth(owner.accessToken))
        .send({ statusId: done.id })
        .expect(200)
    ).body.task;
    expect(completed.completedAt).not.toBeNull();
    expect(completed.spawnedTaskId).toBeDefined();
    // The completed original's rule is cleared so history never re-fires.
    expect(completed.recurrence).toBeNull();

    const spawned = await getDetail(
      owner.accessToken,
      completed.spawnedTaskId as string,
    );
    expect(spawned.name).toBe("Standup notes");
    expect(spawned.listId).toBe(list.id);
    // Dates advanced from the ORIGINAL due date, keeping the 2-day gap.
    expect(spawned.dueDate).toBe("2026-07-12T09:00:00.000Z");
    expect(spawned.startDate).toBe("2026-07-10T09:00:00.000Z");
    // First not-done status, not completed.
    expect(spawned.status.type).toBe("not_started");
    expect(spawned.completedAt).toBeNull();
    // Assignees / tags / estimate / custom field values copied.
    expect(spawned.assignees.map((a: { id: string }) => a.id)).toEqual([
      owner.userId,
    ]);
    expect(spawned.tags.map((t: { id: string }) => t.id)).toEqual([tag.id]);
    expect(spawned.timeEstimateMinutes).toBe(30);
    expect(
      spawned.fields.find((f: { fieldId: string }) => f.fieldId === field.id)
        .value,
    ).toEqual({ text: "bring coffee" });
    // The clone carries the rule forward.
    expect(spawned.recurrence).toEqual({
      freq: "daily",
      interval: 2,
      mode: "on_complete",
    });

    // Completing the ORIGINAL again (already done, rule cleared) spawns nothing.
    const again = (
      await http
        .patch(`/tasks/${task.id}`)
        .set(auth(owner.accessToken))
        .send({ statusId: done.id })
        .expect(200)
    ).body.task;
    expect(again.spawnedTaskId).toBeUndefined();
  });

  it("a reorder that moves a recurring task into a done status also spawns", async () => {
    const owner = await ownerWorkspace();
    const { space, list } = await makeSpaceAndList(owner.accessToken);
    const statuses = await getStatuses(owner.accessToken, space.id);
    const done = statuses.find((s) => s.type === "done")!;

    const task = await makeTask(owner.accessToken, list.id, {
      name: "Weekly report",
      dueDate: "2026-07-17T12:00:00.000Z",
    });
    await http
      .patch(`/tasks/${task.id}`)
      .set(auth(owner.accessToken))
      .send({ recurrence: { freq: "weekly", interval: 1, mode: "on_complete" } })
      .expect(200);

    await http
      .post(`/lists/${list.id}/tasks/reorder`)
      .set(auth(owner.accessToken))
      .send({ statusId: done.id, ids: [task.id] })
      .expect(200);

    const cards = (
      await http.get(`/lists/${list.id}/tasks`).set(auth(owner.accessToken))
    ).body.tasks;
    expect(cards).toHaveLength(2);
    const clone = cards.find((t: { id: string }) => t.id !== task.id);
    expect(clone.name).toBe("Weekly report");
    expect(clone.dueDate).toBe("2026-07-24T12:00:00.000Z");
    expect(clone.status.type).toBe("not_started");

    const original = await getDetail(owner.accessToken, task.id);
    expect(original.recurrence).toBeNull();
    expect(original.completedAt).not.toBeNull();
  });
});
