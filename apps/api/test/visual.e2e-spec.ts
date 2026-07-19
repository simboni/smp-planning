import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import express from "express";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 12 (files/attachments, proofing annotations,
 * whiteboards, mind maps). Same harness as the other e2e specs; the app is
 * created with bodyParser:false + a larger express.json limit to mirror
 * main.ts so base64 uploads fit.
 */

let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication({ bodyParser: false });
  app.use(express.json({ limit: "12mb" }));
  await app.init();
  http = request(app.getHttpServer());
});

afterAll(async () => {
  await app.close();
});

const uniqueEmail = () =>
  `u${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
// 1x1 transparent PNG
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function signup(email = uniqueEmail()) {
  const res = await http
    .post("/auth/signup")
    .send({ email, fullName: "Visual User", password: "password123" })
    .expect(201);
  return { email, identityToken: res.body.identityToken as string, userId: res.body.user.id as string };
}

async function fixture() {
  const owner = await signup();
  const ws = await http
    .post("/workspaces")
    .set(auth(owner.identityToken))
    .send({ name: "M12 WS" })
    .expect(201);
  const workspaceId = ws.body.workspace.id as string;
  const access = (
    await http
      .post(`/workspaces/${workspaceId}/token`)
      .set(auth(owner.identityToken))
      .expect(200)
  ).body.accessToken as string;
  const space = (
    await http.post("/spaces").set(auth(access)).send({ name: "S" }).expect(201)
  ).body.space.id as string;
  const list = (
    await http
      .post(`/spaces/${space}/lists`)
      .set(auth(access))
      .send({ name: "L" })
      .expect(201)
  ).body.list.id as string;
  const task = (
    await http
      .post(`/lists/${list}/tasks`)
      .set(auth(access))
      .send({ name: "T" })
      .expect(201)
  ).body.task.id as string;
  return { owner, workspaceId, access, space, list, task };
}

async function join(ownerAccess: string, workspaceId: string, m: { email: string; identityToken: string }, role = "member") {
  await http
    .post("/workspaces/current/members")
    .set(auth(ownerAccess))
    .send({ email: m.email, role })
    .expect(201);
  return (
    await http.post(`/workspaces/${workspaceId}/token`).set(auth(m.identityToken)).expect(200)
  ).body.accessToken as string;
}

describe("attachments", () => {
  it("uploads a base64 file, lists it, and downloads the bytes", async () => {
    const f = await fixture();
    const up = await http
      .post(`/tasks/${f.task}/files`)
      .set(auth(f.access))
      .send({ name: "mockup.png", mime: "image/png", dataBase64: PNG })
      .expect(201);
    const fileId = up.body.file.id as string;
    expect(up.body.file.sizeBytes).toBeGreaterThan(0);

    const list = await http
      .get(`/tasks/${f.task}/files`)
      .set(auth(f.access))
      .expect(200);
    expect(list.body.files).toHaveLength(1);
    expect(list.body.files[0].name).toBe("mockup.png");

    const dl = await http.get(`/files/${fileId}`).set(auth(f.access)).expect(200);
    expect(dl.headers["content-type"]).toContain("image/png");
    expect(dl.body.length).toBe(up.body.file.sizeBytes);
  });

  it("rejects files over 5MB with 413", async () => {
    const f = await fixture();
    const big = Buffer.alloc(5 * 1024 * 1024 + 1024, 7).toString("base64");
    await http
      .post(`/tasks/${f.task}/files`)
      .set(auth(f.access))
      .send({ name: "big.bin", mime: "application/octet-stream", dataBase64: big })
      .expect(413);
  });

  it("surfaces attachmentCount on the task card and blocks non-uploader delete", async () => {
    const f = await fixture();
    const up = await http
      .post(`/tasks/${f.task}/files`)
      .set(auth(f.access))
      .send({ name: "a.png", mime: "image/png", dataBase64: PNG })
      .expect(201);
    const card = (
      await http.get(`/lists/${f.list}/tasks`).set(auth(f.access)).expect(200)
    ).body.tasks.find((t: { id: string }) => t.id === f.task);
    expect(card.attachmentCount).toBe(1);

    const bob = await signup();
    const bobAccess = await join(f.access, f.workspaceId, bob);
    await http
      .delete(`/files/${up.body.file.id}`)
      .set(auth(bobAccess))
      .expect(403);
  });
});

describe("proofing", () => {
  it("adds an annotation, notifies, and resolves it", async () => {
    const f = await fixture();
    const bob = await signup();
    const bobAccess = await join(f.access, f.workspaceId, bob);
    // assign bob so he is notified on annotation
    await http
      .post(`/tasks/${f.task}/assignees`)
      .set(auth(f.access))
      .send({ userId: bob.userId })
      .expect(201);
    const fileId = (
      await http
        .post(`/tasks/${f.task}/files`)
        .set(auth(f.access))
        .send({ name: "art.png", mime: "image/png", dataBase64: PNG })
        .expect(201)
    ).body.file.id as string;

    const ann = await http
      .post(`/files/${fileId}/annotations`)
      .set(auth(f.access))
      .send({ x: 0.5, y: 0.25, body: "Fix the alignment here" })
      .expect(201);
    expect(ann.body.annotation.x).toBeCloseTo(0.5);

    const bobInbox = await http.get("/notifications").set(auth(bobAccess)).expect(200);
    expect(bobInbox.body.unreadCount).toBeGreaterThanOrEqual(1);

    await http
      .patch(`/annotations/${ann.body.annotation.id}`)
      .set(auth(f.access))
      .send({ resolved: true })
      .expect(200);
    const anns = await http
      .get(`/files/${fileId}/annotations`)
      .set(auth(f.access))
      .expect(200);
    expect(anns.body.annotations[0].resolvedAt).toBeTruthy();
  });
});

describe("whiteboards & mind maps", () => {
  it("round-trips whiteboard elements and rejects oversize", async () => {
    const f = await fixture();
    const wb = (
      await http
        .post("/whiteboards")
        .set(auth(f.access))
        .send({ name: "Jam" })
        .expect(201)
    ).body.whiteboard.id as string;
    const els = [
      { id: "a", kind: "sticky", x: 10, y: 10, w: 100, h: 80, text: "Hi", color: "#FDE68A" },
    ];
    await http.patch(`/whiteboards/${wb}`).set(auth(f.access)).send({ elements: els }).expect(200);
    const got = await http.get(`/whiteboards/${wb}`).set(auth(f.access)).expect(200);
    expect(got.body.whiteboard.elements).toHaveLength(1);

    const huge = Array.from({ length: 20000 }, (_, i) => ({
      id: `n${i}`,
      kind: "sticky",
      x: i,
      y: i,
      w: 100,
      h: 80,
      text: "x".repeat(40),
    }));
    await http.patch(`/whiteboards/${wb}`).set(auth(f.access)).send({ elements: huge }).expect(413);
  });

  it("creates a mind map with a root node and round-trips it", async () => {
    const f = await fixture();
    const mm = (
      await http
        .post("/mindmaps")
        .set(auth(f.access))
        .send({ name: "Strategy" })
        .expect(201)
    ).body.mindmap.id as string;
    const got = await http.get(`/mindmaps/${mm}`).set(auth(f.access)).expect(200);
    expect(got.body.mindmap.root.text).toBe("Strategy");
    const root = { ...got.body.mindmap.root, children: [{ id: "c1", text: "Pillar 1", children: [] }] };
    await http.patch(`/mindmaps/${mm}`).set(auth(f.access)).send({ root }).expect(200);
    const after = await http.get(`/mindmaps/${mm}`).set(auth(f.access)).expect(200);
    expect(after.body.mindmap.root.children).toHaveLength(1);
  });

  it("excludes guests from whiteboards", async () => {
    const f = await fixture();
    const guest = await signup();
    const guestAccess = await join(f.access, f.workspaceId, guest, "guest");
    await http.get("/whiteboards").set(auth(guestAccess)).expect(403);
  });
});
