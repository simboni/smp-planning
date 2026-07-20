import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import express from "express";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 19 branding: admins can change a workspace's
 * name / accent color / logo; members cannot; invalid colors are rejected.
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

const uniqueEmail = () => `b${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function signup(email = uniqueEmail()) {
  const res = await http
    .post("/auth/signup")
    .send({ email, fullName: "Brand User", password: "password123" })
    .expect(201);
  return { email, identityToken: res.body.identityToken as string };
}
async function makeWorkspace(identityToken: string) {
  const ws = await http.post("/workspaces").set(auth(identityToken)).send({ name: "Brandco" }).expect(201);
  const tok = await http.post(`/workspaces/${ws.body.workspace.id}/token`).set(auth(identityToken)).expect(200);
  return { workspaceId: ws.body.workspace.id as string, accessToken: tok.body.accessToken as string };
}

describe("workspace branding", () => {
  it("lets an admin change name, color and logo", async () => {
    const owner = await signup();
    const { accessToken } = await makeWorkspace(owner.identityToken);
    const res = await http
      .patch("/workspaces/current")
      .set(auth(accessToken))
      .send({ name: "Renamed Co", color: "#10B981", avatarUrl: "https://x/logo.png" })
      .expect(200);
    expect(res.body.workspace.name).toBe("Renamed Co");
    expect(res.body.workspace.color).toBe("#10B981");
    expect(res.body.workspace.avatarUrl).toBe("https://x/logo.png");

    // Clearing the logo works.
    const cleared = await http
      .patch("/workspaces/current")
      .set(auth(accessToken))
      .send({ avatarUrl: "" })
      .expect(200);
    expect(cleared.body.workspace.avatarUrl).toBeNull();
  });

  it("rejects a malformed color", async () => {
    const owner = await signup();
    const { accessToken } = await makeWorkspace(owner.identityToken);
    await http
      .patch("/workspaces/current")
      .set(auth(accessToken))
      .send({ color: "blue" })
      .expect(400);
  });

  it("forbids a plain member from changing branding", async () => {
    const owner = await signup();
    const { workspaceId, accessToken: ownerTok } = await makeWorkspace(owner.identityToken);
    const memberEmail = uniqueEmail();
    const member = await signup(memberEmail);
    await http
      .post("/workspaces/current/members")
      .set(auth(ownerTok))
      .send({ email: memberEmail, role: "member" })
      .expect(201);
    const memberTok = (
      await http.post(`/workspaces/${workspaceId}/token`).set(auth(member.identityToken)).expect(200)
    ).body.accessToken as string;
    await http
      .patch("/workspaces/current")
      .set(auth(memberTok))
      .send({ name: "Hijacked" })
      .expect(403);
  });
});
