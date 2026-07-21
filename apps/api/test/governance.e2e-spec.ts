import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import express from "express";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 17 (Governance): custom roles + capability
 * enforcement, custom-role assignment, and the audit log viewer + integrity
 * check. Exercises the full two-stage auth (signup -> workspace token).
 */

let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ bodyParser: false });
  app.use(express.json({ limit: "12mb" }));
  await app.init();
  http = request(app.getHttpServer());
});
afterAll(async () => {
  await app.close();
});

const uniqueEmail = () => `g${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function signup(email = uniqueEmail()) {
  const res = await http
    .post("/auth/signup")
    .send({ email, fullName: "Gov User", password: "password123" })
    .expect(201);
  return { email, identityToken: res.body.identityToken as string };
}

/**
 * Create a workspace owned by identityToken and return its access token.
 * Upgraded to Business (M24): governance features (custom roles, audit
 * viewer) are plan-gated and these tests exercise the features themselves.
 */
async function makeWorkspace(identityToken: string, name = "Gov WS") {
  const ws = await http
    .post("/workspaces")
    .set(auth(identityToken))
    .send({ name })
    .expect(201);
  const tok = await http
    .post(`/workspaces/${ws.body.workspace.id}/token`)
    .set(auth(identityToken))
    .expect(200);
  const accessToken = tok.body.accessToken as string;
  await http.post("/plans/select").set(auth(accessToken)).send({ plan: "business" }).expect(200);
  return { workspaceId: ws.body.workspace.id as string, accessToken };
}

/** Invite a fresh member and return their user id + a workspace access token. */
async function addMember(
  ownerAccess: string,
  workspaceId: string,
  memberIdentity: string,
  memberEmail: string,
  role = "member",
) {
  await http
    .post("/workspaces/current/members")
    .set(auth(ownerAccess))
    .send({ email: memberEmail, role })
    .expect(201);
  const tok = await http
    .post(`/workspaces/${workspaceId}/token`)
    .set(auth(memberIdentity))
    .expect(200);
  const members = await http
    .get("/workspaces/current/members")
    .set(auth(ownerAccess))
    .expect(200);
  const me = members.body.members.find(
    (m: { email: string }) => m.email === memberEmail,
  );
  return { userId: me.id as string, accessToken: tok.body.accessToken as string };
}

describe("custom roles & capability enforcement", () => {
  it("a custom role can revoke Space creation from a member", async () => {
    const owner = await signup();
    const { workspaceId, accessToken: ownerTok } = await makeWorkspace(owner.identityToken);

    const memberEmail = uniqueEmail();
    const member = await signup(memberEmail);
    const { userId: memberId, accessToken: memberTok } = await addMember(
      ownerTok,
      workspaceId,
      member.identityToken,
      memberEmail,
    );

    // Baseline: a plain member can create a Space.
    await http
      .post("/spaces")
      .set(auth(memberTok))
      .send({ name: "Before" })
      .expect(201);

    // Admin defines a restricted role and assigns it to the member.
    const roleRes = await http
      .post("/governance/roles")
      .set(auth(ownerTok))
      .send({
        name: "Restricted",
        baseRole: "member",
        capabilities: { createSpaces: false },
      })
      .expect(201);
    const roleId = roleRes.body.role.id as string;
    expect(roleRes.body.role.memberCount).toBe(0);

    await http
      .post(`/governance/members/${memberId}/role`)
      .set(auth(ownerTok))
      .send({ customRoleId: roleId })
      .expect(204);

    // Now Space creation is forbidden for that member.
    await http
      .post("/spaces")
      .set(auth(memberTok))
      .send({ name: "After" })
      .expect(403);

    // Clearing the assignment restores the ability.
    await http
      .post(`/governance/members/${memberId}/role`)
      .set(auth(ownerTok))
      .send({ customRoleId: null })
      .expect(204);
    await http
      .post("/spaces")
      .set(auth(memberTok))
      .send({ name: "Restored" })
      .expect(201);
  });

  it("non-admins cannot manage custom roles", async () => {
    const owner = await signup();
    const { workspaceId, accessToken: ownerTok } = await makeWorkspace(owner.identityToken);
    const memberEmail = uniqueEmail();
    const member = await signup(memberEmail);
    const { accessToken: memberTok } = await addMember(
      ownerTok,
      workspaceId,
      member.identityToken,
      memberEmail,
    );
    await http
      .post("/governance/roles")
      .set(auth(memberTok))
      .send({ name: "Nope", baseRole: "member" })
      .expect(403);
  });
});

describe("audit log viewer", () => {
  it("lists workspace activity and verifies the hash chain; members are denied", async () => {
    const owner = await signup();
    const { workspaceId, accessToken: ownerTok } = await makeWorkspace(owner.identityToken);

    // Generate some auditable activity. Include a member invite up front: its
    // audit payload has multiple keys ({email, role}) whose in-memory order
    // differs from how jsonb hands them back, so it guards the canonical-hash
    // regression (verify must not depend on stored key ordering).
    const inviteEmail = uniqueEmail();
    await signup(inviteEmail);
    await http
      .post("/workspaces/current/members")
      .set(auth(ownerTok))
      .send({ email: inviteEmail, role: "member" })
      .expect(201);
    await http.post("/spaces").set(auth(ownerTok)).send({ name: "Audited" }).expect(201);
    await http
      .post("/governance/roles")
      .set(auth(ownerTok))
      .send({ name: "AuditRole", baseRole: "guest" })
      .expect(201);

    const list = await http.get("/audit").set(auth(ownerTok)).expect(200);
    expect(Array.isArray(list.body.events)).toBe(true);
    expect(list.body.events.length).toBeGreaterThan(0);
    // newest-first
    const actions = list.body.events.map((e: { action: string }) => e.action);
    expect(actions).toContain("role.create");

    const verify = await http.get("/audit/verify").set(auth(ownerTok)).expect(200);
    expect(verify.body.ok).toBe(true);
    expect(verify.body.checked).toBeGreaterThan(0);
    expect(verify.body.brokenAt).toBeNull();

    // A plain member lacks viewAuditLog and is refused.
    const memberEmail = uniqueEmail();
    const member = await signup(memberEmail);
    const { accessToken: memberTok } = await addMember(
      ownerTok,
      workspaceId,
      member.identityToken,
      memberEmail,
    );
    await http.get("/audit").set(auth(memberTok)).expect(403);

    // ...but a custom role that grants it lets a member in.
    const roleRes = await http
      .post("/governance/roles")
      .set(auth(ownerTok))
      .send({ name: "Auditor", baseRole: "member", capabilities: { viewAuditLog: true } })
      .expect(201);
    const members = await http
      .get("/workspaces/current/members")
      .set(auth(ownerTok))
      .expect(200);
    const memberId = members.body.members.find(
      (m: { email: string }) => m.email === memberEmail,
    ).id;
    await http
      .post(`/governance/members/${memberId}/role`)
      .set(auth(ownerTok))
      .send({ customRoleId: roleRes.body.role.id })
      .expect(204);
    await http.get("/audit").set(auth(memberTok)).expect(200);
  });
});
