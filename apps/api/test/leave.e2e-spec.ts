import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { workingDaysBetween } from "../src/leave/leave.service";

/**
 * End-to-end tests for leave management (HR module): types are admin policy,
 * requests carry working-day math, balances derive from approved days, and
 * approvals route to admins or the requester's DEPARTMENT HEAD.
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

async function ownerWorkspace(name = "Leave WS") {
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

/** Next Monday (UTC) at least a week out, as YYYY-MM-DD + offset days. */
function futureWeekday(plusDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 14);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); // Monday
  d.setUTCDate(d.getUTCDate() + plusDays);
  return d.toISOString().slice(0, 10);
}

describe("leave management", () => {
  it("working-day math is correct", () => {
    // A Monday..Friday span is 5 working days; Mon..Sun still 5.
    const mon = futureWeekday(0);
    expect(workingDaysBetween(mon, futureWeekday(4))).toBe(5);
    expect(workingDaysBetween(mon, futureWeekday(6))).toBe(5);
    expect(workingDaysBetween(mon, mon)).toBe(1);
  });

  it("types are admin policy; requests, balances, decide, cancel flow", async () => {
    const owner = await ownerWorkspace();
    const member = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const guest = await memberOf(owner.accessToken, owner.workspaceId, "guest");

    // Guests are outside the leave system; members can't define policy.
    await http.get("/leave/types").set(auth(guest.accessToken)).expect(403);
    await http
      .post("/leave/types")
      .set(auth(member.accessToken))
      .send({ name: "Nope" })
      .expect(403);

    const annual = (
      await http
        .post("/leave/types")
        .set(auth(owner.accessToken))
        .send({ name: "Annual leave", daysPerYear: 21 })
        .expect(201)
    ).body.type;
    await http
      .post("/leave/types")
      .set(auth(owner.accessToken))
      .send({ name: "Annual leave" })
      .expect(409);

    // Member requests Mon–Fri (5 working days).
    const req1 = (
      await http
        .post("/leave/requests")
        .set(auth(member.accessToken))
        .send({
          leaveTypeId: annual.id,
          startDate: futureWeekday(0),
          endDate: futureWeekday(4),
          reason: "Family time",
        })
        .expect(201)
    ).body.request;
    expect(req1.days).toBe(5);
    expect(req1.status).toBe("pending");

    // Overlapping request is rejected.
    await http
      .post("/leave/requests")
      .set(auth(member.accessToken))
      .send({
        leaveTypeId: annual.id,
        startDate: futureWeekday(2),
        endDate: futureWeekday(8),
      })
      .expect(409);

    // Balance shows 5 pending, 0 used.
    const year = Number(futureWeekday(0).slice(0, 4));
    const balPending = (
      await http
        .get(`/leave/balances?year=${year}`)
        .set(auth(member.accessToken))
        .expect(200)
    ).body.balances.find(
      (b: { leaveTypeId: string }) => b.leaveTypeId === annual.id,
    );
    expect(balPending).toMatchObject({
      entitlementDays: 21,
      usedDays: 0,
      pendingDays: 5,
    });

    // Requester can't decide their own; another plain member can't either.
    await http
      .post(`/leave/requests/${req1.id}/decide`)
      .set(auth(member.accessToken))
      .send({ approve: true })
      .expect(403);
    const bystander = await memberOf(
      owner.accessToken,
      owner.workspaceId,
      "member",
    );
    await http
      .post(`/leave/requests/${req1.id}/decide`)
      .set(auth(bystander.accessToken))
      .send({ approve: true })
      .expect(403);

    // Admin approves; balance moves pending → used; away board shows it.
    const approvals = (
      await http
        .get("/leave/requests?scope=approvals")
        .set(auth(owner.accessToken))
        .expect(200)
    ).body.requests;
    expect(approvals.map((r: { id: string }) => r.id)).toContain(req1.id);
    await http
      .post(`/leave/requests/${req1.id}/decide`)
      .set(auth(owner.accessToken))
      .send({ approve: true, note: "Enjoy" })
      .expect(201);
    const balUsed = (
      await http
        .get(`/leave/balances?year=${year}`)
        .set(auth(member.accessToken))
        .expect(200)
    ).body.balances.find(
      (b: { leaveTypeId: string }) => b.leaveTypeId === annual.id,
    );
    expect(balUsed).toMatchObject({ usedDays: 5, pendingDays: 0 });
    const away = (
      await http
        .get(`/leave/away?from=${futureWeekday(0)}&to=${futureWeekday(4)}`)
        .set(auth(member.accessToken))
        .expect(200)
    ).body.requests;
    expect(away.map((r: { id: string }) => r.id)).toContain(req1.id);

    // Requester cancels the approved leave; away board empties.
    await http
      .post(`/leave/requests/${req1.id}/cancel`)
      .set(auth(member.accessToken))
      .expect(201);
    const awayAfter = (
      await http
        .get(`/leave/away?from=${futureWeekday(0)}&to=${futureWeekday(4)}`)
        .set(auth(member.accessToken))
        .expect(200)
    ).body.requests;
    expect(awayAfter).toHaveLength(0);
  });

  it("department heads decide their members' requests", async () => {
    const owner = await ownerWorkspace();
    const head = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const worker = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const outsider = await memberOf(owner.accessToken, owner.workspaceId, "member");

    const dept = (
      await http
        .post("/departments")
        .set(auth(owner.accessToken))
        .send({ name: "Ops", kind: "operations" })
        .expect(201)
    ).body.department;
    await http
      .post(`/departments/${dept.id}/members`)
      .set(auth(owner.accessToken))
      .send({ userId: head.userId, deptRole: "head" })
      .expect(201);
    await http
      .post(`/departments/${dept.id}/members`)
      .set(auth(owner.accessToken))
      .send({ userId: worker.userId })
      .expect(201);

    const type = (
      await http
        .post("/leave/types")
        .set(auth(owner.accessToken))
        .send({ name: "Sick leave", daysPerYear: 14 })
        .expect(201)
    ).body.type;

    const req = (
      await http
        .post("/leave/requests")
        .set(auth(worker.accessToken))
        .send({
          leaveTypeId: type.id,
          startDate: futureWeekday(7),
          endDate: futureWeekday(8),
        })
        .expect(201)
    ).body.request;

    // The head sees it in approvals; an unrelated member does not.
    const headQueue = (
      await http
        .get("/leave/requests?scope=approvals")
        .set(auth(head.accessToken))
        .expect(200)
    ).body.requests;
    expect(headQueue.map((r: { id: string }) => r.id)).toContain(req.id);
    const outsiderQueue = (
      await http
        .get("/leave/requests?scope=approvals")
        .set(auth(outsider.accessToken))
        .expect(200)
    ).body.requests;
    expect(outsiderQueue).toHaveLength(0);

    // Outsider can't decide; the head can.
    await http
      .post(`/leave/requests/${req.id}/decide`)
      .set(auth(outsider.accessToken))
      .send({ approve: true })
      .expect(403);
    await http
      .post(`/leave/requests/${req.id}/decide`)
      .set(auth(head.accessToken))
      .send({ approve: false, note: "Peak week — pick other dates" })
      .expect(201);

    const mine = (
      await http
        .get("/leave/requests?scope=mine")
        .set(auth(worker.accessToken))
        .expect(200)
    ).body.requests;
    expect(mine[0]).toMatchObject({ status: "rejected" });
    expect(mine[0].decisionNote).toBe("Peak week — pick other dates");
  });
});
