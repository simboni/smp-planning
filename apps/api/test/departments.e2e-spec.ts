import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for the HR module (departments, designations, onboarding)
 * against the migrated stackup_test database: department CRUD is admin-only,
 * rosters carry designations from memberships.title, onboarding by email
 * lands people in the workspace AND the department, and a department-linked
 * private Space is visible to exactly the department's members.
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

async function ownerWorkspace(name = "HR WS") {
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

/** Invite an existing signup into the workspace, return their access token. */
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

describe("departments (HR module)", () => {
  it("admin creates a department with a private home space; member CRUD is gated", async () => {
    const owner = await ownerWorkspace();
    const member = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const guest = await memberOf(owner.accessToken, owner.workspaceId, "guest");

    // Members and guests can't create departments.
    await http
      .post("/departments")
      .set(auth(member.accessToken))
      .send({ name: "Nope" })
      .expect(403);
    await http.get("/departments").set(auth(guest.accessToken)).expect(403);

    const created = await http
      .post("/departments")
      .set(auth(owner.accessToken))
      .send({
        name: "Finance",
        description: "Money things",
        kind: "accounting",
        leadUserId: member.userId,
        createSpace: true,
      })
      .expect(201);
    const dept = created.body.department;
    expect(dept.name).toBe("Finance");
    expect(dept.kind).toBe("accounting");
    expect(dept.lead.id).toBe(member.userId);
    expect(dept.spaceId).toBeTruthy();
    expect(dept.spaceName).toBe("Finance");

    // Kinds are validated; an unknown kind is a 400, and the default is
    // 'general'.
    await http
      .post("/departments")
      .set(auth(owner.accessToken))
      .send({ name: "Bad", kind: "warp-drive" })
      .expect(400);
    const plain = (
      await http
        .post("/departments")
        .set(auth(owner.accessToken))
        .send({ name: "Untyped" })
        .expect(201)
    ).body.department;
    expect(plain.kind).toBe("general");
    await http
      .patch(`/departments/${plain.id}`)
      .set(auth(owner.accessToken))
      .send({ kind: "operations" })
      .expect(200);
    const retyped = (
      await http
        .get(`/departments/${plain.id}`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body.department;
    expect(retyped.kind).toBe("operations");

    // Duplicate names conflict.
    await http
      .post("/departments")
      .set(auth(owner.accessToken))
      .send({ name: "Finance" })
      .expect(409);

    // Members can browse the org structure read-only.
    const listed = await http
      .get("/departments")
      .set(auth(member.accessToken))
      .expect(200);
    expect(listed.body.departments).toHaveLength(2); // Finance + Untyped
    expect(
      listed.body.departments.map((d: { kind: string }) => d.kind).sort(),
    ).toEqual(["accounting", "operations"]);
  });

  it("roster: add existing members with designations, head role, remove", async () => {
    const owner = await ownerWorkspace();
    const member = await memberOf(owner.accessToken, owner.workspaceId, "member");

    const dept = (
      await http
        .post("/departments")
        .set(auth(owner.accessToken))
        .send({ name: "Engineering" })
        .expect(201)
    ).body.department;

    const added = await http
      .post(`/departments/${dept.id}/members`)
      .set(auth(owner.accessToken))
      .send({ userId: member.userId, title: "Senior Engineer", deptRole: "head" })
      .expect(201);
    expect(added.body.member.deptRole).toBe("head");
    expect(added.body.member.title).toBe("Senior Engineer");

    // Adding twice conflicts.
    await http
      .post(`/departments/${dept.id}/members`)
      .set(auth(owner.accessToken))
      .send({ userId: member.userId })
      .expect(409);

    // The designation is the membership title — visible on the members list.
    const members = await http
      .get("/workspaces/current/members")
      .set(auth(owner.accessToken))
      .expect(200);
    const row = members.body.members.find(
      (m: { id: string }) => m.id === member.userId,
    );
    expect(row.title).toBe("Senior Engineer");

    // Detail shows the roster; head sorts first.
    const detail = (
      await http
        .get(`/departments/${dept.id}`)
        .set(auth(member.accessToken))
        .expect(200)
    ).body.department;
    expect(detail.members).toHaveLength(1);
    expect(detail.members[0].userId).toBe(member.userId);

    // Update dept role + designation, then remove.
    await http
      .patch(`/departments/${dept.id}/members/${member.userId}`)
      .set(auth(owner.accessToken))
      .send({ deptRole: "member", title: "Staff Engineer" })
      .expect(200);
    const after = (
      await http
        .get(`/departments/${dept.id}`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body.department;
    expect(after.members[0].deptRole).toBe("member");
    expect(after.members[0].title).toBe("Staff Engineer");

    // The workspace-wide roster endpoint (must not be shadowed by :id).
    const roster = await http
      .get("/departments/roster")
      .set(auth(member.accessToken))
      .expect(200);
    expect(roster.body.entries).toEqual([
      { departmentId: dept.id, userId: member.userId, deptRole: "member" },
    ]);

    await http
      .delete(`/departments/${dept.id}/members/${member.userId}`)
      .set(auth(owner.accessToken))
      .expect(204);
    const empty = (
      await http
        .get(`/departments/${dept.id}`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body.department;
    expect(empty.members).toHaveLength(0);
  });

  it("onboarding by email invites into the workspace AND the department", async () => {
    const owner = await ownerWorkspace();
    const dept = (
      await http
        .post("/departments")
        .set(auth(owner.accessToken))
        .send({ name: "Operations" })
        .expect(201)
    ).body.department;

    const email = uniqueEmail();
    const added = await http
      .post(`/departments/${dept.id}/members`)
      .set(auth(owner.accessToken))
      .send({ email, role: "member", title: "Ops Coordinator" })
      .expect(201);
    expect(added.body.member.email).toBe(email);
    expect(added.body.member.role).toBe("member");
    expect(added.body.member.title).toBe("Ops Coordinator");

    // They are a real workspace member now.
    const members = await http
      .get("/workspaces/current/members")
      .set(auth(owner.accessToken))
      .expect(200);
    const row = members.body.members.find(
      (m: { email: string }) => m.email === email,
    );
    expect(row).toBeTruthy();
    expect(row.title).toBe("Ops Coordinator");

    // An email that's ALREADY a member is simply added to the department.
    const existing = await memberOf(
      owner.accessToken,
      owner.workspaceId,
      "member",
    );
    const re = await http
      .post(`/departments/${dept.id}/members`)
      .set(auth(owner.accessToken))
      .send({ email: existing.email })
      .expect(201);
    expect(re.body.member.userId).toBe(existing.userId);
  });

  it("a department's private space is visible to exactly its members", async () => {
    const owner = await ownerWorkspace();
    const inDept = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const outDept = await memberOf(owner.accessToken, owner.workspaceId, "member");

    const dept = (
      await http
        .post("/departments")
        .set(auth(owner.accessToken))
        .send({ name: "Design", createSpace: true })
        .expect(201)
    ).body.department;

    await http
      .post(`/departments/${dept.id}/members`)
      .set(auth(owner.accessToken))
      .send({ userId: inDept.userId })
      .expect(201);

    const spacesOf = async (token: string) =>
      (await http.get("/spaces").set(auth(token)).expect(200)).body.spaces.map(
        (s: { id: string }) => s.id,
      );

    expect(await spacesOf(inDept.accessToken)).toContain(dept.spaceId);
    expect(await spacesOf(outDept.accessToken)).not.toContain(dept.spaceId);

    // Leaving the department revokes the visibility.
    await http
      .delete(`/departments/${dept.id}/members/${inDept.userId}`)
      .set(auth(owner.accessToken))
      .expect(204);
    expect(await spacesOf(inDept.accessToken)).not.toContain(dept.spaceId);

    // Deleting the department removes its grants; the space itself survives
    // for admins.
    await http
      .delete(`/departments/${dept.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    expect(await spacesOf(owner.accessToken)).toContain(dept.spaceId);
  });

  it("designations edit through the members endpoint, incl. owner + self", async () => {
    const owner = await ownerWorkspace();
    const updated = await http
      .patch(`/workspaces/current/members/${owner.userId}`)
      .set(auth(owner.accessToken))
      .send({ title: "CEO" })
      .expect(200);
    expect(updated.body.title).toBe("CEO");

    // Role changes on the owner are still rejected.
    await http
      .patch(`/workspaces/current/members/${owner.userId}`)
      .set(auth(owner.accessToken))
      .send({ role: "member" })
      .expect(400);

    // Invite with a designation in one step.
    const email = uniqueEmail();
    const invited = await http
      .post("/workspaces/current/members")
      .set(auth(owner.accessToken))
      .send({ email, role: "member", title: "Analyst" })
      .expect(201);
    expect(invited.body.title).toBe("Analyst");
  });
});
