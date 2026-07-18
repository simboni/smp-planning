import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 1 (Spaces -> Folders -> Lists) against the
 * migrated stackup_test database. Mirrors app.e2e-spec.ts: unique emails,
 * two-workspace isolation setup, supertest.
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

async function signup(email = uniqueEmail(), password = "password123") {
  const res = await http
    .post("/auth/signup")
    .send({ email, fullName: "Test User", password })
    .expect(201);
  return { email, password, ...res.body };
}

async function createWorkspaceWithToken(identityToken: string, name: string) {
  const created = await http
    .post("/workspaces")
    .set("Authorization", `Bearer ${identityToken}`)
    .send({ name })
    .expect(201);
  const workspaceId = created.body.workspace.id as string;
  const tokenRes = await http
    .post(`/workspaces/${workspaceId}/token`)
    .set("Authorization", `Bearer ${identityToken}`)
    .expect(200);
  return { workspaceId, accessToken: tokenRes.body.accessToken as string };
}

/** A fresh workspace with an owner access token, ready for hierarchy work. */
async function freshWorkspace(name = "H Space") {
  const { identityToken } = await signup();
  return createWorkspaceWithToken(identityToken, name);
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("hierarchy: build & fetch tree", () => {
  it("creates space -> folder -> list and a folderless list, tree nests correctly", async () => {
    const { accessToken } = await freshWorkspace("Engineering");

    const space = (
      await http
        .post("/spaces")
        .set(auth(accessToken))
        .send({ name: "Backend", color: "#112233", icon: "🚀" })
        .expect(201)
    ).body.space;
    expect(space.color).toBe("#112233");
    expect(space.icon).toBe("🚀");
    expect(space.sortOrder).toBe(0);

    const folder = (
      await http
        .post(`/spaces/${space.id}/folders`)
        .set(auth(accessToken))
        .send({ name: "Sprints" })
        .expect(201)
    ).body.folder;
    expect(folder.spaceId).toBe(space.id);

    const inFolder = (
      await http
        .post(`/spaces/${space.id}/lists`)
        .set(auth(accessToken))
        .send({ name: "Sprint 1", folderId: folder.id })
        .expect(201)
    ).body.list;
    expect(inFolder.folderId).toBe(folder.id);

    const folderless = (
      await http
        .post(`/spaces/${space.id}/lists`)
        .set(auth(accessToken))
        .send({ name: "Backlog" })
        .expect(201)
    ).body.list;
    expect(folderless.folderId).toBeNull();

    const tree = (
      await http.get("/hierarchy").set(auth(accessToken)).expect(200)
    ).body;
    const s = tree.spaces.find((x: { id: string }) => x.id === space.id);
    expect(s).toBeDefined();
    expect(s.folders).toHaveLength(1);
    expect(s.folders[0].id).toBe(folder.id);
    expect(s.folders[0].lists.map((l: { id: string }) => l.id)).toEqual([
      inFolder.id,
    ]);
    expect(s.lists.map((l: { id: string }) => l.id)).toEqual([folderless.id]);
  });

  it("default space color is #7B68EE and rejects a bad color", async () => {
    const { accessToken } = await freshWorkspace();
    const space = (
      await http
        .post("/spaces")
        .set(auth(accessToken))
        .send({ name: "Defaults" })
        .expect(201)
    ).body.space;
    expect(space.color).toBe("#7B68EE");

    await http
      .post("/spaces")
      .set(auth(accessToken))
      .send({ name: "Bad", color: "red" })
      .expect(400);
    await http
      .post("/spaces")
      .set(auth(accessToken))
      .send({ name: "  " })
      .expect(400);
  });

  it("rejects a list whose folder is in another space (400)", async () => {
    const { accessToken } = await freshWorkspace();
    const spaceA = (
      await http.post("/spaces").set(auth(accessToken)).send({ name: "A" })
    ).body.space;
    const spaceB = (
      await http.post("/spaces").set(auth(accessToken)).send({ name: "B" })
    ).body.space;
    const folderA = (
      await http
        .post(`/spaces/${spaceA.id}/folders`)
        .set(auth(accessToken))
        .send({ name: "FA" })
    ).body.folder;

    await http
      .post(`/spaces/${spaceB.id}/lists`)
      .set(auth(accessToken))
      .send({ name: "Wrong", folderId: folderA.id })
      .expect(400);
  });

  it("GET /lists/:id returns space + folder breadcrumb", async () => {
    const { accessToken } = await freshWorkspace();
    const space = (
      await http.post("/spaces").set(auth(accessToken)).send({ name: "Crumbs" })
    ).body.space;
    const folder = (
      await http
        .post(`/spaces/${space.id}/folders`)
        .set(auth(accessToken))
        .send({ name: "Grp" })
    ).body.folder;
    const list = (
      await http
        .post(`/spaces/${space.id}/lists`)
        .set(auth(accessToken))
        .send({ name: "L", folderId: folder.id })
    ).body.list;

    const res = (
      await http.get(`/lists/${list.id}`).set(auth(accessToken)).expect(200)
    ).body;
    expect(res.list.id).toBe(list.id);
    expect(res.space.id).toBe(space.id);
    expect(res.folder.id).toBe(folder.id);
  });
});

describe("hierarchy: move & reorder", () => {
  it("moves a list between folder and folderless via PATCH", async () => {
    const { accessToken } = await freshWorkspace();
    const space = (
      await http.post("/spaces").set(auth(accessToken)).send({ name: "Move" })
    ).body.space;
    const folder = (
      await http
        .post(`/spaces/${space.id}/folders`)
        .set(auth(accessToken))
        .send({ name: "F" })
    ).body.folder;
    const list = (
      await http
        .post(`/spaces/${space.id}/lists`)
        .set(auth(accessToken))
        .send({ name: "Roamer" })
    ).body.list;
    expect(list.folderId).toBeNull();

    // Move into folder.
    const intoFolder = (
      await http
        .patch(`/lists/${list.id}`)
        .set(auth(accessToken))
        .send({ folderId: folder.id })
        .expect(200)
    ).body.list;
    expect(intoFolder.folderId).toBe(folder.id);

    // Move back to folderless.
    const backOut = (
      await http
        .patch(`/lists/${list.id}`)
        .set(auth(accessToken))
        .send({ folderId: null })
        .expect(200)
    ).body.list;
    expect(backOut.folderId).toBeNull();

    // Reflected in the tree.
    const tree = (await http.get("/hierarchy").set(auth(accessToken))).body;
    const s = tree.spaces.find((x: { id: string }) => x.id === space.id);
    expect(s.folders[0].lists).toHaveLength(0);
    expect(s.lists.map((l: { id: string }) => l.id)).toContain(list.id);
  });

  it("reorders spaces and the new order persists", async () => {
    const { accessToken } = await freshWorkspace();
    const a = (
      await http.post("/spaces").set(auth(accessToken)).send({ name: "one" })
    ).body.space;
    const b = (
      await http.post("/spaces").set(auth(accessToken)).send({ name: "two" })
    ).body.space;
    const c = (
      await http.post("/spaces").set(auth(accessToken)).send({ name: "three" })
    ).body.space;

    await http
      .post("/spaces/reorder")
      .set(auth(accessToken))
      .send({ ids: [c.id, a.id, b.id] })
      .expect(200);

    const spaces = (
      await http.get("/spaces").set(auth(accessToken)).expect(200)
    ).body.spaces;
    expect(spaces.map((s: { id: string }) => s.id)).toEqual([c.id, a.id, b.id]);
    expect(spaces.map((s: { sortOrder: number }) => s.sortOrder)).toEqual([
      0, 1, 2,
    ]);
  });
});

describe("hierarchy: cascade delete", () => {
  it("deleting a space removes its folders and lists from the tree", async () => {
    const { accessToken } = await freshWorkspace();
    const space = (
      await http.post("/spaces").set(auth(accessToken)).send({ name: "Doomed" })
    ).body.space;
    const folder = (
      await http
        .post(`/spaces/${space.id}/folders`)
        .set(auth(accessToken))
        .send({ name: "F" })
    ).body.folder;
    const list = (
      await http
        .post(`/spaces/${space.id}/lists`)
        .set(auth(accessToken))
        .send({ name: "L", folderId: folder.id })
    ).body.list;

    await http
      .delete(`/spaces/${space.id}`)
      .set(auth(accessToken))
      .expect(204);

    const tree = (await http.get("/hierarchy").set(auth(accessToken))).body;
    expect(
      tree.spaces.find((x: { id: string }) => x.id === space.id),
    ).toBeUndefined();
    // Its children are gone with it.
    await http.get(`/lists/${list.id}`).set(auth(accessToken)).expect(404);
    await http.get(`/spaces/${space.id}`).set(auth(accessToken)).expect(404);
  });
});

describe("hierarchy: cross-workspace isolation gate", () => {
  it("workspace B cannot see, PATCH, or DELETE workspace A's space", async () => {
    const wsA = await freshWorkspace("Iso A");
    const wsB = await freshWorkspace("Iso B");

    const aSpace = (
      await http
        .post("/spaces")
        .set(auth(wsA.accessToken))
        .send({ name: "A-Secret" })
        .expect(201)
    ).body.space;

    // B's tree / space list never contains A's space.
    const bTree = (await http.get("/hierarchy").set(auth(wsB.accessToken))).body;
    expect(
      bTree.spaces.find((x: { id: string }) => x.id === aSpace.id),
    ).toBeUndefined();
    const bSpaces = (await http.get("/spaces").set(auth(wsB.accessToken))).body
      .spaces;
    expect(
      bSpaces.find((x: { id: string }) => x.id === aSpace.id),
    ).toBeUndefined();

    // B cannot read, patch, or delete A's space (RLS -> 404).
    await http.get(`/spaces/${aSpace.id}`).set(auth(wsB.accessToken)).expect(404);
    await http
      .patch(`/spaces/${aSpace.id}`)
      .set(auth(wsB.accessToken))
      .send({ name: "hijacked" })
      .expect(404);
    await http
      .delete(`/spaces/${aSpace.id}`)
      .set(auth(wsB.accessToken))
      .expect(404);

    // A's space is untouched.
    const stillThere = (
      await http.get(`/spaces/${aSpace.id}`).set(auth(wsA.accessToken)).expect(200)
    ).body.space;
    expect(stillThere.name).toBe("A-Secret");
  });
});
