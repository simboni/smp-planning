import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import express from "express";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 20 (limits & metering): the usage report
 * reflects real attachment bytes, and the storage cap is enforced on upload.
 * A tiny per-workspace override is written directly as the migrator (the app
 * role has SELECT-only on workspace_limits), mirroring how a billing layer
 * would set caps out-of-band.
 */

let app: INestApplication;
let http: ReturnType<typeof request>;
let admin: Client;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ bodyParser: false });
  app.use(express.json({ limit: "12mb" }));
  await app.init();
  http = request(app.getHttpServer());
  admin = new Client({
    connectionString:
      process.env.ADMIN_DB_URL ??
      "postgres://stackup_migrator:migrator_dev_pw@localhost:5432/stackup_test",
  });
  await admin.connect();
});
afterAll(async () => {
  await admin.end();
  await app.close();
});

const uniqueEmail = () => `lim${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
// A 1x1 PNG (~68 bytes decoded) — enough to exceed a 10-byte cap.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function scaffold() {
  const email = uniqueEmail();
  const su = await http
    .post("/auth/signup")
    .send({ email, fullName: "Lim", password: "password123" })
    .expect(201);
  const identityToken = su.body.identityToken as string;
  const ws = await http.post("/workspaces").set(auth(identityToken)).send({ name: "Limco" }).expect(201);
  const workspaceId = ws.body.workspace.id as string;
  const access = (
    await http.post(`/workspaces/${workspaceId}/token`).set(auth(identityToken)).expect(200)
  ).body.accessToken as string;
  const space = (await http.post("/spaces").set(auth(access)).send({ name: "S" }).expect(201)).body.space.id;
  const list = (
    await http.post(`/spaces/${space}/lists`).set(auth(access)).send({ name: "L" }).expect(201)
  ).body.list.id;
  const task = (
    await http.post(`/lists/${list}/tasks`).set(auth(access)).send({ name: "T" }).expect(201)
  ).body.task.id;
  return { workspaceId, access, task };
}

describe("limits & metering", () => {
  it("reports usage that grows as attachments are added", async () => {
    const { access, task } = await scaffold();

    const before = await http.get("/limits/usage").set(auth(access)).expect(200);
    expect(before.body.storage.usedBytes).toBe(0);
    expect(before.body.storage.limitBytes).toBeGreaterThan(0);
    expect(before.body.automations.limit).toBeGreaterThan(0);

    await http
      .post(`/tasks/${task}/files`)
      .set(auth(access))
      .send({ name: "a.png", mime: "image/png", dataBase64: PNG })
      .expect(201);

    const after = await http.get("/limits/usage").set(auth(access)).expect(200);
    expect(after.body.storage.usedBytes).toBeGreaterThan(0);
    expect(after.body.storage.percent).toBeGreaterThanOrEqual(0);
  });

  it("rejects an upload that would exceed the storage cap", async () => {
    const { workspaceId, access, task } = await scaffold();
    // Set a 10-byte cap for this workspace (as the migrator).
    await admin.query(
      `INSERT INTO workspace_limits (workspace_id, storage_limit_bytes)
       VALUES ($1, 10)
       ON CONFLICT (workspace_id) DO UPDATE SET storage_limit_bytes = 10`,
      [workspaceId],
    );

    await http
      .post(`/tasks/${task}/files`)
      .set(auth(access))
      .send({ name: "big.png", mime: "image/png", dataBase64: PNG })
      .expect(413);

    // Usage still reads back cleanly with the tiny cap.
    const usage = await http.get("/limits/usage").set(auth(access)).expect(200);
    expect(usage.body.storage.limitBytes).toBe(10);
  });
});
