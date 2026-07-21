import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import express from "express";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 24 (pricing plans & feature gating): the plan
 * catalog, the owner-gated switch, plan-driven usage limits, and the feature
 * gates (custom roles / audit log / branding / advanced cards) flipping with
 * the plan.
 */

let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ bodyParser: false });
  app.use(express.json({ limit: "12mb" }));
  await app.init();
  http = request(app.getHttpServer());
});
afterAll(async () => {
  await app.close();
});

const uniqueEmail = () => `p${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function scaffold() {
  const email = uniqueEmail();
  const su = await http
    .post("/auth/signup")
    .send({ email, fullName: "Plan User", password: "password123" })
    .expect(201);
  const identityToken = su.body.identityToken as string;
  const ws = await http.post("/workspaces").set(auth(identityToken)).send({ name: "Planco" }).expect(201);
  const workspaceId = ws.body.workspace.id as string;
  const access = (
    await http.post(`/workspaces/${workspaceId}/token`).set(auth(identityToken)).expect(200)
  ).body.accessToken as string;
  return { workspaceId, access, identityToken };
}

describe("plans", () => {
  it("workspaces start Free; the catalog lists all four plans", async () => {
    const { access } = await scaffold();
    const res = await http.get("/plans").set(auth(access)).expect(200);
    expect(res.body.current).toBe("free");
    expect(res.body.plans.map((p: { id: string }) => p.id)).toEqual([
      "free",
      "unlimited",
      "business",
      "enterprise",
    ]);
    // Free-plan numbers drive the usage report.
    const usage = await http.get("/limits/usage").set(auth(access)).expect(200);
    expect(usage.body.storage.limitBytes).toBe(500 * 1024 * 1024);
    expect(usage.body.automations.limit).toBe(100);
  });

  it("only the owner can switch plans; limits follow the plan", async () => {
    const { workspaceId, access } = await scaffold();

    // A member is refused.
    const memEmail = uniqueEmail();
    const mem = await http
      .post("/auth/signup")
      .send({ email: memEmail, fullName: "Mem", password: "password123" })
      .expect(201);
    await http
      .post("/workspaces/current/members")
      .set(auth(access))
      .send({ email: memEmail, role: "admin" })
      .expect(201);
    const memTok = (
      await http.post(`/workspaces/${workspaceId}/token`).set(auth(mem.body.identityToken)).expect(200)
    ).body.accessToken as string;
    await http.post("/plans/select").set(auth(memTok)).send({ plan: "business" }).expect(403);

    // Bad plan id rejected; owner switch works.
    await http.post("/plans/select").set(auth(access)).send({ plan: "platinum" }).expect(400);
    await http.post("/plans/select").set(auth(access)).send({ plan: "business" }).expect(200);

    const res = await http.get("/plans").set(auth(access)).expect(200);
    expect(res.body.current).toBe("business");
    const usage = await http.get("/limits/usage").set(auth(access)).expect(200);
    expect(usage.body.storage.limitBytes).toBe(100 * 1024 * 1024 * 1024);
    expect(usage.body.automations.limit).toBe(10_000);
  });

  it("feature gates flip with the plan", async () => {
    const { access } = await scaffold();

    // FREE: custom roles, audit log, branding, advanced cards all refused.
    await http
      .post("/governance/roles")
      .set(auth(access))
      .send({ name: "Blocked", baseRole: "member" })
      .expect(403);
    await http.get("/audit").set(auth(access)).expect(403);
    await http
      .patch("/workspaces/current")
      .set(auth(access))
      .send({ color: "#10B981" })
      .expect(403);
    const dash = (
      await http.post("/dashboards").set(auth(access)).send({ name: "D" }).expect(201)
    ).body.dashboard;
    await http
      .post(`/dashboards/${dash.id}/cards`)
      .set(auth(access))
      .send({ kind: "completionTrend" })
      .expect(403);
    // Renaming the workspace stays free.
    await http
      .patch("/workspaces/current")
      .set(auth(access))
      .send({ name: "Still Free Co" })
      .expect(200);
    // Basic cards stay free.
    await http
      .post(`/dashboards/${dash.id}/cards`)
      .set(auth(access))
      .send({ kind: "text", config: { text: "hi" } })
      .expect(201);

    // BUSINESS: everything unlocks.
    await http.post("/plans/select").set(auth(access)).send({ plan: "business" }).expect(200);
    await http
      .post("/governance/roles")
      .set(auth(access))
      .send({ name: "Allowed", baseRole: "member" })
      .expect(201);
    await http.get("/audit").set(auth(access)).expect(200);
    await http
      .patch("/workspaces/current")
      .set(auth(access))
      .send({ color: "#10B981" })
      .expect(200);
    await http
      .post(`/dashboards/${dash.id}/cards`)
      .set(auth(access))
      .send({ kind: "completionTrend" })
      .expect(201);
  });
});
