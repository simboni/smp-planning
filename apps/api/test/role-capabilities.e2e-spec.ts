import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * Settings → Roles: every capability switch is enforced by the API, not just
 * shown. A custom role can take a capability away from a member, or grant
 * "Invite & manage members" — which still never reaches admins or the owner.
 */

let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  http = request(app.getHttpServer());
});
afterAll(async () => {
  await app.close();
});

const uniqueEmail = () => `cap${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function signup(fullName = "Cap User") {
  const email = uniqueEmail();
  const r = await http.post("/auth/signup").send({ email, fullName, password: "password123" }).expect(201);
  return { email, identityToken: r.body.identityToken as string, userId: r.body.user.id as string };
}
async function token(identityToken: string, workspaceId: string) {
  return (await http.post(`/workspaces/${workspaceId}/token`).set(auth(identityToken)).expect(200)).body
    .accessToken as string;
}
async function workspace() {
  const owner = await signup("Olive Owner");
  const ws = await http.post("/workspaces").set(auth(owner.identityToken)).send({ name: "Caps" }).expect(201);
  const workspaceId = ws.body.workspace.id as string;
  const access = await token(owner.identityToken, workspaceId);
  // Custom roles are a Business-plan feature.
  await http.post("/plans/select").set(auth(access)).send({ plan: "business" }).expect(200);
  return { ...owner, workspaceId, access };
}
async function join(ownerAccess: string, workspaceId: string, role: "member" | "guest" | "admin" = "member") {
  const u = await signup("Mo Member");
  await http.post("/workspaces/current/members").set(auth(ownerAccess)).send({ email: u.email, role }).expect(201);
  return { ...u, access: await token(u.identityToken, workspaceId) };
}
async function giveRole(ownerAccess: string, userId: string, capabilities: Record<string, boolean>) {
  const r = await http
    .post("/governance/roles")
    .set(auth(ownerAccess))
    .send({ name: `R${Math.random()}`, baseRole: "member", capabilities })
    .expect(201);
  await http
    .post(`/governance/members/${userId}/role`)
    .set(auth(ownerAccess))
    .send({ customRoleId: r.body.role.id })
    .expect(204);
}

describe("role capabilities are enforced", () => {
  it("GET /governance/me reports the caller's own switches", async () => {
    const w = await workspace();
    const m = await join(w.access, w.workspaceId);
    const own = await http.get("/governance/me").set(auth(w.access)).expect(200);
    expect(own.body.capabilities).toMatchObject({ exportData: true, manageMembers: true });
    const plain = await http.get("/governance/me").set(auth(m.access)).expect(200);
    expect(plain.body.capabilities).toMatchObject({ deleteItems: true, exportData: false });
    await giveRole(w.access, m.userId, { deleteItems: false });
    const after = await http.get("/governance/me").set(auth(m.access)).expect(200);
    expect(after.body.capabilities.deleteItems).toBe(false);
  });

  it("deleteItems off: no deleting tasks, lists, folders or Spaces", async () => {
    const w = await workspace();
    const m = await join(w.access, w.workspaceId);
    const sp = (await http.post("/spaces").set(auth(m.access)).send({ name: "Mine" }).expect(201)).body.space;
    const folder = (await http.post(`/spaces/${sp.id}/folders`).set(auth(m.access)).send({ name: "F" }).expect(201)).body.folder;
    const ls = (await http.post(`/spaces/${sp.id}/lists`).set(auth(m.access)).send({ name: "L" }).expect(201)).body.list;
    const t = (await http.post(`/lists/${ls.id}/tasks`).set(auth(m.access)).send({ name: "T" }).expect(201)).body.task;
    await giveRole(w.access, m.userId, { deleteItems: false });
    for (const path of [`/tasks/${t.id}`, `/lists/${ls.id}`, `/folders/${folder.id}`, `/spaces/${sp.id}`]) {
      const r = await http.delete(path).set(auth(m.access));
      expect([path, r.status]).toEqual([path, 403]);
    }
    // The owner still can.
    await http.delete(`/tasks/${t.id}`).set(auth(w.access)).expect(204);
  });

  it("createDocs off: no new docs", async () => {
    const w = await workspace();
    const m = await join(w.access, w.workspaceId);
    await http.post("/docs").set(auth(m.access)).send({ name: "Before" }).expect(201);
    await giveRole(w.access, m.userId, { createDocs: false });
    const r = await http.post("/docs").set(auth(m.access)).send({ name: "After" }).expect(403);
    expect(r.body.message).toMatch(/creating Docs/);
  });

  it("manageAutomations off: no creating, editing or deleting automations", async () => {
    const w = await workspace();
    const m = await join(w.access, w.workspaceId);
    const sp = (await http.post("/spaces").set(auth(m.access)).send({ name: "Auto" }).expect(201)).body.space;
    const body = {
      name: "Close on done",
      trigger: { type: "task.created" },
      actions: [{ type: "set.priority", priority: "high" }],
    };
    const made = await http.post(`/spaces/${sp.id}/automations`).set(auth(m.access)).send(body);
    expect(made.status).toBe(201);
    const id = made.body.automation.id as string;
    await giveRole(w.access, m.userId, { manageAutomations: false });
    await http.post(`/spaces/${sp.id}/automations`).set(auth(m.access)).send(body).expect(403);
    await http.patch(`/automations/${id}`).set(auth(m.access)).send({ name: "x" }).expect(403);
    await http.delete(`/automations/${id}`).set(auth(m.access)).expect(403);
  });

  it("exportData: members can't export the workspace unless a role grants it", async () => {
    const w = await workspace();
    const m = await join(w.access, w.workspaceId);
    await http.get("/export/workspace").set(auth(w.access)).expect(200);
    await http.get("/export/workspace").set(auth(m.access)).expect(403);
    await giveRole(w.access, m.userId, { exportData: true });
    await http.get("/export/workspace").set(auth(m.access)).expect(200);
  });

  it("manageMembers: a granted member handles members and guests, never admins", async () => {
    const w = await workspace();
    const m = await join(w.access, w.workspaceId);
    const other = await join(w.access, w.workspaceId);
    const adm = await join(w.access, w.workspaceId, "admin");
    const outsider = await signup("New Person");
    // A plain member can't.
    await http.post("/workspaces/current/members").set(auth(m.access)).send({ email: outsider.email, role: "member" }).expect(403);

    await giveRole(w.access, m.userId, { manageMembers: true });
    await http.post("/workspaces/current/members").set(auth(m.access)).send({ email: outsider.email, role: "guest" }).expect(201);
    await http.patch(`/workspaces/current/members/${outsider.userId}`).set(auth(m.access)).send({ role: "member" }).expect(200);
    // ...but can't create, promote to, or touch an admin, or the owner.
    await http.post("/workspaces/current/members").set(auth(m.access)).send({ email: uniqueEmail(), role: "admin" }).expect(403);
    await http.patch(`/workspaces/current/members/${other.userId}`).set(auth(m.access)).send({ role: "admin" }).expect(403);
    await http.patch(`/workspaces/current/members/${adm.userId}`).set(auth(m.access)).send({ status: "suspended" }).expect(403);
    await http.delete(`/workspaces/current/members/${adm.userId}`).set(auth(m.access)).expect(403);
    await http.delete(`/workspaces/current/members/${w.userId}`).set(auth(m.access)).expect(403);
    // Removing a member works.
    await http.delete(`/workspaces/current/members/${outsider.userId}`).set(auth(m.access)).expect(204);
  });

  it("a refused invite creates no account for the invitee", async () => {
    const w = await workspace();
    const m = await join(w.access, w.workspaceId);
    const email = uniqueEmail();
    await http.post("/workspaces/current/members").set(auth(m.access)).send({ email, role: "member" }).expect(403);
    // The address is still free to sign up with.
    await http.post("/auth/signup").send({ email, fullName: "Free", password: "password123" }).expect(201);
  });
});
