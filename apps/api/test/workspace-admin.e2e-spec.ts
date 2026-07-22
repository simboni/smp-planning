import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import express from "express";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for the workspace-admin surface added this cycle:
 *   - member management (change role, suspend/reactivate, remove) with the
 *     owner-protection and self-protection guards,
 *   - owner-only workspace deletion (cascades the whole tenant),
 *   - whiteboard cross-reference links (folder/list/task) with RLS-scoped
 *     validation so a link can't point across workspaces.
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

const uniqueEmail = () => `wa${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function signup(email = uniqueEmail()) {
  const res = await http
    .post("/auth/signup")
    .send({ email, fullName: "Admin User", password: "password123" })
    .expect(201);
  return { email, identityToken: res.body.identityToken as string };
}

async function makeWorkspace(identityToken: string) {
  const ws = await http
    .post("/workspaces")
    .set(auth(identityToken))
    .send({ name: "Adminco" })
    .expect(201);
  const workspaceId = ws.body.workspace.id as string;
  const tok = await http
    .post(`/workspaces/${workspaceId}/token`)
    .set(auth(identityToken))
    .expect(200);
  return { workspaceId, accessToken: tok.body.accessToken as string };
}

/** Invite a brand-new real user into the workspace and return their ids/token. */
async function inviteRealMember(ownerAccess: string, role: "member" | "admin") {
  const invitee = await signup();
  const res = await http
    .post("/workspaces/current/members")
    .set(auth(ownerAccess))
    .send({ email: invitee.email, role })
    .expect(201);
  const userId = res.body.id as string;
  // The invitee can now select a workspace token of their own.
  const list = await http.get("/workspaces").set(auth(invitee.identityToken)).expect(200);
  const wsId = list.body.workspaces[0].id as string;
  const tok = await http
    .post(`/workspaces/${wsId}/token`)
    .set(auth(invitee.identityToken))
    .expect(200);
  return { userId, email: invitee.email, accessToken: tok.body.accessToken as string, identityToken: invitee.identityToken };
}

describe("member management", () => {
  it("changes a member's role and suspends / reactivates them", async () => {
    const owner = await signup();
    const { accessToken } = await makeWorkspace(owner.identityToken);
    const member = await inviteRealMember(accessToken, "member");

    const promoted = await http
      .patch(`/workspaces/current/members/${member.userId}`)
      .set(auth(accessToken))
      .send({ role: "admin" })
      .expect(200);
    expect(promoted.body.role).toBe("admin");

    const suspended = await http
      .patch(`/workspaces/current/members/${member.userId}`)
      .set(auth(accessToken))
      .send({ status: "suspended" })
      .expect(200);
    expect(suspended.body.status).toBe("suspended");

    const reactivated = await http
      .patch(`/workspaces/current/members/${member.userId}`)
      .set(auth(accessToken))
      .send({ status: "active" })
      .expect(200);
    expect(reactivated.body.status).toBe("active");
  });

  it("removes a member from the workspace", async () => {
    const owner = await signup();
    const { accessToken } = await makeWorkspace(owner.identityToken);
    const member = await inviteRealMember(accessToken, "member");

    await http
      .delete(`/workspaces/current/members/${member.userId}`)
      .set(auth(accessToken))
      .expect(204);

    const members = await http
      .get("/workspaces/current/members")
      .set(auth(accessToken))
      .expect(200);
    expect(members.body.members.some((m: { id: string }) => m.id === member.userId)).toBe(false);
  });

  it("protects the owner and forbids acting on yourself", async () => {
    const owner = await signup();
    const { accessToken } = await makeWorkspace(owner.identityToken);
    const me = await http.get("/workspaces/current/members").set(auth(accessToken)).expect(200);
    const ownerId = me.body.members[0].id as string;

    // Can't modify or remove yourself (the owner).
    await http
      .patch(`/workspaces/current/members/${ownerId}`)
      .set(auth(accessToken))
      .send({ role: "member" })
      .expect(400);
    await http
      .delete(`/workspaces/current/members/${ownerId}`)
      .set(auth(accessToken))
      .expect(400);
  });

  it("forbids a plain member from managing others", async () => {
    const owner = await signup();
    const { accessToken } = await makeWorkspace(owner.identityToken);
    const member = await inviteRealMember(accessToken, "member");
    const other = await inviteRealMember(accessToken, "member");

    await http
      .patch(`/workspaces/current/members/${other.userId}`)
      .set(auth(member.accessToken))
      .send({ role: "admin" })
      .expect(403);
    await http
      .delete(`/workspaces/current/members/${other.userId}`)
      .set(auth(member.accessToken))
      .expect(403);
  });
});

describe("delete workspace", () => {
  it("lets the owner delete the workspace and removes it from their list", async () => {
    const owner = await signup();
    const { workspaceId, accessToken } = await makeWorkspace(owner.identityToken);

    await http.delete("/workspaces/current").set(auth(accessToken)).expect(204);

    const list = await http.get("/workspaces").set(auth(owner.identityToken)).expect(200);
    expect(list.body.workspaces.some((w: { id: string }) => w.id === workspaceId)).toBe(false);
  });

  it("forbids a non-owner admin from deleting the workspace", async () => {
    const owner = await signup();
    const { accessToken } = await makeWorkspace(owner.identityToken);
    const admin = await inviteRealMember(accessToken, "admin");

    await http.delete("/workspaces/current").set(auth(admin.accessToken)).expect(403);
  });
});

describe("whiteboard links", () => {
  async function makeSpaceAndList(accessToken: string) {
    const space = await http
      .post("/spaces")
      .set(auth(accessToken))
      .send({ name: "Marketing" })
      .expect(201);
    const spaceId = space.body.space.id as string;
    const list = await http
      .post(`/spaces/${spaceId}/lists`)
      .set(auth(accessToken))
      .send({ name: "Launch" })
      .expect(201);
    return { spaceId, listId: list.body.list.id as string };
  }

  it("creates a board linked to a list and seeded with elements", async () => {
    const owner = await signup();
    const { accessToken } = await makeWorkspace(owner.identityToken);
    const { spaceId, listId } = await makeSpaceAndList(accessToken);

    const res = await http
      .post("/whiteboards")
      .set(auth(accessToken))
      .send({
        name: "Launch board",
        spaceId,
        listId,
        elements: [
          { id: "a1", kind: "sticky", x: 0, y: 0, w: 170, h: 130, text: "Hi", color: "#FFE066" },
        ],
      })
      .expect(201);
    expect(res.body.whiteboard.listId).toBe(listId);
    expect(res.body.whiteboard.listName).toBe("Launch");
    expect(res.body.whiteboard.elements).toHaveLength(1);

    // The link shows up on the hub listing too.
    const listing = await http.get("/whiteboards").set(auth(accessToken)).expect(200);
    const found = listing.body.whiteboards.find((w: { id: string }) => w.id === res.body.whiteboard.id);
    expect(found.listName).toBe("Launch");
    expect(found.elementCount).toBe(1);
  });

  it("rejects a link to an id that isn't in this workspace", async () => {
    const owner = await signup();
    const { accessToken } = await makeWorkspace(owner.identityToken);
    await http
      .post("/whiteboards")
      .set(auth(accessToken))
      .send({ name: "Bad", listId: "00000000-0000-0000-0000-000000000000" })
      .expect(400);
  });
});
