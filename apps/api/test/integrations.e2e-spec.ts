import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import express from "express";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 15 (AI Brain, public REST API + PATs, webhooks,
 * import/export). AI runs its heuristic path (no ANTHROPIC_API_KEY in CI), so
 * assertions target structure, not model wording.
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

async function fixture() {
  const email = uniqueEmail();
  const signup = await http
    .post("/auth/signup")
    .send({ email, fullName: "M15 User", password: "password123" })
    .expect(201);
  const identityToken = signup.body.identityToken as string;
  const ws = await http
    .post("/workspaces")
    .set(auth(identityToken))
    .send({ name: "M15 WS" })
    .expect(201);
  const workspaceId = ws.body.workspace.id as string;
  const access = (
    await http
      .post(`/workspaces/${workspaceId}/token`)
      .set(auth(identityToken))
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
      .send({ name: "Ship onboarding" })
      .expect(201)
  ).body.task.id as string;
  return { identityToken, workspaceId, access, space, list, task };
}

describe("AI Brain (heuristic path)", () => {
  it("reports availability and model", async () => {
    const f = await fixture();
    const res = await http.get("/ai/status").set(auth(f.access)).expect(200);
    expect(typeof res.body.available).toBe("boolean");
    expect(res.body.model).toBe("claude-opus-4-8");
  });

  it("rewrites text and summarizes a task", async () => {
    const f = await fixture();
    const w = await http
      .post("/ai/write")
      .set(auth(f.access))
      .send({ action: "improve", text: "make the onboarding flow better" })
      .expect(201);
    expect(w.body.text.length).toBeGreaterThan(0);
    expect(["claude", "heuristic"]).toContain(w.body.source);

    const s = await http
      .post(`/ai/tasks/${f.task}/summary`)
      .set(auth(f.access))
      .expect(201);
    expect(s.body.text).toContain("onboarding");
  });

  it("suggests subtasks and parses a command", async () => {
    const f = await fixture();
    const sub = await http
      .post(`/ai/tasks/${f.task}/subtasks`)
      .set(auth(f.access))
      .expect(201);
    expect(Array.isArray(sub.body.items)).toBe(true);
    expect(sub.body.items.length).toBeGreaterThan(0);

    const cmd = await http
      .post("/ai/command")
      .set(auth(f.access))
      .send({ text: "create a task Draft Q3 roadmap" })
      .expect(201);
    expect(cmd.body.command.intent).toBe("create_task");
    expect(cmd.body.command.taskName.toLowerCase()).toContain("roadmap");
  });
});

describe("Public API & Personal Access Tokens", () => {
  it("mints a token and uses it to read and write", async () => {
    const f = await fixture();
    const minted = await http
      .post("/pat")
      .set(auth(f.access))
      .send({ name: "CI token", scope: "write" })
      .expect(201);
    const token = minted.body.token as string;
    expect(token.startsWith("stackup_pat_")).toBe(true);
    expect(minted.body.pat.tokenPrefix.startsWith("stackup_pat_")).toBe(true);

    const me = await http.get("/api/v1/me").set(auth(token)).expect(200);
    expect(me.body.workspaceId).toBe(f.workspaceId);

    const spaces = await http.get("/api/v1/spaces").set(auth(token)).expect(200);
    expect(spaces.body.spaces.length).toBeGreaterThanOrEqual(1);

    const created = await http
      .post(`/api/v1/lists/${f.list}/tasks`)
      .set(auth(token))
      .send({ name: "Via public API" })
      .expect(201);
    expect(created.body.task.name).toBe("Via public API");
  });

  it("enforces read scope and rejects revoked tokens", async () => {
    const f = await fixture();
    const ro = await http
      .post("/pat")
      .set(auth(f.access))
      .send({ name: "readonly", scope: "read" })
      .expect(201);
    const token = ro.body.token as string;
    await http.get("/api/v1/spaces").set(auth(token)).expect(200);
    await http
      .post(`/api/v1/lists/${f.list}/tasks`)
      .set(auth(token))
      .send({ name: "nope" })
      .expect(403);

    await http.delete(`/pat/${ro.body.pat.id}`).set(auth(f.access)).expect(204);
    await http.get("/api/v1/spaces").set(auth(token)).expect(401);
  });

  it("rejects a bogus token", async () => {
    await http.get("/api/v1/spaces").set(auth("stackup_pat_deadbeef")).expect(401);
    await http.get("/api/v1/spaces").set(auth("not-a-token")).expect(401);
  });
});

