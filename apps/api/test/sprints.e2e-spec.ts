import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 10 (Sprints) against the migrated
 * stackup_test database: sprint creation wraps a fresh list, story points
 * ride the task PATCH, and the report computes burndown + velocity.
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

/** 'YYYY-MM-DD' n days from now, in UTC (matching the API's date math). */
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

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

async function ownerWorkspace(name = "M10 Sprint WS") {
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

async function makeSpace(token: string, body: Record<string, unknown> = {}) {
  return (
    await http
      .post("/spaces")
      .set(auth(token))
      .send({ name: "Space", ...body })
      .expect(201)
  ).body.space;
}

async function makeTask(
  token: string,
  listId: string,
  body: Record<string, unknown> = {},
) {
  return (
    await http
      .post(`/lists/${listId}/tasks`)
      .set(auth(token))
      .send({ name: "Task", ...body })
      .expect(201)
  ).body.task;
}

async function spaceStatuses(token: string, spaceId: string) {
  const res = await http
    .get(`/spaces/${spaceId}/statuses`)
    .set(auth(token))
    .expect(200);
  return res.body.statuses as { id: string; type: string }[];
}

async function makeSprint(
  token: string,
  spaceId: string,
  body: Record<string, unknown> = {},
) {
  return (
    await http
      .post(`/spaces/${spaceId}/sprints`)
      .set(auth(token))
      .send({ startDate: day(-2), endDate: day(2), ...body })
      .expect(201)
  ).body.sprint;
}

describe("sprints", () => {
  it("creating a sprint auto-creates its backing list, which works like any list", async () => {
    const owner = await ownerWorkspace();
    const space = await makeSpace(owner.accessToken);

    await http
      .post(`/spaces/${space.id}/sprints`)
      .set(auth(owner.accessToken))
      .send({ startDate: day(2), endDate: day(0) })
      .expect(400); // inverted window
    await http
      .post(`/spaces/${space.id}/sprints`)
      .set(auth(owner.accessToken))
      .send({ startDate: "soon", endDate: day(2) })
      .expect(400);

    const sprint = await makeSprint(owner.accessToken, space.id);
    expect(sprint.name).toBe("Sprint 1"); // default numbered name
    expect(sprint.spaceId).toBe(space.id);
    expect(sprint.startDate).toBe(day(-2));
    expect(sprint.endDate).toBe(day(2));
    expect(sprint.archived).toBe(false);

    // The backing list exists in the space and accepts tasks like any list.
    const listDetail = await http
      .get(`/lists/${sprint.listId}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(listDetail.body.list.name).toBe("Sprint 1");
    expect(listDetail.body.list.spaceId).toBe(space.id);
    const task = await makeTask(owner.accessToken, sprint.listId);
    expect(task.listId).toBe(sprint.listId);

    const second = await makeSprint(owner.accessToken, space.id, {
      name: "Hardening",
    });
    expect(second.name).toBe("Hardening");
  });

  it("sprintPoints ride the task PATCH (int 0..999 or null)", async () => {
    const owner = await ownerWorkspace();
    const space = await makeSpace(owner.accessToken);
    const sprint = await makeSprint(owner.accessToken, space.id);
    const task = await makeTask(owner.accessToken, sprint.listId);
    expect(task.sprintPoints).toBeNull();

    await http
      .patch(`/tasks/${task.id}`)
      .set(auth(owner.accessToken))
      .send({ sprintPoints: 1000 })
      .expect(400);
    await http
      .patch(`/tasks/${task.id}`)
      .set(auth(owner.accessToken))
      .send({ sprintPoints: 2.5 })
      .expect(400);

    const set = await http
      .patch(`/tasks/${task.id}`)
      .set(auth(owner.accessToken))
      .send({ sprintPoints: 5 })
      .expect(200);
    expect(set.body.task.sprintPoints).toBe(5);

    const cleared = await http
      .patch(`/tasks/${task.id}`)
      .set(auth(owner.accessToken))
      .send({ sprintPoints: null })
      .expect(200);
    expect(cleared.body.task.sprintPoints).toBeNull();
  });

  it("listing sums points; completing a task moves its points to completedPoints", async () => {
    const owner = await ownerWorkspace();
    const space = await makeSpace(owner.accessToken);
    const sprint = await makeSprint(owner.accessToken, space.id);
    const a = await makeTask(owner.accessToken, sprint.listId, { name: "A" });
    const b = await makeTask(owner.accessToken, sprint.listId, { name: "B" });
    await http
      .patch(`/tasks/${a.id}`)
      .set(auth(owner.accessToken))
      .send({ sprintPoints: 5 })
      .expect(200);
    await http
      .patch(`/tasks/${b.id}`)
      .set(auth(owner.accessToken))
      .send({ sprintPoints: 3 })
      .expect(200);

    let listed = await http
      .get(`/spaces/${space.id}/sprints`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(listed.body.sprints).toHaveLength(1);
    expect(listed.body.sprints[0]).toMatchObject({
      id: sprint.id,
      listId: sprint.listId,
      totalPoints: 8,
      completedPoints: 0,
    });

    const statuses = await spaceStatuses(owner.accessToken, space.id);
    const done = statuses.find((s) => s.type === "done")!;
    await http
      .patch(`/tasks/${a.id}`)
      .set(auth(owner.accessToken))
      .send({ statusId: done.id })
      .expect(200);

    listed = await http
      .get(`/spaces/${space.id}/sprints`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(listed.body.sprints[0]).toMatchObject({
      totalPoints: 8,
      completedPoints: 5,
    });
  });

  it("report: burndown day count/drops/ideal endpoints, velocity includes the sprint", async () => {
    const owner = await ownerWorkspace();
    const space = await makeSpace(owner.accessToken);
    // 5-day window centered on today (day(-2)..day(2)).
    const sprint = await makeSprint(owner.accessToken, space.id);
    const a = await makeTask(owner.accessToken, sprint.listId, { name: "A" });
    const b = await makeTask(owner.accessToken, sprint.listId, { name: "B" });
    await http
      .patch(`/tasks/${a.id}`)
      .set(auth(owner.accessToken))
      .send({ sprintPoints: 5 })
      .expect(200);
    await http
      .patch(`/tasks/${b.id}`)
      .set(auth(owner.accessToken))
      .send({ sprintPoints: 3 })
      .expect(200);
    const statuses = await spaceStatuses(owner.accessToken, space.id);
    const done = statuses.find((s) => s.type === "done")!;
    await http
      .patch(`/tasks/${a.id}`)
      .set(auth(owner.accessToken))
      .send({ statusId: done.id })
      .expect(200); // completes TODAY

    const report = (
      await http
        .get(`/sprints/${sprint.id}/report`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body;
    expect(report.sprint.id).toBe(sprint.id);
    expect(report.totalPoints).toBe(8);
    expect(report.completedPoints).toBe(5);

    const days = report.burndown.days;
    expect(days).toHaveLength(5); // start..end inclusive
    expect(days.map((d: { date: string }) => d.date)).toEqual([
      day(-2),
      day(-1),
      day(0),
      day(1),
      day(2),
    ]);
    // Nothing was completed before today -> full total until the drop today.
    expect(days[0].remainingPoints).toBe(8);
    expect(days[1].remainingPoints).toBe(8);
    expect(days[2].remainingPoints).toBe(3); // the 5-pointer landed today
    // Days after today have no actuals — the chart stops.
    expect(days[3].remainingPoints).toBeNull();
    expect(days[4].remainingPoints).toBeNull();
    // Ideal line: linear from totalPoints down to 0.
    expect(days[0].idealRemaining).toBe(8);
    expect(days[2].idealRemaining).toBeCloseTo(4, 5);
    expect(days[4].idealRemaining).toBe(0);

    // Velocity lists this space's sprints chronologically with completed pts.
    expect(report.velocity).toEqual([
      { sprintId: sprint.id, name: sprint.name, completedPoints: 5 },
    ]);

    // A second, earlier sprint shows up before it (chronological order).
    const earlier = await makeSprint(owner.accessToken, space.id, {
      name: "Sprint 0",
      startDate: day(-10),
      endDate: day(-6),
    });
    const report2 = (
      await http
        .get(`/sprints/${sprint.id}/report`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body;
    expect(
      report2.velocity.map((v: { sprintId: string }) => v.sprintId),
    ).toEqual([earlier.id, sprint.id]);
  });

  it("PATCH renames the backing list too; DELETE keeps the list alive", async () => {
    const owner = await ownerWorkspace();
    const space = await makeSpace(owner.accessToken);
    const sprint = await makeSprint(owner.accessToken, space.id);

    await http
      .patch(`/sprints/${sprint.id}`)
      .set(auth(owner.accessToken))
      .send({ startDate: day(3) })
      .expect(400); // would invert the stored window

    const patched = await http
      .patch(`/sprints/${sprint.id}`)
      .set(auth(owner.accessToken))
      .send({ name: "Sprint 1 (extended)", endDate: day(5), archived: true })
      .expect(200);
    expect(patched.body.sprint).toMatchObject({
      name: "Sprint 1 (extended)",
      endDate: day(5),
      archived: true,
    });
    const listDetail = await http
      .get(`/lists/${sprint.listId}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(listDetail.body.list.name).toBe("Sprint 1 (extended)");

    // Deleting the sprint removes only the wrapper; the list survives.
    await http
      .delete(`/sprints/${sprint.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    await http
      .get(`/sprints/${sprint.id}/report`)
      .set(auth(owner.accessToken))
      .expect(404);
    await http
      .get(`/lists/${sprint.listId}`)
      .set(auth(owner.accessToken))
      .expect(200);
    const listed = await http
      .get(`/spaces/${space.id}/sprints`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(listed.body.sprints).toHaveLength(0);
  });
});
