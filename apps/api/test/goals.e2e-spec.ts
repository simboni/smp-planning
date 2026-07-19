import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 9 (Goals, OKRs & Portfolios) against the
 * migrated stackup_test database. Same harness as M8: unique emails,
 * supertest, setup.ts; owner signs up, creates a workspace + access token.
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

async function ownerWorkspace(name = "M9 WS") {
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

async function makeSpaceAndList(
  token: string,
  spaceBody: Record<string, unknown> = {},
) {
  const space = (
    await http
      .post("/spaces")
      .set(auth(token))
      .send({ name: "Space", ...spaceBody })
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

async function makeGoal(
  token: string,
  body: Record<string, unknown> = {},
) {
  return (
    await http
      .post("/goals")
      .set(auth(token))
      .send({ name: "Goal", ...body })
      .expect(201)
  ).body.goal;
}

describe("goal folders", () => {
  it("supports CRUD; deleting a folder keeps its goals (folderId nulled)", async () => {
    const owner = await ownerWorkspace();

    const folder = (
      await http
        .post("/goal-folders")
        .set(auth(owner.accessToken))
        .send({ name: "Q3 OKRs", color: "#FF5733" })
        .expect(201)
    ).body.folder;
    expect(folder.name).toBe("Q3 OKRs");
    expect(folder.color).toBe("#FF5733");
    expect(folder.goalCount).toBe(0);

    const goal = await makeGoal(owner.accessToken, {
      name: "Grow revenue",
      folderId: folder.id,
    });
    expect(goal.folderId).toBe(folder.id);

    const listed = await http
      .get("/goal-folders")
      .set(auth(owner.accessToken))
      .expect(200);
    expect(listed.body.folders).toHaveLength(1);
    expect(listed.body.folders[0].goalCount).toBe(1);

    const patched = await http
      .patch(`/goal-folders/${folder.id}`)
      .set(auth(owner.accessToken))
      .send({ name: "Q4 OKRs", color: "#22C55E" })
      .expect(200);
    expect(patched.body.folder.name).toBe("Q4 OKRs");
    expect(patched.body.folder.color).toBe("#22C55E");
    expect(patched.body.folder.goalCount).toBe(1);

    await http
      .delete(`/goal-folders/${folder.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    await http
      .get("/goal-folders")
      .set(auth(owner.accessToken))
      .expect(200)
      .expect((r) => expect(r.body.folders).toHaveLength(0));

    // The goal survives the folder deletion (SET NULL).
    const detail = await http
      .get(`/goals/${goal.id}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(detail.body.goal.folderId).toBeNull();
  });
});

describe("goals", () => {
  it("CRUD with owner/dueDate; archived filter; light edit rule", async () => {
    const owner = await ownerWorkspace();
    const memberA = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const memberB = await memberOf(owner.accessToken, owner.workspaceId, "member");

    // Any member can create; bad references are rejected.
    await http
      .post("/goals")
      .set(auth(memberA.accessToken))
      .send({})
      .expect(400); // name required
    const goal = await makeGoal(memberA.accessToken, {
      name: "Ship v2",
      description: "The big one",
      ownerUserId: owner.userId,
      dueDate: "2026-09-30",
    });
    expect(goal.name).toBe("Ship v2");
    expect(goal.owner.id).toBe(owner.userId);
    expect(goal.dueDate).toBe("2026-09-30");
    expect(goal.archived).toBe(false);
    expect(goal.progress).toBe(0);
    expect(goal.targetCount).toBe(0);

    const listed = await http
      .get("/goals")
      .set(auth(memberB.accessToken))
      .expect(200);
    const card = listed.body.goals.find((g: { id: string }) => g.id === goal.id);
    expect(card).toMatchObject({
      name: "Ship v2",
      description: "The big one",
      folderId: null,
      progress: 0,
      targetCount: 0,
    });
    expect(card.owner.fullName).toBe("Test User");

    // An unrelated member is neither creator, goal owner nor admin -> 403.
    await http
      .patch(`/goals/${goal.id}`)
      .set(auth(memberB.accessToken))
      .send({ name: "hijack" })
      .expect(403);
    await http
      .delete(`/goals/${goal.id}`)
      .set(auth(memberB.accessToken))
      .expect(403);

    // The creator can edit; archiving hides it from the default list.
    const patched = await http
      .patch(`/goals/${goal.id}`)
      .set(auth(memberA.accessToken))
      .send({ name: "Ship v2.1", archived: true })
      .expect(200);
    expect(patched.body.goal.name).toBe("Ship v2.1");
    expect(patched.body.goal.archived).toBe(true);

    const active = await http
      .get("/goals")
      .set(auth(memberA.accessToken))
      .expect(200);
    expect(
      active.body.goals.find((g: { id: string }) => g.id === goal.id),
    ).toBeUndefined();
    const all = await http
      .get("/goals?archived=1")
      .set(auth(memberA.accessToken))
      .expect(200);
    expect(
      all.body.goals.find((g: { id: string }) => g.id === goal.id),
    ).toBeDefined();

    // The goal OWNER (workspace owner here) may delete it too.
    await http
      .delete(`/goals/${goal.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    await http
      .get(`/goals/${goal.id}`)
      .set(auth(owner.accessToken))
      .expect(404);
  });

  it("guests get 403 on the goals surface", async () => {
    const owner = await ownerWorkspace();
    const guest = await memberOf(owner.accessToken, owner.workspaceId, "guest");
    await http.get("/goals").set(auth(guest.accessToken)).expect(403);
    await http
      .post("/goals")
      .set(auth(guest.accessToken))
      .send({ name: "Nope" })
      .expect(403);
    await http.get("/portfolios").set(auth(guest.accessToken)).expect(403);
    await http.get("/goal-folders").set(auth(guest.accessToken)).expect(403);
  });
});

describe("targets", () => {
  it("number target math: (current-start)/(target-start), clamped 0..1", async () => {
    const owner = await ownerWorkspace();
    const goal = await makeGoal(owner.accessToken, { name: "Numbers" });

    await http
      .post(`/goals/${goal.id}/targets`)
      .set(auth(owner.accessToken))
      .send({ name: "Bad", type: "percentage" })
      .expect(400); // invalid type

    const target = (
      await http
        .post(`/goals/${goal.id}/targets`)
        .set(auth(owner.accessToken))
        .send({ name: "Signups", type: "number", startValue: 0, targetValue: 100 })
        .expect(201)
    ).body.target;
    // Numbers come back as numbers, and progress starts at 0.
    expect(target.startValue).toBe(0);
    expect(target.targetValue).toBe(100);
    expect(target.currentValue).toBe(0);
    expect(target.progress).toBe(0);

    const at40 = await http
      .patch(`/targets/${target.id}`)
      .set(auth(owner.accessToken))
      .send({ currentValue: 40 })
      .expect(200);
    expect(at40.body.target.currentValue).toBe(40);
    expect(at40.body.target.progress).toBeCloseTo(0.4, 5);

    // Overshoot clamps to 1, undershoot clamps to 0.
    const over = await http
      .patch(`/targets/${target.id}`)
      .set(auth(owner.accessToken))
      .send({ currentValue: 150 })
      .expect(200);
    expect(over.body.target.progress).toBe(1);
    const under = await http
      .patch(`/targets/${target.id}`)
      .set(auth(owner.accessToken))
      .send({ currentValue: -10 })
      .expect(200);
    expect(under.body.target.progress).toBe(0);

    // Goal progress reflects the single target.
    const detail = await http
      .get(`/goals/${goal.id}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(detail.body.goal.progress).toBe(0);
    expect(detail.body.goal.targetCount).toBe(1);

    await http
      .delete(`/targets/${target.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    const empty = await http
      .get(`/goals/${goal.id}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(empty.body.goal.targets).toHaveLength(0);
    expect(empty.body.goal.progress).toBe(0);
  });

  it("boolean targets flip 0 -> 1 on done", async () => {
    const owner = await ownerWorkspace();
    const goal = await makeGoal(owner.accessToken, { name: "Booleans" });
    const target = (
      await http
        .post(`/goals/${goal.id}/targets`)
        .set(auth(owner.accessToken))
        .send({ name: "Launch the blog", type: "boolean" })
        .expect(201)
    ).body.target;
    expect(target.done).toBe(false);
    expect(target.progress).toBe(0);

    const done = await http
      .patch(`/targets/${target.id}`)
      .set(auth(owner.accessToken))
      .send({ done: true })
      .expect(200);
    expect(done.body.target.progress).toBe(1);

    const detail = await http
      .get(`/goals/${goal.id}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(detail.body.goal.progress).toBe(1);
  });

  it("tasks targets track done/total; goal progress is the mean of targets", async () => {
    const owner = await ownerWorkspace();
    const { space, list } = await makeSpaceAndList(owner.accessToken);
    const taskA = await makeTask(owner.accessToken, list.id, { name: "A" });
    const taskB = await makeTask(owner.accessToken, list.id, { name: "B" });

    const goal = await makeGoal(owner.accessToken, { name: "Mixed" });
    const tasksTarget = (
      await http
        .post(`/goals/${goal.id}/targets`)
        .set(auth(owner.accessToken))
        .send({ name: "Close the epics", type: "tasks", taskIds: [taskA.id, taskB.id] })
        .expect(201)
    ).body.target;
    expect(tasksTarget.progress).toBe(0);

    // A finished boolean target alongside it, to exercise the mean.
    const boolTarget = (
      await http
        .post(`/goals/${goal.id}/targets`)
        .set(auth(owner.accessToken))
        .send({ name: "Kickoff held", type: "boolean" })
        .expect(201)
    ).body.target;
    await http
      .patch(`/targets/${boolTarget.id}`)
      .set(auth(owner.accessToken))
      .send({ done: true })
      .expect(200);

    // Complete one of the two linked tasks -> tasks target 0.5.
    const statuses = await spaceStatuses(owner.accessToken, space.id);
    const doneStatus = statuses.find((s) => s.type === "done")!;
    await http
      .patch(`/tasks/${taskA.id}`)
      .set(auth(owner.accessToken))
      .send({ statusId: doneStatus.id })
      .expect(200);

    const detail = await http
      .get(`/goals/${goal.id}`)
      .set(auth(owner.accessToken))
      .expect(200);
    const t = detail.body.goal.targets.find(
      (x: { id: string }) => x.id === tasksTarget.id,
    );
    expect(t.progress).toBeCloseTo(0.5, 5);
    expect(t.tasks).toHaveLength(2);
    const linkedA = t.tasks.find((x: { id: string }) => x.id === taskA.id);
    expect(linkedA).toMatchObject({
      name: "A",
      listId: list.id,
      statusType: "done",
    });
    // goal.progress = mean(0.5, 1) = 0.75
    expect(detail.body.goal.progress).toBeCloseTo(0.75, 5);
    expect(detail.body.goal.targetCount).toBe(2);
  });

  it("tasks in invisible private spaces cannot be linked (400) and never leak names", async () => {
    const owner = await ownerWorkspace();
    const member = await memberOf(owner.accessToken, owner.workspaceId, "member");

    // The owner's private space is invisible to the member.
    const { list: privateList } = await makeSpaceAndList(owner.accessToken, {
      name: "Secret",
      isPrivate: true,
    });
    const secretTask = await makeTask(owner.accessToken, privateList.id, {
      name: "Top secret",
    });

    const goal = await makeGoal(member.accessToken, { name: "Mine" });
    await http
      .post(`/goals/${goal.id}/targets`)
      .set(auth(member.accessToken))
      .send({ name: "Sneaky", type: "tasks", taskIds: [secretTask.id] })
      .expect(400);

    const target = (
      await http
        .post(`/goals/${goal.id}/targets`)
        .set(auth(member.accessToken))
        .send({ name: "Legit", type: "tasks" })
        .expect(201)
    ).body.target;
    await http
      .patch(`/targets/${target.id}`)
      .set(auth(member.accessToken))
      .send({ taskIds: [secretTask.id] })
      .expect(400);

    // The OWNER links their own private task to a goal of their own; the
    // member still sees the goal (workspace-wide) but the task is masked.
    const ownersGoal = await makeGoal(owner.accessToken, { name: "Owner's" });
    await http
      .post(`/goals/${ownersGoal.id}/targets`)
      .set(auth(owner.accessToken))
      .send({ name: "Private work", type: "tasks", taskIds: [secretTask.id] })
      .expect(201);
    const seenByMember = await http
      .get(`/goals/${ownersGoal.id}`)
      .set(auth(member.accessToken))
      .expect(200);
    expect(seenByMember.body.goal.targets[0].tasks).toEqual([
      { id: secretTask.id, name: "Private task", listId: null, statusType: null },
    ]);
  });
});

describe("portfolios", () => {
  it("rolls lists up: stats in one query, progress = done/total, overdue counted", async () => {
    const owner = await ownerWorkspace();
    const { space, list } = await makeSpaceAndList(owner.accessToken);
    const statuses = await spaceStatuses(owner.accessToken, space.id);
    const doneStatus = statuses.find((s) => s.type === "done")!;
    const activeStatus = statuses.find((s) => s.type === "active")!;

    // 3 tasks: one done, one active AND overdue, one untouched.
    await makeTask(owner.accessToken, list.id, {
      name: "Done",
      statusId: doneStatus.id,
    });
    await makeTask(owner.accessToken, list.id, {
      name: "Late",
      statusId: activeStatus.id,
      dueDate: "2020-01-01T00:00:00.000Z",
    });
    await makeTask(owner.accessToken, list.id, { name: "Fresh" });

    const portfolio = (
      await http
        .post("/portfolios")
        .set(auth(owner.accessToken))
        .send({ name: "Delivery", color: "#3366FF", listIds: [list.id] })
        .expect(201)
    ).body.portfolio;
    expect(portfolio.itemCount).toBe(1);

    const listed = await http
      .get("/portfolios")
      .set(auth(owner.accessToken))
      .expect(200);
    expect(listed.body.portfolios).toEqual([
      { id: portfolio.id, name: "Delivery", color: "#3366FF", itemCount: 1 },
    ]);

    const detail = await http
      .get(`/portfolios/${portfolio.id}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(detail.body.portfolio.id).toBe(portfolio.id);
    expect(detail.body.items).toHaveLength(1);
    expect(detail.body.items[0]).toMatchObject({
      listId: list.id,
      listName: "List",
      spaceId: space.id,
      spaceName: "Space",
      stats: { total: 3, done: 1, inProgress: 1, overdue: 1 },
    });
    expect(detail.body.items[0].progress).toBeCloseTo(1 / 3, 2);

    const patched = await http
      .patch(`/portfolios/${portfolio.id}`)
      .set(auth(owner.accessToken))
      .send({ name: "Delivery 2", listIds: [] })
      .expect(200);
    expect(patched.body.portfolio.name).toBe("Delivery 2");
    expect(patched.body.portfolio.itemCount).toBe(0);

    await http
      .delete(`/portfolios/${portfolio.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    await http
      .get(`/portfolios/${portfolio.id}`)
      .set(auth(owner.accessToken))
      .expect(404);
  });

  it("only visible lists are linkable (400) and invisible items are filtered", async () => {
    const owner = await ownerWorkspace();
    const member = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const { list: privateList } = await makeSpaceAndList(owner.accessToken, {
      name: "Secret",
      isPrivate: true,
    });

    // A member cannot link a list they cannot see.
    await http
      .post("/portfolios")
      .set(auth(member.accessToken))
      .send({ name: "Sneaky", listIds: [privateList.id] })
      .expect(400);

    // The owner can; the member then sees the portfolio without the item.
    const portfolio = (
      await http
        .post("/portfolios")
        .set(auth(owner.accessToken))
        .send({ name: "Owner's", listIds: [privateList.id] })
        .expect(201)
    ).body.portfolio;
    const seenByMember = await http
      .get(`/portfolios/${portfolio.id}`)
      .set(auth(member.accessToken))
      .expect(200);
    expect(seenByMember.body.items).toHaveLength(0);
    const seenByOwner = await http
      .get(`/portfolios/${portfolio.id}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(seenByOwner.body.items).toHaveLength(1);
  });
});
