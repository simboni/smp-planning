import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 8 (Time tracking, Timesheets & Workload)
 * against the migrated stackup_test database. Same harness as M7: unique
 * emails, supertest, setup.ts; owner signs up, creates a workspace + access
 * token, and a Space -> List -> Task to track time on.
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

async function ownerWorkspace(name = "M8 WS") {
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
  return (
    await http
      .post(`/lists/${listId}/tasks`)
      .set(auth(token))
      .send({ name: "Track me", ...body })
      .expect(201)
  ).body.task;
}

// A fixed Monday (UTC) far from "now" so timer entries never collide with it.
const MONDAY = "2026-01-05";

describe("timer", () => {
  it("start shows on GET /timer; a second start auto-stops the first", async () => {
    const owner = await ownerWorkspace();
    const { list } = await makeSpaceAndList(owner.accessToken);
    const taskA = await makeTask(owner.accessToken, list.id, { name: "A" });
    const taskB = await makeTask(owner.accessToken, list.id, { name: "B" });

    const started = await http
      .post(`/tasks/${taskA.id}/timer/start`)
      .set(auth(owner.accessToken))
      .send({ note: "working", billable: true })
      .expect(201);
    expect(started.body.entry.taskId).toBe(taskA.id);
    expect(started.body.entry.endedAt).toBeNull();
    expect(started.body.entry.billable).toBe(true);
    expect(started.body.entry.note).toBe("working");

    // GET /timer surfaces the running entry with its task + elapsed seconds.
    const timer = await http
      .get("/timer")
      .set(auth(owner.accessToken))
      .expect(200);
    expect(timer.body.running).not.toBeNull();
    expect(timer.body.running.entry.id).toBe(started.body.entry.id);
    expect(timer.body.running.task).toEqual({
      id: taskA.id,
      name: "A",
      listId: list.id,
    });
    expect(timer.body.running.entry.durationSeconds).toBeGreaterThanOrEqual(0);

    // Starting a second timer on another task auto-stops the first.
    const second = await http
      .post(`/tasks/${taskB.id}/timer/start`)
      .set(auth(owner.accessToken))
      .send({})
      .expect(201);
    expect(second.body.entry.taskId).toBe(taskB.id);

    const after = await http
      .get("/timer")
      .set(auth(owner.accessToken))
      .expect(200);
    expect(after.body.running.entry.id).toBe(second.body.entry.id);
    expect(after.body.running.task.id).toBe(taskB.id);

    // The first task's entry was finalized with a non-negative duration.
    const entriesA = await http
      .get(`/tasks/${taskA.id}/time-entries`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(entriesA.body.entries).toHaveLength(1);
    expect(entriesA.body.entries[0].endedAt).not.toBeNull();
    expect(entriesA.body.entries[0].durationSeconds).toBeGreaterThanOrEqual(0);

    // Stop the second: totals appear on the task, no timer remains.
    const stopped = await http
      .post("/timer/stop")
      .set(auth(owner.accessToken))
      .expect(200);
    expect(stopped.body.entry.id).toBe(second.body.entry.id);
    expect(stopped.body.entry.endedAt).not.toBeNull();

    const gone = await http
      .get("/timer")
      .set(auth(owner.accessToken))
      .expect(200);
    expect(gone.body.running).toBeNull();

    const entriesB = await http
      .get(`/tasks/${taskB.id}/time-entries`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(entriesB.body.entries).toHaveLength(1);
    expect(entriesB.body.totalSeconds).toBe(
      entriesB.body.entries[0].durationSeconds,
    );

    // Stopping again without a running timer is a 404.
    await http.post("/timer/stop").set(auth(owner.accessToken)).expect(404);
  });
});

describe("time entries", () => {
  it("manual entries validate order and 24h; totals + trackedSeconds add up", async () => {
    const owner = await ownerWorkspace();
    const { list } = await makeSpaceAndList(owner.accessToken);
    const task = await makeTask(owner.accessToken, list.id);

    // end before start -> 400
    await http
      .post(`/tasks/${task.id}/time-entries`)
      .set(auth(owner.accessToken))
      .send({
        startedAt: "2026-01-06T10:00:00.000Z",
        endedAt: "2026-01-06T09:00:00.000Z",
      })
      .expect(400);
    // longer than 24h -> 400
    await http
      .post(`/tasks/${task.id}/time-entries`)
      .set(auth(owner.accessToken))
      .send({
        startedAt: "2026-01-06T00:00:00.000Z",
        endedAt: "2026-01-07T12:00:00.000Z",
      })
      .expect(400);
    // missing/garbage timestamps -> 400
    await http
      .post(`/tasks/${task.id}/time-entries`)
      .set(auth(owner.accessToken))
      .send({ startedAt: "2026-01-06T09:00:00.000Z" })
      .expect(400);

    const created = await http
      .post(`/tasks/${task.id}/time-entries`)
      .set(auth(owner.accessToken))
      .send({
        startedAt: "2026-01-06T09:00:00.000Z",
        endedAt: "2026-01-06T10:00:00.000Z",
        billable: true,
        note: "manual hour",
      })
      .expect(201);
    expect(created.body.entry.durationSeconds).toBe(3600);
    expect(created.body.entry.billable).toBe(true);

    const listed = await http
      .get(`/tasks/${task.id}/time-entries`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(listed.body.totalSeconds).toBe(3600);
    expect(listed.body.billableSeconds).toBe(3600);
    expect(listed.body.entries[0].user.id).toBe(owner.userId);
    expect(listed.body.entries[0].note).toBe("manual hour");

    // trackedSeconds shows up on the task card and detail.
    const detail = await http
      .get(`/tasks/${task.id}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(detail.body.task.trackedSeconds).toBe(3600);
    const cards = await http
      .get(`/lists/${list.id}/tasks`)
      .set(auth(owner.accessToken))
      .expect(200);
    const card = cards.body.tasks.find((t: { id: string }) => t.id === task.id);
    expect(card.trackedSeconds).toBe(3600);
  });

  it("entries are edit-own-only; admins may delete anyone's", async () => {
    const owner = await ownerWorkspace();
    const memberA = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const memberB = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const { list } = await makeSpaceAndList(owner.accessToken);
    const task = await makeTask(owner.accessToken, list.id);

    const entry = (
      await http
        .post(`/tasks/${task.id}/time-entries`)
        .set(auth(memberA.accessToken))
        .send({
          startedAt: "2026-01-06T09:00:00.000Z",
          endedAt: "2026-01-06T10:00:00.000Z",
        })
        .expect(201)
    ).body.entry;

    // Another member cannot edit or delete someone else's entry.
    await http
      .patch(`/time-entries/${entry.id}`)
      .set(auth(memberB.accessToken))
      .send({ note: "hijack" })
      .expect(403);
    await http
      .delete(`/time-entries/${entry.id}`)
      .set(auth(memberB.accessToken))
      .expect(403);

    // The owner of the entry edits it — validation still applies.
    await http
      .patch(`/time-entries/${entry.id}`)
      .set(auth(memberA.accessToken))
      .send({ endedAt: "2026-01-06T08:00:00.000Z" })
      .expect(400); // would end before it starts
    const patched = await http
      .patch(`/time-entries/${entry.id}`)
      .set(auth(memberA.accessToken))
      .send({ endedAt: "2026-01-06T11:30:00.000Z", note: "stretched" })
      .expect(200);
    expect(patched.body.entry.durationSeconds).toBe(2.5 * 3600);
    expect(patched.body.entry.note).toBe("stretched");

    // Workspace owner (admin rights) may delete anyone's entry.
    await http
      .delete(`/time-entries/${entry.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    const listed = await http
      .get(`/tasks/${task.id}/time-entries`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(listed.body.entries).toHaveLength(0);
  });
});

describe("timesheets", () => {
  it("submit validates Mondays; admin decision notifies the member", async () => {
    const owner = await ownerWorkspace();
    const member = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const { list } = await makeSpaceAndList(owner.accessToken);
    const task = await makeTask(owner.accessToken, list.id);

    // Member tracks 2h on Tuesday of the fixed week.
    await http
      .post(`/tasks/${task.id}/time-entries`)
      .set(auth(member.accessToken))
      .send({
        startedAt: "2026-01-06T09:00:00.000Z",
        endedAt: "2026-01-06T11:00:00.000Z",
        billable: true,
      })
      .expect(201);

    // Non-Monday weekStart -> 400 (read and submit alike).
    await http
      .get("/timesheets/me?weekStart=2026-01-06")
      .set(auth(member.accessToken))
      .expect(400);
    await http
      .post("/timesheets/submit")
      .set(auth(member.accessToken))
      .send({ weekStart: "2026-01-06" })
      .expect(400);

    // My week: 7 days, the Tuesday bucket carries the 2h, no submission yet.
    const mine = await http
      .get(`/timesheets/me?weekStart=${MONDAY}`)
      .set(auth(member.accessToken))
      .expect(200);
    expect(mine.body.weekStart).toBe(MONDAY);
    expect(mine.body.days).toHaveLength(7);
    expect(mine.body.days[0].date).toBe(MONDAY);
    expect(mine.body.days[1].date).toBe("2026-01-06");
    expect(mine.body.days[1].totalSeconds).toBe(7200);
    expect(mine.body.days[1].billableSeconds).toBe(7200);
    expect(mine.body.days[1].entries[0].taskName).toBe("Track me");
    expect(mine.body.totalSeconds).toBe(7200);
    expect(mine.body.submission).toBeNull();

    // Submit; the members' review list is admin-only.
    const submitted = await http
      .post("/timesheets/submit")
      .set(auth(member.accessToken))
      .send({ weekStart: MONDAY })
      .expect(201);
    expect(submitted.body.submission.status).toBe("submitted");
    await http
      .get(`/timesheets?weekStart=${MONDAY}`)
      .set(auth(member.accessToken))
      .expect(403);

    const rows = (
      await http
        .get(`/timesheets?weekStart=${MONDAY}`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body.rows;
    const row = rows.find(
      (r: { user: { id: string } }) => r.user.id === member.userId,
    );
    expect(row.totalSeconds).toBe(7200);
    expect(row.billableSeconds).toBe(7200);
    expect(row.submission.status).toBe("submitted");

    // Deciding a week nobody submitted is a 404.
    await http
      .post(`/timesheets/${member.userId}/decide`)
      .set(auth(owner.accessToken))
      .send({ weekStart: "2026-01-12", decision: "approved" })
      .expect(404);

    // Approve -> submission decided, member gets a 'timesheet' notification.
    const decided = await http
      .post(`/timesheets/${member.userId}/decide`)
      .set(auth(owner.accessToken))
      .send({ weekStart: MONDAY, decision: "approved" })
      .expect(200);
    expect(decided.body.submission.status).toBe("approved");
    expect(decided.body.submission.decidedBy).toBe(owner.userId);
    expect(decided.body.submission.decidedAt).not.toBeNull();

    const inbox = await http
      .get("/notifications")
      .set(auth(member.accessToken))
      .expect(200);
    const note = inbox.body.notifications.find(
      (n: { kind: string }) => n.kind === "timesheet",
    );
    expect(note).toBeDefined();
    expect(note.message).toContain("approved");

    // Members cannot decide; rejected weeks reset to submitted on re-submit.
    await http
      .post(`/timesheets/${member.userId}/decide`)
      .set(auth(member.accessToken))
      .send({ weekStart: MONDAY, decision: "rejected" })
      .expect(403);
    await http
      .post(`/timesheets/${member.userId}/decide`)
      .set(auth(owner.accessToken))
      .send({ weekStart: MONDAY, decision: "rejected" })
      .expect(200);
    const resubmitted = await http
      .post("/timesheets/submit")
      .set(auth(member.accessToken))
      .send({ weekStart: MONDAY })
      .expect(201);
    expect(resubmitted.body.submission.status).toBe("submitted");
    expect(resubmitted.body.submission.decidedBy).toBeNull();
  });
});

describe("workload", () => {
  it("returns capacity, assigned estimate and tracked time per member", async () => {
    const owner = await ownerWorkspace();
    const member = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const { list } = await makeSpaceAndList(owner.accessToken);

    // A 2h-estimated task due Wednesday of the week, assigned to the member.
    const task = await makeTask(owner.accessToken, list.id, {
      name: "Estimated",
      timeEstimateMinutes: 120,
      dueDate: "2026-01-07T12:00:00.000Z",
      assigneeIds: [member.userId],
    });
    // The member also tracked an hour that week.
    await http
      .post(`/tasks/${task.id}/time-entries`)
      .set(auth(member.accessToken))
      .send({
        startedAt: "2026-01-05T09:00:00.000Z",
        endedAt: "2026-01-05T10:00:00.000Z",
      })
      .expect(201);

    await http
      .get("/workload?weekStart=2026-01-07")
      .set(auth(member.accessToken))
      .expect(400); // not a Monday

    const res = await http
      .get(`/workload?weekStart=${MONDAY}`)
      .set(auth(member.accessToken))
      .expect(200);
    expect(res.body.weekStart).toBe(MONDAY);
    expect(res.body.days).toHaveLength(7);
    expect(res.body.days[0]).toBe(MONDAY);
    expect(res.body.days[6]).toBe("2026-01-11");

    const mine = res.body.members.find(
      (m: { user: { id: string } }) => m.user.id === member.userId,
    );
    expect(mine).toBeDefined();
    expect(mine.capacitySeconds).toBe(8 * 3600 * 5);
    expect(mine.assignedSeconds).toBe(7200);
    expect(mine.trackedSeconds).toBe(3600);
    expect(mine.tasks).toHaveLength(1);
    expect(mine.tasks[0]).toMatchObject({
      id: task.id,
      name: "Estimated",
      listId: list.id,
      estimateSeconds: 7200,
    });

    // The owner appears too, with capacity but no assigned work.
    const owners = res.body.members.find(
      (m: { user: { id: string } }) => m.user.id === owner.userId,
    );
    expect(owners.assignedSeconds).toBe(0);
    expect(owners.capacitySeconds).toBe(8 * 3600 * 5);
  });
});
