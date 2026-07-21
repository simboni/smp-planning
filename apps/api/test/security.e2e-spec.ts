import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import express from "express";
import { authenticator } from "otplib";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 16 (2FA + session management). Uses the real
 * otplib to generate valid TOTP codes against the secret returned by enroll.
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

const uniqueEmail = () => `s${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function signup(email = uniqueEmail()) {
  const res = await http
    .post("/auth/signup")
    .send({ email, fullName: "Sec User", password: "password123" })
    .expect(201);
  return { email, identityToken: res.body.identityToken as string, refreshToken: res.body.refreshToken as string };
}

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("profile", () => {
  it("updates the display name and avatar, and rejects a non-image avatar", async () => {
    const u = await signup();
    const ok = await http
      .patch("/auth/me")
      .set(auth(u.identityToken))
      .send({ fullName: "Renamed Person", avatarUrl: TINY_PNG })
      .expect(200);
    expect(ok.body.user.fullName).toBe("Renamed Person");
    expect(ok.body.user.avatarUrl).toBe(TINY_PNG);

    // A non-image string is refused.
    await http
      .patch("/auth/me")
      .set(auth(u.identityToken))
      .send({ avatarUrl: "javascript:alert(1)" })
      .expect(400);

    // null clears it.
    const cleared = await http
      .patch("/auth/me")
      .set(auth(u.identityToken))
      .send({ avatarUrl: null })
      .expect(200);
    expect(cleared.body.user.avatarUrl).toBeNull();
  });
});

/** Enroll + enable 2FA; returns the shared secret. */
async function enable2fa(identityToken: string): Promise<string> {
  const en = await http.post("/auth/2fa/enroll").set(auth(identityToken)).expect(201);
  expect(en.body.qrDataUrl).toMatch(/^data:image\/png/);
  const secret = new URL(en.body.otpauthUri).searchParams.get("secret") as string;
  await http
    .post("/auth/2fa/enable")
    .set(auth(identityToken))
    .send({ code: authenticator.generate(secret) })
    .expect(201);
  return secret;
}

describe("two-factor auth", () => {
  it("enrolls, enables, and gates login behind a code", async () => {
    const u = await signup();
    const secret = await enable2fa(u.identityToken);

    const status = await http.get("/auth/2fa/status").set(auth(u.identityToken)).expect(200);
    expect(status.body.enabled).toBe(true);

    // login now returns a challenge, not tokens
    const login = await http.post("/auth/login").send({ email: u.email, password: "password123" }).expect(200);
    expect(login.body.twoFactorRequired).toBe(true);
    expect(login.body.identityToken).toBeUndefined();
    const challengeToken = login.body.challengeToken as string;

    // wrong code rejected
    await http.post("/auth/2fa/login").send({ challengeToken, code: "000000" }).expect(401);

    // the pre-2FA challenge token must NOT authenticate real endpoints — it is
    // not a credential, so presenting it as a Bearer token is rejected.
    await http.get("/auth/me").set(auth(challengeToken)).expect(401);
    await http.post("/auth/2fa/enroll").set(auth(challengeToken)).expect(401);

    // correct code completes login
    const done = await http
      .post("/auth/2fa/login")
      .send({ challengeToken, code: authenticator.generate(secret) })
      .expect(200);
    expect(done.body.identityToken).toBeTruthy();
    expect(done.body.refreshToken).toBeTruthy();
  });

  it("can be disabled with a valid code, restoring direct login", async () => {
    const u = await signup();
    const secret = await enable2fa(u.identityToken);
    await http
      .post("/auth/2fa/disable")
      .set(auth(u.identityToken))
      .send({ code: authenticator.generate(secret) })
      .expect(201);
    const login = await http.post("/auth/login").send({ email: u.email, password: "password123" }).expect(200);
    expect(login.body.twoFactorRequired).toBeUndefined();
    expect(login.body.identityToken).toBeTruthy();
  });
});

describe("sessions", () => {
  it("lists active sessions, flags the current one, and revokes others", async () => {
    const u = await signup();
    // a second login creates a second session
    const second = await http
      .post("/auth/login")
      .send({ email: u.email, password: "password123" })
      .set("User-Agent", "Mozilla/5.0 (Macintosh) Chrome/120")
      .expect(200);

    const list = await http
      .get("/auth/sessions")
      .set(auth(u.identityToken))
      .set("x-refresh-token", u.refreshToken)
      .expect(200);
    expect(list.body.sessions.length).toBeGreaterThanOrEqual(2);
    expect(list.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const other = list.body.sessions.find((s: { current: boolean }) => !s.current);
    await http.delete(`/auth/sessions/${other.id}`).set(auth(u.identityToken)).expect(204);

    // the revoked session's refresh token no longer works
    await http.post("/auth/refresh").send({ refreshToken: second.body.refreshToken }).expect(401);

    const after = await http
      .get("/auth/sessions")
      .set(auth(u.identityToken))
      .set("x-refresh-token", u.refreshToken)
      .expect(200);
    expect(after.body.sessions.some((s: { id: string }) => s.id === other.id)).toBe(false);
  });

  it("logout revokes the presented refresh token", async () => {
    const u = await signup();
    // the token works before logout
    await http.post("/auth/refresh").send({ refreshToken: u.refreshToken }).expect(200);
    // NB: refresh rotates, so re-login for a fresh token to revoke
    const again = await http
      .post("/auth/login")
      .send({ email: u.email, password: "password123" })
      .expect(200);
    const rt = again.body.refreshToken as string;
    await http.post("/auth/logout").send({ refreshToken: rt }).expect(204);
    // after logout the token can no longer be redeemed
    await http.post("/auth/refresh").send({ refreshToken: rt }).expect(401);
    // logout is idempotent — a second call still succeeds
    await http.post("/auth/logout").send({ refreshToken: rt }).expect(204);
  });
});
