import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests against the migrated stackup_test database (setup.ts
 * points APP_DB_URL there before any module loads). Emails are unique per
 * run so reruns never collide.
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

/** Sign up a fresh user; returns their tokens + identity. */
async function signup(email = uniqueEmail(), password = "password123") {
  const res = await http
    .post("/auth/signup")
    .send({ email, fullName: "Test User", password })
    .expect(201);
  return { email, password, ...res.body };
}

/** Create a workspace and return an access token scoped to it. */
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

describe("health", () => {
  it("reports ok with db connectivity", async () => {
    const res = await http.get("/health").expect(200);
    expect(res.body).toEqual({ status: "ok", db: true });
  });
});

describe("auth flow", () => {
  it("signup returns identity + refresh tokens and empty workspaces", async () => {
    const res = await signup();
    expect(typeof res.identityToken).toBe("string");
    expect(typeof res.refreshToken).toBe("string");
    expect(res.user.email).toBeDefined();
    expect(res.workspaces).toEqual([]);
  });

  it("login with correct credentials returns 200", async () => {
    const { email, password } = await signup();
    const res = await http
      .post("/auth/login")
      .send({ email, password })
      .expect(200);
    expect(res.body.identityToken).toBeDefined();
    expect(res.body.user.email).toBe(email.toLowerCase());
  });

  it("login with wrong password returns 401", async () => {
    const { email } = await signup();
    await http
      .post("/auth/login")
      .send({ email, password: "wrong-password" })
      .expect(401);
  });

  it("duplicate signup returns 409", async () => {
    const { email } = await signup();
    await http
      .post("/auth/signup")
      .send({ email, fullName: "Dup", password: "password123" })
      .expect(409);
  });

  it("refresh rotates the token and yields a new identity token", async () => {
    const { refreshToken } = await signup();
    const res = await http
      .post("/auth/refresh")
      .send({ refreshToken })
      .expect(200);
    expect(res.body.identityToken).toBeDefined();
    expect(res.body.refreshToken).not.toBe(refreshToken);
    // Old token is now revoked.
    await http.post("/auth/refresh").send({ refreshToken }).expect(401);
  });

  it("GET /auth/me returns the user for a valid token", async () => {
    const { identityToken, email } = await signup();
    const res = await http
      .get("/auth/me")
      .set("Authorization", `Bearer ${identityToken}`)
      .expect(200);
    expect(res.body.user.email).toBe(email.toLowerCase());
  });

  it("GET /auth/me without a token returns 401", async () => {
    await http.get("/auth/me").expect(401);
  });
});

describe("workspace flow", () => {
  it("creates a workspace that then appears in GET /workspaces", async () => {
    const { identityToken } = await signup();
    const created = await http
      .post("/workspaces")
      .set("Authorization", `Bearer ${identityToken}`)
      .send({ name: "Acme Inc" })
      .expect(201);
    expect(created.body.workspace.role).toBe("owner");
    expect(created.body.workspace.slug).toMatch(/^acme-inc-[0-9a-f]{6}$/);

    const list = await http
      .get("/workspaces")
      .set("Authorization", `Bearer ${identityToken}`)
      .expect(200);
    expect(list.body.workspaces.map((w: { id: string }) => w.id)).toContain(
      created.body.workspace.id,
    );
  });

  it("mints an access token and GET /workspaces/current returns it", async () => {
    const { identityToken } = await signup();
    const { workspaceId, accessToken } = await createWorkspaceWithToken(
      identityToken,
      "Beta Co",
    );
    const current = await http
      .get("/workspaces/current")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(current.body.workspace.id).toBe(workspaceId);
    expect(current.body.role).toBe("owner");
  });

  it("an identity token cannot reach workspace-scoped routes", async () => {
    const { identityToken } = await signup();
    await http
      .get("/workspaces/current")
      .set("Authorization", `Bearer ${identityToken}`)
      .expect(401);
  });

  it("invites a member who then appears in the members list", async () => {
    const { identityToken } = await signup();
    const { accessToken } = await createWorkspaceWithToken(
      identityToken,
      "Gamma LLC",
    );
    const inviteeEmail = uniqueEmail();
    const invited = await http
      .post("/workspaces/current/members")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ email: inviteeEmail, role: "member" })
      .expect(201);
    expect(invited.body.role).toBe("member");

    const members = await http
      .get("/workspaces/current/members")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    const emails = members.body.members.map((m: { email: string }) => m.email);
    expect(emails).toContain(inviteeEmail);
    // Re-inviting the same member is a 409.
    await http
      .post("/workspaces/current/members")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ email: inviteeEmail, role: "member" })
      .expect(409);
  });
});

describe("cross-workspace isolation gate", () => {
  it("user A's access token sees ONLY WS-A members, never WS-B's", async () => {
    // Two independent users, each with their own workspace + a distinct member.
    const userA = await signup();
    const wsA = await createWorkspaceWithToken(userA.identityToken, "Workspace A");
    const aMemberEmail = uniqueEmail();
    await http
      .post("/workspaces/current/members")
      .set("Authorization", `Bearer ${wsA.accessToken}`)
      .send({ email: aMemberEmail, role: "member" })
      .expect(201);

    const userB = await signup();
    const wsB = await createWorkspaceWithToken(userB.identityToken, "Workspace B");
    const bMemberEmail = uniqueEmail();
    await http
      .post("/workspaces/current/members")
      .set("Authorization", `Bearer ${wsB.accessToken}`)
      .send({ email: bMemberEmail, role: "member" })
      .expect(201);

    // With A's access token, the members list is confined to WS-A by RLS.
    const membersA = await http
      .get("/workspaces/current/members")
      .set("Authorization", `Bearer ${wsA.accessToken}`)
      .expect(200);
    const emailsA = membersA.body.members.map((m: { email: string }) => m.email);
    expect(emailsA).toContain(userA.email.toLowerCase());
    expect(emailsA).toContain(aMemberEmail);
    // The isolation assertion: NONE of WS-B's identities leak into WS-A.
    expect(emailsA).not.toContain(bMemberEmail);
    expect(emailsA).not.toContain(userB.email.toLowerCase());
  });

  it("user A cannot mint an access token for user B's workspace (403)", async () => {
    const userA = await signup();
    await createWorkspaceWithToken(userA.identityToken, "A Home");

    const userB = await signup();
    const wsB = await createWorkspaceWithToken(userB.identityToken, "B Home");

    await http
      .post(`/workspaces/${wsB.workspaceId}/token`)
      .set("Authorization", `Bearer ${userA.identityToken}`)
      .expect(403);
  });
});
