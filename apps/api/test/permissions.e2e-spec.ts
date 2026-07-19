import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 2 (Teams, Guests & Permissions) against the
 * migrated stackup_test database. Mirrors the existing harness: unique emails,
 * supertest, setup.ts. Several cases need TWO real users in the SAME
 * workspace with their own access tokens, so we sign up a second user, invite
 * them by email (which links their existing identity), then have them mint a
 * workspace access token themselves.
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

/** An owner with a fresh workspace. */
async function ownerWorkspace(name = "M2 WS") {
  const owner = await signup();
  const ws = await createWorkspaceWithToken(owner.identityToken, name);
  return { ...owner, ...ws };
}

/** Sign up a new user, invite them into `ws` with `role`, and get their token. */
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

describe("teams", () => {
  it("create, add/remove members, memberCount; a member cannot create", async () => {
    const owner = await ownerWorkspace("Teams WS");
    const userB = await memberOf(owner.accessToken, owner.workspaceId, "member");

    const team = (
      await http
        .post("/teams")
        .set(auth(owner.accessToken))
        .send({ name: "Design", color: "#123456" })
        .expect(201)
    ).body.team;
    expect(team.name).toBe("Design");
    expect(team.color).toBe("#123456");

    await http
      .post(`/teams/${team.id}/members`)
      .set(auth(owner.accessToken))
      .send({ userId: userB.userId })
      .expect(201);
    // Duplicate membership is a 409.
    await http
      .post(`/teams/${team.id}/members`)
      .set(auth(owner.accessToken))
      .send({ userId: userB.userId })
      .expect(409);

    let teams = (
      await http.get("/teams").set(auth(owner.accessToken)).expect(200)
    ).body.teams;
    expect(teams.find((t: { id: string }) => t.id === team.id).memberCount).toBe(
      1,
    );

    const detail = (
      await http.get(`/teams/${team.id}`).set(auth(owner.accessToken)).expect(200)
    ).body;
    expect(detail.members.map((m: { userId: string }) => m.userId)).toContain(
      userB.userId,
    );

    await http
      .delete(`/teams/${team.id}/members/${userB.userId}`)
      .set(auth(owner.accessToken))
      .expect(204);
    teams = (await http.get("/teams").set(auth(owner.accessToken))).body.teams;
    expect(teams.find((t: { id: string }) => t.id === team.id).memberCount).toBe(
      0,
    );

    // A plain member may READ teams but not create one.
    await http.get("/teams").set(auth(userB.accessToken)).expect(200);
    await http
      .post("/teams")
      .set(auth(userB.accessToken))
      .send({ name: "Nope" })
      .expect(403);
  });

  it("deleting a team also drops its space shares", async () => {
    const owner = await ownerWorkspace("Team Cascade WS");
    const userB = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const space = (
      await http
        .post("/spaces")
        .set(auth(owner.accessToken))
        .send({ name: "S", isPrivate: true })
        .expect(201)
    ).body.space;
    const team = (
      await http
        .post("/teams")
        .set(auth(owner.accessToken))
        .send({ name: "T" })
        .expect(201)
    ).body.team;
    await http
      .post(`/teams/${team.id}/members`)
      .set(auth(owner.accessToken))
      .send({ userId: userB.userId })
      .expect(201);
    await http
      .put(`/spaces/${space.id}/shares`)
      .set(auth(owner.accessToken))
      .send({ principalType: "team", principalId: team.id, permission: "edit" })
      .expect(200);
    // Visible via the team share.
    await http.get(`/spaces/${space.id}`).set(auth(userB.accessToken)).expect(200);
    // Delete the team -> the share vanishes -> space no longer visible.
    await http
      .delete(`/teams/${team.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    await http.get(`/spaces/${space.id}`).set(auth(userB.accessToken)).expect(404);
  });
});

describe("space visibility", () => {
  it("private spaces are hidden from members but visible to the owner", async () => {
    const owner = await ownerWorkspace("Priv WS");
    const userB = await memberOf(owner.accessToken, owner.workspaceId, "member");

    const priv = (
      await http
        .post("/spaces")
        .set(auth(owner.accessToken))
        .send({ name: "Secret", isPrivate: true })
        .expect(201)
    ).body.space;
    const pub = (
      await http
        .post("/spaces")
        .set(auth(owner.accessToken))
        .send({ name: "Public" })
        .expect(201)
    ).body.space;

    // Owner sees all.
    const ownerTree = (
      await http.get("/hierarchy").set(auth(owner.accessToken)).expect(200)
    ).body;
    expect(
      ownerTree.spaces.find((s: { id: string }) => s.id === priv.id),
    ).toBeDefined();

    // Member sees the public one only; 404 on the private one.
    const bTree = (
      await http.get("/hierarchy").set(auth(userB.accessToken)).expect(200)
    ).body;
    expect(
      bTree.spaces.find((s: { id: string }) => s.id === pub.id),
    ).toBeDefined();
    expect(
      bTree.spaces.find((s: { id: string }) => s.id === priv.id),
    ).toBeUndefined();
    await http.get(`/spaces/${priv.id}`).set(auth(userB.accessToken)).expect(404);
    await http.get(`/spaces/${pub.id}`).set(auth(userB.accessToken)).expect(200);
  });
});

describe("sharing to a user", () => {
  it("view lets a member read but not write; edit lets them write", async () => {
    const owner = await ownerWorkspace("Share WS");
    const userB = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const space = (
      await http
        .post("/spaces")
        .set(auth(owner.accessToken))
        .send({ name: "Shared", isPrivate: true })
        .expect(201)
    ).body.space;

    await http.get(`/spaces/${space.id}`).set(auth(userB.accessToken)).expect(404);

    await http
      .put(`/spaces/${space.id}/shares`)
      .set(auth(owner.accessToken))
      .send({ principalType: "user", principalId: userB.userId, permission: "view" })
      .expect(200);

    const detail = (
      await http.get(`/spaces/${space.id}`).set(auth(userB.accessToken)).expect(200)
    ).body;
    expect(detail.space.myPermission).toBe("view");
    // 'view' < 'edit' -> cannot create a list.
    await http
      .post(`/spaces/${space.id}/lists`)
      .set(auth(userB.accessToken))
      .send({ name: "L" })
      .expect(403);

    // Upgrade to edit.
    await http
      .put(`/spaces/${space.id}/shares`)
      .set(auth(owner.accessToken))
      .send({ principalType: "user", principalId: userB.userId, permission: "edit" })
      .expect(200);
    const detail2 = (
      await http.get(`/spaces/${space.id}`).set(auth(userB.accessToken))
    ).body;
    expect(detail2.space.myPermission).toBe("edit");
    await http
      .post(`/spaces/${space.id}/lists`)
      .set(auth(userB.accessToken))
      .send({ name: "L" })
      .expect(201);
    // Edit is not manage: cannot delete the space.
    await http
      .delete(`/spaces/${space.id}`)
      .set(auth(userB.accessToken))
      .expect(403);
  });
});

describe("sharing to a team", () => {
  it("a team share grants its members edit", async () => {
    const owner = await ownerWorkspace("TeamShare WS");
    const userB = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const space = (
      await http
        .post("/spaces")
        .set(auth(owner.accessToken))
        .send({ name: "TS", isPrivate: true })
        .expect(201)
    ).body.space;
    const team = (
      await http
        .post("/teams")
        .set(auth(owner.accessToken))
        .send({ name: "Devs" })
        .expect(201)
    ).body.team;
    await http
      .post(`/teams/${team.id}/members`)
      .set(auth(owner.accessToken))
      .send({ userId: userB.userId })
      .expect(201);

    await http.get(`/spaces/${space.id}`).set(auth(userB.accessToken)).expect(404);

    await http
      .put(`/spaces/${space.id}/shares`)
      .set(auth(owner.accessToken))
      .send({ principalType: "team", principalId: team.id, permission: "edit" })
      .expect(200);

    const detail = (
      await http.get(`/spaces/${space.id}`).set(auth(userB.accessToken)).expect(200)
    ).body;
    expect(detail.space.myPermission).toBe("edit");
    await http
      .post(`/spaces/${space.id}/lists`)
      .set(auth(userB.accessToken))
      .send({ name: "L" })
      .expect(201);
  });
});

describe("guests", () => {
  it("a guest sees nothing until a space is shared with them", async () => {
    const owner = await ownerWorkspace("Guest WS");
    const pub = (
      await http
        .post("/spaces")
        .set(auth(owner.accessToken))
        .send({ name: "Pub" })
        .expect(201)
    ).body.space;
    await http
      .post("/spaces")
      .set(auth(owner.accessToken))
      .send({ name: "Priv", isPrivate: true })
      .expect(201);

    const guest = await memberOf(owner.accessToken, owner.workspaceId, "guest");

    // Guests see no spaces by default — not even public ones.
    let tree = (
      await http.get("/hierarchy").set(auth(guest.accessToken)).expect(200)
    ).body;
    expect(tree.spaces).toHaveLength(0);
    await http.get(`/spaces/${pub.id}`).set(auth(guest.accessToken)).expect(404);

    // Share the public space explicitly -> guest sees exactly that one.
    await http
      .put(`/spaces/${pub.id}/shares`)
      .set(auth(owner.accessToken))
      .send({ principalType: "user", principalId: guest.userId, permission: "view" })
      .expect(200);
    tree = (await http.get("/hierarchy").set(auth(guest.accessToken))).body;
    expect(tree.spaces.map((s: { id: string }) => s.id)).toEqual([pub.id]);
    expect(tree.spaces[0].myPermission).toBe("view");
  });
});

describe("myPermission field", () => {
  it("is present and correct on tree, space detail and list detail", async () => {
    const owner = await ownerWorkspace("Perm WS");
    const space = (
      await http
        .post("/spaces")
        .set(auth(owner.accessToken))
        .send({ name: "P" })
        .expect(201)
    ).body.space;
    expect(space.myPermission).toBe("full");

    const tree = (await http.get("/hierarchy").set(auth(owner.accessToken))).body;
    expect(
      tree.spaces.find((s: { id: string }) => s.id === space.id).myPermission,
    ).toBe("full");

    const spaces = (await http.get("/spaces").set(auth(owner.accessToken))).body
      .spaces;
    expect(
      spaces.find((s: { id: string }) => s.id === space.id).myPermission,
    ).toBe("full");

    const detail = (
      await http.get(`/spaces/${space.id}`).set(auth(owner.accessToken))
    ).body;
    expect(detail.space.myPermission).toBe("full");

    const list = (
      await http
        .post(`/spaces/${space.id}/lists`)
        .set(auth(owner.accessToken))
        .send({ name: "L" })
        .expect(201)
    ).body.list;
    const listDetail = (
      await http.get(`/lists/${list.id}`).set(auth(owner.accessToken)).expect(200)
    ).body;
    expect(listDetail.space.myPermission).toBe("full");

    // A member sees a public space as 'edit' (the workspace default).
    const userB = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const bTree = (await http.get("/hierarchy").set(auth(userB.accessToken))).body;
    expect(
      bTree.spaces.find((s: { id: string }) => s.id === space.id).myPermission,
    ).toBe("edit");
  });
});

describe("space access panel & privacy", () => {
  it("lists shares, gates privacy on manage rights, and unshare hides again", async () => {
    const owner = await ownerWorkspace("Access WS");
    const userB = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const space = (
      await http
        .post("/spaces")
        .set(auth(owner.accessToken))
        .send({ name: "A" })
        .expect(201)
    ).body.space;

    let access = (
      await http
        .get(`/spaces/${space.id}/access`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body;
    expect(access.canManage).toBe(true);
    expect(access.isPrivate).toBe(false);
    expect(access.entries).toEqual([]);

    await http
      .put(`/spaces/${space.id}/shares`)
      .set(auth(owner.accessToken))
      .send({
        principalType: "user",
        principalId: userB.userId,
        permission: "comment",
      })
      .expect(200);

    access = (
      await http.get(`/spaces/${space.id}/access`).set(auth(owner.accessToken))
    ).body;
    expect(access.entries).toHaveLength(1);
    expect(access.entries[0].principalId).toBe(userB.userId);
    expect(String(access.entries[0].email).toLowerCase()).toBe(
      userB.email.toLowerCase(),
    );
    expect(access.entries[0].permission).toBe("comment");

    // A member with only a 'comment' share cannot toggle privacy (not manage).
    await http
      .put(`/spaces/${space.id}/privacy`)
      .set(auth(userB.accessToken))
      .send({ isPrivate: true })
      .expect(403);

    // Owner turns it private.
    const p = (
      await http
        .put(`/spaces/${space.id}/privacy`)
        .set(auth(owner.accessToken))
        .send({ isPrivate: true })
        .expect(200)
    ).body;
    expect(p.isPrivate).toBe(true);

    // Member keeps their 'comment' visibility but still can't write.
    const detail = (
      await http.get(`/spaces/${space.id}`).set(auth(userB.accessToken)).expect(200)
    ).body;
    expect(detail.space.myPermission).toBe("comment");
    await http
      .post(`/spaces/${space.id}/lists`)
      .set(auth(userB.accessToken))
      .send({ name: "x" })
      .expect(403);

    // Unshare -> private space with no share -> member 404s again.
    await http
      .delete(`/spaces/${space.id}/shares/user/${userB.userId}`)
      .set(auth(owner.accessToken))
      .expect(204);
    await http.get(`/spaces/${space.id}`).set(auth(userB.accessToken)).expect(404);
  });
});
