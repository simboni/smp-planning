import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import express from "express";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 26 (public share links). A member creates a
 * link for an entity; an anonymous caller (no Authorization header) can then
 * read that entity read-only, and a revoked/invalid token 404s.
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

const uniqueEmail = () => `s${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function scaffold() {
  const su = await http
    .post("/auth/signup")
    .send({ email: uniqueEmail(), fullName: "Sharer", password: "password123" })
    .expect(201);
  const identityToken = su.body.identityToken as string;
  const ws = await http
    .post("/workspaces")
    .set(auth(identityToken))
    .send({ name: "ShareCo" })
    .expect(201);
  const access = (
    await http
      .post(`/workspaces/${ws.body.workspace.id}/token`)
      .set(auth(identityToken))
      .expect(200)
  ).body.accessToken as string;
  const space = (
    await http.post("/spaces").set(auth(access)).send({ name: "Product" }).expect(201)
  ).body.space.id as string;
  const list = (
    await http
      .post(`/spaces/${space}/lists`)
      .set(auth(access))
      .send({ name: "Roadmap" })
      .expect(201)
  ).body.list.id as string;
  const task = (
    await http
      .post(`/lists/${list}/tasks`)
      .set(auth(access))
      .send({ name: "Public demo task" })
      .expect(201)
  ).body.task.id as string;
  return { identityToken, access, space, list, task };
}

describe("public share links", () => {
  it("shares a list and resolves it anonymously", async () => {
    const f = await scaffold();
    const created = await http
      .post("/shares")
      .set(auth(f.access))
      .send({ entityType: "list", entityId: f.list })
      .expect(201);
    const token = created.body.share.token as string;
    expect(token.startsWith("share_")).toBe(true);
    expect(created.body.share.permission).toBe("view");

    // Anonymous resolve — NO Authorization header.
    const view = (await http.get(`/public/share/${token}`).expect(200)).body.view;
    expect(view.entityType).toBe("list");
    expect(view.workspaceName).toBe("ShareCo");
    expect(view.list.tasks.map((t: { name: string }) => t.name)).toContain(
      "Public demo task",
    );

    // Re-sharing the same entity returns the SAME live link (idempotent).
    const again = await http
      .post("/shares")
      .set(auth(f.access))
      .send({ entityType: "list", entityId: f.list })
      .expect(201);
    const existing = await http
      .get(`/shares?type=list&id=${f.list}`)
      .set(auth(f.access))
      .expect(200);
    expect(existing.body.share.id).toBe(again.body.share.id);
  });

  it("shares a task and revokes it", async () => {
    const f = await scaffold();
    const share = (
      await http
        .post("/shares")
        .set(auth(f.access))
        .send({ entityType: "task", entityId: f.task })
        .expect(201)
    ).body.share;
    const tv = (await http.get(`/public/share/${share.token}`).expect(200)).body.view;
    expect(tv.entityType).toBe("task");
    expect(tv.title).toBe("Public demo task");

    // Revoke → the link stops working immediately.
    await http.delete(`/shares/${share.id}`).set(auth(f.access)).expect(204);
    await http.get(`/public/share/${share.token}`).expect(404);
  });

  it("404s an unknown token and rejects an unknown entity type", async () => {
    const f = await scaffold();
    await http.get("/public/share/share_does_not_exist").expect(404);
    await http
      .post("/shares")
      .set(auth(f.access))
      .send({ entityType: "nonsense", entityId: f.task })
      .expect(400);
  });
});
