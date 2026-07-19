import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 13 (Chat, SyncUps & task email): channels and
 * DMs, threaded messages with mentions and reactions, unread tracking, and
 * task email compose/list. Same harness as the other modules.
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
    .send({ email, fullName: "Chat User", password })
    .expect(201);
  return {
    email,
    identityToken: res.body.identityToken as string,
    userId: res.body.user.id as string,
  };
}

/** Owner + workspace + access token + space + list + one task. */
async function fixture() {
  const owner = await signup();
  const ws = await http
    .post("/workspaces")
    .set(auth(owner.identityToken))
    .send({ name: "M13 WS" })
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
  const spaceId = space.body.space.id as string;
  const list = await http
    .post(`/spaces/${spaceId}/lists`)
    .set(auth(access))
    .send({ name: "List" })
    .expect(201);
  const task = await http
    .post(`/lists/${list.body.list.id}/tasks`)
    .set(auth(access))
    .send({ name: "Task A" })
    .expect(201);
  return {
    owner,
    workspaceId,
    access,
    spaceId,
    taskId: task.body.task.id as string,
  };
}

/** Invite an existing signed-up user into the workspace and mint their token. */
async function join(
  ownerAccess: string,
  workspaceId: string,
  member: { email: string; identityToken: string },
  role = "member",
) {
  await http
    .post("/workspaces/current/members")
    .set(auth(ownerAccess))
    .send({ email: member.email, role })
    .expect(201);
  const tok = await http
    .post(`/workspaces/${workspaceId}/token`)
    .set(auth(member.identityToken))
    .expect(200);
  return tok.body.accessToken as string;
}

describe("channels & messages", () => {
  it("creates a channel (creator auto-joined) and a second user joins", async () => {
    const f = await fixture();
    const ch = await http
      .post("/channels")
      .set(auth(f.access))
      .send({ name: "general", description: "hi" })
      .expect(201);
    const channelId = ch.body.channel.id as string;
    expect(ch.body.channel.memberCount).toBe(1);

    // Creator sees it in their channel list.
    const mine = await http
      .get("/channels")
      .set(auth(f.access))
      .expect(200);
    expect(
      mine.body.channels.some((c: { id: string }) => c.id === channelId),
    ).toBe(true);

    const bob = await signup();
    const bobAccess = await join(f.access, f.workspaceId, bob);
    // Bob sees it as browsable, not yet joined.
    const pub = await http
      .get("/channels/public")
      .set(auth(bobAccess))
      .expect(200);
    const listed = pub.body.channels.find(
      (c: { id: string }) => c.id === channelId,
    );
    expect(listed.joined).toBe(false);

    await http
      .post(`/channels/${channelId}/join`)
      .set(auth(bobAccess))
      .expect(200);
    const after = await http
      .get("/channels/public")
      .set(auth(bobAccess))
      .expect(200);
    expect(
      after.body.channels.find((c: { id: string }) => c.id === channelId)
        .joined,
    ).toBe(true);
  });

  it("post increments another member's unread; /read clears it", async () => {
    const f = await fixture();
    const bob = await signup();
    const bobAccess = await join(f.access, f.workspaceId, bob);
    const ch = await http
      .post("/channels")
      .set(auth(f.access))
      .send({ name: "unread-test" })
      .expect(201);
    const channelId = ch.body.channel.id as string;
    await http
      .post(`/channels/${channelId}/join`)
      .set(auth(bobAccess))
      .expect(200);

    await http
      .post(`/channels/${channelId}/messages`)
      .set(auth(f.access))
      .send({ body: "hello team" })
      .expect(201);

    const before = await http
      .get("/channels")
      .set(auth(bobAccess))
      .expect(200);
    const unreadCh = before.body.channels.find(
      (c: { id: string }) => c.id === channelId,
    );
    expect(unreadCh.unread).toBeGreaterThanOrEqual(1);

    await http
      .post(`/channels/${channelId}/read`)
      .set(auth(bobAccess))
      .expect(200);
    const after = await http
      .get("/channels")
      .set(auth(bobAccess))
      .expect(200);
    expect(
      after.body.channels.find((c: { id: string }) => c.id === channelId)
        .unread,
    ).toBe(0);
  });

  it("mention notifies the mentioned channel member", async () => {
    const f = await fixture();
    const bob = await signup();
    const bobAccess = await join(f.access, f.workspaceId, bob);
    const ch = await http
      .post("/channels")
      .set(auth(f.access))
      .send({ name: "mentions" })
      .expect(201);
    const channelId = ch.body.channel.id as string;
    await http
      .post(`/channels/${channelId}/join`)
      .set(auth(bobAccess))
      .expect(200);

    await http
      .post(`/channels/${channelId}/messages`)
      .set(auth(f.access))
      .send({ body: `ping @[${bob.userId}] look here` })
      .expect(201);

    const inbox = await http
      .get("/notifications")
      .set(auth(bobAccess))
      .expect(200);
    expect(
      inbox.body.notifications.some((n: { kind: string }) => n.kind === "chat"),
    ).toBe(true);
  });

  it("threaded reply increments replyCount and thread fetch returns it", async () => {
    const f = await fixture();
    const ch = await http
      .post("/channels")
      .set(auth(f.access))
      .send({ name: "threads" })
      .expect(201);
    const channelId = ch.body.channel.id as string;
    const parent = await http
      .post(`/channels/${channelId}/messages`)
      .set(auth(f.access))
      .send({ body: "root message" })
      .expect(201);
    const parentId = parent.body.message.id as string;

    await http
      .post(`/channels/${channelId}/messages`)
      .set(auth(f.access))
      .send({ body: "a reply", parentMessageId: parentId })
      .expect(201);

    const top = await http
      .get(`/channels/${channelId}/messages`)
      .set(auth(f.access))
      .expect(200);
    const rootOut = top.body.messages.find(
      (m: { id: string }) => m.id === parentId,
    );
    expect(rootOut.replyCount).toBe(1);
    // Reply is NOT a top-level message.
    expect(top.body.messages.length).toBe(1);

    const thread = await http
      .get(`/messages/${parentId}/thread`)
      .set(auth(f.access))
      .expect(200);
    expect(thread.body.parent.id).toBe(parentId);
    expect(thread.body.replies).toHaveLength(1);
    expect(thread.body.replies[0].body).toBe("a reply");
  });

  it("reaction toggles on then off", async () => {
    const f = await fixture();
    const ch = await http
      .post("/channels")
      .set(auth(f.access))
      .send({ name: "reactions" })
      .expect(201);
    const channelId = ch.body.channel.id as string;
    const msg = await http
      .post(`/channels/${channelId}/messages`)
      .set(auth(f.access))
      .send({ body: "react to me" })
      .expect(201);
    const messageId = msg.body.message.id as string;

    const add = await http
      .post(`/messages/${messageId}/reactions`)
      .set(auth(f.access))
      .send({ emoji: "👍" })
      .expect(200);
    expect(add.body.reactions).toHaveLength(1);
    expect(add.body.reactions[0].count).toBe(1);
    expect(add.body.reactions[0].mine).toBe(true);

    const remove = await http
      .post(`/messages/${messageId}/reactions`)
      .set(auth(f.access))
      .send({ emoji: "👍" })
      .expect(200);
    expect(remove.body.reactions).toHaveLength(0);
  });
});

