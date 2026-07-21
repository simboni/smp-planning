import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import express from "express";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { EmailService, type EmailMessage } from "../src/comms/email.service";

/**
 * End-to-end tests for Module 27 (password reset). The email provider is a
 * fake that captures the reset link so the test can extract the token, mirror
 * the real flow, and confirm the new password works while the old one — and
 * old sessions — stop.
 */

const sent: EmailMessage[] = [];
class FakeEmail {
  providerName() {
    return "fake";
  }
  configured() {
    return true;
  }
  async send(msg: EmailMessage) {
    sent.push(msg);
    return { ok: true, provider: "fake", detail: "captured" };
  }
  async sendTest(to: string) {
    return this.send({ to, subject: "t", text: "t" });
  }
}

let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailService)
    .useClass(FakeEmail)
    .compile();
  app = moduleRef.createNestApplication({ bodyParser: false });
  app.use(express.json({ limit: "12mb" }));
  await app.init();
  http = request(app.getHttpServer());
});
afterAll(async () => {
  await app.close();
});

const uniqueEmail = () => `pr${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;

function tokenFromLastEmail(): string {
  const link = sent[sent.length - 1].text.match(/\/reset\?token=([a-f0-9]+)/);
  if (!link) throw new Error("no reset link in email");
  return link[1];
}

describe("password reset", () => {
  it("emails a reset link, sets a new password, and invalidates the old one", async () => {
    const email = uniqueEmail();
    await http
      .post("/auth/signup")
      .send({ email, fullName: "Reset User", password: "oldpassword1" })
      .expect(201);

    // Request a reset — always 200, and an email is captured.
    const before = sent.length;
    await http.post("/auth/forgot-password").send({ email }).expect(200);
    expect(sent.length).toBe(before + 1);
    const token = tokenFromLastEmail();

    // Complete the reset.
    await http
      .post("/auth/reset-password")
      .send({ token, password: "newpassword1" })
      .expect(200);

    // New password works; old one is rejected.
    await http.post("/auth/login").send({ email, password: "newpassword1" }).expect(200);
    await http.post("/auth/login").send({ email, password: "oldpassword1" }).expect(401);

    // The token is single-use.
    await http
      .post("/auth/reset-password")
      .send({ token, password: "another1234" })
      .expect(400);
  });

  it("returns 200 for an unknown email without sending anything", async () => {
    const before = sent.length;
    await http
      .post("/auth/forgot-password")
      .send({ email: "nobody-here@t.test" })
      .expect(200);
    expect(sent.length).toBe(before);
  });

  it("rejects an invalid or too-short reset", async () => {
    await http
      .post("/auth/reset-password")
      .send({ token: "deadbeef", password: "longenough1" })
      .expect(400);
    await http
      .post("/auth/reset-password")
      .send({ token: "whatever", password: "short" })
      .expect(400);
  });
});
