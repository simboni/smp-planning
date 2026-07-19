import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 5 (Views Engine) against the migrated
 * stackup_test database. Same harness as M3/M4: unique emails, supertest,
 * setup.ts; owner signs up, creates a workspace + access token, then a
 * Space -> List to hang views off of.
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

async function ownerWorkspace(name = "M5 WS") {
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
  opts: { isPrivate?: boolean } = {},
) {
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

describe("views", () => {
  it("creates a shared view on a list and lists it", async () => {
    const owner = await ownerWorkspace();
    const { list } = await makeSpaceAndList(owner.accessToken);

    const created = await http
      .post(`/lists/${list.id}/views`)
      .set(auth(owner.accessToken))
      .send({
        name: "  Board by status  ",
        kind: "board",
        config: { groupBy: "status" },
      })
      .expect(201);
    const view = created.body.view;
    expect(view.name).toBe("Board by status"); // trimmed
    expect(view.kind).toBe("board");
    expect(view.isShared).toBe(true); // default
    expect(view.position).toBe(0);
    expect(view.createdBy).toBe(owner.userId);
    expect(view.config).toEqual({ groupBy: "status" });

    const listed = await http
      .get(`/lists/${list.id}/views`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(listed.body.views).toHaveLength(1);
    expect(listed.body.views[0].id).toBe(view.id);

    // Bad kind and empty name are rejected.
    await http
      .post(`/lists/${list.id}/views`)
      .set(auth(owner.accessToken))
      .send({ name: "X", kind: "timeline" })
      .expect(400);
    await http
      .post(`/lists/${list.id}/views`)
      .set(auth(owner.accessToken))
      .send({ name: "   ", kind: "list" })
      .expect(400);
  });

  it("personal views are visible only to their creator", async () => {
    const owner = await ownerWorkspace();
    const memberA = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const memberB = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const { list } = await makeSpaceAndList(owner.accessToken);

    const personal = (
      await http
        .post(`/lists/${list.id}/views`)
        .set(auth(memberA.accessToken))
        .send({ name: "My filter", kind: "list", isShared: false })
        .expect(201)
    ).body.view;
    expect(personal.isShared).toBe(false);

    // Creator sees it; another member does not.
    const mine = await http
      .get(`/lists/${list.id}/views`)
      .set(auth(memberA.accessToken))
      .expect(200);
    expect(mine.body.views.map((v: { id: string }) => v.id)).toContain(
      personal.id,
    );
    const theirs = await http
      .get(`/lists/${list.id}/views`)
      .set(auth(memberB.accessToken))
      .expect(200);
    expect(theirs.body.views.map((v: { id: string }) => v.id)).not.toContain(
      personal.id,
    );

    // Another member cannot edit or delete someone else's personal view.
    await http
      .patch(`/views/${personal.id}`)
      .set(auth(memberB.accessToken))
      .send({ name: "Hijack" })
      .expect(403);
    await http
      .delete(`/views/${personal.id}`)
      .set(auth(memberB.accessToken))
      .expect(403);
  });

  it("a view-only member can create a personal view but not a shared one", async () => {
    const owner = await ownerWorkspace();
    const viewer = await memberOf(owner.accessToken, owner.workspaceId, "member");
    // Private space shared 'view' -> the member can see but not edit.
    const { space, list } = await makeSpaceAndList(owner.accessToken, {
      isPrivate: true,
    });
    await http
      .put(`/spaces/${space.id}/shares`)
      .set(auth(owner.accessToken))
      .send({
        principalType: "user",
        principalId: viewer.userId,
        permission: "view",
      })
      .expect(200);

    // Shared view -> 403; personal view -> 201.
    await http
      .post(`/lists/${list.id}/views`)
      .set(auth(viewer.accessToken))
      .send({ name: "Team board", kind: "board", isShared: true })
      .expect(403);
    const personal = (
      await http
        .post(`/lists/${list.id}/views`)
        .set(auth(viewer.accessToken))
        .send({ name: "Just mine", kind: "table", isShared: false })
        .expect(201)
    ).body.view;

    // They may edit their own personal view, but not flip it shared.
    await http
      .patch(`/views/${personal.id}`)
      .set(auth(viewer.accessToken))
      .send({ name: "Still mine" })
      .expect(200);
    await http
      .patch(`/views/${personal.id}`)
      .set(auth(viewer.accessToken))
      .send({ isShared: true })
      .expect(403);
  });

  it("PATCH config roundtrips and bumps position/name", async () => {
    const owner = await ownerWorkspace();
    const { list } = await makeSpaceAndList(owner.accessToken);
    const view = (
      await http
        .post(`/lists/${list.id}/views`)
        .set(auth(owner.accessToken))
        .send({ name: "Table", kind: "table" })
        .expect(201)
    ).body.view;
    expect(view.config).toEqual({});

    const config = {
      filters: { priorities: ["urgent", "high"], includeDone: false },
      sort: { key: "dueDate", dir: "asc" },
      groupBy: null,
      columns: ["name", "assignee", "dueDate"],
    };
    const patched = await http
      .patch(`/views/${view.id}`)
      .set(auth(owner.accessToken))
      .send({ name: "Sprint table", config, position: 5 })
      .expect(200);
    expect(patched.body.view.config).toEqual(config);
    expect(patched.body.view.name).toBe("Sprint table");
    expect(patched.body.view.position).toBe(5);

    // Roundtrips through GET too.
    const listed = await http
      .get(`/lists/${list.id}/views`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(listed.body.views[0].config).toEqual(config);

    // Oversized config (> 8KB serialized) is rejected.
    await http
      .patch(`/views/${view.id}`)
      .set(auth(owner.accessToken))
      .send({ config: { blob: "x".repeat(9000) } })
      .expect(400);
  });

  it("DELETE removes the view", async () => {
    const owner = await ownerWorkspace();
    const { list } = await makeSpaceAndList(owner.accessToken);
    const view = (
      await http
        .post(`/lists/${list.id}/views`)
        .set(auth(owner.accessToken))
        .send({ name: "Doomed", kind: "calendar" })
        .expect(201)
    ).body.view;

    await http
      .delete(`/views/${view.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    const listed = await http
      .get(`/lists/${list.id}/views`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(listed.body.views).toHaveLength(0);
    await http
      .delete(`/views/${view.id}`)
      .set(auth(owner.accessToken))
      .expect(404);
  });
});
