import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 6 (Real-time Collaboration): comments with
 * threading/mentions/assigned comments, task activity, the notifications
 * inbox and reminders. Same harness as M3-M5. The SSE stream itself is not
 * exercised here (long-lived response); its publish paths are covered
 * indirectly through the mutations below.
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
    .send({ email, fullName: "Collab User", password })
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
    .send({ name: "M6 WS" })
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
  const listId = list.body.list.id as string;
  const task = await http
    .post(`/lists/${listId}/tasks`)
    .set(auth(access))
    .send({ name: "Task A" })
    .expect(201);
  return {
    owner,
    workspaceId,
    access,
    spaceId,
    listId,
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

describe("comments", () => {
  it("creates, threads, edits and deletes comments", async () => {
    const f = await fixture();
    const c1 = await http
      .post(`/tasks/${f.taskId}/comments`)
      .set(auth(f.access))
      .send({ body: "First!" })
      .expect(201);
    const parentId = c1.body.comment.id as string;
    await http
      .post(`/tasks/${f.taskId}/comments`)
      .set(auth(f.access))
      .send({ body: "A reply", parentCommentId: parentId })
      .expect(201);

    const listRes = await http
      .get(`/tasks/${f.taskId}/comments`)
      .set(auth(f.access))
      .expect(200);
    const top = listRes.body.comments.find(
      (c: { id: string }) => c.id === parentId,
    );
    expect(top).toBeDefined();
    expect(top.replies).toHaveLength(1);
    expect(top.replies[0].body).toBe("A reply");

    await http
      .patch(`/comments/${parentId}`)
      .set(auth(f.access))
      .send({ body: "First! (edited)" })
      .expect(200);
    const after = await http
      .get(`/tasks/${f.taskId}/comments`)
      .set(auth(f.access))
      .expect(200);
    const edited = after.body.comments.find(
      (c: { id: string }) => c.id === parentId,
    );
    expect(edited.body).toBe("First! (edited)");
    expect(edited.editedAt).toBeTruthy();

    await http
      .delete(`/comments/${parentId}`)
      .set(auth(f.access))
      .expect(204);
    const final = await http
      .get(`/tasks/${f.taskId}/comments`)
      .set(auth(f.access))
      .expect(200);
    expect(
      final.body.comments.find((c: { id: string }) => c.id === parentId),
    ).toBeUndefined();
  });

  it("mention tokens notify the mentioned member", async () => {
    const f = await fixture();
    const bob = await signup();
    const bobAccess = await join(f.access, f.workspaceId, bob);

    await http
      .post(`/tasks/${f.taskId}/comments`)
      .set(auth(f.access))
      .send({ body: `ping @[${bob.userId}] please look` })
      .expect(201);

    const inbox = await http
      .get("/notifications")
      .set(auth(bobAccess))
      .expect(200);
    const mention = inbox.body.notifications.find(
      (n: { kind: string }) => n.kind === "mention",
    );
    expect(mention).toBeDefined();
    expect(inbox.body.unreadCount).toBeGreaterThanOrEqual(1);
  });

  it("assigned comments notify and resolve", async () => {
    const f = await fixture();
    const bob = await signup();
    const bobAccess = await join(f.access, f.workspaceId, bob);

    const c = await http
      .post(`/tasks/${f.taskId}/comments`)
      .set(auth(f.access))
      .send({ body: "Do the thing", assigneeUserId: bob.userId })
      .expect(201);
    expect(c.body.comment.assignee.id).toBe(bob.userId);

    const inbox = await http
      .get("/notifications")
      .set(auth(bobAccess))
      .expect(200);
    expect(
      inbox.body.notifications.some(
        (n: { kind: string }) => n.kind === "assigned",
      ),
    ).toBe(true);

    await http
      .patch(`/comments/${c.body.comment.id}`)
      .set(auth(bobAccess))
      .send({ resolved: true })
      .expect(200);
    const listRes = await http
      .get(`/tasks/${f.taskId}/comments`)
      .set(auth(f.access))
      .expect(200);
    expect(
      listRes.body.comments.find(
        (x: { id: string }) => x.id === c.body.comment.id,
      ).resolvedAt,
    ).toBeTruthy();
  });

  it("view-only members cannot comment; comment-level members can", async () => {
    const f = await fixture();
    // Make the space private, then share at 'view' and 'comment' levels.
    const viewer = await signup();
    const commenter = await signup();
    const viewerAccess = await join(f.access, f.workspaceId, viewer);
    const commenterAccess = await join(f.access, f.workspaceId, commenter);
    await http
      .put(`/spaces/${f.spaceId}/privacy`)
      .set(auth(f.access))
      .send({ isPrivate: true })
      .expect(200);
    await http
      .put(`/spaces/${f.spaceId}/shares`)
      .set(auth(f.access))
      .send({
        principalType: "user",
        principalId: viewer.userId,
        permission: "view",
      })
      .expect(200);
    await http
      .put(`/spaces/${f.spaceId}/shares`)
      .set(auth(f.access))
      .send({
        principalType: "user",
        principalId: commenter.userId,
        permission: "comment",
      })
      .expect(200);

    await http
      .post(`/tasks/${f.taskId}/comments`)
      .set(auth(viewerAccess))
      .send({ body: "should fail" })
      .expect(403);
    await http
      .post(`/tasks/${f.taskId}/comments`)
      .set(auth(commenterAccess))
      .send({ body: "should work" })
      .expect(201);
  });
});

describe("activity", () => {
  it("records created + status changes", async () => {
    const f = await fixture();
    const statuses = await http
      .get(`/spaces/${f.spaceId}/statuses`)
      .set(auth(f.access))
      .expect(200);
    const done = statuses.body.statuses.find(
      (s: { type: string }) => s.type === "done",
    );
    await http
      .patch(`/tasks/${f.taskId}`)
      .set(auth(f.access))
      .send({ statusId: done.id })
      .expect(200);

    const act = await http
      .get(`/tasks/${f.taskId}/activity`)
      .set(auth(f.access))
      .expect(200);
    const kinds = act.body.activity.map((a: { kind: string }) => a.kind);
    expect(kinds).toContain("created");
    expect(kinds).toContain("status");
  });
});

describe("notifications & reminders", () => {
  it("assignment notifies the assignee (not the actor)", async () => {
    const f = await fixture();
    const bob = await signup();
    const bobAccess = await join(f.access, f.workspaceId, bob);
    await http
      .post(`/tasks/${f.taskId}/assignees`)
      .set(auth(f.access))
      .send({ userId: bob.userId })
      .expect(201);
    const inbox = await http
      .get("/notifications")
      .set(auth(bobAccess))
      .expect(200);
    expect(
      inbox.body.notifications.some(
        (n: { kind: string }) => n.kind === "assigned",
      ),
    ).toBe(true);
  });

  it("read + read-all clear the unread count", async () => {
    const f = await fixture();
    const bob = await signup();
    const bobAccess = await join(f.access, f.workspaceId, bob);
    await http
      .post(`/tasks/${f.taskId}/comments`)
      .set(auth(f.access))
      .send({ body: `hey @[${bob.userId}]` })
      .expect(201);
    const before = await http
      .get("/notifications")
      .set(auth(bobAccess))
      .expect(200);
    expect(before.body.unreadCount).toBeGreaterThanOrEqual(1);
    await http
      .post("/notifications/read-all")
      .set(auth(bobAccess))
      .expect(200);
    const after = await http
      .get("/notifications")
      .set(auth(bobAccess))
      .expect(200);
    expect(after.body.unreadCount).toBe(0);
  });

  it("due reminders surface as notifications exactly once", async () => {
    const f = await fixture();
    const past = new Date(Date.now() - 60_000).toISOString();
    await http
      .post("/reminders")
      .set(auth(f.access))
      .send({ note: "Pay invoices", remindAt: past })
      .expect(201);

    const first = await http
      .get("/notifications")
      .set(auth(f.access))
      .expect(200);
    const reminders = first.body.notifications.filter(
      (n: { kind: string; message: string }) =>
        n.kind === "reminder" && n.message.includes("Pay invoices"),
    );
    expect(reminders).toHaveLength(1);

    // A second fetch must not duplicate it (notified_at gate).
    const second = await http
      .get("/notifications")
      .set(auth(f.access))
      .expect(200);
    const again = second.body.notifications.filter(
      (n: { kind: string; message: string }) =>
        n.kind === "reminder" && n.message.includes("Pay invoices"),
    );
    expect(again).toHaveLength(1);
  });
});