describe("Webhooks", () => {
  let receiver: Server;
  let received: { headers: Record<string, string>; body: unknown }[] = [];
  let url = "";

  beforeAll(async () => {
    receiver = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        received.push({
          headers: req.headers as Record<string, string>,
          body: data ? JSON.parse(data) : null,
        });
        res.writeHead(200);
        res.end("ok");
      });
    });
    await new Promise<void>((r) => receiver.listen(0, r));
    url = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => receiver.close(() => r()));
  });

  it("creates a webhook and delivers a signed test ping", async () => {
    const f = await fixture();
    received = [];
    const created = await http
      .post("/webhooks")
      .set(auth(f.access))
      .send({ url, events: ["*"] })
      .expect(201);
    expect(created.body.secret.startsWith("whsec_")).toBe(true);

    const test = await http
      .post(`/webhooks/${created.body.webhook.id}/test`)
      .set(auth(f.access))
      .expect(201);
    expect(test.body.ok).toBe(true);
    expect(received.length).toBe(1);
    expect(received[0].headers["x-stackup-signature"]).toMatch(/^sha256=/);
    expect((received[0].body as { event: string }).event).toBe("ping");

    const dels = await http
      .get(`/webhooks/${created.body.webhook.id}/deliveries`)
      .set(auth(f.access))
      .expect(200);
    expect(dels.body.deliveries.length).toBeGreaterThanOrEqual(1);
  });

  it("fans real task events out to the endpoint", async () => {
    const f = await fixture();
    received = [];
    await http
      .post("/webhooks")
      .set(auth(f.access))
      .send({ url, events: ["task.changed"] })
      .expect(201);
    await http
      .post(`/lists/${f.list}/tasks`)
      .set(auth(f.access))
      .send({ name: "Triggers a webhook" })
      .expect(201);
    // dispatch is fire-and-forget; give the event loop a beat.
    await new Promise((r) => setTimeout(r, 300));
    expect(received.some((r) => (r.body as { event: string }).event === "task.changed")).toBe(true);
  });
});

describe("Import / Export", () => {
  it("exports the workspace as JSON and a list as CSV", async () => {
    const f = await fixture();
    const json = await http
      .get("/export/workspace")
      .set(auth(f.access))
      .expect(200);
    expect(json.body.spaces.length).toBeGreaterThanOrEqual(1);

    const csv = await http
      .get(`/lists/${f.list}/export.csv`)
      .set(auth(f.access))
      .expect(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("Name");
    expect(csv.text).toContain("Ship onboarding");
  });

  it("imports tasks from CSV and a Trello board", async () => {
    const f = await fixture();
    const csv = "Name,Description\nDesign spec,Write it\nBuild it,\n";
    const imp = await http
      .post("/import/csv")
      .set(auth(f.access))
      .send({ listId: f.list, csv })
      .expect(201);
    expect(imp.body.tasks).toBe(2);

    const trello = {
      name: "My Trello Board",
      lists: [
        { id: "l1", name: "To Do" },
        { id: "l2", name: "Done" },
      ],
      cards: [
        { name: "Card A", desc: "first", idList: "l1" },
        { name: "Card B", idList: "l2" },
      ],
    };
    const board = await http
      .post("/import/board")
      .set(auth(f.access))
      .send({ source: "trello", data: trello })
      .expect(201);
    expect(board.body.lists).toBe(2);
    expect(board.body.tasks).toBe(2);
  });
});