describe("direct messages", () => {
  it("find-or-create is idempotent for a pair", async () => {
    const f = await fixture();
    const bob = await signup();
    await join(f.access, f.workspaceId, bob);

    const first = await http
      .post("/dms")
      .set(auth(f.access))
      .send({ userId: bob.userId })
      .expect(201);
    const second = await http
      .post("/dms")
      .set(auth(f.access))
      .send({ userId: bob.userId })
      .expect(201);
    expect(first.body.channel.id).toBe(second.body.channel.id);
    expect(first.body.channel.isDm).toBe(true);
    expect(first.body.channel.members).toHaveLength(2);

    // 400 when DM-ing yourself.
    await http
      .post("/dms")
      .set(auth(f.access))
      .send({ userId: f.owner.userId })
      .expect(400);
  });
});

describe("guests", () => {
  it("guests get 403 on GET /channels", async () => {
    const f = await fixture();
    const guest = await signup();
    const guestAccess = await join(
      f.access,
      f.workspaceId,
      guest,
      "guest",
    );
    await http.get("/channels").set(auth(guestAccess)).expect(403);
  });
});

describe("task email", () => {
  it("compose logs the email, lists it, and records activity", async () => {
    const f = await fixture();
    await http
      .post(`/tasks/${f.taskId}/emails`)
      .set(auth(f.access))
      .send({
        to: "client@example.com",
        subject: "Status update",
        body: "All on track.",
      })
      .expect(201);

    const list = await http
      .get(`/tasks/${f.taskId}/emails`)
      .set(auth(f.access))
      .expect(200);
    expect(list.body.emails).toHaveLength(1);
    expect(list.body.emails[0].direction).toBe("outbound");
    expect(list.body.emails[0].toAddr).toBe("client@example.com");
    expect(list.body.emails[0].fromAddr).toBe(f.owner.email);

    const act = await http
      .get(`/tasks/${f.taskId}/activity`)
      .set(auth(f.access))
      .expect(200);
    expect(
      act.body.activity.some((a: { kind: string }) => a.kind === "email"),
    ).toBe(true);
  });
});
