import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { FcmClient, type FcmNotification } from "../src/push/fcm.client";

/**
 * End-to-end tests for mobile push notifications. The FCM sender is replaced
 * with a fake that reports configured and captures what would be sent, so
 * token registration, the upsert semantics, and the notification.new →
 * push bridge are all exercised without network (and without a real
 * FCM_SERVICE_ACCOUNT — the feature ships dormant).
 */

const fcmSends: { token: string; title: string; body: string; path?: string }[] =
  [];
class FakeFcm {
  configured() {
    return true;
  }
  async send(token: string, n: FcmNotification) {
    fcmSends.push({ token, title: n.title, body: n.body, path: n.path });
    return { ok: true, unregistered: false, detail: "captured" };
  }
}

let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FcmClient)
    .useClass(FakeFcm)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
  http = request(app.getHttpServer());
});
afterAll(async () => {
  await app.close();
});

const uniqueEmail = () =>
  `p${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;
const uniqueToken = () =>
  `device-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signup(email = uniqueEmail(), password = "password123") {
  const res = await http
    .post("/auth/signup")
    .send({ email, fullName: "Push User", password })
    .expect(201);
  return {
    email,
    identityToken: res.body.identityToken as string,
    userId: res.body.user.id as string,
  };
}

/** Owner + workspace + space + list + one task; returns everything. */
async function fixture() {
  const owner = await signup();
  const ws = await http
    .post("/workspaces")
    .set(auth(owner.identityToken))
    .send({ name: "Push WS" })
    .expect(201);
  const workspaceId = ws.body.workspace.id as string;
  const tok = await http
    .post(`/workspaces/${workspaceId}/token`)
    .set(auth(owner.identityToken))
    .expect(200);
  const access = tok.body.accessToken as string;
  const space = await http
    .post("/spaces")
    .set(auth(access))
    .send({ name: "Space" })
    .expect(201);
  const list = await http
    .post(`/spaces/${space.body.space.id}/lists`)
    .set(auth(access))
    .send({ name: "List" })
    .expect(201);
  const task = await http
    .post(`/lists/${list.body.list.id}/tasks`)
    .set(auth(access))
    .send({ name: "Task A" })
    .expect(201);
  return { owner, workspaceId, access, taskId: task.body.task.id as string };
}

/** Invite an existing signed-up user into the workspace and mint their token. */
async function join(
  ownerAccess: string,
  workspaceId: string,
  member: { email: string; identityToken: string },
) {
  await http
    .post("/workspaces/current/members")
    .set(auth(ownerAccess))
    .send({ email: member.email, role: "member" })
    .expect(201);
  const tok = await http
    .post(`/workspaces/${workspaceId}/token`)
    .set(auth(member.identityToken))
    .expect(200);
  return tok.body.accessToken as string;
}

/** The push bridge is fire-and-forget off the event bus; poll briefly. */
async function waitForSends(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("push token registration", () => {
  it("registers, re-registers (upsert) and unregisters a device token", async () => {
    const user = await signup();
    const token = uniqueToken();

    await http
      .post("/push/tokens")
      .set(auth(user.identityToken))
      .send({ token })
      .expect(201);

    // Same token again is an upsert, not a unique-violation 500.
    await http
      .post("/push/tokens")
      .set(auth(user.identityToken))
      .send({ token, platform: "ios" })
      .expect(201);

    // A missing token is rejected.
    await http
      .post("/push/tokens")
      .set(auth(user.identityToken))
      .send({})
      .expect(400);

    await http
      .delete("/push/tokens")
      .set(auth(user.identityToken))
      .send({ token })
      .expect(204);
  });

  it("rejects unauthenticated registration", async () => {
    await http.post("/push/tokens").send({ token: uniqueToken() }).expect(401);
  });
});

describe("notification push bridge", () => {
  it("pushes to the mentioned member's device after a mention", async () => {
    const f = await fixture();
    const bob = await signup();
    await join(f.access, f.workspaceId, bob);
    const deviceToken = uniqueToken();

    // Register twice: the upsert keeps ONE row, so exactly one push arrives.
    await http
      .post("/push/tokens")
      .set(auth(bob.identityToken))
      .send({ token: deviceToken })
      .expect(201);
    await http
      .post("/push/tokens")
      .set(auth(bob.identityToken))
      .send({ token: deviceToken })
      .expect(201);

    await http
      .post(`/tasks/${f.taskId}/comments`)
      .set(auth(f.access))
      .send({ body: `ping @[${bob.userId}] please look` })
      .expect(201);

    await waitForSends(() =>
      fcmSends.some((s) => s.token === deviceToken),
    );
    const sends = fcmSends.filter((s) => s.token === deviceToken);
    expect(sends).toHaveLength(1);
    expect(sends[0].title).toBe("New mention");
    expect(sends[0].body).toBe("mentioned you in a comment");
    expect(sends[0].path).toBe(`/list?task=${f.taskId}`);

    // After unregistering, a further mention pushes nothing to that device.
    await http
      .delete("/push/tokens")
      .set(auth(bob.identityToken))
      .send({ token: deviceToken })
      .expect(204);
    await http
      .post(`/tasks/${f.taskId}/comments`)
      .set(auth(f.access))
      .send({ body: `again @[${bob.userId}]` })
      .expect(201);
    await new Promise((r) => setTimeout(r, 300));
    expect(fcmSends.filter((s) => s.token === deviceToken)).toHaveLength(1);
  });
});
