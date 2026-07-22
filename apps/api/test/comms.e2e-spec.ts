import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import express from "express";
import request from "supertest";
import { AppModule } from "../src/app.module";
import {
  EmailService,
  type BrandedMessage,
  type EmailMessage,
} from "../src/comms/email.service";
import { brandedText, renderBrandedEmail } from "../src/comms/email.template";
import { SlackClient } from "../src/comms/slack.client";

/**
 * End-to-end tests for Module 22 (comms & integrations). The email provider
 * and the Slack poster are replaced with fakes that capture what would be
 * sent, so delivery, the Slack config lifecycle, the test message, and the
 * event-driven notification are all exercised without network.
 */

const sentEmails: EmailMessage[] = [];
class FakeEmail {
  providerName() {
    return "fake";
  }
  configured() {
    return true;
  }
  async send(msg: EmailMessage) {
    sentEmails.push(msg);
    return { ok: true, provider: "fake", detail: "captured" };
  }
  async sendBranded(msg: BrandedMessage) {
    const { to, subject, ...fields } = msg;
    return this.send({
      to,
      subject,
      text: brandedText(fields),
      html: renderBrandedEmail(fields),
    });
  }
}

const slackPosts: { url: string; text: string }[] = [];
class FakeSlack {
  async post(url: string, text: string) {
    slackPosts.push({ url, text });
    return { ok: true, detail: "captured" };
  }
}

let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailService)
    .useClass(FakeEmail)
    .overrideProvider(SlackClient)
    .useClass(FakeSlack)
    .compile();
  app = moduleRef.createNestApplication({ bodyParser: false });
  app.use(express.json({ limit: "12mb" }));
  await app.init();
  http = request(app.getHttpServer());
});
afterAll(async () => {
  await app.close();
});

const uniqueEmail = () => `c${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function scaffold() {
  const email = uniqueEmail();
  const su = await http
    .post("/auth/signup")
    .send({ email, fullName: "Comms", password: "password123" })
    .expect(201);
  const identityToken = su.body.identityToken as string;
  const ws = await http.post("/workspaces").set(auth(identityToken)).send({ name: "Commco" }).expect(201);
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
  return { workspaceId, access, task, identityToken };
}

describe("email delivery", () => {
  it("routes a task email through the pluggable provider", async () => {
    const { access, task } = await scaffold();
    const before = sentEmails.length;
    const res = await http
      .post(`/tasks/${task}/emails`)
      .set(auth(access))
      .send({ to: "client@acme.test", subject: "Your update", body: "All done." })
      .expect(201);
    expect(res.body.delivery.ok).toBe(true);
    expect(sentEmails.length).toBe(before + 1);
    const last = sentEmails[sentEmails.length - 1];
    expect(last.to).toBe("client@acme.test");
    expect(last.subject).toBe("Your update");
    expect(last.text).toContain("All done.");
  });

  it("reports the active email provider", async () => {
    const { access } = await scaffold();
    const res = await http.get("/integrations/email").set(auth(access)).expect(200);
    expect(res.body.provider).toBe("fake");
    expect(res.body.configured).toBe(true);
  });
});

describe("Slack integration", () => {
  it("configures, tests, notifies on events, and removes", async () => {
    const { access, task } = await scaffold();

    // Not configured yet.
    const empty = await http.get("/integrations/slack").set(auth(access)).expect(200);
    expect(empty.body.configured).toBe(false);

    // A non-https URL is rejected.
    await http
      .put("/integrations/slack")
      .set(auth(access))
      .send({ webhookUrl: "http://insecure/hook" })
      .expect(400);

    // Configure with an https webhook.
    const cfg = await http
      .put("/integrations/slack")
      .set(auth(access))
      .send({ webhookUrl: "https://hooks.slack.com/services/T/B/xxxxx", events: ["*"] })
      .expect(200);
    expect(cfg.body.configured).toBe(true);
    // The raw webhook (with its secret) is never echoed back.
    expect(JSON.stringify(cfg.body)).not.toContain("/services/T/B/xxxxx");

    // Test message posts to Slack.
    const before = slackPosts.length;
    const test = await http.post("/integrations/slack/test").set(auth(access)).expect(200);
    expect(test.body.ok).toBe(true);
    expect(slackPosts.length).toBe(before + 1);

    // A real change hint posts a human-readable line.
    const n = slackPosts.length;
    await http
      .patch(`/tasks/${task}`)
      .set(auth(access))
      .send({ name: "Renamed task" })
      .expect(200);
    // The event bus fires synchronously in-process; give the tap a tick.
    await new Promise((r) => setTimeout(r, 50));
    expect(slackPosts.length).toBeGreaterThan(n);
    expect(slackPosts[slackPosts.length - 1].text).toMatch(/task/i);

    // Remove clears it.
    await http.delete("/integrations/slack").set(auth(access)).expect(204);
    const gone = await http.get("/integrations/slack").set(auth(access)).expect(200);
    expect(gone.body.configured).toBe(false);
  });

  it("forbids a non-admin from configuring Slack", async () => {
    const { access, workspaceId } = await scaffold();
    const memberEmail = uniqueEmail();
    const mem = await http
      .post("/auth/signup")
      .send({ email: memberEmail, fullName: "Mem", password: "password123" })
      .expect(201);
    await http
      .post("/workspaces/current/members")
      .set(auth(access))
      .send({ email: memberEmail, role: "member" })
      .expect(201);
    const memTok = (
      await http.post(`/workspaces/${workspaceId}/token`).set(auth(mem.body.identityToken)).expect(200)
    ).body.accessToken as string;
    await http
      .put("/integrations/slack")
      .set(auth(memTok))
      .send({ webhookUrl: "https://hooks.slack.com/services/x/y/z" })
      .expect(403);
  });
});
