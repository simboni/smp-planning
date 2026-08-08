import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * Cross-workspace isolation — the report that prompted this: "I created a
 * profile for another person, made a workspace for them, and all MY spaces
 * and folders appeared in their workspace."
 *
 * These tests assert the hard boundary from every angle a real user can
 * touch: a second user's own workspace, a second workspace owned by the SAME
 * user, token minting for a workspace you don't belong to, and reading a
 * foreign space by id.
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

async function signup() {
  const email = uniqueEmail();
  const res = await http
    .post("/auth/signup")
    .send({ email, fullName: "Test User", password: "password123" })
    .expect(201);
  return {
    email,
    identityToken: res.body.identityToken as string,
    userId: res.body.user.id as string,
  };
}

async function makeWorkspace(identityToken: string, name: string) {
  const created = await http
    .post("/workspaces")
    .set(auth(identityToken))
    .send({ name })
    .expect(201);
  const workspaceId = created.body.workspace.id as string;
  const tok = await http
    .post(`/workspaces/${workspaceId}/token`)
    .set(auth(identityToken))
    .expect(200);
  return { workspaceId, accessToken: tok.body.accessToken as string };
}

async function makeSpaceWithFolderAndList(token: string, name: string) {
  const space = (
    await http.post("/spaces").set(auth(token)).send({ name }).expect(201)
  ).body.space;
  const folder = (
    await http
      .post(`/spaces/${space.id}/folders`)
      .set(auth(token))
      .send({ name: `${name} folder` })
      .expect(201)
  ).body.folder;
  const list = (
    await http
      .post(`/spaces/${space.id}/lists`)
      .set(auth(token))
      .send({ name: `${name} list` })
      .expect(201)
  ).body.list;
  return { space, folder, list };
}

describe("cross-workspace isolation", () => {
  it("a second user's own workspace never shows the first user's spaces", async () => {
    const alice = await signup();
    const aliceWs = await makeWorkspace(alice.identityToken, "Alice Co");
    await makeSpaceWithFolderAndList(aliceWs.accessToken, "ALICE-SECRET");

    // A brand-new person with their OWN workspace.
    const peter = await signup();
    const peterWs = await makeWorkspace(peter.identityToken, "Peter Co");

    const spaces = (
      await http.get("/spaces").set(auth(peterWs.accessToken)).expect(200)
    ).body.spaces as { name: string }[];
    expect(spaces.map((s) => s.name)).not.toContain("ALICE-SECRET");
    expect(spaces).toHaveLength(0);

    const tree = (
      await http.get("/hierarchy").set(auth(peterWs.accessToken)).expect(200)
    ).body.spaces as { name: string }[];
    expect(tree).toHaveLength(0);
  });

  it("a SECOND workspace owned by the same user starts empty", async () => {
    const owner = await signup();
    const first = await makeWorkspace(owner.identityToken, "My First Co");
    const mine = await makeSpaceWithFolderAndList(first.accessToken, "MINE");

    // Exactly what the report describes: the same person creates another
    // workspace (e.g. "for Peter"). It must NOT inherit the first one's work.
    const second = await makeWorkspace(owner.identityToken, "Peter Co");

    const spaces = (
      await http.get("/spaces").set(auth(second.accessToken)).expect(200)
    ).body.spaces;
    expect(spaces).toHaveLength(0);

    const tree = (
      await http.get("/hierarchy").set(auth(second.accessToken)).expect(200)
    ).body.spaces;
    expect(tree).toHaveLength(0);

    // The first workspace still has its work (nothing was moved).
    const firstSpaces = (
      await http.get("/spaces").set(auth(first.accessToken)).expect(200)
    ).body.spaces as { id: string }[];
    expect(firstSpaces.map((s) => s.id)).toContain(mine.space.id);

    // A foreign space id is invisible even when named directly.
    await http
      .get(`/spaces/${mine.space.id}`)
      .set(auth(second.accessToken))
      .expect(404);
    await http
      .get(`/spaces/${mine.space.id}/lists`)
      .set(auth(second.accessToken))
      .expect(404);
  });

  it("you cannot mint an access token for a workspace you don't belong to", async () => {
    const alice = await signup();
    const aliceWs = await makeWorkspace(alice.identityToken, "Alice Co");
    const peter = await signup();

    // Peter knows Alice's workspace id and asks for a token on it.
    await http
      .post(`/workspaces/${aliceWs.workspaceId}/token`)
      .set(auth(peter.identityToken))
      .expect(403);
  });

  it("creating a space in workspace B never lands it in workspace A", async () => {
    const owner = await signup();
    const a = await makeWorkspace(owner.identityToken, "WS A");
    const b = await makeWorkspace(owner.identityToken, "WS B");

    const inB = (
      await http
        .post("/spaces")
        .set(auth(b.accessToken))
        .send({ name: "BORN-IN-B" })
        .expect(201)
    ).body.space;

    const aSpaces = (
      await http.get("/spaces").set(auth(a.accessToken)).expect(200)
    ).body.spaces as { id: string; name: string }[];
    expect(aSpaces.map((s) => s.name)).not.toContain("BORN-IN-B");

    const bSpaces = (
      await http.get("/spaces").set(auth(b.accessToken)).expect(200)
    ).body.spaces as { id: string }[];
    expect(bSpaces.map((s) => s.id)).toEqual([inB.id]);
  });

  it("an invited member sees the inviter's workspace — by design, not a leak", async () => {
    // This is the ONE case where another person legitimately sees your work:
    // you invited them INTO your workspace. Documented so the distinction is
    // explicit when triaging reports like this.
    const owner = await signup();
    const ws = await makeWorkspace(owner.identityToken, "Shared Co");
    await makeSpaceWithFolderAndList(ws.accessToken, "TEAM-WORK");

    const invitee = await signup();
    await http
      .post("/workspaces/current/members")
      .set(auth(ws.accessToken))
      .send({ email: invitee.email, role: "member" })
      .expect(201);
    const inviteeTok = (
      await http
        .post(`/workspaces/${ws.workspaceId}/token`)
        .set(auth(invitee.identityToken))
        .expect(200)
    ).body.accessToken as string;

    const spaces = (
      await http.get("/spaces").set(auth(inviteeTok)).expect(200)
    ).body.spaces as { name: string }[];
    expect(spaces.map((s) => s.name)).toContain("TEAM-WORK");

    // …but their OWN separate workspace stays empty.
    const own = await makeWorkspace(invitee.identityToken, "Invitee Own Co");
    const ownSpaces = (
      await http.get("/spaces").set(auth(own.accessToken)).expect(200)
    ).body.spaces;
    expect(ownSpaces).toHaveLength(0);
  });
});
